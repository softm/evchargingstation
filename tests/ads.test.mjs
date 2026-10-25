import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdManager,normalizeAdConfig,validAdUnit,ADFIT_SCRIPT} from '../public/js/ads.js';
import {mountListAds,listAdPositions} from '../public/js/ad-list.js';
import {mountBottomAd,BOTTOM_STORAGE_KEY,bottomExpanded} from '../public/js/ad-bottom.js';
import {mountWelcome,WELCOME_STORAGE_KEY} from '../public/js/ad-welcome.js';
import {buildAdConfig} from '../scripts/ad-config.mjs';
import {adFixture} from './ad-fixture.mjs';
// Fixture-only IDs are confined to the fake DOM. They are never public configuration.
const ids=['DAN-TestOnly12345678','DAN-TestOnly23456789','DAN-TestOnly34567890','DAN-TestOnly45678901','DAN-TestOnly56789012'];
const config=()=>({enabled:true,mode:'adfit',units:Object.fromEntries(['list1','list2','list3','bottomDesktop','bottomMobile'].map((name,i)=>[name,{unit:ids[i],width:name==='bottomDesktop'?728:320,height:name==='bottomDesktop'?90:100}]))});
const manager=(f,options={})=>createAdManager({config:config(),win:f.win,doc:f.doc,...options});
const banner=(f,m,name='list1')=>m.slot({host:f.host,name,unit:m.config.units[name],root:f.root});
const render=(list,count,shown=count)=>list.render({shown:Array.from({length:shown},(_,i)=>({id:String(i+1)})),total:count,card:s=>`<article class="station-card" data-station-id="${s.id}"></article>`,empty:'empty',more:shown<count?'more':''});

test('empty/disabled/demo/non-production settings and preview never request the SDK',()=>{
 for(const options of [{config:{}},{config:{...config(),enabled:false}},{demo:true},{location:{origin:'http://localhost',pathname:'/'}},{preview:true},{config:{...config(),mode:'off'}}]){
  const f=adFixture(),m=manager(f,options),s=banner(f,m);s.update({eligible:true});f.visibleAll();
  assert.equal(f.networkScripts().length,0);assert.equal(m.requestCount,0);
  if(m.preview)assert.match(f.host.querySelector('.adfit-creative').textContent,/실제 광고가 아닙니다/);else assert.equal(f.host.hidden,true);
 }
 assert.equal(validAdUnit('DAN-abc" onload="bad'),false);
});

test('visible placements request once, use the issued size and unique official NO-AD callbacks',()=>{
 const f=adFixture(),m=manager(f),list=mountListAds({root:f.root,manager:m,doc:f.doc});render(list,60);
 assert.equal(f.networkScripts().length,0);f.visibleAll();assert.equal(f.networkScripts().length,3);
 const ins=f.created.filter(n=>n.tag==='ins');assert.equal(new Set(ins.map(n=>n.attrs['data-ad-onfail'])).size,3);
 assert.equal(ins[0].attrs['data-ad-width'],'320');assert.equal(ins[0].attrs['data-ad-height'],'100');
 assert.ok(f.networkScripts().every(s=>s.src===ADFIT_SCRIPT&&s.async));
 const hosts=[...list.hosts],iframe=new f.Node('iframe');hosts[0].querySelector('.adfit-creative').append(iframe);f.mutations[0].fn();
 for(const count of [60,20,3,6,60])render(list,count);f.visibleAll();
 assert.equal(f.networkScripts().length,3);assert.equal(list.hosts[0],hosts[0]);assert.equal(iframe.parentNode,hosts[0].querySelector('.adfit-creative'));
});

test('0/3/6/20/60 results and show-more keep station IDs/order separate from 6/18/30 advertisement positions',()=>{
 const f=adFixture(),m=manager(f,{preview:true}),list=mountListAds({root:f.root,manager:m,doc:f.doc});
 for(const [count,expected]of [[0,0],[3,0],[6,0],[20,2],[60,3]]){
  render(list,count);assert.equal(list.hosts.filter(h=>!h.hidden).length,expected);
  const ids=f.root.children.flatMap(n=>[...n.innerHTML.matchAll(/data-station-id="(.*?)"/g)].map(m=>m[1]));
  assert.deepEqual(ids,Array.from({length:count},(_,i)=>String(i+1)));
 }
 render(list,60,12);assert.equal(list.hosts.filter(h=>!h.hidden).length,1);
 render(list,60,24);assert.equal(list.hosts.filter(h=>!h.hidden).length,2);
 assert.deepEqual(list.hosts.map(h=>h.dataset.afterStation),['6','18','30']);
 assert.deepEqual(listAdPositions(normalizeAdConfig({placements:{listInline:{positions:[30,6,6,18,1],maxSlots:2}}})),[6,18]);
});

