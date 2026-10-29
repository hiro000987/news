const $ = s => document.querySelector(s);
const el = (tag, text, cls) => { const x = document.createElement(tag); if (text != null) x.textContent = text; if (cls) x.className = cls; return x; };
const add = (p, ...xs) => { for (const x of xs) if (x) p.append(x); return p; };
const button = (text, action, cls='secondary') => { const b=el('button',text,cls); b.type='button'; b.addEventListener('click',action); return b; };
const state={page:'home',offset:0,limit:20,meta:{categories:[],tags:[]},review:null,quiz:null,selected:null,revealed:false,key:null};
const pages=[['home','⌂','ホーム'],['knowledge','▤','知識'],['review','◷','復習'],['analytics','▥','分析']];
const statusLabels={new:'未学習',due:'復習予定',mastered:'習得の目安',archived:'アーカイブ'};
let aiVersion=0, aiController=null, aiBatch=null;
function clearAi(){aiVersion++;aiController?.abort();aiController=null;aiBatch=null}
let authMode='loading', authClient=null, authReady=false, sessionVersion=0, requestController=new AbortController(), currentUid=null;
function resetSession(){
  sessionVersion++; clearAi(); requestController.abort(); requestController=new AbortController();
  state.review=null; state.quiz=null; state.response=''; state.selected=null; state.key=null; state.revealed=false; state.q=''; state.category=''; state.tag=''; state.status=''; state.offset=0; state.meta={categories:[],tags:[]};
  if ($('#modal').open) $('#modal').close();
  returnFocus=null; $('#modal-content').replaceChildren();
  $('#view').replaceChildren();
  clearTimeout(toast.timer); $('#toast').textContent=''; $('#toast').classList.remove('show');
}
function loginErrorMessage(error){
  const messages=new Map([
    ['auth/popup-blocked','ポップアップがブロックされました。ブラウザの設定を確認してください。'],
    ['auth/popup-closed-by-user','ログイン画面が閉じられました。もう一度お試しください。'],
    ['auth/network-request-failed','通信できませんでした。インターネット接続を確認してください。'],
    ['auth/unauthorized-domain','ログインに使うサイトの設定を確認してください。'],
    ['auth/web-storage-unsupported','ブラウザの保存機能を利用できません。ブラウザの設定を確認してください。'],
    ['auth/operation-not-supported-in-this-environment','このブラウザ環境ではログインできません。通常のブラウザで開いてください。']
  ]);
  let code;try{code=error?.code}catch{code=null}
  if(!messages.has(code))return 'ログインできませんでした。もう一度お試しください。（確認コード: auth/unknown）';
  return `${messages.get(code)}（確認コード: ${code}）`;
}
function showLogin(message='ログインすると、あなたの知識を安全に開けます。', retryAccount=false){
  authReady=false; resetSession();
  document.body.classList.add('auth-locked'); $('#logout-button').hidden=true; $('#page-title').textContent='ログイン';
  const panel=el('div',null,'panel login-panel');
  add(panel,el('span','HIRO KNOWLEDGE','eyebrow'),el('h2','おかえりなさい'),el('p',message,'muted'));
  const error=el('p','','error');error.setAttribute('role','alert');
  const login=button(retryAccount?'別のアカウントでログイン':'Googleでログイン',async()=>{
    login.disabled=true;error.textContent='';
    try { if(retryAccount){await authClient.signOut();showLogin('本人の Google アカウントを選んでください。');return;} await authClient.signIn(); }
    catch(e){error.textContent=loginErrorMessage(e);}
    finally{login.disabled=false}
  },'primary');
  add(panel,login,error);$('#view').replaceChildren(panel);
}
async function authorizedFetch(path,options={}){
  const version=sessionVersion, headers=new Headers(options.headers||{});
  const call=async force=>{
    if(authMode==='firebase')headers.set('Authorization',`Bearer ${await authClient.getAuthToken(force)}`);
    if(version!==sessionVersion)throw new Error('ログイン状態が変わりました。');
    return fetch(path,{...options,headers,signal:options.signal?AbortSignal.any([requestController.signal,options.signal]):requestController.signal});
  };
  let r=await call(false);
  if(authMode==='firebase' && r.status===401 && version===sessionVersion)r=await call(true);
  if(version!==sessionVersion)throw new Error('ログイン状態が変わりました。');
  if(authMode==='firebase' && (r.status===401||r.status===403)){
    showLogin('このアカウントでは利用できません。本人の Google アカウントでログインしてください。',true);
    throw new Error('本人の Google アカウントでログインしてください。');
  }
  return r;
}
async function api(path, options={}) {
  const opts={...options,headers:{...options.headers}};
  if(options.body && typeof options.body !== 'string'){opts.body=JSON.stringify(options.body);opts.headers['Content-Type']='application/json'}
  const version=sessionVersion; const r=await authorizedFetch(path,opts); let data;
  try{data=await r.json()}catch{throw new Error('サーバーからの応答を読み取れませんでした。')}
  if(version!==sessionVersion)throw new Error('ログイン状態が変わりました。');
  if(!r.ok){const error=new Error(data.error || `通信エラー (${r.status})`);error.status=r.status;error.code=data.code;throw error;} return data;
}
function toast(t){const x=$('#toast');x.textContent=t;x.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>x.classList.remove('show'),3500)}
function fail(e){toast(e.message || '処理に失敗しました。')}
function nav(){document.querySelectorAll('.nav').forEach(n=>{n.replaceChildren();for(const [id,icon,label] of pages){const b=button('',()=>go(id),'');const i=el('span',icon,'nav-icon');i.setAttribute('aria-hidden','true');b.setAttribute('aria-label',label);add(b,i,document.createTextNode(label));b.classList.toggle('active',state.page===id);if(state.page===id)b.setAttribute('aria-current','page');n.append(b)}});$('#page-title').textContent=pages.find(p=>p[0]===state.page)[2]}
async function go(page){if(!authReady)return;clearAi();if($('#modal').open)$('#modal').close();$('#modal-content').replaceChildren();const version=sessionVersion;state.page=page;nav();$('#view').replaceChildren(el('p','読み込み中…','muted'));try{if(page==='home')await home();if(page==='knowledge')await knowledge();if(page==='review')await review();if(page==='analytics')await analytics()}catch(e){if(version===sessionVersion&&state.page===page)$('#view').replaceChildren(empty('読み込めませんでした',e.message,button('もう一度試す',()=>go(page))))} }
function empty(title,desc,action){const x=el('div',null,'empty');add(x,el('strong',title),el('p',desc),action);return x}
function card(label,value,sub){const x=el('div',null,'card');add(x,el('span',label,'label'),el('strong',value==null?'—':String(value)),el('span',sub||'','muted'));return x}
function section(title,action){const x=el('div',null,'section-heading');add(x,el('h2',title),action);return x}
const percent=v=>v==null?'未測定':`${Math.round((v<=1?v*100:v))}%`;
function itemList(items, fallback) {
  const list=el('div');
  if (!items.length) { list.append(el('p',fallback,'muted')); return list; }
  for (const item of items) {
    const b=button(item.title,()=>detail(item.id),'list-link');
    list.append(b);
  }
  return list;
}
async function home(){
  const [d,due]=await Promise.all([api('/api/dashboard'),api('/api/knowledge?status=due&limit=5')]);
  if(state.page!=='home')return;
  const v=$('#view');v.replaceChildren();
  const hero=el('div',null,'hero');
  add(hero,el('span','少しずつ、確かな知識に','eyebrow'),el('h2','今日の学びを、明日の力へ。'),el('p','覚えたことを自分の言葉で思い出す。小さな復習を重ねて、知識を使える力にしよう。'),button('今日の復習をはじめる →',()=>go('review'),'primary'),button('AIでカード作成',openAi));
  const cards=el('div',null,'cards');
  add(cards,card('今日の復習',d.dueCount,'復習できる知識'),card('今日の学習',d.learnedToday,'学んだ知識'),card('今日の復習回数',d.reviewsToday,'記録した回答'),card('知識のストック',d.totalKnowledge,'登録した知識'),card('3択の正答率',percent(d.recentAccuracy),`直近30日・最大100件 / ${d.objectiveAnswers??0} 件`),card('連続した学習日',d.streakDays,'東京時間'),card('今日の追加',d.addedToday,'新しい知識'));
  const lists=el('div',null,'grid-two');
  const duePanel=el('div',null,'panel');add(duePanel,el('h3','今日の復習対象'),el('p','期限到来・未学習の知識（最大5件）','muted'),itemList(due.items||[],'復習対象はありません。'));
  const learned=el('div',null,'panel');add(learned,el('h3','今日学んだ知識'),el('p','今日復習した知識（最大5件）','muted'),itemList(d.learnedTodayItems||[],'今日はまだ学習していません。'));
  add(lists,duePanel,learned);
  const weak=(d.categories||[]).filter(c=>c.totalAnswers>=3&&c.accuracy!=null).sort((a,b)=>a.accuracy-b.accuracy);
  const weakPanel=el('div',null,'panel');add(weakPanel,el('h3','復習のヒント'),el('p','3択の回答が3件以上あるカテゴリーを正答率の低い順に表示します。','muted'));
  if(!weak.length)weakPanel.append(el('p','まだ十分な3択の回答がありません。','muted'));
  else for(const c of weak.slice(0,3))weakPanel.append(el('p',`${c.category}: ${percent(c.accuracy)}（${c.totalAnswers}件）`));
  add(v,hero,cards,section('今日の知識'),lists,section('カテゴリーの振り返り'),weakPanel);
}
async function meta(){state.meta=await api('/api/meta')}
function select(label, options, value=''){const s=el('select');s.setAttribute('aria-label',label);for(const [val,txt] of options){const o=el('option',txt);o.value=val;s.append(o)}s.value=value;return s}
async function knowledge(){await meta();if(state.page!=='knowledge')return;const v=$('#view');v.replaceChildren(el('p','記録した知識を探して、少しずつ育てよう。','intro'));v.append(button('AIでカード作成',openAi));const filters=el('div',null,'filters');const q=el('input');q.type='search';q.placeholder='タイトルや内容を検索';q.setAttribute('aria-label','知識を検索');q.value=state.q||'';const category=select('カテゴリー', [['','すべてのカテゴリー'],...state.meta.categories.map(x=>[x,x])],state.category||'');const tag=select('タグ',[['','すべてのタグ'],...state.meta.tags.map(x=>[x,x])],state.tag||'');const status=select('状態',[['','すべての状態'],...Object.entries(statusLabels)],state.status||'');let timer;q.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>{state.q=q.value;state.offset=0;loadList()},300)});for(const [control,key] of [[category,'category'],[tag,'tag'],[status,'status']])control.addEventListener('change',()=>{state[key]=control.value;state.offset=0;loadList()});add(filters,q,category,tag,status);const list=el('div',null,'knowledge-list');list.id='knowledge-list';const pagination=el('div',null,'pagination');pagination.id='pagination';add(v,filters,list,pagination);await loadList()}
async function loadList(){const list=$('#knowledge-list');if(!list)return;list.replaceChildren(el('p','読み込み中…','muted'));try{const params=new URLSearchParams({q:state.q||'',category:state.category||'',tag:state.tag||'',status:state.status||'',offset:String(state.offset),limit:String(state.limit)});const d=await api('/api/knowledge?'+params);list.replaceChildren();if(!d.items.length)list.append(empty('知識が見つかりません','検索条件を変えるか、新しい知識を追加しよう。',button('知識を追加',()=>editor())));for(const item of d.items){const c=el('div',null,'knowledge-card');c.tabIndex=0;c.setAttribute('role','button');c.setAttribute('aria-label',`${item.title} の詳細`);c.addEventListener('click',()=>detail(item.id));c.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();detail(item.id)}});const text=el('div');add(text,el('h3',item.title));const badges=el('div');if(item.category)badges.append(el('span',item.category,'badge'));for(const tag of item.tags||[])badges.append(el('span','#'+tag,'badge'));if(item.archivedAt)badges.append(el('span','アーカイブ','badge'));add(text,badges,el('p',(item.content||'').slice(0,120)));add(c,text,el('span','→','muted'));list.append(c)}const p=$('#pagination');p.replaceChildren();if(d.total>state.limit){const prev=button('← 前へ',()=>{state.offset=Math.max(0,state.offset-state.limit);loadList()},'danger');prev.disabled=state.offset===0;const next=button('次へ →',()=>{state.offset+=state.limit;loadList()},'danger');next.disabled=state.offset+state.limit>=d.total;add(p,prev,el('span',`${state.offset+1}–${Math.min(state.offset+state.limit,d.total)} / ${d.total}`),next)}}catch(e){list.replaceChildren(empty('読み込めませんでした',e.message,button('再試行',loadList)))}}
const dialog=$('#modal');let returnFocus;
function modal(title,body,actions=[]){returnFocus=document.activeElement;const wrap=$('#modal-content');wrap.replaceChildren();const head=el('div',null,'modal-head');const h=el('h2',title);h.id='dialog-title';const close=button('×',()=>dialog.close(),'icon-button');close.setAttribute('aria-label','閉じる');add(head,h,close);const inner=el('div',null,'modal-body');inner.append(body);const foot=el('div',null,'modal-actions');for(const a of actions)foot.append(a);add(wrap,head,inner,foot);dialog.setAttribute('aria-labelledby','dialog-title');if(!dialog.open)dialog.showModal();}
dialog.addEventListener('close',()=>{const refresh=(aiBatch?.savedAny||aiBatch?.pending)&&authReady;clearAi();$('#modal-content').replaceChildren();returnFocus?.focus();if(refresh)go(state.page)});
function field(container,label,value='',type='text',hint=''){const l=el('label',label);const id='f-'+crypto.randomUUID();l.htmlFor=id;const input=el(type==='textarea'?'textarea':'input');input.id=id;if(type!=='textarea')input.type=type;input.value=value??'';container.append(l);if(hint)container.append(el('div',hint,'hint'));container.append(input);return input}
function safeUrl(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:''}catch{return ''}}
function dateText(value){
  if(!value)return '未設定';
  const date=new Date(value);
  return Number.isNaN(date.getTime())?'未設定':new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',dateStyle:'medium',timeStyle:'short'}).format(date);
}

