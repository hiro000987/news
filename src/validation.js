export class ApiError extends Error {
  constructor(message, code='VALIDATION_ERROR', status=400, details={}) { super(message); this.code=code; this.status=status; this.details=details; }
}
export const MAX_BODY_BYTES=10*1024*1024;
export const uuid=()=>crypto.randomUUID();
export const isUuid=value=>typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function check(condition,message='入力内容が正しくない') { if(!condition) throw new ApiError(message); }
export function safeObject(value) {
 check(value && typeof value==='object' && !Array.isArray(value),'オブジェクトを指定してね');
 for(const key of Object.keys(value)) { check(!['__proto__','prototype','constructor'].includes(key),'禁止されたキーが含まれている'); const v=value[key]; if(v && typeof v==='object') { if(Array.isArray(v)) v.forEach(x=>{if(x && typeof x==='object') safeObject(x);}); else safeObject(v); } }
 return value;
}
export function text(value,max=20000,{required=false,trim=true}={}) { check(typeof value==='string','文字列を指定してね'); const result=trim?value.trim():value; check(result.length<=max && (!required || result.length>0),'文字数が範囲外'); check(!result.includes('\u0000'),'使用できない文字が含まれている'); return result; }
export function validTimestamp(value,nullable=false) { if(nullable && value===null) return true; return typeof value==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString()===value; }
export function normalizeTitle(value) {return value.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('ja');}
export function sourceUrl(value) { if(value===undefined || value===null || value==='') return ''; const raw=text(value,2048); let url; try{url=new URL(raw);}catch{throw new ApiError('URLが正しくない');} check(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password,'http/httpsのURLを指定してね'); url.hash=''; return url.href; }
export async function readJson(request) {
 check((request.headers.get('content-type')||'').split(';')[0].trim().toLowerCase()==='application/json','JSONを指定してね');
 const declared=request.headers.get('content-length'); check(!declared||Number(declared)<=MAX_BODY_BYTES,'ファイルが大きすぎる');
 const reader=request.body?.getReader(); check(reader,'本文が必要'); let size=0,chunks=[];
 while(true){const {value,done}=await reader.read(); if(done)break; size+=value.byteLength; if(size>MAX_BODY_BYTES){await reader.cancel(); throw new ApiError('ファイルが大きすぎる');} chunks.push(value);}
 const bytes=new Uint8Array(size); let offset=0; for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}chunks.length=0;
 let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new ApiError('JSONを読み込めない');} return safeObject(body);
}
export function validateKnowledge(body) {
 safeObject(body); const title=text(body.title,300,{required:true}),content=text(body.content,50000,{required:true});
 const category=text(body.category??'',80); check(Array.isArray(body.tags??[]),'タグは配列で指定してね'); check((body.tags??[]).length<=20,'タグは20件まで'); const tags=[...new Set((body.tags??[]).map(t=>text(t,80,{required:true})))];
 const understanding=body.understanding??0; check(Number.isInteger(understanding)&&understanding>=0&&understanding<=3,'理解度は0〜3');
 let quizzes=body.quizzes; if(quizzes===undefined || (Array.isArray(quizzes)&&!quizzes.length)) quizzes=[{type:'recall',prompt:`「${title}」を自分の言葉で説明すると？`,answer:content,explanation:'',options:[],correctIndex:null}];
 check(Array.isArray(quizzes)&&quizzes.length<=20,'問題は20件まで');
 quizzes=quizzes.map(q=>{safeObject(q);check(['recall','choice'].includes(q.type),'問題形式が正しくない'); if(q.id!==undefined)check(isUuid(q.id),'問題IDが正しくない'); const options=q.options??[];check(Array.isArray(options),'選択肢は配列で指定してね');if(q.type==='choice'){check(options.length===3&&Number.isInteger(q.correctIndex)&&q.correctIndex>=0&&q.correctIndex<=2,'3つの選択肢と正解位置が必要');}else check(options.length===0&&(q.correctIndex===undefined||q.correctIndex===null),'自由回答に選択肢は指定できない');return {id:q.id,type:q.type,prompt:text(q.prompt,1000,{required:true}),answer:text(q.answer,50000,{required:true}),explanation:text(q.explanation??'',10000),options:options.map(o=>text(o,1000,{required:true})),correctIndex:q.type==='choice'?q.correctIndex:null};});
 for(const quiz of quizzes)if(quiz.type==='choice'){check(new Set(quiz.options.map(o=>o.normalize('NFKC').toLocaleLowerCase('ja'))).size===3,'選択肢は重複できない');check(quiz.answer===quiz.options[quiz.correctIndex],'正解の文章を正解の選択肢と一致させてね');}
 check(new Set(quizzes.map(q=>q.id).filter(Boolean)).size===quizzes.filter(q=>q.id).length,'問題IDが重複している');
 return {title,content,category,tags,sourceUrl:sourceUrl(body.sourceUrl),notes:text(body.notes??'',20000),understanding,quizzes};
}
export function integerParam(value,fallback,min,max){if(value===null)return fallback;check(/^\d+$/.test(value),'件数が正しくない');const n=Number(value);check(Number.isSafeInteger(n)&&n>=min&&n<=max,'件数が範囲外');return n;}