test('hidden/background/undersized/out-of-view placements wait; visibility return is bounded to one request',()=>{
 const f=adFixture(),m=manager(f),s=banner(f,m);s.update({eligible:true});f.doc.hidden=true;f.visibleAll();assert.equal(m.requestCount,0);
 f.doc.hidden=false;f.host.width=300;f.visibleAll();assert.equal(m.requestCount,0);
 f.host.width=1000;f.host.height=0;f.visibleAll();assert.equal(m.requestCount,0);
 f.host.height=180;f.host.top=1000;f.visibleAll();assert.equal(m.requestCount,0);
 f.host.top=100;m.setBlocked(true);f.visibleAll();assert.equal(m.requestCount,0);
 m.setBlocked(false);f.doc.emit('visibilitychange');f.visibleAll();assert.equal(m.requestCount,1);
 for(let i=0;i<10;i++)s.update({eligible:true});f.visibleAll();assert.equal(m.requestCount,1);
});

test('NO-AD, blocked SDK and timeouts release space independently, ignore wrong callbacks and never retry',()=>{
 for(const reason of ['no-ad','script-error','load-timeout','response-timeout']){
  const f=adFixture(),m=manager(f),s=banner(f,m);s.update({eligible:true});f.visibleAll();
  const ins=f.created.find(n=>n.tag==='ins'),script=f.networkScripts()[0];
  f.win[ins.attrs['data-ad-onfail']]({});assert.equal(s.state,'loading');
  if(reason==='no-ad')f.win[ins.attrs['data-ad-onfail']](ins);
  else if(reason==='script-error')script.onerror();
  else {if(reason==='response-timeout')script.onload();f.fireTimers();}
  assert.equal(s.state,reason==='no-ad'?'no-ad':'error');assert.equal(f.host.hidden,true);
  for(let i=0;i<5;i++)s.update({eligible:true});f.visibleAll();assert.equal(m.requestCount,1);
 }
});

test('rendered iframe cancels the watchdog without asserting a paid impression; separate NO-AD leaves other units intact',()=>{
 const f=adFixture(),m=manager(f),list=mountListAds({root:f.root,manager:m,doc:f.doc});render(list,60);f.visibleAll();
 const [a,b]=f.created.filter(n=>n.tag==='ins');list.hosts[0].querySelector('.adfit-creative').append(new f.Node('iframe'));f.mutations[0].fn();
 assert.equal(list.hosts[0].dataset.adState,'loaded');f.win[b.attrs['data-ad-onfail']](b);
 assert.equal(list.hosts[1].dataset.adState,'no-ad');assert.equal(list.hosts[0].hidden,false);assert.equal(a.removed,undefined);
});

test('bottom opens and requests once on first load, session choice persists, reading/detail collapse is temporary and does not re-request',()=>{
 const f=adFixture(),m=manager(f),bottom=mountBottomAd({host:f.bottom,manager:m,win:f.win,doc:f.doc});
 assert.equal(f.panel.hidden,false);f.visibleAll();assert.equal(m.requestCount,1);assert.equal(f.storage.has(BOTTOM_STORAGE_KEY),false);
 bottom.setReading(true);assert.equal(f.panel.hidden,true);assert.equal(f.storage.has(BOTTOM_STORAGE_KEY),false);
 bottom.setContext({isList:false,detailOpen:false});assert.equal(f.panel.hidden,false);f.visibleAll();assert.equal(m.requestCount,1);
 bottom.setExpanded(false);bottom.setExpanded(true);f.visibleAll();assert.equal(m.requestCount,1);
 f.resize(390);assert.equal(f.bottom.hidden,true);assert.equal(m.requestCount,1,'resize cannot request another real unit');
 f.resize(1000);assert.equal(f.bottom.hidden,false);assert.equal(m.requestCount,1);
 const next=adFixture({width:390,storage:f.storage}),nextManager=manager(next),nextBottom=mountBottomAd({host:next.bottom,manager:nextManager,win:next.win,doc:next.doc});
 assert.equal(next.panel.hidden,false);nextBottom.setContext({isList:true,detailOpen:true});assert.equal(next.bottom.hidden,true);assert.equal(next.doc.body.style.getPropertyValue('--ev-ad-space'),'0px');
 nextBottom.setContext({isList:true,detailOpen:false});assert.equal(next.bottom.hidden,false);
});

test('bottom NO-AD returns all reserved space and a hidden mobile detail cannot request an ad',()=>{
 const f=adFixture({width:390}),m=manager(f),bottom=mountBottomAd({host:f.bottom,manager:m,win:f.win,doc:f.doc});
 bottom.setContext({isList:true,detailOpen:true});bottom.setExpanded(true);f.visibleAll();assert.equal(m.requestCount,0);
 bottom.setContext({isList:true,detailOpen:false});f.visibleAll();assert.equal(m.requestCount,1);
 const ins=f.created.find(n=>n.tag==='ins');f.win[ins.attrs['data-ad-onfail']](ins);
 assert.equal(f.bottom.hidden,true);assert.equal(f.doc.body.style.getPropertyValue('--ev-ad-space'),'0px');
 bottom.sync();assert.equal(f.bottom.hidden,true);
});

