import { authenticate, assertSameOrigin } from './auth.js';
import { handleApi } from './api.js';

export function secure(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control','no-store');
  headers.set('X-Content-Type-Options','nosniff');
  headers.set('Referrer-Policy','no-referrer');
  headers.set('X-Frame-Options','DENY');
  headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'");
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET')
      return secure(Response.json({status:'ok',app:'Hiro Knowledge'}));
    try {
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
