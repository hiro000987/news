import { authenticate, assertSameOrigin, authProvider, isLocalRequest, publicAuthConfig } from './auth.js';
import { handleApi } from './api.js';

export function secure(response, options={}) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control','no-store');
  headers.set('X-Content-Type-Options','nosniff');
  headers.set('Referrer-Policy','no-referrer');
  headers.set('X-Frame-Options','DENY');
  headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  const firebase = options.firebaseAuthDomain;
  headers.set('Content-Security-Policy', firebase
    ? `default-src 'self'; script-src 'self' https://www.gstatic.com https://apis.google.com; style-src 'self'; img-src 'self' data:; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com; frame-src https://${firebase}; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'`
    : "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'");
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET')
      return secure(Response.json({status:'ok',app:'Hiro Knowledge'}));
    try {
      if (url.pathname === '/api/auth/config') {
        if (request.method !== 'GET') return secure(Response.json({error:'GETで取得してほしい。',code:'METHOD_NOT_ALLOWED'},{status:405,headers:{Allow:'GET'}}));
        return secure(Response.json(publicAuthConfig(request,env)));
      }
      if (!url.pathname.startsWith('/api/') && !isLocalRequest(request,env) && authProvider(env) === 'firebase') {
        const config = publicAuthConfig(request,env);
        if (!['GET','HEAD'].includes(request.method)) return secure(new Response('Method not allowed',{status:405}));
        if (!env.ASSETS) return secure(new Response('Not found',{status:404}));
        return secure(await env.ASSETS.fetch(request),{firebaseAuthDomain:config.firebase.authDomain});
      }
      await authenticate(request, env);
      assertSameOrigin(request);
      if (url.pathname.startsWith('/api/')) {
        if (!env.DB) return secure(Response.json({error:'データベースの接続設定が必要。',code:'DB_NOT_CONFIGURED'},{status:503}));
        return secure(await handleApi(request,env));
      }
      if (!['GET','HEAD'].includes(request.method)) return secure(new Response('Method not allowed',{status:405}));
      if (!env.ASSETS) return secure(new Response('Not found',{status:404}));
      return secure(await env.ASSETS.fetch(request));
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      const message = status < 500 || status === 503 ? error.message : '処理に失敗した。保存状態を確認してからやり直してほしい。';
      return secure(Response.json({error:message,code:error.code || 'INTERNAL_ERROR'},{status}));
    }
  }
};