test('a page makes at most four distinct requests, and duplicate units are rejected',()=>{
 const f=adFixture(),m=manager(f),list=mountListAds({root:f.root,manager:m,doc:f.doc});render(list,60);f.visibleAll();
 const bottom=mountBottomAd({host:f.bottom,manager:m,win:f.win,doc:f.doc});bottom.setExpanded(true);f.visibleAll();assert.equal(m.requestCount,4);
 const extra=new f.Node();extra.innerHTML='<div class="adfit-creative"></div>';
 m.slot({host:extra,name:'list1',unit:{unit:ids[4],width:320,height:100}}).update({eligible:true});f.visibleAll();assert.equal(m.requestCount,4);assert.equal(extra.hidden,true);
});

test('preview remains network-free across desktop/mobile resizing and storage failures do not break controls',()=>{
 const f=adFixture(),m=manager(f,{preview:true});f.win.sessionStorage.getItem=()=>{throw Error('blocked');};f.win.sessionStorage.setItem=()=>{throw Error('blocked');};
 const bottom=mountBottomAd({host:f.bottom,manager:m,win:f.win,doc:f.doc});assert.equal(f.panel.hidden,false);
 f.resize(390);bottom.setExpanded(true);assert.equal(f.panel.style.getPropertyValue('--ad-width'),'320px');
 assert.equal(f.networkScripts().length,0);assert.equal(f.bottom.hidden,false);
 assert.equal(bottomExpanded({stored:null,mobile:true,config:m.config.placements.bottomAnchor}),true);
});

test('welcome UI is optional/session-scoped, closes immediately, restores focus and never calls AdFit even with approval flags',()=>{
 const f=adFixture(),m=manager(f,{config:{...config(),placements:{welcome:{enabled:true,adfitApproved:true}}}}),focused=new f.Node('button');f.doc.activeElement=focused;
 const welcome=mountWelcome({dialog:f.welcome,manager:m,win:f.win,doc:f.doc});welcome.start();assert.equal(f.welcome.open,true);assert.equal(f.storage.get(WELCOME_STORAGE_KEY),'true');
 f.welcome.querySelectorAll('[data-welcome-close]')[0].emit('click');assert.equal(f.welcome.open,false);assert.equal(f.doc.activeElement,focused);
 welcome.start();assert.equal(f.welcome.open,false);assert.equal(f.networkScripts().length,0);
 const off=adFixture(),offWelcome=mountWelcome({dialog:off.welcome,manager:manager(off),win:off.win,doc:off.doc});offWelcome.start();assert.equal(off.welcome.open,false);
});

test('build variables retain the legacy alias, enforce distinct issued units and exact sizes, and never enable welcome advertising',()=>{
 const legacy=buildAdConfig({}, {PUBLIC_ADFIT_BANNER_UNIT:ids[0]});assert.equal(legacy.units.list1.unit,ids[0]);assert.equal(legacy.enabled,true);
 const explicit=buildAdConfig({}, {PUBLIC_ADFIT_BANNER_UNIT:ids[0],PUBLIC_ADFIT_LIST_1_UNIT:ids[1],PUBLIC_ADFIT_ENABLED:'false'});assert.equal(explicit.units.list1.unit,ids[1]);assert.equal(explicit.enabled,false);
 assert.throws(()=>buildAdConfig({}, {PUBLIC_ADFIT_LIST_1_UNIT:'invalid'}));
 assert.throws(()=>buildAdConfig({}, {PUBLIC_ADFIT_LIST_1_UNIT:ids[0],PUBLIC_ADFIT_BOTTOM_MOBILE_UNIT:ids[0]}));
 assert.throws(()=>buildAdConfig({units:{list1:{unit:ids[0],width:400,height:100}}},{}));
 assert.throws(()=>buildAdConfig({}, {PUBLIC_ADFIT_ENABLED:'yes'}));
 const approved=buildAdConfig({placements:{welcome:{adfitApproved:true}}},{PUBLIC_ADFIT_WELCOME_UNIT:ids[0]});assert.equal(approved.enabled,false);
});

test('teardown cancels pending work, removes callback ownership and cannot re-request from stale observers',()=>{
 const f=adFixture(),m=manager(f),s=banner(f,m);s.update({eligible:true});f.visibleAll();
 const callback=f.created.find(n=>n.tag==='ins').attrs['data-ad-onfail'];assert.equal(typeof f.win[callback],'function');
 m.destroy();assert.equal(f.win[callback],undefined);assert.equal(f.timers.size,0);assert.equal(f.host.hidden,true);
 s.update({eligible:true});f.visibleAll();assert.equal(f.networkScripts().length,1);
});
