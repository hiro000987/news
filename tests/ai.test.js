import test from 'node:test';
import assert from 'node:assert/strict';
import {handleApi} from '../src/api.js';
import {validateKnowledge} from '../src/validation.js';
import {TABLES} from '../src/backup.js';
import {fixture} from './d1-fixture.js';

const model='@cf/qwen/qwen3-30b-a3b-fp8';
const draft={title:'想起練習',content:'学んだ内容を見ずに思い出す練習。',category:'学習',tags:['記憶'],quizzes:[{type:'recall',prompt:'想起練習とは？',answer:'内容を見ずに思い出す練習。',explanation:'繰り返して確かめる。'}]};
const output=(candidates=[draft])=>({choices:[{message:{content:JSON.stringify({candidates})},finish_reason:'stop'}]});
const input={mode:'topic',topic:'想起練習',count:1};
function client(DB,AI){return async(path='generate',body=input)=>{
 const response=await handleApi(new Request('https://example.test/api/ai/'+path,{method:path==='status'?'GET':'POST',...(path==='status'?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})}),{DB,AI});
 return {status:response.status,data:await response.json()};
};}

test('AI status reports durable budget without invoking provider; absent binding fails closed',async t=>{
 const {DB}=await fixture(t);let calls=0;const api=client(DB,{run(){calls++;return output();}});
 assert.deepEqual(await api('status'),{status:200,data:{available:true,model,dailyLimit:20,remainingCalls:20}});
 assert.equal(calls,0);
 assert.equal((await client(DB)('status')).data.available,false);
 assert.equal((await client(DB)()).status,503);
 assert.equal((await api('status')).data.remainingCalls,20);
});

test('AI generates valid unsaved recall drafts, discards model metadata and preserves one caller URL only in forced notes',async t=>{
 const {DB,api:knowledge}=await fixture(t);let sent;
 const api=client(DB,{run(name,request){assert.equal(name,model);sent=request;return output([{...draft,sourceUrl:'https://invented.invalid/',notes:'verified by AI',id:crypto.randomUUID(),understanding:3},{...draft,title:'分散練習'}]);}});
 const response=await api('generate',{mode:'source',sourceText:'想起練習とは、学んだ内容を見ずに思い出す練習。',sourceUrl:'https://example.test/article#part',count:2});
 assert.equal(response.status,200);assert.equal(response.data.mode,'source');assert.equal(response.data.model,model);assert.equal(response.data.remainingCalls,19);assert.ok(!Number.isNaN(Date.parse(response.data.generatedAt)));
 assert.equal(sent.prompt,undefined);assert.equal(sent.messages.length,2);assert.equal(sent.messages[0].role,'system');assert.ok(sent.messages[0].content.includes(JSON.stringify(sent.response_format.json_schema)));assert.equal(sent.messages[1].role,'user');assert.ok(sent.messages[1].content.endsWith('/no_think'));assert.ok(sent.max_tokens<=4096);assert.equal(sent.response_format.type,'json_schema');
 assert.equal(response.data.candidates.length,2);
 for(const candidate of response.data.candidates){validateKnowledge(candidate);assert.equal(candidate.sourceUrl,'');assert.equal(candidate.understanding,0);assert.equal(candidate.id,undefined);assert.equal(candidate.quizzes.length,1);assert.equal(candidate.quizzes[0].type,'recall');assert.equal(candidate.quizzes[0].id,undefined);assert.match(candidate.notes,/AI/);assert.match(candidate.notes,/未検証/);assert.match(candidate.notes,/提供された文章/);assert.match(candidate.notes,/https:\/\/example.test\/article/);assert.ok(!candidate.notes.includes('invented'));assert.ok(!candidate.notes.includes('verified by AI'));}
 assert.equal((await knowledge('knowledge')).data.total,0);
 for(const candidate of response.data.candidates)assert.equal((await knowledge('knowledge','POST',candidate)).status,201);
 assert.equal((await DB.prepare('SELECT count(*) AS n FROM sources').first()).n,0);
});

