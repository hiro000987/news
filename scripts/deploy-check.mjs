import { readFileSync,existsSync } from 'node:fs';
const configPath=process.env.HIRO_DEPLOY_CONFIG || 'wrangler.production.json';
if(!existsSync(configPath))throw new Error('公開設定が未作成。READMEの本人認証・無料プラン確認を先に完了する。');
const c=JSON.parse(readFileSync(configPath,'utf8'));
if(!c.d1_databases?.[0]?.database_id||c.d1_databases[0].database_id.startsWith('00000000'))throw new Error('専用D1のIDが必要。');
if(c.assets?.run_worker_first!==true||c.preview_urls!==false||c.workers_dev!==false)throw new Error('認証経由の専用routeとpreview無効化が必要。');
if(c.vars?.LOCAL_DEV)throw new Error('本番ではLOCAL_DEVを設定できない。');
const file='.wrangler/deployment-verification.json';
if(!existsSync(file))throw new Error('Access/本人ポリシー/無料プラン確認記録が必要。READMEを参照。');
const v=JSON.parse(readFileSync(file,'utf8'));
const age=Date.now()-Date.parse(v.checkedAt);
if(v.freePlan!==true||v.accessAppVerified!==true||v.ownerOnlyPolicy!==true||v.productionHost!==c.routes?.[0]?.pattern||age>86400000||age < -300000||!Number.isFinite(age))
  throw new Error('24時間以内に確認した無料プラン・Access対象URL・本人のみの許可ポリシーが必要。');
if(!c.vars?.ACCESS_TEAM_DOMAIN||!c.vars?.ACCESS_AUD||!v.authSecretsVerified)throw new Error('本番認証の設定とOWNER_EMAIL secret確認が必要。公開Gitへメールや秘密を保存しない。');
console.log('Deployment preflight passed; authentication at the deployed URL still requires verification.');
