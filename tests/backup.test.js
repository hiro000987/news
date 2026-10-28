import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './d1-fixture.js';
import {exportBackup,importBackup} from '../src/backup.js';
import {handleApi} from '../src/api.js';

test('full backup roundtrip, additive retry and conflict atomicity',async t=>{
 const source=await fixture(t), target=await fixture(t);
 const item=(await source.api('knowledge','POST',{title:'保存',content:'内容',notes:'応用メモ',category:'技術',tags:['基礎'],sourceUrl:'https://example.com/a'})).data.item;
 await source.api('reviews','POST',{knowledgeId:item.id,quizId:item.quizzes[0].id,rating:'remembered',response:'内容',idempotencyKey:crypto.randomUUID()});
 const backup=(await source.api('backup')).data;
 assert.equal(backup.version,1); assert.ok(backup.tables.reviews.length);
 assert.equal((await target.api('backup/validate','POST',backup)).status,200);
 const imported=await target.api('backup/import','POST',backup); assert.equal(imported.status,200); assert.ok(imported.data.imported>0);
 assert.equal((await target.api('knowledge/'+item.id)).data.history.length,1);
 const retry=await target.api('backup/import','POST',backup); assert.equal(retry.data.imported,0); assert.ok(retry.data.skipped>0);
 const corrupt=structuredClone(backup); corrupt.tables.knowledge[0].title='conflict'; corrupt.tables.knowledge[0].normalized_title='conflict';
 assert.equal((await target.api('backup/import','POST',corrupt)).status,409);
 assert.equal((await target.api('knowledge/'+item.id)).data.item.title,'保存');
});

test('hostile and orphaned backups fail before any insert',async t=>{
 const {api,DB}=await fixture(t);
 const item=(await api('knowledge','POST',{title:'既存',content:'保持'})).data.item;
 const backup=(await api('backup')).data;
 const bad=structuredClone(backup); bad.tables.quizzes[0].knowledge_id=crypto.randomUUID();
 assert.equal((await api('backup/import','POST',bad)).status,400);
 const invalid=structuredClone(backup); invalid.tables.knowledge[0].created_at='yesterday';
 assert.equal((await api('backup/import','POST',invalid)).status,400);
 const proto=JSON.parse(JSON.stringify(backup).replace('"version":1','"version":1,"__proto__":{"polluted":true}'));
 assert.equal((await api('backup/import','POST',proto)).status,400);
 assert.equal((await DB.prepare('SELECT count(*) AS n FROM knowledge').first()).n,1);
 assert.equal((await api('knowledge/'+item.id)).data.item.title,'既存');
 const typed=structuredClone(backup); typed.tables.review_state[0].reviews='0';
 assert.equal((await api('backup/import','POST',typed)).status,400);
 const huge=structuredClone(backup); huge.tables.knowledge[0].content='x'.repeat(10*1024*1024+1);
 assert.equal((await api('backup/import','POST',huge)).status,400);
});

test('backup state and review snapshots must agree with actual history',async t=>{
 const {api}=await fixture(t);
 const item=(await api('knowledge','POST',{title:'履歴検査',content:'内容'})).data.item;
 const empty=(await api('backup')).data;
 empty.tables.review_state[0].reviews=900;empty.tables.review_state[0].streak=900;empty.tables.review_state[0].version=900;empty.tables.review_state[0].status='mastered';
 assert.equal((await api('backup/validate','POST',empty)).status,400);
 await api('reviews','POST',{knowledgeId:item.id,quizId:item.quizzes[0].id,rating:'remembered',response:'内容',idempotencyKey:crypto.randomUUID()});
 const backup=(await api('backup')).data;
 const wrong=structuredClone(backup);wrong.tables.reviews[0].rating='forgot';assert.equal((await api('backup/validate','POST',wrong)).status,400);
 const changed=structuredClone(backup);changed.tables.review_state[0].due_at=new Date(Date.now()+10*86400000).toISOString();assert.equal((await api('backup/validate','POST',changed)).status,400);
 const choice=(await api('knowledge','POST',{title:'選択検査',content:'内容',quizzes:[{type:'choice',prompt:'どれ？',answer:'a',options:['a','b','c'],correctIndex:0}]})).data.item;
 const choices=(await api('backup')).data;const quiz=choices.tables.quizzes.find(q=>q.knowledge_id===choice.id);quiz.answer='違う';assert.equal((await api('backup/validate','POST',choices)).status,400);
});

test('export is a consistent snapshot during a concurrent write',async t=>{
 const {api,DB}=await fixture(t);await api('knowledge','POST',{title:'最初',content:'内容'});
 let mutated=false;
 const mutate=async()=>{if(!mutated){mutated=true;await api('knowledge','POST',{title:'同時追加',content:'内容'});}};
 const proxy={prepare(sql){const statement=DB.prepare(sql);return {real:statement,sql,async all(){const result=await statement.all();if(sql.includes('FROM knowledge '))await mutate();return result;}};},async batch(statements){const results=await DB.batch(statements.map(s=>s.real));if(statements.some(s=>s.sql.startsWith('SELECT *')))await mutate();return results;}};
 const backup=await exportBackup(proxy);const target=await fixture(t);
 assert.equal((await target.api('backup/import','POST',backup)).status,200);
 assert.equal(backup.tables.knowledge.length,1);assert.equal(backup.tables.quizzes.length,1);
});

