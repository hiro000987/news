import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from 'jose';
import { authenticate, assertSameOrigin } from '../src/auth.js';

const env = {ACCESS_TEAM_DOMAIN:'test-team.cloudflareaccess.com',ACCESS_AUD:'knowledge-aud',OWNER_EMAIL:'owner@example.test'};
const {privateKey,publicKey} = await generateKeyPair('RS256');
const jwk = {...await exportJWK(publicKey),kid:'test',alg:'RS256',use:'sig'};
const keys = createLocalJWKSet({keys:[jwk]});
async function token(overrides={}) {
  return new SignJWT({email:env.OWNER_EMAIL,...overrides}).setProtectedHeader({alg:'RS256',kid:'test'})
    .setIssuedAt().setIssuer('https://'+env.ACCESS_TEAM_DOMAIN).setAudience(env.ACCESS_AUD).setExpirationTime('5m').sign(privateKey);
}
function request(jwt, url='https://knowledge.example.test/api/knowledge') {
  return new Request(url,{headers:jwt?{'Cf-Access-Jwt-Assertion':jwt}:{}});
}
test('missing production settings fail closed', async()=>{
  await assert.rejects(()=>authenticate(request(),{}), {status:503});
});
test('local mode is limited to loopback even if flag leaks to deployed settings', async()=>{
  assert.equal((await authenticate(request(null,'http://127.0.0.1:8787/api/knowledge'),{LOCAL_DEV:'true'})).local,true);
  await assert.rejects(()=>authenticate(request(null),{LOCAL_DEV:'true'}), {status:503});
});
test('header presence, forged email and unsigned tokens cannot authenticate',async()=>{
  for(const jwt of [null,'fake','eyJhbGciOiJub25lIn0.eyJlbWFpbCI6Im93bmVyQGV4YW1wbGUudGVzdCJ9.'])
    await assert.rejects(()=>authenticate(request(jwt),env,keys),{status:401});
});
test('real signed owner JWT accepted, case normalized',async()=>{
  const identity=await authenticate(request(await token({email:'OWNER@example.test'})),env,keys);
  assert.equal(identity.email,'owner@example.test'); assert.equal(identity.local,false);
});
test('other user, wrong issuer, wrong audience and expired token rejected',async()=>{
  const other=await token({email:'other@example.test'});
  const issuer=await new SignJWT({email:env.OWNER_EMAIL}).setProtectedHeader({alg:'RS256',kid:'test'}).setIssuedAt().setIssuer('https://other.cloudflareaccess.com').setAudience(env.ACCESS_AUD).setExpirationTime('5m').sign(privateKey);
  const audience=await new SignJWT({email:env.OWNER_EMAIL}).setProtectedHeader({alg:'RS256',kid:'test'}).setIssuedAt().setIssuer('https://'+env.ACCESS_TEAM_DOMAIN).setAudience('other-app').setExpirationTime('5m').sign(privateKey);
  const expired=await new SignJWT({email:env.OWNER_EMAIL}).setProtectedHeader({alg:'RS256',kid:'test'}).setIssuedAt().setIssuer('https://'+env.ACCESS_TEAM_DOMAIN).setAudience(env.ACCESS_AUD).setExpirationTime(1).sign(privateKey);
  for(const jwt of [other,issuer,audience,expired])await assert.rejects(()=>authenticate(request(jwt),env,keys),{status:401});
});
test('tampered signatures, missing expiry and spoofed localhost host header rejected',async()=>{
  const signed=await token();const pieces=signed.split('.');pieces[2]=(pieces[2][0]==='A'?'B':'A')+pieces[2].slice(1);
  await assert.rejects(()=>authenticate(request(pieces.join('.')),env,keys),{status:401});
  const noExpiry=await new SignJWT({email:env.OWNER_EMAIL}).setProtectedHeader({alg:'RS256',kid:'test'}).setIssuedAt().setIssuer('https://'+env.ACCESS_TEAM_DOMAIN).setAudience(env.ACCESS_AUD).sign(privateKey);
  await assert.rejects(()=>authenticate(request(noExpiry),env,keys),{status:401});
  const spoof=new Request('https://public.example.test/',{headers:{Host:'localhost'}});
  await assert.rejects(()=>authenticate(spoof,{LOCAL_DEV:'true'}),{status:503});
});
test('unsafe methods require exact origin; cross-site fetch metadata rejected',()=>{
  const url='https://knowledge.example.test/api/knowledge';
  assert.doesNotThrow(()=>assertSameOrigin(new Request(url,{method:'POST',headers:{Origin:'https://knowledge.example.test'}})));
  for(const headers of [{},{Origin:'https://evil.test'},{Origin:'https://knowledge.example.test','Sec-Fetch-Site':'cross-site'}])
    assert.throws(()=>assertSameOrigin(new Request(url,{method:'POST',headers})),{status:403});
  assert.doesNotThrow(()=>assertSameOrigin(new Request(url)));
});
