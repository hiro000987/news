import {ApiError,check,safeObject,isUuid,validTimestamp,sourceUrl,normalizeTitle,MAX_BODY_BYTES} from './validation.js';
import {initialSchedule,scheduleReview} from './scheduler.js';

// Order is significant: every referenced parent precedes its children.
export const TABLES={
 knowledge:['id','title','content','normalized_title','understanding','created_at','updated_at','archived_at'],
 categories:['id','name'],tags:['id','name'],
 knowledge_categories:['knowledge_id','category_id'],knowledge_tags:['knowledge_id','tag_id'],
 sources:['id','knowledge_id','url'],
 quizzes:['id','knowledge_id','type','prompt','answer','explanation','options_json','correct_index','active'],
 reviews:['id','knowledge_id','quiz_id','rating','response','selected_index','correct','idempotency_key','request_json','schedule_json','created_at'],
 review_state:['knowledge_id','due_at','interval_days','streak','lapses','reviews','status','version'],
 notes:['id','knowledge_id','content','created_at']
};
const keys={knowledge:['id'],categories:['id'],tags:['id'],knowledge_categories:['knowledge_id'],knowledge_tags:['knowledge_id','tag_id'],sources:['id'],quizzes:['id'],reviews:['id'],review_state:['knowledge_id'],notes:['id']};
const unique={knowledge:['normalized_title'],categories:['name'],tags:['name'],sources:['knowledge_id','url'],reviews:['idempotency_key'],notes:['knowledge_id']};
const same=(a,b,columns)=>columns.every(c=>a[c]===b[c]);
export const MAX_BACKUP_ROWS=50000;
const pk=(table,row)=>JSON.stringify(keys[table].map(k=>row[k]));
function integer(v,min=0,max=Number.MAX_SAFE_INTEGER){return Number.isSafeInteger(v)&&v>=min&&v<=max;}
function string(v,max=50000,empty=true){return typeof v==='string' && v.length<=max && (empty||v.trim().length>0) && !v.includes('\u0000');}
function parseJson(value){try{return JSON.parse(value);}catch{throw new ApiError('バックアップ内のJSONが正しくない');}}
function schedule(s){return s&&validTimestamp(s.dueAt)&&typeof s.intervalDays==='number'&&Number.isFinite(s.intervalDays)&&s.intervalDays>=0&&s.intervalDays<=180&&integer(s.streak)&&integer(s.lapses)&&integer(s.reviews)&&['new','learning','mastered'].includes(s.status);}
function validateRow(table,r){
 check(Object.keys(r).length===TABLES[table].length&&Object.keys(r).every(k=>TABLES[table].includes(k)),'バックアップの列が正しくない');
 for(const c of TABLES[table])if(c==='id'||c.endsWith('_id'))check(isUuid(r[c]),'バックアップのIDが正しくない');
 if(table==='knowledge'){check(string(r.title,300,false)&&string(r.content,50000,false)&&r.normalized_title===normalizeTitle(r.title)&&integer(r.understanding,0,3),'知識データが正しくない');check(validTimestamp(r.created_at)&&validTimestamp(r.updated_at)&&validTimestamp(r.archived_at,true),'日時が正しくない');}
 if(table==='categories'||table==='tags')check(string(r.name,80,false)&&r.name===r.name.trim(),'分類名が正しくない');
 if(table==='sources')check(sourceUrl(r.url)===r.url&&r.url.length>0,'URLが正しくない');
 if(table==='quizzes'){const options=parseJson(r.options_json);check(['recall','choice'].includes(r.type)&&string(r.prompt,1000,false)&&string(r.answer,50000,false)&&string(r.explanation,10000)&&integer(r.active,0,1)&&Array.isArray(options),'問題が正しくない');check(r.type==='recall'?options.length===0&&r.correct_index===null:options.length===3&&options.every(x=>string(x,1000,false))&&integer(r.correct_index,0,2),'選択肢が正しくない');if(r.type==='choice')check(new Set(options.map(o=>o.trim().normalize('NFKC').toLocaleLowerCase('ja'))).size===3&&r.answer===options[r.correct_index],'正解と選択肢が一致しないか、選択肢が重複している');}
 if(table==='reviews'){check(['forgot','unsure','remembered'].includes(r.rating)&&string(r.response,20000)&&(r.selected_index===null||integer(r.selected_index,0,2))&&(r.correct===null||integer(r.correct,0,1))&&isUuid(r.idempotency_key)&&validTimestamp(r.created_at),'回答履歴が正しくない');const request=parseJson(r.request_json),savedSchedule=parseJson(r.schedule_json);safeObject(request);safeObject(savedSchedule);check(schedule(savedSchedule),'回答時の復習状態が正しくない');check(request.knowledgeId===r.knowledge_id&&request.quizId===r.quiz_id&&request.idempotencyKey===r.idempotency_key&&['forgot','unsure','remembered'].includes(request.rating)&&request.response===r.response&&request.selectedIndex===r.selected_index,'回答リクエストが正しくない');}
 if(table==='review_state')check(schedule({dueAt:r.due_at,intervalDays:r.interval_days,streak:r.streak,lapses:r.lapses,reviews:r.reviews,status:r.status})&&integer(r.version),'復習状態が正しくない');
 if(table==='notes')check(string(r.content,20000)&&validTimestamp(r.created_at),'メモが正しくない');
}
function backupLimit(){return new ApiError('JSONバックアップ上限（10MiB・全テーブル合計50,000行）を超えた。D1のSQLエクスポートを利用してね','BACKUP_LIMIT',413);}
export async function exportBackup(db){
 const names=Object.keys(TABLES);
 // Preflight avoids materializing an already oversized database in Worker memory.
 // The actual data reads still share one atomic D1 batch snapshot.
 const sizes=await db.batch(names.map(table=>db.prepare(`SELECT count(*) AS n,coalesce(sum(length(CAST(json_object(${TABLES[table].map(c=>`'${c}',${c}`).join(',')}) AS BLOB))+1),0) AS bytes FROM ${table}`)));
 const totals=sizes.reduce((v,result)=>({rows:v.rows+result.results[0].n,bytes:v.bytes+result.results[0].bytes}),{rows:0,bytes:0});
 if(totals.rows>MAX_BACKUP_ROWS||totals.bytes>MAX_BODY_BYTES)throw backupLimit();
 const results=await db.batch(names.map(table=>db.prepare(`SELECT * FROM ${table} ORDER BY ${keys[table].join(',')}`))),tables=Object.fromEntries(names.map((table,i)=>[table,results[i].results]));
 const backup={version:1,exportedAt:new Date().toISOString(),tables};
 if(results.reduce((n,result)=>n+result.results.length,0)>MAX_BACKUP_ROWS||new TextEncoder().encode(JSON.stringify(backup)).byteLength>MAX_BODY_BYTES)throw backupLimit();
 return backup;
}

