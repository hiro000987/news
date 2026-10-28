import { createRemoteJWKSet, jwtVerify } from 'jose';

export class AuthError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const resolvers = new Map();
function settings(env) {
  const team = String(env.ACCESS_TEAM_DOMAIN || '').replace(/^https:\/\//, '').replace(/\/$/, '');
  const email = String(env.OWNER_EMAIL || '').trim().toLowerCase();
  const aud = String(env.ACCESS_AUD || '').trim();
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/i.test(team) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !aud)
    throw new AuthError(503, 'AUTH_NOT_CONFIGURED', '本人認証の設定が完了していないため利用できない。');
  return { issuer: 'https://' + team.toLowerCase(), email, aud };
}

export async function authenticate(request, env, keyResolver) {
  const host = new URL(request.url).hostname;
  if (env.LOCAL_DEV === 'true' && ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host))
    return { email: null, local: true };
  const config = settings(env);
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || token.length > 16_384) throw new AuthError(401, 'UNAUTHORIZED', '本人のCloudflare Accessログインが必要。');
  try {
    if (!keyResolver) {
      if (!resolvers.has(config.issuer)) resolvers.set(config.issuer, createRemoteJWKSet(new URL(config.issuer + '/cdn-cgi/access/certs'), {timeoutDuration: 5000}));
      keyResolver = resolvers.get(config.issuer);
    }
    const {payload} = await jwtVerify(token, keyResolver, {issuer:config.issuer,audience:config.aud,algorithms:['RS256'],requiredClaims:['exp','iat','email']});
    if (String(payload.email || '').toLowerCase() !== config.email) throw new Error('Owner mismatch');
    return {email:config.email,local:false};
  } catch {
    throw new AuthError(401, 'UNAUTHORIZED', '本人のCloudflare Accessログインを確認できなかった。');
  }
}

export function assertSameOrigin(request) {
  if (['GET','HEAD','OPTIONS'].includes(request.method)) return;
  const origin = new URL(request.url).origin;
  if (request.headers.get('Origin') !== origin || request.headers.get('Sec-Fetch-Site') === 'cross-site')
    throw new AuthError(403,'ORIGIN_REJECTED','この画面から操作をやり直してほしい。');
}
