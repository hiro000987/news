import { createRemoteJWKSet, jwtVerify } from 'jose';

export class AuthError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const resolvers = new Map();
const FIREBASE_JWKS = new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
const notConfigured = () => new AuthError(503, 'AUTH_NOT_CONFIGURED', '本人認証の設定が完了していないため利用できない。');
const ownerEmail = env => {
  const email = String(env.OWNER_EMAIL || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw notConfigured();
  return email;
};
export function isLocalRequest(request, env) {
  return env.LOCAL_DEV === 'true' && ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(new URL(request.url).hostname);
}
export function authProvider(env) {
  const provider = env.AUTH_PROVIDER || 'access';
  if (!['access', 'firebase'].includes(provider)) throw notConfigured();
  return provider;
}
function firebaseSettings(env) {
  const projectId = String(env.FIREBASE_PROJECT_ID || '').trim();
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) throw notConfigured();
  return {projectId, email:ownerEmail(env), issuer:'https://securetoken.google.com/' + projectId};
}
export function publicAuthConfig(request, env) {
  if (isLocalRequest(request, env)) return {mode:'local'};
  if (authProvider(env) === 'access') return {mode:'access'};
  const {projectId} = firebaseSettings(env);
  const apiKey = String(env.FIREBASE_API_KEY || '').trim();
  const authDomain = String(env.FIREBASE_AUTH_DOMAIN || '').trim().toLowerCase();
  const appId = String(env.FIREBASE_APP_ID || '').trim();
  if (!/^[A-Za-z0-9_-]{10,256}$/.test(apiKey) || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(authDomain) || !/^1:\d+:web:[a-f0-9]+$/i.test(appId)) throw notConfigured();
  return {mode:'firebase',firebase:{apiKey,authDomain,projectId,appId}};
}
function settings(env) {
  const team = String(env.ACCESS_TEAM_DOMAIN || '').replace(/^https:\/\//, '').replace(/\/$/, '');
  const email = String(env.OWNER_EMAIL || '').trim().toLowerCase();
  const aud = String(env.ACCESS_AUD || '').trim();
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/i.test(team) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !aud)
    throw new AuthError(503, 'AUTH_NOT_CONFIGURED', '本人認証の設定が完了していないため利用できない。');
  return { issuer: 'https://' + team.toLowerCase(), email, aud };
}

export async function authenticate(request, env, keyResolver) {
  if (isLocalRequest(request, env))
    return { email: null, local: true };
  if (authProvider(env) === 'firebase') return authenticateFirebase(request, env, keyResolver);
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

async function authenticateFirebase(request, env, keyResolver) {
  const config = firebaseSettings(env);
  const header = request.headers.get('Authorization') || '';
  const match = header.length <= 16_384 && header.match(/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i);
  if (!match) throw new AuthError(401, 'UNAUTHORIZED', '本人のGoogleログインが必要。');
  try {
    if (!keyResolver) {
      if (!resolvers.has('firebase')) resolvers.set('firebase', createRemoteJWKSet(FIREBASE_JWKS, {timeoutDuration:5000}));
      keyResolver = resolvers.get('firebase');
    }
    const {payload,protectedHeader} = await jwtVerify(match[1], keyResolver, {
      issuer:config.issuer,audience:config.projectId,algorithms:['RS256'],
      requiredClaims:['exp','iat','auth_time','sub','email','email_verified','firebase']
    });
    const now = Math.floor(Date.now()/1000);
    if (typeof protectedHeader.kid !== 'string' || !protectedHeader.kid ||
        payload.aud !== config.projectId || typeof payload.sub !== 'string' || !payload.sub.trim() || payload.sub.length > 128 ||
        !['exp','iat','auth_time'].every(key => typeof payload[key] === 'number' && Number.isFinite(payload[key]) && payload[key] >= 0) ||
        payload.iat > now || payload.auth_time > now || payload.auth_time > payload.iat || payload.exp <= payload.iat ||
        typeof payload.email !== 'string' || payload.email.trim().toLowerCase() !== config.email || payload.email_verified !== true ||
        payload.firebase?.sign_in_provider !== 'google.com') throw new Error('Invalid Firebase owner claims');
    return {email:config.email,local:false,provider:'firebase'};
  } catch {
    throw new AuthError(401, 'UNAUTHORIZED', '本人のGoogleログインを確認できなかった。');
  }
}

export function assertSameOrigin(request) {
  if (['GET','HEAD','OPTIONS'].includes(request.method)) return;
  const origin = new URL(request.url).origin;
  if (request.headers.get('Origin') !== origin || request.headers.get('Sec-Fetch-Site') === 'cross-site')
    throw new AuthError(403,'ORIGIN_REJECTED','この画面から操作をやり直してほしい。');
}
