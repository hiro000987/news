import { AI_MODEL } from '../src/ai.js';
const DAY = 24 * 60 * 60 * 1000;
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const workerId = value => typeof value === 'string' && (UUID.test(value) || /^[0-9a-f]{32}$/i.test(value)) && !/^[0-]+$/.test(value);
const present = v => typeof v === 'string' && v.trim().length > 0 && v === v.trim();
const reject = message => { throw new Error(message); };

/** Validates recorded deployment evidence; does not verify live Cloudflare state. */
export function validateDeployment(c, proof, { now = Date.now(), mode = 'production' } = {}) {
  if (!['bootstrap','production'].includes(mode)) reject('デプロイモードが正しくない。');
  if (!c || typeof c !== 'object' || !proof || typeof proof !== 'object') reject('設定と確認記録が必要。');
  if (Object.hasOwn(c,'env')) reject('このアプリでは名前付き環境を使用できません。');
  if (!present(c.name) || c.name !== proof.workerName) reject('Worker名と確認記録を一致させてください。');
  if (c.assets?.run_worker_first !== true || c.preview_urls !== false) reject('全画面のWorker経由とプレビュー無効化が必要。');
  const db = c.d1_databases;
  if (!Array.isArray(db) || db.length !== 1 || !UUID.test(db[0]?.database_id || '')) reject('専用D1の有効なIDが必要。');
  const vars = c.vars || {};
  if (Object.hasOwn(vars,'LOCAL_DEV') || Object.hasOwn(vars,'OWNER_EMAIL')) reject('LOCAL_DEVとOWNER_EMAILを公開設定に含められません。');
  const provider = vars.AUTH_PROVIDER || 'access';
  if (!['access','firebase'].includes(provider)) reject('認証方式が正しくない。');
  const timestamp = Date.parse(proof.checkedAt), current = Number(now), age = current - timestamp;
  if (proof.freePlan !== true || !Number.isFinite(age) || age > DAY || age < -300000) reject('24時間以内の無料プラン確認記録が必要。');
  if (Object.hasOwn(c,'ai') && (!c.ai || c.ai.binding !== 'AI' || Object.keys(c.ai).some(key=>key!=='binding') || proof.workersAiFreeVerified !== true || proof.aiModel !== AI_MODEL)) reject('AIには無料対応モデルの確認記録と専用AI bindingが必要。');
  if (Object.hasOwn(c, 'route')) reject('単数のroute設定は使用できません。');
  const routes = c.routes ?? [];
  if (!Array.isArray(routes)) reject('ルート設定が正しくない。');
  if (mode === 'bootstrap') {
    if (c.workers_dev !== false || routes.length !== 0) reject('準備段階では公開URLとルートを無効にしてください。');
    return;
  }
  const host = proof.productionHost;
  if (!present(host) || !HOST.test(host)) reject('公開先はワイルドカードやパスを含まないホスト名が必要。');
  if (c.workers_dev === true) {
    if (routes.length !== 0 || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(proof.workerSubdomain || '') || host !== `${c.name}.${proof.workerSubdomain}.workers.dev` || !workerId(proof.workerId)) reject('workers.devのホストとWorker確認記録が必要。');
    if (provider === 'access' && (proof.accessDestinationType !== 'worker' || proof.workerId !== proof.accessDestinationWorkerId)) reject('workers.devにはWorker単位のAccess保護が必要。');
  } else if (c.workers_dev === false) {
    if (routes.length !== 1 || typeof routes[0] !== 'object' || routes[0] === null || routes[0].pattern !== host || host.endsWith('.workers.dev')) reject('確認済みの単一カスタムホストが必要。');
  } else reject('公開先の設定が正しくない。');
  if (provider === 'firebase') {
    const project = vars.FIREBASE_PROJECT_ID;
    const domain = vars.FIREBASE_AUTH_DOMAIN;
    if (typeof project !== 'string' || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project) || domain !== `${project}.firebaseapp.com` || typeof vars.FIREBASE_API_KEY !== 'string' || !/^[A-Za-z0-9_-]{10,256}$/.test(vars.FIREBASE_API_KEY) || typeof vars.FIREBASE_APP_ID !== 'string' || !/^1:\d+:web:[a-f0-9]+$/i.test(vars.FIREBASE_APP_ID)) reject('Firebase設定が正しくない。');
    if (proof.authProvider !== 'firebase' || proof.firebaseSparkVerified !== true || proof.googleProviderVerified !== true || proof.authorizedDomainVerified !== true || proof.authSecretsVerified !== true || proof.ownerOnlyPolicy !== true || proof.firebaseProjectId !== project || proof.firebaseAuthDomain !== domain || proof.authorizedDomain !== host) reject('Firebaseの無料プラン、Googleログイン、本人設定と許可ドメインの確認記録が必要。');
  } else {
    const domain = vars.ACCESS_TEAM_DOMAIN;
    if (!present(domain) || !/^(?:https:\/\/)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com\/?$/.test(domain) || !present(vars.ACCESS_AUD)) reject('Accessのチームドメインとaudienceが必要。');
    if (proof.accessAppVerified !== true || proof.ownerOnlyPolicy !== true || proof.authSecretsVerified !== true || !present(proof.accessAppId) || proof.accessAudience !== vars.ACCESS_AUD || proof.teamDomain !== domain) reject('Accessアプリ、本人のみのポリシー、認証情報の確認記録が必要。');
  }
}