test('source mode rejects invented content or answers, retains exact excerpts and removes generated explanation claims',async t=>{
 const {DB}=await fixture(t),body={mode:'source',sourceText:'HTTPはリクエストとレスポンスで通信する。GETは情報を取得する。POSTは情報を送信する。',count:1};
 const valid={title:'HTTPのGET',content:'GETは情報を取得する。',category:'通信',tags:['HTTP'],quizzes:[{type:'recall',prompt:'GETの用途は？',answer:'情報を取得する。',explanation:'GETはURLクエリパラメーターを利用する。'}]};
 for(const candidate of [{...valid,content:valid.content+'GETはURLクエリパラメーターを利用する。'},{...valid,quizzes:[{...valid.quizzes[0],answer:'URLクエリパラメーターを利用する。'}]},{...valid,content:'GETはデータを取得する。'},{...valid,content:'GETは情報を取得する。POSTは情報を送信する。HTTPはリクエストとレスポンスで通信する。'}]){
  const response=await client(DB,{run:async()=>output([candidate])})('generate',body);
  assert.equal(response.status,502);assert.equal(response.data.code,'AI_INVALID_OUTPUT');
 }
 let sent;
 const response=await client(DB,{run:async(_model,request)=>{sent=request;return output([{...valid,content:' \nGETは情報を取得する。\n ',quizzes:[{...valid.quizzes[0],answer:' 情報を取得する。 '}]}]);}})('generate',body);
 assert.equal(response.status,200);assert.equal(response.data.candidates[0].content,'GETは情報を取得する。');assert.equal(response.data.candidates[0].quizzes[0].answer,'情報を取得する。');assert.equal(response.data.candidates[0].quizzes[0].explanation,'');
 assert.match(sent.messages[0].content,/連続した原文/);assert.equal(sent.response_format.json_schema.properties.candidates.items.properties.quizzes.items.properties.explanation.maxLength,0);
 const properties=sent.response_format.json_schema.properties.candidates.items.properties,excerpts=properties.content.enum;
 assert.ok(Array.isArray(excerpts)&&excerpts.length>0&&excerpts.length<=80);assert.deepEqual(properties.quizzes.items.properties.answer.enum,excerpts);
 assert.ok(excerpts.every(excerpt=>typeof excerpt==='string'&&excerpt.length>0&&excerpt.length<=600&&body.sourceText.includes(excerpt)));
 assert.ok(excerpts.includes('GETは情報を取得する。'));assert.ok(!excerpts.includes('GETはURLクエリパラメーターを利用する。'));
 const topic=await client(DB,{run:async()=>output([valid])})('generate',{mode:'topic',topic:'HTTP',count:1});
 assert.equal(topic.status,200);assert.equal(topic.data.candidates[0].quizzes[0].explanation,'GETはURLクエリパラメーターを利用する。');
});

test('source excerpt enums include Japanese comma clauses and stay bounded across long passages',async t=>{
 const {DB}=await fixture(t);
 for(const sourceText of ['HTTPではクライアントがリクエストを送り、サーバーがレスポンスを返す。GETは情報の取得、POSTは情報の送信に使う。','！？。','甲'.repeat(8000),Array.from({length:300},(_,i)=>`項目${i}は試験用の文章である。`).join('')]){
  let options;
  const response=await client(DB,{run:async(_model,request)=>{const props=request.response_format.json_schema.properties.candidates.items.properties;options=props.content.enum;assert.ok(Array.isArray(options));assert.deepEqual(props.quizzes.items.properties.answer.enum,options);return output([{...draft,content:options[0],quizzes:[{...draft.quizzes[0],answer:options[0]}]}]);}})('generate',{mode:'source',sourceText,count:1});
  assert.equal(response.status,200);assert.ok(options.length>0&&options.length<=80);assert.equal(new Set(options).size,options.length);assert.ok(options.every(option=>option===option.trim()&&option.length<=600&&sourceText.includes(option)));assert.ok(options.reduce((sum,option)=>sum+option.length,0)<=2400);
  if(sourceText.includes('GET')){assert.ok(options.includes('GETは情報の取得'));assert.ok(options.includes('POSTは情報の送信に使う。'));}
 }
});

test('AI rejects invalid input, dangerous URLs and prototype keys without consuming budget or calling provider',async t=>{
 const {DB}=await fixture(t);let calls=0;const api=client(DB,{run(){calls++;return output();}});
 for(const body of [{...input,topic:''},{...input,topic:'a'.repeat(201)},{...input,count:4},{...input,count:1.5},{...input,mode:'url'},{mode:'source',sourceText:''},{mode:'source',sourceText:'a'.repeat(8001)},{...input,sourceUrl:'javascript:alert(1)'},{...input,sourceUrl:'https://name:pass@example.test'},{...input,...JSON.parse('{"__proto__":{"polluted":true}}')}, {...input,ignored:'a'.repeat(150000)}])assert.equal((await api('generate',body)).status,400);
 assert.equal(calls,0);assert.equal((await api('status')).data.remainingCalls,20);
});