export async function inspectBackup(db,body){
 safeObject(body);check(new TextEncoder().encode(JSON.stringify(body)).byteLength<=MAX_BODY_BYTES,'ファイルが大きすぎる');
 check(Object.keys(body).every(k=>['version','exportedAt','tables'].includes(k))&&body.version===1&&validTimestamp(body.exportedAt),'対応していないバックアップ形式');
 check(body.tables&&Object.keys(body.tables).length===Object.keys(TABLES).length&&Object.keys(body.tables).every(t=>TABLES[t]),'全テーブルが必要');
 const existing={},merged={},counts={},conflicts=[];let total=0;
 for(const [table,columns] of Object.entries(TABLES)){
  const rows=body.tables[table];check(Array.isArray(rows),'テーブルは配列で指定してね');total+=rows.length;check(total<=MAX_BACKUP_ROWS,'バックアップの行数が多すぎる');counts[table]=rows.length;
  const seen=new Set();for(const row of rows){safeObject(row);validateRow(table,row);const key=pk(table,row);check(!seen.has(key),'バックアップ内でIDが重複している');seen.add(key);}
  existing[table]=(await db.prepare(`SELECT * FROM ${table}`).all()).results;
  const map=new Map(existing[table].map(r=>[pk(table,r),r]));
  for(const row of rows){const prior=map.get(pk(table,row));if(prior&&!same(prior,row,columns))conflicts.push({table,id:keys[table].map(k=>row[k]).join(':')});map.set(pk(table,row),row);}
  merged[table]=[...map.values()];
  for(const field of unique[table]??[]){const values=new Map();for(const row of merged[table]){const prior=values.get(row[field]);if(prior&&pk(table,prior)!==pk(table,row))conflicts.push({table,field,id:pk(table,row)});values.set(row[field],row);}}
 }
 const maps=Object.fromEntries(Object.entries(merged).map(([table,rows])=>[table,new Map(rows.map(r=>[pk(table,r),r]))]));
 const has=(table,id)=>maps[table].get(JSON.stringify([id]));
 const histories=new Map();
 for(const [table,rows] of Object.entries(merged))for(const row of rows){if('knowledge_id' in row)check(has('knowledge',row.knowledge_id),'存在しない知識を参照している');if('category_id' in row)check(has('categories',row.category_id),'存在しないカテゴリーを参照している');if('tag_id' in row)check(has('tags',row.tag_id),'存在しないタグを参照している');if('quiz_id' in row){const quiz=has('quizzes',row.quiz_id);check(quiz&&quiz.knowledge_id===row.knowledge_id,'回答の問題参照が正しくない');const request=parseJson(row.request_json);if(quiz.type==='choice')check(integer(row.selected_index,0,2)&&row.correct===Number(row.selected_index===quiz.correct_index)&&row.rating===(row.correct===0?'forgot':request.rating),'選択回答が正しくない');else check(row.selected_index===null&&row.correct===null&&row.rating===request.rating,'自由回答が正しくない');if(!histories.has(row.knowledge_id))histories.set(row.knowledge_id,[]);histories.get(row.knowledge_id).push({...row,savedSchedule:parseJson(row.schedule_json)});}}
 const activeQuizKnowledge=new Set(merged.quizzes.filter(q=>q.active===1).map(q=>q.knowledge_id));
 const incomingStates=new Set(body.tables.review_state.map(s=>s.knowledge_id)),incomingHistories=new Map();
 if(conflicts.length)for(const review of body.tables.reviews){if(!incomingHistories.has(review.knowledge_id))incomingHistories.set(review.knowledge_id,[]);incomingHistories.get(review.knowledge_id).push({...review,savedSchedule:parseJson(review.schedule_json)});}
 for(const row of merged.knowledge){
  const state=has('review_state',row.id);check(state,'復習状態が不足している');check(activeQuizKnowledge.has(row.id),'有効な問題が不足している');
  // A valid old snapshot may conflict with a more recent existing schedule.
  // Validate its own chain for the preview; conflicting rows are never imported.
  const chain=conflicts.length&&incomingStates.has(row.id)?incomingHistories:histories;
  const history=(chain.get(row.id)??[]).sort((a,b)=>a.savedSchedule.reviews-b.savedSchedule.reviews);
  check(state.reviews===history.length&&state.version===history.length,'回答件数と復習状態が一致しない');
  // Backup v1 pins scheduler v1. A future policy needs a versioned verifier.
  let replay=initialSchedule(new Date(row.created_at));
  history.forEach(review=>{replay=scheduleReview(replay,review.rating,new Date(review.created_at));check(Object.keys(replay).every(key=>review.savedSchedule[key]===replay[key]),'回答履歴と復習アルゴリズムの結果が一致しない');});
  if(history.length){const latest=history.at(-1).savedSchedule;check(state.due_at===latest.dueAt&&state.interval_days===latest.intervalDays&&state.streak===latest.streak&&state.lapses===latest.lapses&&state.status===latest.status,'最新回答と復習状態が一致しない');}
  else check(state.status==='new'&&state.interval_days===0&&state.streak===0&&state.lapses===0&&state.due_at===row.created_at,'未学習の復習状態が正しくない');
 }
 return {counts,conflicts,existing};
}
export async function importBackup(db,body){
 const checked=await inspectBackup(db,body);if(checked.conflicts.length)throw new ApiError('既存データと競合している','BACKUP_CONFLICT',409,{conflicts:checked.conflicts});
 const statements=[];let imported=0,skipped=0,total=0;
 for(const [table,columns] of Object.entries(TABLES)){
  for(const row of body.tables[table]){
   total++;
   // This conditional NOT NULL violation also rejects a conflicting concurrent import
   // within the same atomic batch; identical concurrent rows remain untouched.
   const guard=columns.find(c=>!keys[table].includes(c)&&!['archived_at','correct_index','correct','selected_index'].includes(c))??columns[0];
   const equal=columns.map(c=>`${table}.${c} IS excluded.${c}`).join(' AND ');
   statements.push(db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')}) ON CONFLICT DO UPDATE SET ${guard}=NULL WHERE NOT (${equal})`).bind(...columns.map(c=>row[c])));
  }
 }
 if(statements.length){try{const results=await db.batch(statements);imported=results.reduce((n,result)=>n+(result.meta.changes??0),0);skipped=total-imported;}catch{throw new ApiError('既存データと競合したため復元していない','BACKUP_CONFLICT',409);}}
 return {imported,skipped};
}

export function csvExport(items){const cell=value=>{let s=String(value??'');if(/^[\s\uFEFF]*[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};const rows=[['ID','タイトル','内容','カテゴリー','タグ','出典URL','メモ','理解度','登録日','更新日','アーカイブ日'],...items.map(i=>[i.id,i.title,i.content,i.category,i.tags.join(' / '),i.sourceUrl,i.notes,i.understanding,i.createdAt,i.updatedAt,i.archivedAt])];return '\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n');}