test('oversized local database refuses unusable JSON exports with explicit limit',async t=>{
 const {DB}=await fixture(t),now=new Date().toISOString();
 await DB.prepare("WITH RECURSIVE nums(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM nums WHERE i<79) INSERT INTO knowledge SELECT printf('%08x-0000-4000-8000-%012x',i,i),'large-'||i,?,'large-'||i,0,?,?,NULL FROM nums").bind('あ'.repeat(50000),now,now).run();
 const response=await handleApi(new Request('https://example.test/api/backup'),{DB});
 assert.equal(response.status,413);assert.equal((await response.json()).code,'BACKUP_LIMIT');
});

test('restoring a valid older snapshot reports conflict rather than replacing newer history',async t=>{
 const {api}=await fixture(t);const item=(await api('knowledge','POST',{title:'古い保存',content:'内容'})).data.item;
 const old=(await api('backup')).data;
 await api('reviews','POST',{knowledgeId:item.id,quizId:item.quizzes[0].id,rating:'remembered',response:'内容',idempotencyKey:crypto.randomUUID()});
 const preview=await api('backup/validate','POST',old);assert.equal(preview.status,200);assert.ok(preview.data.conflicts.length>0);
 assert.equal((await api('backup/import','POST',old)).status,409);
 assert.equal((await api('knowledge/'+item.id)).data.history.length,1);
});

test('backup replays scheduler transitions rather than accepting internally consistent invented intervals',async t=>{
 const {api}=await fixture(t);const item=(await api('knowledge','POST',{title:'間隔検査',content:'内容'})).data.item;
 await api('reviews','POST',{knowledgeId:item.id,quizId:item.quizzes[0].id,rating:'forgot',response:'',idempotencyKey:crypto.randomUUID()});
 const backup=(await api('backup')).data,review=backup.tables.reviews[0],schedule=JSON.parse(review.schedule_json),state=backup.tables.review_state[0];
 schedule.intervalDays=180;schedule.dueAt=new Date(Date.parse(review.created_at)+180*86400000).toISOString();review.schedule_json=JSON.stringify(schedule);state.interval_days=180;state.due_at=schedule.dueAt;
 assert.equal((await api('backup/validate','POST',backup)).status,400);
});

test('import detects an existing-row conflict introduced after validation and rolls back new rows',async t=>{
 const source=await fixture(t),target=await fixture(t);
 const item=(await source.api('knowledge','POST',{title:'競合元',content:'保存内容'})).data.item;
 await target.api('backup/import','POST',(await source.api('backup')).data);
 await source.api('knowledge','POST',{title:'追加分',content:'追加内容'});
 const backup=(await source.api('backup')).data;
 const proxy={prepare:target.DB.prepare.bind(target.DB),async batch(statements){await target.DB.prepare('UPDATE knowledge SET content=? WHERE id=?').bind('同時に変化',item.id).run();return target.DB.batch(statements);}};
 await assert.rejects(()=>importBackup(proxy,backup),error=>error.status===409);
 assert.equal((await target.DB.prepare('SELECT count(*) AS n FROM knowledge').first()).n,1);
 assert.equal((await target.api('knowledge/'+item.id)).data.item.content,'同時に変化');
});

test('concurrent conflicting imports stay atomic',async t=>{
 const source=await fixture(t),target=await fixture(t);
 await source.api('knowledge','POST',{title:'一つ目',content:'内容'});
 await source.api('knowledge','POST',{title:'二つ目',content:'内容'});
 const a=(await source.api('backup')).data,b=structuredClone(a);
 b.tables.knowledge[1].content='異なる内容';
 const results=await Promise.all([target.api('backup/import','POST',a),target.api('backup/import','POST',b)]);
 assert.equal(results.filter(r=>r.status===200).length,1,JSON.stringify(results));
 assert.equal(results.filter(r=>r.status===409).length,1,JSON.stringify(results));
 assert.equal((await target.DB.prepare('SELECT count(*) AS n FROM knowledge').first()).n,2);
 assert.equal((await target.DB.prepare('SELECT count(*) AS n FROM quizzes').first()).n,2);
});

test('concurrent identical imports report actual inserted and skipped rows',async t=>{
 const source=await fixture(t),target=await fixture(t);
 await source.api('knowledge','POST',{title:'重複復元',content:'内容'});
 const backup=(await source.api('backup')).data;
 const total=Object.values(backup.tables).reduce((n,rows)=>n+rows.length,0);
 const results=await Promise.all([target.api('backup/import','POST',backup),target.api('backup/import','POST',backup)]);
 assert.ok(results.every(r=>r.status===200));
 assert.equal(results.reduce((n,r)=>n+r.data.imported,0),total);
 assert.equal(results.reduce((n,r)=>n+r.data.skipped,0),total);
});
