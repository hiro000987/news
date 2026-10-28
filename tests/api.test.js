import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../src/api.js';
import { fixture } from './d1-fixture.js';

test('CRUD, bounded search, duplicates, quiz retirement and archive retain history', async t => {
  const {api}=await fixture(t);
  const created=await api('knowledge','POST',{title:' 記憶の仕組み ',content:'思い出す練習',category:'学習',tags:['記憶'],quizzes:[{type:'choice',prompt:'正解は？',answer:'A',options:['A','B','C'],correctIndex:0}]});
  assert.equal(created.status,201);
  const item=created.data.item;
  assert.equal(item.title,'記憶の仕組み'); assert.equal(item.schedule.reviews,0);
  assert.equal((await api('knowledge','POST',{title:'記憶の仕組み',content:'重複'})).status,409);
  assert.equal((await api('knowledge?q=仕組み&category=学習&tag=記憶')).data.total,1);
  assert.equal((await api('knowledge?limit=9999')).status,400);
  const reviewed=await api('reviews','POST',{knowledgeId:item.id,quizId:item.quizzes[0].id,rating:'remembered',selectedIndex:1,response:'',idempotencyKey:crypto.randomUUID()});
  assert.equal(reviewed.status,201); assert.equal(reviewed.data.review.rating,'forgot'); assert.equal(reviewed.data.review.correct,false);
  const edited=await api('knowledge/'+item.id,'PUT',{...item,expectedUpdatedAt:item.updatedAt,title:'変更',quizzes:[{type:'recall',prompt:'何？',answer:'回答'}]});
  assert.equal(edited.status,200); assert.notEqual(edited.data.item.quizzes[0].id,item.quizzes[0].id);
  assert.equal((await api('knowledge/'+item.id)).data.history.length,1);
  assert.equal((await api('reviews','POST',{knowledgeId:item.id,quizId:item.quizzes[0].id,rating:'remembered',selectedIndex:0,idempotencyKey:crypto.randomUUID()})).status,400);
  assert.equal((await api('backup/validate','POST',(await api('backup')).data)).status,200);
  assert.equal((await api('knowledge/'+item.id+'/archive','PATCH',{archived:true})).status,200);
  assert.equal((await api('knowledge')).data.total,0);
  assert.equal((await api('knowledge?status=archived')).data.total,1);
  assert.equal((await api('knowledge/'+item.id+'/archive','PATCH',{archived:false})).status,200);
});

test('stale concurrent edits reject without losing winning content or child data',async t=>{
 const {api}=await fixture(t);const item=(await api('knowledge','POST',{title:'編集競合',content:'最初',notes:'最初'})).data.item;
 const changes=['一番','二番'].map(content=>({...item,content,notes:content,expectedUpdatedAt:item.updatedAt,tags:[content]}));
 const results=await Promise.all(changes.map(body=>api('knowledge/'+item.id,'PUT',body)));
 assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===409).length,1);
 const winner=results.find(r=>r.status===200).data.item,actual=(await api('knowledge/'+item.id)).data.item;
 assert.equal(actual.content,winner.content);assert.equal(actual.notes,winner.notes);assert.deepEqual(actual.tags,winner.tags);assert.notEqual(actual.updatedAt,item.updatedAt);
 assert.equal((await api('knowledge/'+item.id,'PUT',{...item,content:'古い',expectedUpdatedAt:item.updatedAt})).status,409);
});

test('review retries/concurrency append once and preserve schedule; metrics separate recall',async t=>{
  const {api,DB}=await fixture(t);
  const item=(await api('knowledge','POST',{title:'想起',content:'答え'})).data.item;
  const body={knowledgeId:item.id,quizId:item.quizzes[0].id,rating:'remembered',response:'答え',idempotencyKey:crypto.randomUUID()};
  const results=await Promise.all([api('reviews','POST',body),api('reviews','POST',body)]);
  assert.ok(results.every(r=>[200,201].includes(r.status)),JSON.stringify(results));
  assert.equal((await DB.prepare('SELECT count(*) AS n FROM reviews').first()).n,1);
  assert.equal((await api('knowledge/'+item.id)).data.item.schedule.reviews,1);
  const dashboard=(await api('dashboard')).data;
  assert.equal(dashboard.recentAccuracy,null); assert.equal(dashboard.objectiveAnswers,0); assert.equal(dashboard.recallRememberedRate,1); assert.equal(dashboard.reviewsToday,1);
  const changed=await api('reviews','POST',{...body,rating:'forgot'}); assert.equal(changed.status,409);
  const concurrent=await Promise.all([api('reviews','POST',{...body,idempotencyKey:crypto.randomUUID()}),api('reviews','POST',{...body,idempotencyKey:crypto.randomUUID()})]);
  assert.ok(concurrent.every(r=>r.status===201),JSON.stringify(concurrent));
  assert.equal((await api('knowledge/'+item.id)).data.item.schedule.reviews,3);
  assert.equal((await DB.prepare('SELECT count(*) AS n FROM reviews').first()).n,3);
});

