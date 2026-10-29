import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const css=await readFile(new URL('../public/style.css',import.meta.url),'utf8');
const sdk=`let callback;let user={uid:'owner'};export async function initializeAuth(config,cb){callback=cb;window.changeIdentity=(uid)=>{user=uid?{uid}:null;callback(user)};cb(user);return user}export async function getAuthToken(){return user.uid}export async function signOut(){window.changeIdentity(null)}export async function signIn(){if(window.loginError)throw window.loginError;window.changeIdentity('owner')}`;
const item={id:'secret-id',title:'PRIVATE_TITLE',content:'PRIVATE_CONTENT',notes:'PRIVATE_NOTES',tags:[],category:'',understanding:0,quizzes:[],schedule:{status:'new'}};
const dashboard={dueCount:1,learnedToday:0,addedToday:1,totalKnowledge:1,reviewsToday:0,reviewCount:0,recentAccuracy:null,objectiveAnswers:0,recallRememberedRate:null,streakDays:0,categories:[],recentDays:[],learnedTodayItems:[]};
const browser=await chromium.launch({headless:true});
async function setup(){
 const page=await browser.newPage();let hold=false,release,arrived;
 const waiting=new Promise(r=>arrived=r);const gate=new Promise(r=>release=r);
 await page.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());let body,type='application/json',status=200;
 if(u.pathname==='/') {body=html;type='text/html'}
 else if(u.pathname==='/app.js'){body=app;type='text/javascript'}
 else if(u.pathname==='/style.css'){body=css;type='text/css'}
 else if(u.pathname==='/auth-client.js'){body=sdk;type='text/javascript'}
 else if(u.pathname==='/api/auth/config')body=JSON.stringify({mode:'firebase',firebase:{apiKey:'test',authDomain:'test.firebaseapp.com',projectId:'test',appId:'test'}});
 else if(req.headers().authorization==='Bearer other'){status=403;body=JSON.stringify({error:'forbidden'})}
 else if(u.pathname==='/api/dashboard')body=JSON.stringify(dashboard);
 else if(u.pathname==='/api/knowledge/secret-id'){if(hold){arrived();await gate}body=JSON.stringify({item,history:[]})}
 else if(u.pathname==='/api/knowledge')body=JSON.stringify({items:[item],total:1});
 else {status=404;body='{}'}
 try{await route.fulfill({status,contentType:type,body})}catch{}
 });
 await page.goto('http://localhost/');await page.getByText('PRIVATE_TITLE').first().waitFor();
 return {page,hold:()=>hold=true,waiting,release};
}
try {
 {const {page}=await setup();await page.getByText('PRIVATE_TITLE').first().click();await page.getByRole('button',{name:'編集',exact:true}).click();assert.equal(await page.getByLabel('自分のメモ・使い道').inputValue(),'PRIVATE_NOTES');await page.evaluate(()=>window.changeIdentity(null));await page.getByRole('button',{name:'Googleでログイン'}).waitFor();assert.equal(await page.locator('#modal-content').textContent(),'');assert.equal(await page.locator('body').evaluate(e=>e.outerHTML.includes('PRIVATE_NOTES')),false);await page.close();console.log('PASS logout clears editor DOM');}
 {const {page}=await setup();await page.getByText('PRIVATE_TITLE').first().click();await page.evaluate(()=>window.changeIdentity('other'));await page.getByText('このアカウントでは利用できません。',{exact:false}).waitFor();assert.equal(await page.locator('#modal-content').textContent(),'');assert.equal(await page.locator('body').evaluate(e=>e.outerHTML.includes('PRIVATE_TITLE')),false);await page.close();console.log('PASS account switch clears owner DOM');}
 {const {page,hold,waiting,release}=await setup();hold();await page.getByText('PRIVATE_TITLE').first().click();await waiting;await page.evaluate(()=>window.changeIdentity(null));release();await page.waitForTimeout(400);assert.equal(await page.locator('#modal-content').textContent(),'');assert.equal(await page.locator('body').evaluate(e=>e.outerHTML.includes('PRIVATE_CONTENT')),false);await page.close();console.log('PASS pending private response discarded');}
 {const {page}=await setup();await page.evaluate(()=>{const original=Response.prototype.json;window.bodyReady=new Promise(resolve=>window.signalBodyReady=resolve);window.bodyGate=new Promise(resolve=>window.releaseBody=resolve);Response.prototype.json=async function(){const data=await original.call(this);if(data?.item?.id==='secret-id'){window.signalBodyReady();await window.bodyGate}return data}});await page.getByText('PRIVATE_TITLE').first().click();await page.evaluate(()=>window.bodyReady);await page.evaluate(()=>window.changeIdentity(null));await page.evaluate(()=>window.releaseBody());await page.waitForTimeout(300);assert.equal(await page.locator('#modal-content').textContent(),'');assert.equal(await page.locator('body').evaluate(e=>e.outerHTML.includes('PRIVATE_CONTENT')),false);await page.close();console.log('PASS delayed parsed JSON discarded');}
 {const {page}=await setup();await page.evaluate(()=>window.changeIdentity(null));for(const code of ['auth/popup-blocked','auth/popup-closed-by-user','auth/network-request-failed','auth/unauthorized-domain','auth/web-storage-unsupported','auth/operation-not-supported-in-this-environment']){await page.evaluate(code=>window.loginError={code,message:'SECRET_MESSAGE',customData:{email:'secret@example.com'}},code);await page.getByRole('button',{name:'Googleでログイン'}).click();assert.ok((await page.locator('[role=alert]').textContent()).includes(code),code)}await page.evaluate(()=>window.loginError={code:'auth/secret-token',message:'SECRET_MESSAGE',customData:{email:'secret@example.com'}});await page.getByRole('button',{name:'Googleでログイン'}).click();const error=await page.locator('[role=alert]').textContent();assert.ok(error.includes('auth/unknown'));assert.equal(error.includes('secret'),false);assert.equal(error.includes('SECRET_MESSAGE'),false);await page.evaluate(()=>window.loginError=new Error('SECRET_MESSAGE'));await page.getByRole('button',{name:'Googleでログイン'}).click();const noCode=await page.locator('[role=alert]').textContent();assert.ok(noCode.includes('auth/unknown'));assert.equal(noCode.includes('SECRET_MESSAGE'),false);await page.close();console.log('PASS login errors expose only allowlisted codes');}
}finally{await browser.close()}
