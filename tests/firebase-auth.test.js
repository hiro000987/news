import test from 'node:test';
import assert from 'node:assert/strict';
import {SignJWT,generateKeyPair,exportJWK,createLocalJWKSet} from 'jose';
import {authenticate} from '../src/auth.js';

const env={AUTH_PROVIDER:'firebase',FIREBASE_PROJECT_ID:'hiro-knowledge-test',OWNER_EMAIL:'owner@example.test'};
const {privateKey,publicKey}=await generateKeyPair('RS256');
const keys=createLocalJWKSet({keys:[{...await exportJWK(publicKey),kid:'firebase-test',alg:'RS256',use:'sig'}]});
async function token(overrides={},signingKey=privateKey){
 const now=Math.floor(Date.now()/1000);
 return new SignJWT({iss:'https://securetoken.google.com/'+env.FIREBASE_PROJECT_ID,aud:env.FIREBASE_PROJECT_ID,sub:'firebase-user-123',email:env.OWNER_EMAIL,email_verified:true,auth_time:now-60,iat:now-30,exp:now+300,firebase:{sign_in_provider:'google.com'},...overrides}).setProtectedHeader({alg:'RS256',kid:'firebase-test'}).sign(signingKey);
}
const request=(jwt,url='https://knowledge.example.test/api/knowledge',headers={})=>new Request(url,{headers:{...(jwt?{Authorization:'Bearer '+jwt}:{}),...headers}});

test('Firebase accepts cryptographically signed verified Google owner and normalizes mail',async()=>{
 const identity=await authenticate(request(await token({email:'OWNER@EXAMPLE.TEST'})),env,keys);
 assert.deepEqual(identity,{email:'owner@example.test',local:false,provider:'firebase'});
});
test('Firebase setup fails closed and preserves loopback-only local bypass',async()=>{
 for(const broken of [{AUTH_PROVIDER:'firebase'}, {...env,FIREBASE_PROJECT_ID:''}, {...env,OWNER_EMAIL:''}, {...env,FIREBASE_PROJECT_ID:'https://evil.test'}, {...env,AUTH_PROVIDER:'unsupported'}])await assert.rejects(()=>authenticate(request(),broken,keys),{status:503});
 assert.equal((await authenticate(request(null,'http://localhost:8787/'),{AUTH_PROVIDER:'firebase',LOCAL_DEV:'true'},keys)).local,true);
 await assert.rejects(()=>authenticate(request(null),{AUTH_PROVIDER:'firebase',LOCAL_DEV:'true'},keys),{status:503});
});
test('Firebase rejects absent/malformed/oversized/unsigned and Access-only credentials',async()=>{
 for(const headers of [{},{Authorization:'Bearer fake'},{Authorization:'Basic abc'},{Authorization:'Bearer '+ 'x'.repeat(17000)},{Authorization:'Bearer eyJhbGciOiJub25lIn0.eyJlbWFpbCI6Im93bmVyQGV4YW1wbGUudGVzdCJ9.'},{'Cf-Access-Jwt-Assertion':'any','Cf-Access-Authenticated-User-Email':env.OWNER_EMAIL}])await assert.rejects(()=>authenticate(request(null,undefined,headers),env,keys),{status:401});
});
test('Firebase rejects other owner, unverified mail and non-Google providers',async()=>{
 for(const claims of [{email:'other@example.test'},{email:'owner@example.test.evil'},{email_verified:false},{email_verified:'true'},{email:null},{firebase:{sign_in_provider:'password'}},{firebase:{sign_in_provider:'custom'}},{firebase:null}])await assert.rejects(async()=>authenticate(request(await token(claims)),env,keys),{status:401});
});
test('Firebase rejects issuer/audience/custom-token/subject mismatches',async()=>{
 for(const claims of [{iss:'https://securetoken.google.com/another-project'},{aud:'another-project'},{aud:[env.FIREBASE_PROJECT_ID,'another-project']},{iss:'service-account@example.iam.gserviceaccount.com',aud:'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit'},{sub:''},{sub:'x'.repeat(129)},{sub:123}])await assert.rejects(async()=>authenticate(request(await token(claims)),env,keys),{status:401});
});
test('Firebase validates expiration, issued-at and authentication time types and chronology',async()=>{
 const now=Math.floor(Date.now()/1000);
 for(const claims of [{exp:now-1},{exp:undefined},{iat:undefined},{iat:now+60},{iat:'123'},{auth_time:undefined},{auth_time:'123'},{auth_time:now+60},{auth_time:now-10},{auth_time:-1}])await assert.rejects(async()=>authenticate(request(await token(claims)),env,keys),{status:401});
});
test('Firebase rejects modified signatures and tokens signed by unrelated keys',async()=>{
 const jwt=await token(),pieces=jwt.split('.');pieces[2]=(pieces[2][0]==='A'?'B':'A')+pieces[2].slice(1);
 await assert.rejects(()=>authenticate(request(pieces.join('.')),env,keys),{status:401});
 const other=await generateKeyPair('RS256');await assert.rejects(async()=>authenticate(request(await token({},other.privateKey)),env,keys),{status:401});
});