test('invalid inputs do not mutate database and CSV neutralizes formula cells',async t=>{
  const {api}=await fixture(t);
  assert.equal((await api('knowledge','POST',{title:'bad',content:'x',sourceUrl:'javascript:alert(1)'})).status,400);
  assert.equal((await api('knowledge','POST',{title:'bad',content:'x',quizzes:[{type:'choice',prompt:'x',answer:'x',options:['a'],correctIndex:0}]})).status,400);
  assert.equal((await api('knowledge','POST',{title:'bad',content:'x',quizzes:[{type:'choice',prompt:'x',answer:'wrong',options:['a','b','c'],correctIndex:0}]})).status,400);
  assert.equal((await api('knowledge','POST',{title:'bad',content:'x',quizzes:[{type:'choice',prompt:'x',answer:'a',options:['a','a','c'],correctIndex:0}]})).status,400);
  await api('knowledge','POST',{title:'=1+1',content:'@bad'});
  const csv=await api('export.csv'); assert.ok(csv.data.includes("'=1+1")); assert.ok(csv.data.includes("'@bad"));
});

test('large CSV export stays within free invocation query budget',async t=>{
 const {DB}=await fixture(t),now=new Date().toISOString();
 await DB.prepare("WITH RECURSIVE nums(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM nums WHERE i<640) INSERT INTO knowledge SELECT printf('%08x-0000-4000-8000-%012x',i,i),'seed-'||i,'内容','seed-'||i,0,?,?,NULL FROM nums").bind(now,now).run();
 await DB.prepare("INSERT INTO review_state SELECT id,created_at,0,0,0,0,'new',0 FROM knowledge").run();let queries=0;
 const counted={prepare(sql){queries++;return DB.prepare(sql);},batch:DB.batch.bind(DB)};
 const response=await handleApi(new Request('https://example.test/api/export.csv'),{DB:counted});
 assert.equal(response.status,200);assert.equal((await response.text()).split('\r\n').length,642);assert.ok(queries<50,`queries: ${queries}`);
});

test('dashboard aggregates history without loading all long content or responses',async t=>{
 const {api,DB}=await fixture(t);
 const item=(await api('knowledge','POST',{title:'長い知識',content:'あ'.repeat(50000),category:'学習'})).data.item;
 await api('reviews','POST',{knowledgeId:item.id,quizId:item.quizzes[0].id,rating:'remembered',response:'こ'.repeat(20000),idempotencyKey:crypto.randomUUID()});
 const choice=(await api('knowledge','POST',{title:'選択知識',content:'説明',category:'学習',quizzes:[{type:'choice',prompt:'正解は？',answer:'a',options:['a','b','c'],correctIndex:0}]})).data.item;
 await api('reviews','POST',{knowledgeId:choice.id,quizId:choice.quizzes[0].id,rating:'remembered',selectedIndex:1,idempotencyKey:crypto.randomUUID()});
 let queries=0;const bounded={prepare(sql){queries++;assert.ok(!/SELECT\s+r\.\*|SELECT\s+k\.\*,s\.due_at/i.test(sql),'dashboard must not load all knowledge/review bodies');return DB.prepare(sql);},batch:DB.batch.bind(DB)};
 const response=await handleApi(new Request('https://example.test/api/dashboard'),{DB:bounded});assert.equal(response.status,200);
 const dashboard=await response.json();assert.equal(dashboard.reviewCount,2);assert.equal(dashboard.learnedToday,2);assert.equal(dashboard.objectiveAnswers,1);assert.equal(dashboard.recentAccuracy,0);assert.equal(dashboard.recallRememberedRate,1);assert.equal(dashboard.learnedTodayItems.length,2);assert.equal(dashboard.streakDays,1);assert.ok(queries<50);
});

test('long Japanese search uses literal substrings within D1 pattern limits',async t=>{
 const {api,DB}=await fixture(t),q='日本語の長い検索条件を五十バイトより長く指定する';
 await api('knowledge','POST',{title:q,content:'100%確かな内容'});
 const limited={prepare(sql){assert.ok(!/\bLIKE\b/i.test(sql),'D1 LIKE patterns are limited to50bytes');return DB.prepare(sql);},batch:DB.batch.bind(DB)};
 const response=await handleApi(new Request('https://example.test/api/knowledge?q='+encodeURIComponent(q)),{DB:limited});assert.equal(response.status,200);assert.equal((await response.json()).total,1);
 assert.equal((await api('knowledge?q='+encodeURIComponent('100%'))).data.total,1);assert.equal((await api('knowledge?q='+encodeURIComponent('_'))).data.total,0);
});
