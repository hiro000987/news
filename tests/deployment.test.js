import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDeployment } from '../scripts/deployment-policy.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const now=Date.parse('2026-10-29T00:00:00Z');
const config=()=>({name:'hiro-knowledge',workers_dev:true,preview_urls:false,routes:[],assets:{run_worker_first:true},d1_databases:[{database_id:'12345678-1234-4234-8234-123456789abc'}],vars:{ACCESS_TEAM_DOMAIN:'example.cloudflareaccess.com',ACCESS_AUD:'audience'}});
const proof=()=>({checkedAt:new Date(now).toISOString(),workerName:'hiro-knowledge',freePlan:true,accessAppVerified:true,ownerOnlyPolicy:true,authSecretsVerified:true,accessAppId:'app-id',accessAudience:'audience',teamDomain:'example.cloudflareaccess.com',productionHost:'hiro-knowledge.account.workers.dev',workerSubdomain:'account',workerId:'87654321-4321-4321-8321-cba987654321',accessDestinationType:'worker',accessDestinationWorkerId:'87654321-4321-4321-8321-cba987654321'});
test('accepts the Cloudflare documented 32-hex Worker ID format',()=>{
  const p=proof();p.workerId=p.accessDestinationWorkerId='c81a2d22c29840ed9d61681a3270dbff';
  assert.doesNotThrow(()=>validate(config(),p));
});
const validate=(c=config(),p=proof(),mode='production')=>validateDeployment(c,p,{now,mode});

test('AI deployment requires explicit free-model evidence and an exact binding',()=>{
 const c=config(),p=proof();c.ai={binding:'AI'};
 assert.throws(()=>validate(c,p));
 p.workersAiFreeVerified=true;p.aiModel='@cf/qwen/qwen3-30b-a3b-fp8';
 assert.doesNotThrow(()=>validate(c,p));
 for(const ai of [{binding:'OTHER'},{binding:'AI',gateway_id:'paid-gateway'},{binding:'AI',remote:true},null]){
  assert.throws(()=>validate({...c,ai},p));
 }
 p.aiModel='@cf/moonshotai/kimi-k2.6';assert.throws(()=>validate(c,p));
});
test('accepts a protected worker-level workers.dev deployment',()=>assert.doesNotThrow(()=>validate()));
test('accepts a protected single custom hostname',()=>{const c=config(),p=proof();c.workers_dev=false;c.routes=[{pattern:'example.com'}];p.productionHost='example.com';assert.doesNotThrow(()=>validate(c,p));});
test('bootstrap permits only inaccessible configuration with fresh free-plan proof',()=>{const c=config(),p=proof();c.workers_dev=false;delete c.vars.ACCESS_TEAM_DOMAIN;delete c.vars.ACCESS_AUD;assert.doesNotThrow(()=>validate(c,p,'bootstrap'));c.workers_dev=true;assert.throws(()=>validate(c,p,'bootstrap'));});
test('rejects unverified or mismatched Access proof',()=>{for(const [key,value] of [['accessAppVerified',false],['ownerOnlyPolicy',false],['authSecretsVerified',false],['accessAppId',''],['accessAudience','other'],['teamDomain','other.cloudflareaccess.com'],['accessDestinationType','self_hosted'],['accessDestinationWorkerId',''],['workerName','other']]){const p=proof();p[key]=value;assert.throws(()=>validate(config(),p),key)}});
test('rejects public endpoint ambiguity and unsafe hosts',()=>{for(const host of ['*.workers.dev','workers.dev','https://name.account.workers.dev','name.account.workers.dev/path','name.account.workers.dev.evil.com','']){const p=proof();p.productionHost=host;assert.throws(()=>validate(config(),p),host)}const c=config();c.routes=[{pattern:'example.com'}];assert.throws(()=>validate(c));});
test('rejects missing free plan, stale or future proof',()=>{for(const delta of [86400001,-300001]){const p=proof();p.checkedAt=new Date(now-delta).toISOString();assert.throws(()=>validate(config(),p));}const p=proof();p.freePlan=false;assert.throws(()=>validate(config(),p));});
test('rejects unsafe settings, missing DB or public owner address',()=>{for(const mutate of [c=>c.preview_urls=true,c=>c.assets.run_worker_first=false,c=>c.d1_databases[0].database_id='00000000-0000-0000-0000-000000000000',c=>c.d1_databases[0].database_id='bad',c=>c.vars.LOCAL_DEV=false,c=>c.vars.OWNER_EMAIL='owner@example.com',c=>c.vars.ACCESS_TEAM_DOMAIN='evil.com',c=>c.vars.ACCESS_AUD='']){const c=config();mutate(c);assert.throws(()=>validate(c));}});
test('rejects extra custom routes or incorrect host proof',()=>{const c=config(),p=proof();c.workers_dev=false;c.routes=[{pattern:'example.com'},{pattern:'other.com'}];p.productionHost='example.com';assert.throws(()=>validate(c,p));c.routes=[{pattern:'example.com/*'}];p.productionHost='example.com/*';assert.throws(()=>validate(c,p));c.routes=[{pattern:'example.com'}];p.productionHost='other.com';assert.throws(()=>validate(c,p));});
test('rejects unknown mode',()=>assert.throws(()=>validate(config(),proof(),'other')));

