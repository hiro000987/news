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