function openAi(){
  clearAi();aiController=new AbortController();const signal=aiController.signal, version=aiVersion, session=sessionVersion;const batch=aiBatch={savedAny:false,pending:false};
  const body=el('div'),status=el('p','利用状況を確認中…','muted');status.setAttribute('aria-live','polite');
  const mode=select('作成方法',[['topic','テーマから作成'],['source','文章から作成']],'topic');const modeLabel=el('label','作成方法');mode.id='ai-mode';modeLabel.htmlFor=mode.id;
  const topicWrap=el('div'),sourceWrap=el('div');const topic=field(topicWrap,'テーマ');topic.maxLength=200;
  const source=field(sourceWrap,'元の文章','','textarea','原文の範囲でレベルを調整し、抜粋して質問を作ります。8,000文字まで。');source.maxLength=8000;
  const url=field(sourceWrap,'参考 URL','','url','URLは参考情報として記録します。ページの内容は取得しません。');
  sourceWrap.hidden=true;mode.addEventListener('change',()=>{topicWrap.hidden=mode.value!=='topic';sourceWrap.hidden=mode.value!=='source'});
  const countLabel=el('label','生成数');countLabel.htmlFor='ai-count';const count=select('生成数',[['1','1件'],['3','3件'],['5','5件'],['10','10件']],'10');count.id='ai-count';
  const levelLabel=el('label','問題のレベル');levelLabel.htmlFor='ai-level';const level=select('問題のレベル',[['beginner','初級'],['intermediate','中級'],['advanced','上級'],['expert','専門家']],'beginner');level.id='ai-level';
  const descriptions={beginner:'基本的な用語と基礎から学びます。',intermediate:'基礎を使った応用を学びます。',advanced:'条件による違いと選択の利点・弱点を学びます。',expert:'前提条件や例外的なケースまで掘り下げます。'};
  const levelHint=el('p',descriptions.beginner,'hint');level.addEventListener('change',()=>levelHint.textContent=descriptions[level.value]);
  const error=el('p','','error');error.setAttribute('role','alert');const results=el('div',null,'ai-results');results.setAttribute('aria-live','polite');
  const inputs=[mode,topic,source,url,count,level];for(const input of inputs)input.addEventListener(input.tagName==='SELECT'?'change':'input',()=>{results.replaceChildren();error.textContent=''});
  const active=()=>version===aiVersion&&session===sessionVersion&&dialog.open;
  const refreshClosed=()=>{if(session===sessionVersion&&authReady&&!dialog.open&&['home','knowledge'].includes(state.page))go(state.page)};
  const generate=button('生成して自動保存',async()=>{
    error.textContent='';results.replaceChildren();
    if(mode.value==='topic'&&!topic.value.trim()){error.textContent='テーマを入力してください。';topic.focus();return}
    if(mode.value==='source'&&!source.value.trim()){error.textContent='元の文章を入力してください。';source.focus();return}
    if(mode.value==='source'&&url.value.trim()&&!safeUrl(url.value.trim())){error.textContent='参考 URL は http または https で入力してください。';url.focus();return}
    const selectedLevel=level.options[level.selectedIndex].textContent;
    generate.disabled=true;for(const input of inputs)input.disabled=true;batch.pending=true;status.textContent='生成・保存中です。閉じてもサーバー側で保存が続く場合があります。';
    try{
      const data=await api('/api/ai/generate',{method:'POST',body:{mode:mode.value,topic:mode.value==='topic'?topic.value.trim():'',sourceText:mode.value==='source'?source.value.trim():'',sourceUrl:mode.value==='source'?url.value.trim():'',count:Number(count.value),level:level.value}});
      batch.pending=false;batch.savedAny=true;if(!active()){refreshClosed();return}
      status.textContent=data.remainingCalls<=0?'本日の利用上限に達しました。時間をおいてお試しください。':`本日の残り: ${data.remainingCalls} 回`;generate.dataset.exhausted=String(data.remainingCalls<=0);
      const items=data.items||[],skipped=data.skipped||[],failed=data.failed||[];
      add(results,el('h3','生成結果'),el('p',`保存: ${items.length}件 / 重複: ${skipped.length}件 / 失敗: ${failed.length}件`),el('p','AI未確認・出典未検証。内容を確認してください。','hint'));
      for(const item of items){const box=el('div',null,'ai-candidate');add(box,el('h3',item.title),el('span',selectedLevel,'badge'),el('span','保存済み','badge'),el('p',item.content,'detail-text'));const choice=(item.quizzes||[]).find(q=>q.type==='choice');if(choice){box.append(el('p',`3択: ${choice.prompt}`,'detail-text'));for(const option of choice.options||[])box.append(el('p',option,'detail-text'));box.append(el('p',`答え: ${choice.answer}`,'detail-text'))}results.append(box)}
      for(const item of skipped)results.append(el('p',`重複: ${item.title}`,'detail-text'));
      for(const item of failed)results.append(el('p',`失敗: ${item.title} — ${item.message}`,'detail-text'));
    }catch(e){batch.pending=false;if(!active()){refreshClosed();return}error.textContent=`${e.message||'生成結果を受け取れませんでした。'} 保存されたカードがある可能性があります。知識一覧を確認してください。`;status.textContent='利用状況を確認中…';batch.savedAny=true;try{await refreshStatus()}catch{if(active()){status.textContent='利用状況を確認できませんでした。';generate.dataset.exhausted='true'}}}
    finally{if(active()){for(const input of inputs)input.disabled=false;generate.disabled=generate.dataset.exhausted==='true'}}
  },'primary');generate.disabled=true;
  add(body,el('p','生成したカードは確認なしで保存。3択と自由回答の問題付き。','hint'),el('p','AI未確認・出典未検証のため、保存後に内容を確認してください。','hint'),el('p','生成1回につき利用1回。件数が多いほど無料枠の計算資源を多く使います。利用回数は毎日9時（日本時間）にリセットし、失敗も回数に含みます。','hint'),status,modeLabel,mode,topicWrap,sourceWrap,countLabel,count,levelLabel,level,levelHint,error,generate,results);
  async function refreshStatus(){const data=await api('/api/ai/status',{signal});if(!active())return;generate.dataset.exhausted=String(!data.available||data.remainingCalls<=0);status.textContent=!data.available?'現在 AI 作成は利用できません。':data.remainingCalls<=0?'本日の利用上限に達しました。時間をおいてお試しください。':`本日の残り: ${data.remainingCalls} / ${data.dailyLimit} 回`;generate.disabled=generate.dataset.exhausted==='true'}
  modal('AIでカード作成',body,[button('閉じる',()=>dialog.close(),'danger')]);refreshStatus().catch(()=>{if(active())status.textContent='利用状況を確認できませんでした。'});
}