test('rejects singular Wrangler route in bootstrap and production',()=>{for(const mode of ['bootstrap','production']){const c=config();if(mode==='bootstrap')c.workers_dev=false;c.route='example.com/*';assert.throws(()=>validate(c,proof(),mode));}});
test('requires the worker host and Access destination to match the recorded worker',()=>{for(const [key,value] of [['workerSubdomain','other'],['workerSubdomain','two.labels'],['workerSubdomain',''],['workerId','other'],['workerId',''],['accessDestinationWorkerId','other']]){const p=proof();p[key]=value;assert.throws(()=>validate(config(),p),key)}});

test('rejects named environments that could override the inspected settings',()=>{
  const c=config();c.workers_dev=false;c.env={public:{workers_dev:true,preview_urls:true,assets:{run_worker_first:false}}};
  assert.throws(()=>validate(c,proof(),'bootstrap'));
});

function cliFixture(t){
  const root=mkdtempSync(path.join(tmpdir(),'hiro-knowledge-deploy-'));
  t.after(()=>{const resolved=realpathSync(root);if(!resolved.startsWith(path.join(realpathSync(tmpdir()),'hiro-knowledge-deploy-')))throw new Error('Unsafe test cleanup');rmSync(resolved,{recursive:true,force:true});});
  mkdirSync(path.join(root,'.wrangler'));
  const safe=config();safe.workers_dev=false;
  writeFileSync(path.join(root,'safe.json'),JSON.stringify(safe));
  writeFileSync(path.join(root,'wrangler.production.json'),JSON.stringify(config()));
  writeFileSync(path.join(root,'.wrangler/deployment-verification.json'),JSON.stringify({...proof(),checkedAt:new Date().toISOString()}));
  return {root,checker:fileURLToPath(new URL('../scripts/deploy-check.mjs',import.meta.url))};
}

test('package deploy checks its actual target even when a safe override file is supplied',t=>{
  const {root,checker}=cliFixture(t);
  const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  const checkArgs=pkg.scripts.deploy.split(' && ')[0].split(/\s+/).slice(2);
  const result=spawnSync(process.execPath,[checker,...checkArgs],{cwd:root,encoding:'utf8',windowsHide:true,env:{...process.env,HIRO_DEPLOY_CONFIG:'safe.json',HIRO_DEPLOY_MODE:'bootstrap',CLOUDFLARE_ENV:''}});
  assert.equal(result.status,1,'must reject the actual public config, not validate the unrelated disabled file');
});

test('CLI rejects CLOUDFLARE_ENV selection before any deploy',t=>{
  const {root,checker}=cliFixture(t);
  const result=spawnSync(process.execPath,[checker],{cwd:root,encoding:'utf8',windowsHide:true,env:{...process.env,HIRO_DEPLOY_CONFIG:'safe.json',HIRO_DEPLOY_MODE:'bootstrap',CLOUDFLARE_ENV:'public'}});
  assert.equal(result.status,1,'a named environment must never change the checked settings');
});
const firebaseConfig=()=>{const c=config();c.vars={AUTH_PROVIDER:'firebase',FIREBASE_PROJECT_ID:'hiro-project-123',FIREBASE_API_KEY:'abcDEF0123456789_key',FIREBASE_AUTH_DOMAIN:'hiro-project-123.firebaseapp.com',FIREBASE_APP_ID:'1:123456:web:abcdef12'};return c;};
const firebaseProof=()=>{const p=proof();delete p.accessDestinationType;delete p.accessDestinationWorkerId;delete p.accessAppId;delete p.accessAudience;delete p.teamDomain;delete p.accessAppVerified;return {...p,authProvider:'firebase',firebaseSparkVerified:true,googleProviderVerified:true,authorizedDomainVerified:true,firebaseProjectId:'hiro-project-123',firebaseAuthDomain:'hiro-project-123.firebaseapp.com',authorizedDomain:p.productionHost};};
test('accepts verified Firebase Google login on a workers.dev host',()=>assert.doesNotThrow(()=>validate(firebaseConfig(),firebaseProof())));
test('accepts verified Firebase Google login on a single custom host',()=>{const c=firebaseConfig(),p=firebaseProof();c.workers_dev=false;c.routes=[{pattern:'example.com'}];p.productionHost=p.authorizedDomain='example.com';assert.doesNotThrow(()=>validate(c,p));});
test('Firebase rejects incomplete or mismatched evidence even if Access evidence exists',()=>{for(const [key,value] of [['firebaseSparkVerified',false],['googleProviderVerified',false],['authorizedDomainVerified',false],['ownerOnlyPolicy',false],['authSecretsVerified',false],['firebaseProjectId','wrong-project'],['firebaseAuthDomain','wrong.firebaseapp.com'],['authorizedDomain','other.workers.dev'],['authProvider','access'],['workerId','bad']]){const p={...proof(),...firebaseProof()};p[key]=value;assert.throws(()=>validate(firebaseConfig(),p),key);}});
test('Firebase rejects invalid configuration and unrelated project auth domain',()=>{for(const [key,value] of [['FIREBASE_PROJECT_ID','short'],['FIREBASE_PROJECT_ID','Invalid_Project'],['FIREBASE_API_KEY','short'],['FIREBASE_API_KEY','abc spaces here'],['FIREBASE_APP_ID','fake'],['FIREBASE_AUTH_DOMAIN','elsewhere.firebaseapp.com']]){const c=firebaseConfig();c.vars[key]=value;assert.throws(()=>validate(c,firebaseProof()),key);}});
test('rejects unknown authentication provider even with valid Access evidence',()=>{const c=config();c.vars.AUTH_PROVIDER='other';assert.throws(()=>validate(c,proof()));});
