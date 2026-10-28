import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const root=fileURLToPath(new URL('../',import.meta.url));
const wrangler=path.join(root,'node_modules/wrangler/bin/wrangler.js');
const runId=Date.now().toString(36);
const outputs=path.join(root,'artifacts','e2e-'+runId);
await mkdir(outputs,{recursive:true});
const children=[];
let browser;
const checks=[];
async function check(name,work){await work();checks.push(name);console.log('PASS '+name);}
async function server(port,suffix){
  const persist='.wrangler/e2e-'+runId+'-'+suffix;
  const args=['d1','migrations','apply','hiro-knowledge','--local','--persist-to',persist];
  const migration=spawnSync(process.execPath,[wrangler,...args],{cwd:root,encoding:'utf8',env:{...process.env,WRANGLER_SEND_METRICS:'false'},windowsHide:true});
  assert.equal(migration.status,0,migration.stderr||migration.stdout);
  const child=spawn(process.execPath,[wrangler,'dev','--ip','127.0.0.1','--port',String(port),'--persist-to',persist],{cwd:root,env:{...process.env,WRANGLER_SEND_METRICS:'false'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  children.push(child);let log='';child.stdout.on('data',x=>{log=(log+x).slice(-10000)});child.stderr.on('data',x=>{log=(log+x).slice(-10000)});
  const base='http://127.0.0.1:'+port;
  for(let i=0;i<60;i++){
    if(child.exitCode!==null)throw new Error('Worker exited '+log);
    try{const h=await fetch(base+'/health',{signal:AbortSignal.timeout(500)});if(h.ok)return {base,persist,child};}catch{}
    await new Promise(r=>setTimeout(r,500));
  }
  throw new Error('Worker not ready '+log);
}
async function json(base,url,method='GET',body){
  const response=await fetch(base+url,{method,headers:{Origin:base,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json();assert.ok(response.ok,JSON.stringify(data));return data;
}
try{
  const primary=await server(8791,'primary');
  const restored=await server(8792,'restored');
  browser=await chromium.launch({headless:true});
  const desktop=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  const page=await desktop.newPage();
  const errors=[];page.on('pageerror',x=>errors.push(x.message));
  const csp=[];page.on('console',m=>{if(m.type()==='error'&&/Content Security Policy|Refused to/.test(m.text()))csp.push(m.text())});
  await page.goto(primary.base);
  await page.getByRole('heading',{name:'今日の学びを、明日の力へ。'}).waitFor();
  let item;
  await check('desktop knowledge registration with recall and three-choice quizzes',async()=>{
    await page.locator('#add-button').click();
    const dialog=page.getByRole('dialog');
    await dialog.getByLabel('タイトル *',{exact:true}).fill('想起と復習（動作検証）');
    await dialog.getByLabel('内容 *',{exact:true}).fill('自分で思い出してから、間隔を空けて復習する。');
    await dialog.getByLabel('カテゴリー',{exact:true}).fill('学習');
    await dialog.getByLabel('タグ（カンマ区切り）').fill('記憶, テスト');
    await dialog.getByLabel('情報源 URL').fill('https://example.com/learning');
    await dialog.getByLabel('自分のメモ・使い道').fill('読書の後で使ってみる。');
    await dialog.getByLabel('質問',{exact:true}).fill('どのように復習する？');
    await dialog.getByLabel('答え',{exact:true}).fill('先に思い出し、間隔を空ける。');
    await dialog.getByLabel('3択の質問').fill('最初にすることは？');
    await dialog.getByLabel('選択肢 1',{exact:true}).fill('自分で思い出す');
    await dialog.getByLabel('選択肢 2',{exact:true}).fill('答えを読む');
    await dialog.getByLabel('選択肢 3',{exact:true}).fill('何もしない');
    await dialog.getByRole('button',{name:'保存する',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    const data=await json(primary.base,'/api/knowledge');assert.equal(data.total,1);item=data.items[0];
    assert.equal(item.quizzes.length,2);assert.equal(item.notes,'読書の後で使ってみる。');
  });
  await check('search, detail edit and persisted reload',async()=>{
    await page.getByRole('button',{name:'知識',exact:true}).click();
    await page.getByLabel('知識を検索').fill('想起');
    await page.getByRole('button',{name:item.title+' の詳細',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'編集',exact:true}).click();
    await page.getByLabel('自分のメモ・使い道').fill('説明するときに使う。');
    await page.getByRole('button',{name:'保存する',exact:true}).click();
    await page.getByRole('dialog').waitFor({state:'hidden'});
    await page.reload();
    const d=await json(primary.base,'/api/knowledge/'+item.id);assert.equal(d.item.notes,'説明するときに使う。');
    assert.deepEqual(d.item.quizzes.map(x=>x.id).sort(),item.quizzes.map(x=>x.id).sort());
  });
  await check('recall first, answer hidden, review history and next date persisted',async()=>{
    await page.getByRole('button',{name:'復習',exact:true}).click();
    await page.getByLabel('あなたの回答').waitFor();
    assert.equal(await page.locator('.answer').count(),0);
    assert.equal(await page.getByRole('button',{name:'覚えていた',exact:true}).count(),0);
    await page.getByLabel('あなたの回答').fill('先に思い出し、間隔を空ける。');
    await page.getByRole('button',{name:'答えを確認する',exact:true}).click();
    await page.locator('.answer').waitFor();
    await page.getByRole('button',{name:'覚えていた',exact:true}).click();
    await page.getByRole('heading',{name:'復習を記録しました',exact:true}).waitFor();
    const d=await json(primary.base,'/api/knowledge/'+item.id);assert.equal(d.history.length,1);assert.equal(d.item.schedule.reviews,1);assert.ok(Date.parse(d.item.schedule.dueAt)>Date.now());
    const stats=await json(primary.base,'/api/dashboard');assert.equal(stats.recentAccuracy,null);assert.equal(stats.recallRememberedRate,1);
  });
  await check('smartphone reads same DB, navigation and dark theme without overflow',async()=>{
    const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const p=await mobile.newPage();await p.goto(primary.base);await p.getByRole('button',{name:'知識',exact:true}).click();
    await p.getByRole('button',{name:item.title+' の詳細',exact:true}).waitFor();
    assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await p.locator('.header-actions .settings-open').click();await p.getByLabel('表示テーマ').selectOption('dark');
    assert.equal(await p.locator('body').getAttribute('data-theme'),'dark');
    await p.getByRole('dialog').getByRole('button',{name:'閉じる',exact:true}).last().click();
    await p.screenshot({path:path.join(outputs,'mobile-dark.png'),fullPage:true});
    await p.getByRole('button',{name:'分析',exact:true}).click();await p.getByRole('heading',{name:'カテゴリー別の知識',exact:true}).waitFor();
    assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await mobile.close();
  });
  await check('three-choice incorrect answer is recorded objectively and archive is reversible',async()=>{
    const second=await json(primary.base,'/api/knowledge','POST',{title:'3択の確認',content:'正解はひとつ。',category:'学習',quizzes:[{type:'choice',prompt:'正解は？',answer:'正解',options:['正解','別の答え','その他'],correctIndex:0}]});
    await page.getByRole('button',{name:'復習',exact:true}).click();
    await page.getByRole('button',{name:'2. 別の答え',exact:true}).click();
    await page.getByRole('button',{name:'答えを確認する',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'覚えていた',exact:true}).isEnabled(),false);
    await page.getByRole('button',{name:'忘れた',exact:true}).click();await page.getByRole('heading',{name:'復習を記録しました',exact:true}).waitFor();
    const d=await json(primary.base,'/api/knowledge/'+second.item.id);assert.equal(d.history[0].correct,false);
    await page.getByRole('button',{name:'知識',exact:true}).click();await page.getByLabel('知識を検索').fill('');
    await page.getByRole('button',{name:'3択の確認 の詳細',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'アーカイブ',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
    assert.equal((await json(primary.base,'/api/knowledge')).total,1);
    await page.getByLabel('状態',{exact:true}).selectOption('archived');await page.getByRole('button',{name:'3択の確認 の詳細',exact:true}).click();
    await page.getByRole('button',{name:'アーカイブを解除',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
    assert.equal((await json(primary.base,'/api/knowledge')).total,2);
  });
  let backupFile;
  await check('JSON and CSV UI downloads, preview and restore to separate real local D1',async()=>{
    await page.locator('.header-actions .settings-open').click();
    const pending=page.waitForEvent('download');await page.getByRole('button',{name:'JSON を出力',exact:true}).click();
    const download=await pending;backupFile=path.join(outputs,'backup.json');await download.saveAs(backupFile);
    const backup=JSON.parse(await readFile(backupFile,'utf8'));assert.equal(backup.version,1);assert.equal(backup.tables.knowledge.length,2);assert.equal(backup.tables.reviews.length,2);
    const csvPending=page.waitForEvent('download');await page.getByRole('button',{name:'CSV を出力',exact:true}).click();await (await csvPending).saveAs(path.join(outputs,'knowledge.csv'));
    const p=await desktop.newPage();await p.goto(restored.base);await p.locator('.header-actions .settings-open').click();await p.getByLabel('バックアップファイル').setInputFiles(backupFile);
    await p.getByRole('button',{name:'ファイルを検証',exact:true}).click();await p.getByRole('heading',{name:'検証結果',exact:true}).waitFor();
    await p.getByRole('button',{name:'この内容を復元する',exact:true}).click();await p.getByText(/復元しました。追加:/).waitFor();
    const output=await json(restored.base,'/api/backup');assert.deepEqual(output.tables,backup.tables);
    await p.reload();assert.equal((await json(restored.base,'/api/knowledge')).total,2);
    await p.close();await page.getByRole('dialog').getByRole('button',{name:'閉じる',exact:true}).last().click();
  });
  await check('untrusted input rendered as text and same-origin write protection enforced',async()=>{
    const unsafe='<img src=x onerror="window.hacked=true">';await json(primary.base,'/api/knowledge','POST',{title:unsafe,content:'安全な文字列表示'});
    await page.getByRole('button',{name:'知識',exact:true}).click();await page.getByLabel('状態',{exact:true}).selectOption('');
    await page.getByText(unsafe,{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.hacked),undefined);
    const r=await fetch(primary.base+'/api/knowledge',{method:'POST',headers:{Origin:'https://evil.test','Content-Type':'application/json'},body:JSON.stringify({title:'bad',content:'bad'})});assert.equal(r.status,403);
  });
  await page.getByRole('button',{name:'ホーム',exact:true}).click();await page.getByRole('heading',{name:'今日の学びを、明日の力へ。'}).waitFor();
  await page.screenshot({path:path.join(outputs,'desktop.png'),fullPage:true});
  assert.deepEqual(errors,[]);assert.deepEqual(csp,[]);
  await writeFile(path.join(outputs,'result.json'),JSON.stringify({passed:checks.length,checks,productionVerified:false,actualDevicesVerified:false,primary:primary.persist,restored:restored.persist},null,2));
  console.log('E2E '+checks.length+' groups passed. Artifacts: '+outputs);
}catch(error){console.error(error);process.exitCode=1;}
finally{
  if(browser)await browser.close();
  for(const child of children){if(process.platform==='win32')spawnSync('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else child.kill();}
}
