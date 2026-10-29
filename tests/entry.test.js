import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
test('unconfigured production protects API and static assets equally',async()=>{
  let accessed=false;
  const env={ASSETS:{fetch:()=>{accessed=true;return new Response('private');}}};
  for(const path of ['/','/app.js','/api/knowledge','/api/backup']){
    const response=await worker.fetch(new Request('https://knowledge.example.test'+path),env);
    assert.equal(response.status,503);assert.equal(response.headers.get('Cache-Control'),'no-store');
  }
  assert.equal(accessed,false);
});
test('configured production refuses unsigned and forged credentials before DB access',async()=>{
  const env={ACCESS_TEAM_DOMAIN:'test.cloudflareaccess.com',ACCESS_AUD:'test',OWNER_EMAIL:'owner@example.test',DB:{prepare:()=>{throw new Error('must never access');}}};
  for(const path of ['/','/api/knowledge','/api/backup']){
    const response=await worker.fetch(new Request('https://knowledge.example.test'+path,{headers:{'Cf-Access-Authenticated-User-Email':env.OWNER_EMAIL}}),env);
    assert.equal(response.status,401);
  }
});
test('loopback mutations reject cross-origin requests and assets have security headers',async()=>{
  const env={LOCAL_DEV:'true',DB:{},ASSETS:{fetch:()=>new Response('private',{headers:{'Content-Type':'text/html'}})}};
  const response=await worker.fetch(new Request('http://127.0.0.1:8787/',{}),env);
  assert.equal(response.status,200);assert.ok(response.headers.get('Content-Security-Policy').includes("frame-ancestors 'none'"));
  const post=await worker.fetch(new Request('http://127.0.0.1:8787/api/knowledge',{method:'POST',headers:{Origin:'https://evil.test'}}),env);
  assert.equal(post.status,403);
});
test('public health exposes no identity, counts, or configuration',async()=>{
  assert.deepEqual(await (await worker.fetch(new Request('https://knowledge.example.test/health'),{})).json(),{status:'ok',app:'Hiro Knowledge'});
});

test('AI routes reject anonymous and cross-origin callers before model or quota access',async()=>{
 let calls=0,queries=0;const AI={run(){calls++;throw new Error('must never invoke');}},DB={prepare(){queries++;throw new Error('must never query');}};
 const production={ACCESS_TEAM_DOMAIN:'test.cloudflareaccess.com',ACCESS_AUD:'test',OWNER_EMAIL:'owner@example.test',DB,AI};
 for(const path of ['status','generate']){
  const response=await worker.fetch(new Request('https://knowledge.example.test/api/ai/'+path,{method:path==='status'?'GET':'POST'}),production);
  assert.equal(response.status,401);
 }
 const crossOrigin=await worker.fetch(new Request('http://127.0.0.1:8787/api/ai/generate',{method:'POST',headers:{Origin:'https://evil.test'}}),{LOCAL_DEV:'true',DB,AI});
 assert.equal(crossOrigin.status,403);assert.equal(calls,0);assert.equal(queries,0);
});

const firebaseEnv={AUTH_PROVIDER:'firebase',FIREBASE_PROJECT_ID:'hiro-knowledge-test',FIREBASE_API_KEY:'public-firebase-web-key',FIREBASE_AUTH_DOMAIN:'hiro-knowledge-test.firebaseapp.com',FIREBASE_APP_ID:'1:123456789:web:0123456789abcdef',OWNER_EMAIL:'owner@example.test'};
test('Firebase public login shell and config expose only client fields; data APIs remain private',async()=>{
 let assets=0,db=0;const env={...firebaseEnv,DB:{prepare(){db++;throw new Error('must never query');}},ASSETS:{fetch(){assets++;return new Response('login shell');}}};
 for(const path of ['/','/app.js','/styles.css'])assert.equal((await worker.fetch(new Request('https://knowledge.example.test'+path),env)).status,200);
 const config=await worker.fetch(new Request('https://knowledge.example.test/api/auth/config'),env);assert.equal(config.status,200);
 assert.deepEqual(await config.json(),{mode:'firebase',firebase:{apiKey:firebaseEnv.FIREBASE_API_KEY,authDomain:firebaseEnv.FIREBASE_AUTH_DOMAIN,projectId:firebaseEnv.FIREBASE_PROJECT_ID,appId:firebaseEnv.FIREBASE_APP_ID}});
 for(const path of ['/api/knowledge','/api/backup','/api/export.csv','/api/dashboard','/api/not-real'])assert.equal((await worker.fetch(new Request('https://knowledge.example.test'+path),env)).status,401);
 assert.equal(db,0);assert.equal(assets,3);
});
test('auth config is GET-only, mode explicit, local bypass is URL-limited and incomplete Firebase fails closed',async()=>{
 assert.deepEqual(await (await worker.fetch(new Request('https://knowledge.example.test/api/auth/config'),{})).json(),{mode:'access'});
 assert.deepEqual(await (await worker.fetch(new Request('http://127.0.0.1:8787/api/auth/config'),{LOCAL_DEV:'true'})).json(),{mode:'local'});
 assert.deepEqual(await (await worker.fetch(new Request('https://knowledge.example.test/api/auth/config'),{LOCAL_DEV:'true'})).json(),{mode:'access'});
 for(const field of ['FIREBASE_API_KEY','FIREBASE_AUTH_DOMAIN','FIREBASE_PROJECT_ID','FIREBASE_APP_ID','OWNER_EMAIL']){
  const env={...firebaseEnv,[field]:''};const response=await worker.fetch(new Request('https://knowledge.example.test/api/auth/config'),env);assert.equal(response.status,503,field);assert.ok(!(await response.text()).includes(firebaseEnv.OWNER_EMAIL));
 }
 assert.equal((await worker.fetch(new Request('https://knowledge.example.test/api/auth/config',{method:'POST'}),firebaseEnv)).status,405);
 assert.equal((await worker.fetch(new Request('https://knowledge.example.test/api/auth/config'),{AUTH_PROVIDER:'unknown'})).status,503);
});
test('Firebase CSP permits Google login dependencies while Access policy remains same-origin',async()=>{
 const firebase=await worker.fetch(new Request('https://knowledge.example.test/'),{...firebaseEnv,ASSETS:{fetch:()=>new Response('login')}});
 const csp=firebase.headers.get('Content-Security-Policy');assert.ok(csp.includes('https://www.gstatic.com'));assert.ok(csp.includes('https://identitytoolkit.googleapis.com'));assert.ok(csp.includes('https://hiro-knowledge-test.firebaseapp.com'));assert.ok(!csp.includes("'unsafe-inline'"));
 const access=await worker.fetch(new Request('http://127.0.0.1:8787/'),{LOCAL_DEV:'true',ASSETS:{fetch:()=>new Response('local')}});assert.ok(!access.headers.get('Content-Security-Policy').includes('gstatic.com'));
});