async function detail(id){
  try{
    const d=await api('/api/knowledge/'+encodeURIComponent(id));const item=d.item;const body=el('div');
    if(item.category)body.append(el('span',item.category,'badge'));
    for(const t of item.tags||[])body.append(el('span','#'+t,'badge'));
    const levels=['未設定','少しわかる','だいたいわかる','説明できる'];
    add(body,el('p',`理解度: ${levels[item.understanding]||'未設定'}　状態: ${item.archivedAt?'アーカイブ':(statusLabels[item.schedule?.status]||({'learning':'学習中'}[item.schedule?.status])||'未設定')}　次回: ${dateText(item.schedule?.dueAt)}`,'muted'));
    for(const [heading,value] of [['内容',item.content],['自分のメモ',item.notes]])if(value)add(body,el('h3',heading),el('p',value,'detail-text'));
    if(item.sourceUrl&&safeUrl(item.sourceUrl)){const a=el('a','情報源を開く ↗');a.href=safeUrl(item.sourceUrl);a.target='_blank';a.rel='noopener noreferrer';body.append(a)}
    const history=d.history||[];body.append(el('h3','復習履歴'));
    if(!history.length)body.append(el('p','まだ復習していません','muted'));
    else for(const entry of history){
      const record=el('div',null,'history-item');
      const rating=({forgot:'忘れた',unsure:'あいまい',remembered:'覚えていた'})[entry.rating]||entry.rating;
      add(record,el('strong',`${dateText(entry.createdAt)}　${rating}`));
      if(entry.correct!==null&&entry.correct!==undefined)record.append(el('p',entry.correct?'3択: 正解':'3択: 不正解','muted'));
      if(entry.response)record.append(el('p',`回答: ${entry.response}`,'detail-text'));
      body.append(record);
    }
    const archive=button(item.archivedAt?'アーカイブを解除':'アーカイブ',async()=>{try{await api(`/api/knowledge/${encodeURIComponent(id)}/archive`,{method:'PATCH',body:{archived:!item.archivedAt}});dialog.close();toast(item.archivedAt?'アーカイブを解除しました':'アーカイブしました');go(state.page)}catch(e){fail(e)}},'danger');
    modal(item.title,body,[archive,button('編集',()=>editor(item),'primary')]);
  }catch(e){fail(e)}
}
function editor(item=null,initial={}){const editorSession=sessionVersion, editorPage=state.page;const draft=initial.candidate||{};const body=el('form');body.addEventListener('submit',e=>e.preventDefault());const title=field(body,'タイトル *',item?.title||draft.title||initial.title||'');title.required=true;const content=field(body,'内容 *',item?.content||draft.content||initial.summary||'','textarea');content.required=true;const grid=el('div',null,'form-grid');const category=field(grid,'カテゴリー',item?.category||draft.category||'');const tags=field(grid,'タグ（カンマ区切り）',(item?.tags||draft.tags||[]).join(', '));body.append(grid);const url=field(body,'情報源 URL',item?.sourceUrl||draft.sourceUrl||initial.url||'','url');const notes=field(body,'自分のメモ・使い道',item?.notes||draft.notes||'','textarea');const ul=el('label','理解度');ul.htmlFor='understanding';body.append(ul);const understanding=select('理解度',[['0','未設定'],['1','少しわかる'],['2','だいたいわかる'],['3','説明できる']],String(item?.understanding??draft.understanding??0));understanding.id='understanding';body.append(understanding);const quizzes=item?.quizzes||draft.quizzes||[];const recall=quizzes.find(q=>q.type==='recall');const choice=quizzes.find(q=>q.type==='choice');add(body,el('h3','自由想起の問題'),el('p','答えを見ずに思い出すための質問。空欄ならタイトルから作成します。','hint'));const prompt=field(body,'質問',recall?.prompt||'');const answer=field(body,'答え',recall?.answer||'','textarea');const explanation=field(body,'解説',recall?.explanation||'','textarea');add(body,el('h3','任意の3択問題'),el('p','客観的な正答率は3択の回答だけから計算します。','hint'));const cp=field(body,'3択の質問',choice?.prompt||'');const options=[0,1,2].map(i=>field(body,`選択肢 ${i+1}`,choice?.options?.[i]||''));const cl=el('label','正解の選択肢');cl.htmlFor='correct-index';body.append(cl);const correct=select('正解の選択肢',[['0','選択肢 1'],['1','選択肢 2'],['2','選択肢 3']],String(choice?.correctIndex??0));correct.id='correct-index';body.append(correct);const ce=field(body,'3択の解説',choice?.explanation||'','textarea');const error=el('p','','error');error.setAttribute('role','alert');body.append(error);const save=button('保存する',async()=>{error.textContent='';if(!title.value.trim()){error.textContent='タイトルを入力してください。';title.focus();return}if(!content.value.trim()){error.textContent='内容を入力してください。';content.focus();return}if((prompt.value.trim()||explanation.value.trim())&&!answer.value.trim()){error.textContent='自由想起の答えを入力してください。';answer.focus();return}if(url.value.trim()&&!safeUrl(url.value.trim())){error.textContent='URLは http または https で入力してください。';url.focus();return}if(cp.value.trim()&&options.some(o=>!o.value.trim())){error.textContent='3択の選択肢をすべて入力してください。';return}const qs=[];if(prompt.value.trim()||answer.value.trim()||explanation.value.trim()||recall){qs.push({...(recall?.id?{id:recall.id}:{}),type:'recall',prompt:prompt.value.trim()||title.value.trim(),answer:answer.value.trim(),explanation:explanation.value.trim(),options:[],correctIndex:null})}if(cp.value.trim())qs.push({...(choice?.id?{id:choice.id}:{}),type:'choice',prompt:cp.value.trim(),answer:options[Number(correct.value)].value.trim(),explanation:ce.value.trim(),options:options.map(x=>x.value.trim()),correctIndex:Number(correct.value)});const data={title:title.value.trim(),content:content.value.trim(),category:category.value.trim(),tags:tags.value.split(/[,、]/).map(s=>s.trim()).filter(Boolean),sourceUrl:url.value.trim(),notes:notes.value.trim(),understanding:Number(understanding.value)};if(item){qs.push(...quizzes.filter(q=>q!==recall&&q!==choice));data.expectedUpdatedAt=item.updatedAt}if(qs.length||item)data.quizzes=qs;save.disabled=true;cancel.disabled=true;try{await api(item?`/api/knowledge/${encodeURIComponent(item.id)}`:'/api/knowledge',{method:item?'PUT':'POST',body:data});if(initial.isActive&&(!initial.isActive()||!body.isConnected)){if(editorSession===sessionVersion&&authReady&&!dialog.open&&state.page===editorPage)go(editorPage);return}if(initial.onSaved){initial.onSaved();toast('保存しました')}else{dialog.close();toast('保存しました');go(state.page)}}catch(e){if(initial.isActive&&(!initial.isActive()||!body.isConnected))return;error.textContent=e.status===409?`${e.message} 入力内容を控えてから、閉じて最新の内容を開き直してください。`:e.message}finally{save.disabled=false;cancel.disabled=false}},'primary');const cancel=button(initial.onReturn?'保存せず候補へ戻る':'キャンセル',()=>initial.onReturn?initial.onReturn():dialog.close(),'danger');modal(item?'知識を編集':'知識を追加',body,[cancel,save]);setTimeout(()=>title.focus(),0)}
async function review(){const d=await api('/api/review/next');if(state.page!=='review')return;state.review=d.item;state.response='';state.forgotWithoutAnswer=false;state.selected=null;state.revealed=false;state.key=crypto.randomUUID();if(!d.item){$('#view').replaceChildren(empty('今の復習は完了','復習の時期になった知識がここに表示されます。',button('知識を見る',()=>go('knowledge'))));return}state.quiz=(d.item.quizzes||[]).find(q=>q.type==='recall')||(d.item.quizzes||[])[0];renderReview()}
function renderReview(){const v=$('#view');v.replaceChildren();const item=state.review;const quiz=state.quiz;if(!quiz){v.append(empty('問題がありません','知識を編集して復習用の質問を追加してください。',button('知識を編集',()=>editor(item))));return}const panel=el('div',null,'panel review-panel');add(panel,el('span',item.category||'復習','badge'),el('p',item.title,'muted'));const qs=item.quizzes||[];if(qs.length>1){const switcher=el('div',null,'row');for(const q of qs){const b=button(q.type==='recall'?'自由想起':'3択',()=>{state.quiz=q;state.response='';state.forgotWithoutAnswer=false;state.selected=null;state.revealed=false;renderReview()},q.id===quiz.id?'secondary':'danger');switcher.append(b)}panel.append(switcher)}panel.append(el('h2',quiz.prompt,'review-question'));let response;if(quiz.type==='choice'){for(let i=0;i<(quiz.options||[]).length;i++){const c=button(`${i+1}. ${quiz.options[i]}`,()=>{if(!state.revealed){state.selected=i;renderReview()}},'choice');c.classList.toggle('selected',state.selected===i);c.setAttribute('aria-pressed',String(state.selected===i));c.disabled=state.revealed;panel.append(c)}}else{const l=el('label','あなたの回答');l.htmlFor='review-response';panel.append(l);response=el('textarea');response.id='review-response';response.placeholder='思い出したことを入力';response.value=state.response||'';response.disabled=state.revealed;response.addEventListener('input',()=>{state.response=response.value;const reveal=panel.querySelector('[data-reveal]');if(reveal)reveal.disabled=!response.value.trim()});panel.append(response)}if(!state.revealed){const reveal=button('答えを確認する',()=>{state.revealed=true;renderReview()},'primary');reveal.dataset.reveal='true';if((quiz.type==='choice'&&state.selected==null)||(quiz.type!=='choice'&&!String(state.response||'').trim()))reveal.disabled=true;panel.append(reveal);if(quiz.type==='recall'){const cantRemember=button('思い出せない・答えを見る',()=>{state.revealed=true;state.forgotWithoutAnswer=true;renderReview()},'danger');panel.append(cantRemember)}}else{const ans=el('div',null,'answer');add(ans,el('strong',quiz.type==='choice'&&state.selected!==quiz.correctIndex?'もう一度確認しよう':'答え'),el('p',quiz.answer||quiz.options?.[quiz.correctIndex]||'答えが登録されていません'));if(quiz.explanation)ans.append(el('p',quiz.explanation));panel.append(ans);panel.append(el('p','どのくらい思い出せた？','muted'));const ratings=el('div',null,'rating');for(const [rating,label] of [['forgot','忘れた'],['unsure','あいまい'],['remembered','覚えていた']]){const b=button(label,async()=>{for(const child of ratings.children)child.disabled=true;try{const result=await api('/api/reviews',{method:'POST',body:{knowledgeId:item.id,quizId:quiz.id,rating,response:state.response||'',selectedIndex:quiz.type==='choice'?state.selected:null,idempotencyKey:state.key}});state.response='';toast('復習を記録しました');const done=el('div',null,'panel review-panel');add(done,el('h2','復習を記録しました'),el('p',`次の復習: ${dateText(result.schedule?.dueAt)}`,'muted'),el('p','この知識をどこで使えそう？ メモに書くと、次の行動につながります。','muted'),button('使い道をメモする',()=>editor(item)),button('次の復習へ →',()=>go('review'),'primary'));v.replaceChildren(done)}catch(e){fail(e);for(const child of ratings.children)child.disabled=child.dataset.blocked==='true'}},rating==='remembered'?'primary':'danger');if(rating==='remembered'&&quiz.type==='choice'&&state.selected!==quiz.correctIndex){b.disabled=true;b.dataset.blocked='true';b.title='不正解のため選べません'}ratings.append(b)}panel.append(ratings)}v.append(panel)}
async function analytics(){
  const d=await api('/api/dashboard');if(state.page!=='analytics')return;const v=$('#view');v.replaceChildren(el('p','学びの積み重ねを振り返ろう。','intro'));
  const cards=el('div',null,'cards');
  add(cards,card('復習した回数',d.reviewCount,'これまでの記録'),card('3択の正答率',percent(d.recentAccuracy),`直近30日・最大100件 / ${d.objectiveAnswers??0} 件`),card('自由想起の自己評価',percent(d.recallRememberedRate),'「覚えていた」の割合'),card('連続した学習日',d.streakDays,'東京時間'));
  const grid=el('div',null,'grid-two');
  const categories=el('div',null,'panel');add(categories,el('h3','カテゴリー別の知識'),el('p','カテゴリーごとの登録件数','muted'));
  if(!(d.categories||[]).length)categories.append(empty('まだデータがありません','知識を追加すると表示されます。'));
  else {const max=Math.max(...d.categories.map(c=>c.total),1);for(const c of d.categories){const row=el('div',null,'bar-row'),bar=el('progress');bar.max=max;bar.value=c.total;bar.setAttribute('aria-label',`${c.category||'未分類'} ${c.total}件`);add(row,el('span',c.category||'未分類'),bar,el('span',`${c.total}件`));categories.append(row)}}
  const progress=el('div',null,'panel');add(progress,el('h3','最近の復習'),el('p','日ごとの復習回数（東京時間）','muted'));
  if(!(d.recentDays||[]).length)progress.append(empty('まだ記録がありません','復習すると記録が表示されます。'));
  else for(const day of d.recentDays){const row=el('div',null,'bar-row'),bar=el('progress');const max=Math.max(...d.recentDays.map(x=>x.reviews),1);bar.max=max;bar.value=day.reviews;bar.setAttribute('aria-label',`${day.date} ${day.reviews}回`);add(row,el('span',day.date),bar,el('span',`${day.reviews}回`));progress.append(row)}
  const accuracy=el('div',null,'panel');add(accuracy,el('h3','カテゴリー別 3択正答率'),el('p','3択の回答が3件以上のカテゴリーを表示。自由想起の自己評価は含みません。','muted'));
  const measured=(d.categories||[]).filter(c=>c.totalAnswers>=3&&c.accuracy!=null).sort((a,b)=>a.accuracy-b.accuracy);
  if(!measured.length)accuracy.append(empty('まだ測定できません','3択の回答が3件以上になると表示されます。'));
  else for(const c of measured){const row=el('div',null,'bar-row'),bar=el('progress');bar.max=1;bar.value=c.accuracy;bar.setAttribute('aria-label',`${c.category} 正答率 ${percent(c.accuracy)}`);add(row,el('span',c.category),bar,el('span',`${percent(c.accuracy)} / ${c.totalAnswers}件`));accuracy.append(row)}
  const weak=el('div',null,'panel');add(weak,el('h3','復習のヒント'),el('p','3択の回答が3件以上あるカテゴリーを正答率の低い順に表示します。','muted'));
  if(!measured.length)weak.append(el('p','まだ十分な3択の回答がありません。','muted'));
  else for(const c of measured.slice(0,3))weak.append(el('p',`${c.category}: ${percent(c.accuracy)}（${c.totalAnswers}件）`));
  add(grid,categories,progress,accuracy,weak);add(v,cards,grid);
}
function setTheme(value){if(value==='system'){delete document.body.dataset.theme;localStorage.removeItem('hiro-theme')}else{document.body.dataset.theme=value;localStorage.setItem('hiro-theme',value)}}
function settings(){const body=el('div');if(authMode==='firebase')add(body,el('h3','アカウント'),button('ログアウト',()=>$('#logout-button').click(),'danger'));const l=el('label','表示テーマ');l.htmlFor='theme';body.append(l);const theme=select('表示テーマ',[['system','システムに合わせる'],['light','ライト'],['dark','ダーク']],localStorage.getItem('hiro-theme')||'system');theme.id='theme';theme.addEventListener('change',()=>setTheme(theme.value));body.append(theme);add(body,el('h3','データの持ち出し'),el('p','バックアップ JSON は復元に使えます。CSV は表計算ソフトで確認できます。','muted'));const exports=el('div',null,'row');for(const [name,path] of [['JSON を出力','/api/backup'],['CSV を出力','/api/export.csv']])exports.append(button(name,async()=>{try{const version=sessionVersion;const r=await authorizedFetch(path);if(!r.ok){const d=await r.json();throw new Error(d.error||'出力できませんでした')}const blob=await r.blob();if(version!==sessionVersion)throw new Error('ログイン状態が変わりました。');const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name.startsWith('JSON')?'hiro-knowledge-backup.json':'hiro-knowledge.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('ファイルを出力しました')}catch(e){fail(e)}}));body.append(exports);add(body,el('h3','JSON から復元'),el('p','先にファイルを検証し、件数と競合を確認します。既存データは一括削除しません。','muted'));const label=el('label','バックアップファイル');label.htmlFor='backup-file';body.append(label);const file=el('input');file.id='backup-file';file.type='file';file.accept='.json,application/json';body.append(file);const preview=el('div');preview.setAttribute('aria-live','polite');body.append(preview);const validate=button('ファイルを検証',async()=>{preview.replaceChildren();if(!file.files[0]){preview.append(el('p','ファイルを選択してください。','error'));return}try{const data=JSON.parse(await file.files[0].text());const result=await api('/api/backup/validate',{method:'POST',body:data});preview.append(el('h3','検証結果'));const counts=el('ul');for(const [key,val] of Object.entries(result.counts||{}))counts.append(el('li',`${key}: ${typeof val==='object'?JSON.stringify(val):val}`));preview.append(counts);const conflicts=result.conflicts||[];preview.append(el('p',`競合: ${Array.isArray(conflicts)?conflicts.length:JSON.stringify(conflicts)}`));if(Array.isArray(conflicts)&&conflicts.length){const ul=el('ul');for(const c of conflicts)ul.append(el('li',typeof c==='string'?c:JSON.stringify(c)));preview.append(ul)}else{const importBtn=button('この内容を復元する',async()=>{importBtn.disabled=true;try{const r=await api('/api/backup/import',{method:'POST',body:data});preview.append(el('p',`復元しました。追加: ${typeof r.imported==='object'?JSON.stringify(r.imported):r.imported}、スキップ: ${typeof r.skipped==='object'?JSON.stringify(r.skipped):r.skipped}`));toast('復元しました')}catch(e){preview.append(el('p',e.message,'error'));importBtn.disabled=false}},'primary');preview.append(importBtn)}}catch(e){preview.append(el('p',e instanceof SyntaxError?'JSON ファイルを読み取れません。':e.message,'error'))}},'danger');body.append(validate);modal('設定',body,[button('閉じる',()=>dialog.close(),'danger')])}
function openSharedDraft(){
  const params=new URLSearchParams(location.search);
  if(params.has('url')||params.has('title')||params.has('summary')){
    const incoming=params.get('url')||'';
    editor(null,{url:safeUrl(incoming),title:params.get('title')||'',summary:params.get('summary')||''});
    history.replaceState(null,'',location.pathname);
  }
}
function enterApp(){
  authReady=true;document.body.classList.remove('auth-locked');
  $('#logout-button').hidden=authMode!=='firebase';
  $('#storage-label').textContent=authMode==='local'?'● ローカル保存':'● 保護されたクラウド';
  go('home');openSharedDraft();
}
async function bootstrapAuth(){
  document.body.classList.add('auth-locked');$('#view').replaceChildren(el('p','ログイン状態を確認中…','muted'));
  try{
    const response=await fetch('/api/auth/config',{cache:'no-store'});
    if(!response.ok)throw new Error('認証設定を確認できません。管理者が設定を確認してください。');
    const config=await response.json();authMode=config.mode;
    if(authMode==='local'||authMode==='access'){enterApp();return;}
    if(authMode!=='firebase'||!config.firebase?.apiKey||!config.firebase?.authDomain||!config.firebase?.projectId||!config.firebase?.appId)throw new Error('Google ログインの設定が不足しています。');
    authClient=await import('/auth-client.js');
    await authClient.initializeAuth(config.firebase,user=>{
      if(user && typeof user.uid==='string' && user.uid){
        if(currentUid!==user.uid){authReady=false;resetSession();currentUid=user.uid;}
        if(!authReady)enterApp();
      } else {currentUid=null;showLogin();}
    });
  }catch(e){
    authReady=false;resetSession();document.body.classList.add('auth-locked');
    $('#page-title').textContent='ログイン';
    $('#view').replaceChildren(empty('ログインを準備できません',e.message,button('もう一度試す',bootstrapAuth)));
  }
}
document.querySelectorAll('.settings-open').forEach(b=>b.addEventListener('click',settings));
$('#add-button').addEventListener('click',()=>editor());
$('#logout-button').addEventListener('click',async()=>{authReady=false;resetSession();document.body.classList.add('auth-locked');$('#page-title').textContent='ログアウト';$('#view').replaceChildren(el('p','ログアウト中…','muted'));try{await authClient.signOut();showLogin('ログアウトしました。')}catch(e){showLogin('ログアウトできませんでした。もう一度試してください。',true)}});
setTheme(localStorage.getItem('hiro-theme')||'system');bootstrapAuth();
