import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { handleApi } from '../src/api.js';

export async function fixture(t) {
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', d1Databases: { DB: 'test' }, compatibilityDate: '2026-07-30' });
  t.after(() => mf.dispose());
  const DB = await mf.getD1Database('DB');
  const sql = await readFile(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8');
  for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean)) await DB.prepare(statement).run();
  const api = async (path, method='GET', body) => {
    const response = await handleApi(new Request('https://example.test/api/' + path, {method, ...(body === undefined ? {} : {body: JSON.stringify(body), headers:{'Content-Type':'application/json'}})}), {DB});
    return { status:response.status, data: response.headers.get('content-type')?.includes('json') ? await response.json() : await response.text() };
  };
  return {DB,api};
}
