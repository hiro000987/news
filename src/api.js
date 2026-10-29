import {initialSchedule,scheduleReview} from './scheduler.js';
import {ApiError,check,isUuid,uuid,readJson,text,validateKnowledge,normalizeTitle,integerParam,validTimestamp} from './validation.js';
import {exportBackup,inspectBackup,importBackup,csvExport} from './backup.js';
import {aiStatus,generateAi} from './ai.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const all=async(db,sql,...values)=>(await db.prepare(sql).bind(...values).all()).results;
const first=(db,sql,...values)=>db.prepare(sql).bind(...values).first();
const scheduleDto=row=>({dueAt:row.due_at,intervalDays:row.interval_days,streak:row.streak,lapses:row.lapses,reviews:row.reviews,status:row.status});
const quizDto=q=>({id:q.id,type:q.type,prompt:q.prompt,answer:q.answer,explanation:q.explanation,options:JSON.parse(q.options_json),correctIndex:q.correct_index});
const reviewDto=r=>({id:r.id,knowledgeId:r.knowledge_id,quizId:r.quiz_id,rating:r.rating,response:r.response,selectedIndex:r.selected_index,correct:r.correct===null?null:!!r.correct,idempotencyKey:r.idempotency_key,createdAt:r.created_at});
async function hydrate(db,rows){
 if(!rows.length)return[];const ids=rows.map(r=>r.id),marks=ids.map(()=>'?').join(',');
 // D1 counts one batch as one query against the free per-invocation limit.
 const [states,categories,tags,sources,notes,quizzes]=(await db.batch([
 `SELECT * FROM review_state WHERE knowledge_id IN (${marks})`,
 `SELECT kc.knowledge_id,c.name FROM knowledge_categories kc JOIN categories c ON c.id=kc.category_id WHERE kc.knowledge_id IN (${marks})`,
 `SELECT kt.knowledge_id,t.name FROM knowledge_tags kt JOIN tags t ON t.id=kt.tag_id WHERE kt.knowledge_id IN (${marks}) ORDER BY t.name`,
 `SELECT * FROM sources WHERE knowledge_id IN (${marks})`,`SELECT * FROM notes WHERE knowledge_id IN (${marks})`,`SELECT * FROM quizzes WHERE knowledge_id IN (${marks}) AND active=1 ORDER BY rowid`
 ].map(sql=>db.prepare(sql).bind(...ids)))).map(result=>result.results);
 return rows.map(r=>({id:r.id,title:r.title,content:r.content,category:categories.find(x=>x.knowledge_id===r.id)?.name??'',tags:tags.filter(x=>x.knowledge_id===r.id).map(x=>x.name),sourceUrl:sources.find(x=>x.knowledge_id===r.id)?.url??'',notes:notes.find(x=>x.knowledge_id===r.id)?.content??'',understanding:r.understanding,createdAt:r.created_at,updatedAt:r.updated_at,archivedAt:r.archived_at,schedule:scheduleDto(states.find(x=>x.knowledge_id===r.id)),quizzes:quizzes.filter(x=>x.knowledge_id===r.id).map(quizDto)}));
}
async function getItem(db,id){const row=await first(db,'SELECT * FROM knowledge WHERE id=?',id);if(!row)throw new ApiError('知識が見つからない','NOT_FOUND',404);return (await hydrate(db,[row]))[0];}
async function saveKnowledge(db,body,id){
 const data=validateKnowledge(body),isNew=!id;id??=uuid();
 const current=isNew?null:await getItem(db,id);
 if(!isNew){check(validTimestamp(body.expectedUpdatedAt),'編集前の更新日時が必要');if(body.expectedUpdatedAt!==current.updatedAt)throw new ApiError('別の画面で更新されている。再読込してね','EDIT_CONFLICT',409);}
 const now=new Date(Math.max(Date.now(),current?Date.parse(current.updatedAt)+1:0)).toISOString();
 const duplicate=await first(db,'SELECT id FROM knowledge WHERE normalized_title=? AND id<>?',normalizeTitle(data.title),id);
 const duplicateUrl=data.sourceUrl?await first(db,'SELECT knowledge_id AS id FROM sources WHERE url=? AND knowledge_id<>?',data.sourceUrl,id):null;
 if(duplicate||duplicateUrl)throw new ApiError('同じタイトルまたはURLの知識がある','DUPLICATE',409,{existingId:(duplicate??duplicateUrl).id});
 const previous=isNew?[]:await all(db,'SELECT * FROM quizzes WHERE knowledge_id=?',id),statements=[],savedQuizzes=[],initial=isNew?initialSchedule(new Date(now)):null;
 // A failing NOT NULL constraint aborts this entire transaction before children change.
 if(!isNew)statements.push(db.prepare('UPDATE knowledge SET content=CASE WHEN updated_at=? THEN content ELSE NULL END WHERE id=?').bind(body.expectedUpdatedAt,id));
 if(isNew){statements.push(db.prepare('INSERT INTO knowledge VALUES (?,?,?,?,?,?,?,NULL)').bind(id,data.title,data.content,normalizeTitle(data.title),data.understanding,now,now));statements.push(db.prepare('INSERT INTO review_state VALUES (?,?,?,?,?,?,?,0)').bind(id,initial.dueAt,initial.intervalDays,initial.streak,initial.lapses,initial.reviews,initial.status));}
 else statements.push(db.prepare('UPDATE knowledge SET title=?,content=?,normalized_title=?,understanding=?,updated_at=? WHERE id=?').bind(data.title,data.content,normalizeTitle(data.title),data.understanding,now,id));
 statements.push(db.prepare('DELETE FROM knowledge_categories WHERE knowledge_id=?').bind(id),db.prepare('DELETE FROM knowledge_tags WHERE knowledge_id=?').bind(id),db.prepare('DELETE FROM sources WHERE knowledge_id=?').bind(id));
 if(data.category){statements.push(db.prepare('INSERT OR IGNORE INTO categories(id,name) VALUES (?,?)').bind(uuid(),data.category));statements.push(db.prepare('INSERT INTO knowledge_categories SELECT ?,id FROM categories WHERE name=?').bind(id,data.category));}
 for(const tag of data.tags){statements.push(db.prepare('INSERT OR IGNORE INTO tags(id,name) VALUES (?,?)').bind(uuid(),tag),db.prepare('INSERT INTO knowledge_tags SELECT ?,id FROM tags WHERE name=?').bind(id,tag));}
 if(data.sourceUrl)statements.push(db.prepare('INSERT INTO sources VALUES (?,?,?)').bind(uuid(),id,data.sourceUrl));
 statements.push(db.prepare('INSERT INTO notes VALUES (?,?,?,?) ON CONFLICT(knowledge_id) DO UPDATE SET content=excluded.content').bind(uuid(),id,data.notes,now));
 statements.push(db.prepare('UPDATE quizzes SET active=0 WHERE knowledge_id=?').bind(id));
 for(const q of data.quizzes){
  const prior=q.id?previous.find(x=>x.id===q.id):null;if(q.id&&!prior)throw new ApiError('別の知識の問題は編集できない');
  const unchanged=prior&&prior.type===q.type&&prior.prompt===q.prompt&&prior.answer===q.answer&&prior.explanation===q.explanation&&prior.options_json===JSON.stringify(q.options)&&prior.correct_index===q.correctIndex;
  // Changed questions receive a new identity so historic answers keep their original meaning.
  if(unchanged)statements.push(db.prepare('UPDATE quizzes SET active=1 WHERE id=?').bind(q.id));
  else{const quizId=uuid();statements.push(db.prepare('INSERT INTO quizzes VALUES (?,?,?,?,?,?,?,?,1)').bind(quizId,id,q.type,q.prompt,q.answer,q.explanation,JSON.stringify(q.options),q.correctIndex));savedQuizzes.push({...q,id:quizId});}
 }
 try{await db.batch(statements);}catch(error){if(!isNew){const latest=await first(db,'SELECT updated_at FROM knowledge WHERE id=?',id);if(latest?.updated_at!==body.expectedUpdatedAt)throw new ApiError('別の画面で更新されている。再読込してね','EDIT_CONFLICT',409);}if(String(error.message).includes('UNIQUE')){const conflict=await first(db,'SELECT id FROM knowledge WHERE normalized_title=?',normalizeTitle(data.title))??(data.sourceUrl?await first(db,'SELECT knowledge_id AS id FROM sources WHERE url=?',data.sourceUrl):null);throw new ApiError('同じタイトルまたはURLの知識がある','DUPLICATE',409,conflict?{existingId:conflict.id}:{});}throw error;}
 // A committed new transaction already determines this DTO. A later read outage
 // must not turn a successful save into an apparent failure and invite duplicates.
 return isNew?{id,...data,tags:[...data.tags].sort(),createdAt:now,updatedAt:now,archivedAt:null,schedule:initial,quizzes:savedQuizzes}:getItem(db,id);
}
async function listKnowledge(db,url){
 const limit=integerParam(url.searchParams.get('limit'),40,1,100),offset=integerParam(url.searchParams.get('offset'),0,0,1000000),values=[],conditions=[];
 const status=url.searchParams.get('status')??'';check(['','new','due','mastered','archived'].includes(status),'状態が正しくない');
 conditions.push(status==='archived'?'k.archived_at IS NOT NULL':'k.archived_at IS NULL');
 if(status==='new')conditions.push('s.reviews=0');if(status==='due'){conditions.push('s.due_at<=?');values.push(new Date().toISOString());}if(status==='mastered')conditions.push("s.status='mastered'");
 const q=text(url.searchParams.get('q')??'',300);if(q){conditions.push('(instr(lower(k.title),lower(?))>0 OR instr(lower(k.content),lower(?))>0)');values.push(q,q);}
 const category=text(url.searchParams.get('category')??'',80),tag=text(url.searchParams.get('tag')??'',80);
 if(category){conditions.push('EXISTS (SELECT 1 FROM knowledge_categories kc JOIN categories c ON c.id=kc.category_id WHERE kc.knowledge_id=k.id AND c.name=?)');values.push(category);}
 if(tag){conditions.push('EXISTS (SELECT 1 FROM knowledge_tags kt JOIN tags t ON t.id=kt.tag_id WHERE kt.knowledge_id=k.id AND t.name=?)');values.push(tag);}
 const from='FROM knowledge k JOIN review_state s ON s.knowledge_id=k.id WHERE '+conditions.join(' AND ');
 const count=await first(db,'SELECT count(*) AS n '+from,...values),rows=await all(db,'SELECT k.* '+from+' ORDER BY k.updated_at DESC,k.id LIMIT ? OFFSET ?',...values,limit,offset);
 return {items:await hydrate(db,rows),total:count.n};
}
async function submitReview(db,body){
 check(isUuid(body.knowledgeId)&&isUuid(body.quizId)&&isUuid(body.idempotencyKey),'回答IDが正しくない');check(['forgot','unsure','remembered'].includes(body.rating),'自己評価が正しくない');
 const input={knowledgeId:body.knowledgeId,quizId:body.quizId,rating:body.rating,response:text(body.response??'',20000,{trim:false}),selectedIndex:body.selectedIndex??null,idempotencyKey:body.idempotencyKey};const requestJson=JSON.stringify(input);
 for(let attempt=0;attempt<5;attempt++){
  const existing=await first(db,'SELECT * FROM reviews WHERE idempotency_key=?',input.idempotencyKey);if(existing){if(existing.request_json!==requestJson)throw new ApiError('同じ回答キーの内容が異なる','IDEMPOTENCY_CONFLICT',409);return {review:reviewDto(existing),schedule:JSON.parse(existing.schedule_json),repeated:true};}
  const knowledge=await first(db,'SELECT id,archived_at FROM knowledge WHERE id=?',input.knowledgeId);if(!knowledge)throw new ApiError('知識が見つからない','NOT_FOUND',404);check(!knowledge.archived_at,'アーカイブした知識は復習できない');
  const quiz=await first(db,'SELECT * FROM quizzes WHERE id=? AND knowledge_id=? AND active=1',input.quizId,input.knowledgeId);check(quiz,'有効な問題が見つからない');
  if(quiz.type==='choice')check(Number.isInteger(input.selectedIndex)&&input.selectedIndex>=0&&input.selectedIndex<=2,'選択肢を選んでね');else check(input.selectedIndex===null,'自由回答に選択肢は指定できない');
  const correct=quiz.type==='choice'?Number(input.selectedIndex===quiz.correct_index):null,rating=correct===0?'forgot':input.rating;
  const previous=await first(db,'SELECT * FROM review_state WHERE knowledge_id=?',input.knowledgeId),now=new Date(),s=scheduleReview(scheduleDto(previous),rating,now),id=uuid();
  const statements=[db.prepare('INSERT INTO reviews (id,knowledge_id,quiz_id,rating,response,selected_index,correct,idempotency_key,request_json,schedule_json,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM review_state WHERE knowledge_id=? AND version=?) AND EXISTS (SELECT 1 FROM quizzes q JOIN knowledge k ON k.id=q.knowledge_id WHERE q.id=? AND q.active=1 AND k.archived_at IS NULL) AND NOT EXISTS (SELECT 1 FROM reviews WHERE idempotency_key=?)').bind(id,input.knowledgeId,input.quizId,rating,input.response,input.selectedIndex,correct,input.idempotencyKey,requestJson,JSON.stringify(s),now.toISOString(),input.knowledgeId,previous.version,input.quizId,input.idempotencyKey),db.prepare('UPDATE review_state SET due_at=?,interval_days=?,streak=?,lapses=?,reviews=?,status=?,version=version+1 WHERE knowledge_id=? AND version=? AND EXISTS (SELECT 1 FROM reviews WHERE id=?)').bind(s.dueAt,s.intervalDays,s.streak,s.lapses,s.reviews,s.status,input.knowledgeId,previous.version,id)];
  await db.batch(statements);const inserted=await first(db,'SELECT * FROM reviews WHERE id=?',id);if(inserted)return {review:reviewDto(inserted),schedule:s,repeated:false};
 }
 throw new ApiError('同時更新のため再試行してね','RETRY_REQUIRED',409);
}
const jstDate=iso=>new Date(Date.parse(iso)+9*3600000).toISOString().slice(0,10);
async function dashboard(db){
 const now=new Date(),today=jstDate(now.toISOString()),cutoff=new Date(now.getTime()-30*86400000).toISOString();
 const start=new Date(today+'T00:00:00+09:00'),startIso=start.toISOString(),endIso=new Date(start.getTime()+86400000).toISOString(),recentStart=new Date(start.getTime()-13*86400000).toISOString();
 const statements=[
  db.prepare('SELECT count(*) AS totalKnowledge,coalesce(sum(s.due_at<=?),0) AS dueCount,coalesce(sum(k.created_at>=? AND k.created_at<?),0) AS addedToday FROM knowledge k JOIN review_state s ON s.knowledge_id=k.id WHERE k.archived_at IS NULL').bind(now.toISOString(),startIso,endIso),
  db.prepare('SELECT count(*) AS reviewCount,coalesce(sum(created_at>=? AND created_at<?),0) AS reviewsToday,count(DISTINCT CASE WHEN created_at>=? AND created_at<? THEN knowledge_id END) AS learnedToday FROM reviews').bind(startIso,endIso,startIso,endIso),
  db.prepare("SELECT count(*) AS n,avg(correct) AS rate FROM (SELECT r.correct FROM reviews r JOIN quizzes q ON q.id=r.quiz_id WHERE q.type='choice' AND r.created_at>=? ORDER BY r.created_at DESC,r.id DESC LIMIT 100)").bind(cutoff),
  db.prepare("SELECT count(*) AS n,avg(rating='remembered') AS rate FROM (SELECT r.rating FROM reviews r JOIN quizzes q ON q.id=r.quiz_id WHERE q.type='recall' AND r.created_at>=? ORDER BY r.created_at DESC,r.id DESC LIMIT 100)").bind(cutoff),
  db.prepare(`WITH answers AS (SELECT kc.category_id,sum(q.type='choice') AS totalAnswers,sum(CASE WHEN q.type='choice' THEN r.correct ELSE 0 END) AS correct,sum(q.type='recall') AS recallAnswers,sum(q.type='recall' AND r.rating='remembered') AS recallRemembered FROM knowledge_categories kc JOIN reviews r ON r.knowledge_id=kc.knowledge_id JOIN quizzes q ON q.id=r.quiz_id GROUP BY kc.category_id), items AS (SELECT kc.category_id,count(*) AS total FROM knowledge_categories kc JOIN knowledge k ON k.id=kc.knowledge_id WHERE k.archived_at IS NULL GROUP BY kc.category_id) SELECT c.name AS category,coalesce(i.total,0) AS total,coalesce(a.correct,0) AS correct,coalesce(a.totalAnswers,0) AS totalAnswers,coalesce(a.recallRemembered,0) AS recallRemembered,coalesce(a.recallAnswers,0) AS recallAnswers FROM categories c LEFT JOIN answers a ON a.category_id=c.id LEFT JOIN items i ON i.category_id=c.id WHERE EXISTS (SELECT 1 FROM knowledge_categories kc WHERE kc.category_id=c.id) ORDER BY c.name`),
  db.prepare("WITH RECURSIVE days(day) AS (SELECT DISTINCT date(created_at,'+9 hours') FROM reviews), streak(day) AS (SELECT max(day) FROM days WHERE day BETWEEN date(?,'-1 day') AND ? HAVING max(day) IS NOT NULL UNION ALL SELECT date(streak.day,'-1 day') FROM streak WHERE EXISTS (SELECT 1 FROM days WHERE days.day=date(streak.day,'-1 day'))) SELECT count(*) AS streakDays FROM streak").bind(today,today),
  db.prepare("SELECT date(created_at,'+9 hours') AS date,count(*) AS reviews FROM reviews WHERE created_at>=? GROUP BY date(created_at,'+9 hours')").bind(recentStart),
  db.prepare('SELECT knowledge_id FROM reviews WHERE created_at>=? AND created_at<? GROUP BY knowledge_id ORDER BY max(created_at) DESC,max(id) DESC LIMIT 5').bind(startIso,endIso)
 ];
 const result=await db.batch(statements),summary=result[0].results[0],counts=result[1].results[0],objective=result[2].results[0],recall=result[3].results[0];
 const categories=result[4].results.map(row=>({...row,accuracy:row.totalAnswers>=3?row.correct/row.totalAnswers:null}));
 const dayCounts=new Map(result[6].results.map(row=>[row.date,row.reviews]));
 const recentDays=Array.from({length:14},(_,i)=>{const date=jstDate(new Date(now.getTime()-(13-i)*86400000).toISOString());return {date,reviews:dayCounts.get(date)??0};});
 const learnedIds=result[7].results.map(row=>row.knowledge_id);let learnedTodayItems=[];
 if(learnedIds.length){const rows=await all(db,`SELECT * FROM knowledge WHERE id IN (${learnedIds.map(()=>'?').join(',')})`,...learnedIds);learnedTodayItems=await hydrate(db,learnedIds.map(id=>rows.find(row=>row.id===id)).filter(Boolean));}
 return {...summary,...counts,learnedTodayItems,recentAccuracy:objective.rate,objectiveAnswers:objective.n,recallRememberedRate:recall.rate,streakDays:result[5].results[0].streakDays,categories,recentDays};
}
export async function handleApi(request,env){
 try{
  const url=new URL(request.url),path=url.pathname.replace(/\/$/,''),method=request.method,db=env.DB;if(!db)throw new ApiError('データベースが設定されていない','UNAVAILABLE',503);
  if(path==='/api/ai/status'&&method==='GET')return json(await aiStatus(env));
  if(path==='/api/ai/generate'&&method==='POST'){
   // generateAi validates the complete provider output before any persistence.
   const {candidates,...metadata}=await generateAi(request,env),items=[],skipped=[],failed=[];
   for(const candidate of candidates){
    try{items.push(await saveKnowledge(db,candidate));}
    catch(error){
     if(error instanceof ApiError&&error.status===409&&error.code==='DUPLICATE')skipped.push({title:candidate.title,reason:'duplicate',...(isUuid(error.details?.existingId)?{existingId:error.details.existingId}:{})});
     else failed.push({title:candidate.title,message:'この知識を保存できなかった。時間をおいて試してね'});
    }
   }
   return json({items,skipped,failed,generatedCount:candidates.length,...metadata});
  }
  if(path==='/api/knowledge'&&method==='GET')return json(await listKnowledge(db,url));
  if(path==='/api/knowledge'&&method==='POST')return json({item:await saveKnowledge(db,await readJson(request))},201);
  const match=path.match(/^\/api\/knowledge\/([^/]+)(\/archive)?$/);
  if(match){check(isUuid(match[1]),'知識IDが正しくない');const id=match[1];if(match[2]&&method==='PATCH'){const body=await readJson(request);check(typeof body.archived==='boolean','アーカイブ状態を指定してね');await getItem(db,id);await db.prepare('UPDATE knowledge SET archived_at=?,updated_at=? WHERE id=?').bind(body.archived?new Date().toISOString():null,new Date().toISOString(),id).run();return json({item:await getItem(db,id)});}if(!match[2]&&method==='GET')return json({item:await getItem(db,id),history:(await all(db,'SELECT * FROM reviews WHERE knowledge_id=? ORDER BY created_at DESC,id DESC',id)).map(reviewDto)});if(!match[2]&&method==='PUT')return json({item:await saveKnowledge(db,await readJson(request),id)});}
  if(path==='/api/meta'&&method==='GET')return json({categories:(await all(db,'SELECT name FROM categories ORDER BY name')).map(x=>x.name),tags:(await all(db,'SELECT name FROM tags ORDER BY name')).map(x=>x.name)});
  if(path==='/api/review/next'&&method==='GET'){const row=await first(db,'SELECT k.* FROM knowledge k JOIN review_state s ON s.knowledge_id=k.id WHERE k.archived_at IS NULL AND (s.due_at<=? OR s.reviews=0) ORDER BY CASE WHEN s.reviews>0 THEN 0 ELSE 1 END,s.due_at,k.id LIMIT 1',new Date().toISOString());return json({item:row?(await hydrate(db,[row]))[0]:null});}
  if(path==='/api/reviews'&&method==='POST'){const result=await submitReview(db,await readJson(request));return json({review:result.review,schedule:result.schedule},result.repeated?200:201);}
  if(path==='/api/dashboard'&&method==='GET')return json(await dashboard(db));
  if(path==='/api/backup'&&method==='GET')return json(await exportBackup(db));
  if(path==='/api/backup/validate'&&method==='POST'){const result=await inspectBackup(db,await readJson(request));return json({counts:result.counts,conflicts:result.conflicts});}
  if(path==='/api/backup/import'&&method==='POST')return json(await importBackup(db,await readJson(request)));
  if(path==='/api/export.csv'&&method==='GET'){const rows=await all(db,`SELECT k.*,c.name AS category,s.url AS source_url,n.content AS notes,(SELECT json_group_array(name) FROM (SELECT t.name FROM knowledge_tags kt JOIN tags t ON t.id=kt.tag_id WHERE kt.knowledge_id=k.id ORDER BY t.name)) AS tags_json FROM knowledge k LEFT JOIN knowledge_categories kc ON kc.knowledge_id=k.id LEFT JOIN categories c ON c.id=kc.category_id LEFT JOIN sources s ON s.knowledge_id=k.id LEFT JOIN notes n ON n.knowledge_id=k.id ORDER BY k.created_at,k.id`);const items=rows.map(r=>({id:r.id,title:r.title,content:r.content,category:r.category??'',tags:JSON.parse(r.tags_json),sourceUrl:r.source_url??'',notes:r.notes??'',understanding:r.understanding,createdAt:r.created_at,updatedAt:r.updated_at,archivedAt:r.archived_at}));return new Response(csvExport(items),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="hiro-knowledge.csv"','Cache-Control':'no-store'}});}
  throw new ApiError('APIが見つからない','NOT_FOUND',404);
 }catch(error){if(error instanceof ApiError)return json({error:error.message,code:error.code,...error.details},error.status);return json({error:'処理に失敗した。時間をおいて再試行してね',code:'INTERNAL_ERROR'},500);}
}
