import { readFileSync } from 'node:fs';
import { validateDeployment } from './deployment-policy.mjs';

const mode = process.env.HIRO_DEPLOY_MODE || 'production';
try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--config' || !args[1])) throw new Error('設定ファイルは --config で1つだけ指定してください。');
  if (process.env.CLOUDFLARE_ENV) throw new Error('CLOUDFLARE_ENVによる環境切替は使用できません。');
  const configPath = args[1] || process.env.HIRO_DEPLOY_CONFIG || 'wrangler.production.json';
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const proof = JSON.parse(readFileSync('.wrangler/deployment-verification.json', 'utf8'));
  validateDeployment(config, proof, { now: Date.now(), mode });
  console.log('設定と確認記録の検査に合格。公開先の実際の認証は別途確認が必要。');
} catch (error) {
  const message = error instanceof SyntaxError ? '設定または確認記録のJSONを読み取れません。' : error?.code ? '設定または確認記録を読み取れません。' : error.message;
  console.error(`デプロイ前の確認に失敗: ${message}`);
  process.exitCode = 1;
}