test('AI rejects malformed, overlong, excessive, duplicate and link-bearing model drafts and counts attempts',async t=>{
 const {DB}=await fixture(t);
 const badOutputs=[{}, {response:'not json'},output([]),output([draft,draft]),output([{...draft,title:'a'.repeat(301)}]),output([{...draft,quizzes:[]}]),output([{...draft,quizzes:[{...draft.quizzes[0],type:'choice'}]}]),output([{...draft,content:'read https://invented.invalid/'}]),{response:'x'.repeat(40001)}, {response:'{"candidates":[{"__proto__":{}}]}'}, {choices:[{message:{content:JSON.stringify({candidates:[draft]})},finish_reason:'length'}]}];
 for(const value of badOutputs){const response=await client(DB,{run:async()=>value})();assert.equal(response.status,502,JSON.stringify(value).slice(0,100));assert.equal(response.data.code,'AI_INVALID_OUTPUT');}
 assert.equal((await client(DB,{run(){}})('status')).data.remainingCalls,20-badOutputs.length);
 const api=client(DB,{run:async()=>output([draft,{...draft}])});
 assert.equal((await api('generate',{...input,count:2})).status,502);
});

test('AI provider failure and actual free-quota exhaustion count once, redact details, do not retry or break knowledge APIs',async t=>{
 const {DB,api:knowledge}=await fixture(t);let calls=0;
 const failure=await client(DB,{run(){calls++;throw new Error('provider private detail');}})();
 assert.equal(failure.status,502);assert.equal(failure.data.code,'AI_PROVIDER_ERROR');assert.ok(!JSON.stringify(failure).includes('private detail'));assert.equal(calls,1);
 const quota=await client(DB,{run(){calls++;throw Object.assign(new Error('daily free allocation exhausted'),{status:429});}})();
 assert.equal(quota.status,429);assert.equal(quota.data.code,'AI_PROVIDER_LIMIT');assert.equal(calls,2);
 assert.equal((await client(DB,{run(){}})('status')).data.remainingCalls,18);
 assert.equal((await knowledge('knowledge','POST',{title:'通常の知識',content:'利用可能'})).status,201);
});

test('AI timeout releases the request at 60 seconds without retry or refund',async t=>{
 const {DB}=await fixture(t);let calls=0,started;
 const invoked=new Promise(resolve=>{started=resolve;});
 t.mock.timers.enable({apis:['setTimeout']});
 const pending=client(DB,{run(){calls++;started();return new Promise(()=>{});}})();
 await invoked;t.mock.timers.tick(60000);
 const response=await pending;assert.equal(response.status,504);assert.equal(response.data.code,'AI_TIMEOUT');assert.equal(calls,1);
 assert.equal((await client(DB,{run(){}})('status')).data.remainingCalls,19);
});

test('AI uses atomic D1 daily reservations under concurrency and resumes on the next UTC day',async t=>{
 const {DB}=await fixture(t);let calls=0;
 const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10),today=new Date().toISOString().slice(0,10);
 await DB.prepare('INSERT INTO ai_daily_usage(day,calls) VALUES (?,20)').bind(yesterday).run();
 const api=client(DB,{run:async()=>{calls++;return output();}});
 const responses=await Promise.all(Array.from({length:27},()=>api()));
 assert.equal(responses.filter(r=>r.status===200).length,20);assert.equal(responses.filter(r=>r.status===429&&r.data.code==='AI_DAILY_LIMIT').length,7);assert.equal(calls,20);
 assert.equal((await DB.prepare('SELECT calls FROM ai_daily_usage WHERE day=?').bind(today).first()).calls,20);
 assert.equal((await api('status')).data.remainingCalls,0);
});

test('AI operational usage stays outside version-one learning backup and import does not restore its quota',async t=>{
 const first=await fixture(t),second=await fixture(t);
 await client(first.DB,{run:async()=>output()})();
 const backup=(await first.api('backup')).data;assert.equal(backup.version,1);assert.deepEqual(Object.keys(backup.tables),Object.keys(TABLES));assert.equal(backup.tables.ai_daily_usage,undefined);
 assert.equal((await second.api('backup/validate','POST',backup)).status,200);
 assert.equal((await second.api('backup/import','POST',backup)).status,200);
 assert.equal((await client(second.DB,{run(){}})('status')).data.remainingCalls,20);
});
