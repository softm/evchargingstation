// CI integration checks against the published, public app. No account or secret is used.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(resolve('.cache/ad-browser/node_modules/playwright/index.mjs')));
const base=process.env.DEPLOYMENT_URL||'https://softm.github.io/evchargingstation/';
const out=resolve('verification/ads');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});const results=[];
const isAdRequest=url=>/^https:\/\/(?:[^/]*adfit\.|[^/]*kas\.kakao|t1\.(?:kakaocdn|daumcdn)\.net\/kas\/)/i.test(url);
try {
 for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:844}]){
  const context=await browser.newContext({viewport});const page=await context.newPage();
  const adRequests=[],errors=[];page.on('request',r=>{if(isAdRequest(r.url()))adRequests.push(r.url());});
  page.on('pageerror',e=>{if(e.stack?.includes('/evchargingstation/js/'))errors.push(e.message);});
  const name=`${viewport.width}x${viewport.height}`;
  try {
   await page.goto(`${base}?region=11&sort=name&ad-preview=1`,{waitUntil:'domcontentloaded'});
   await page.locator('.station-card').first().waitFor({state:'attached',timeout:90000});
   await page.locator('#welcomeAdDialog[open]').waitFor();
   await page.screenshot({path:resolve(out,`welcome-${name}.png`)});
   await page.keyboard.press('Escape');await page.locator('#welcomeAdDialog').waitFor({state:'hidden'});
   if(viewport.width<761){
    await page.locator('[data-focus-action="list"]').click();
    await page.waitForFunction(()=>document.querySelector('#appLayout')?.dataset.mapFocusState==='list-sheet');
   }
   assert.equal(await page.locator('.station-card').count(),60);
   assert.equal(await page.locator('.adfit-banner[data-after-station]').count(),1);
   const placement=await page.locator('.adfit-banner[data-after-station]').evaluateAll(slots=>slots.map(s=>({position:Number(s.dataset.afterStation),width:s.getBoundingClientRect().width,hidden:s.hidden})));
   assert.deepEqual(placement.map(s=>s.position),[6]);
   if(viewport.width>320)assert.equal(placement.filter(s=>!s.hidden).length,1);
   assert.ok(placement.every(s=>s.hidden||s.width>=320),'never crop a creative on narrow screens');
   assert.equal(await page.locator('#bottomAdPanel').isVisible(),true);
   const geometry=await page.evaluate(mobile=>{
    const ad=document.querySelector('#bottomAd').getBoundingClientRect();
    const content=(mobile?document.querySelector('#results'):document.querySelector('#appLayout')).getBoundingClientRect();
    return {overflow:document.documentElement.scrollWidth>innerWidth,contentBottom:content.bottom,adTop:ad.top};
   },viewport.width<761);
   assert.equal(geometry.overflow,false);assert.ok(geometry.contentBottom<=geometry.adTop+1,'reserved ad space prevents overlap');
   await page.screenshot({path:resolve(out,`ads-${name}.png`)});
   const list=page.locator('#listContent'),rect=await list.boundingBox();
   await page.mouse.move(rect.x+rect.width/2,rect.y+Math.min(120,rect.height/2));await page.mouse.wheel(0,650);
   await page.waitForFunction(()=>{const id=document.querySelector('.station-card.selected')?.dataset.stationId;return id&&id===document.querySelector('.ev-map-pin.is-selected')?.dataset.stationId;},null,{timeout:15000});
   assert.equal(await page.locator('#bottomAdPanel').isVisible(),false,'reading temporarily collapses bottom');
   await page.screenshot({path:resolve(out,`ads-inline-${name}.png`)});
   const selected=await page.locator('.station-card.selected').getAttribute('data-station-id');
   if(viewport.width<761){
    await page.locator('.list-sheet-close').click();
    await page.waitForFunction(()=>document.querySelector('#appLayout')?.dataset.mapFocusState==='map-browse');
   }
   await page.locator('.ev-map-pin.is-selected').click();
   await page.locator('#stationDialog[open]').waitFor();
   assert.equal(await page.locator('.station-card.selected').getAttribute('data-station-id'),selected);
   assert.equal(await page.locator('.ev-map-pin.is-selected').getAttribute('data-station-id'),selected);
   if(viewport.width<761)assert.equal(await page.locator('#bottomAd').isVisible(),false,'mobile detail owns its space');
   await page.getByRole('button',{name:'충전소 상세 닫기',exact:true}).click();
   if(viewport.width<761)await page.waitForFunction(()=>document.querySelector('#appLayout')?.dataset.mapFocusState==='map-browse');
   // Mobile detail close returns to map-browse and restores the explicit ad choice.
   // Desktop remains in its reading context and stays collapsed.
   assert.equal(await page.locator('#bottomAdPanel').isVisible(),viewport.width<761,'navigation preserves the explicit bottom-ad choice');
   if(viewport.width>=761)await page.getByRole('button',{name:'광고 펼치기',exact:true}).click();
   await page.getByRole('button',{name:'광고 접기',exact:true}).click();
   await page.reload({waitUntil:'domcontentloaded'});await page.locator('.station-card').first().waitFor({state:'attached',timeout:90000});
   assert.equal(await page.locator('#welcomeAdDialog').isVisible(),false,'welcome is once per preview session');
   assert.equal(await page.locator('#bottomAdPanel').isVisible(),false,'explicit collapse survives reload');
   const search=page.getByRole('searchbox');await search.fill('__no_matching_charging_station__');
   await page.waitForFunction(()=>document.querySelector('#resultCount')?.textContent==='0');
   assert.equal(await page.locator('.adfit-banner[data-after-station]:visible').count(),0);
   // Continue in preview so deployment verification never creates real impressions.
   await search.fill('');await page.waitForFunction(()=>Number(document.querySelector('#resultCount')?.textContent)>0);
   if(viewport.width<761){
    await page.locator('[data-focus-action="list"]').click();
    await page.waitForFunction(()=>document.querySelector('#appLayout')?.dataset.mapFocusState==='list-sheet');
   }
   await page.getByRole('button',{name:/충전소 더 보기/}).click();
   await page.waitForFunction(()=>document.querySelectorAll('.station-card').length===120);
   assert.equal(await page.locator('.adfit-banner[data-after-station]').count(),1,'more results keep the same issued placement');
   if(viewport.width<761){
    await page.locator('.list-sheet-close').click();
    await page.waitForFunction(()=>document.querySelector('#appLayout')?.dataset.mapFocusState==='map-browse');
   }
   await page.getByRole('button',{name:'지도 확대',exact:true}).click();
   await page.getByRole('button',{name:'지도 축소',exact:true}).click();
   const mapBox=await page.locator('#map').boundingBox();
   await page.mouse.move(mapBox.x+mapBox.width*0.6,mapBox.y+mapBox.height*0.6);await page.mouse.down();
   await page.mouse.move(mapBox.x+mapBox.width*0.6+40,mapBox.y+mapBox.height*0.6+25,{steps:8});await page.mouse.up();
   await page.waitForFunction(()=>document.querySelector('#regionSelect').value==='auto');
   assert.equal(adRequests.length,0);assert.deepEqual(errors,[]);
   results.push({viewport,pass:true,adRequests:0,checks:['6th-card slot','bottom default-open/reserve/collapse/session','welcome Escape/session','scroll selection and marker','marker click and detail','mobile map/list','empty results','more results','map zoom and drag','preview zero SDK']});
  } catch(error){await page.screenshot({path:resolve(out,`failure-${name}.png`)}).catch(()=>{});throw error;}
  finally{await context.close();}
 }
 await writeFile(resolve(out,'result.json'),JSON.stringify({pass:true,results},null,2));console.log(JSON.stringify({pass:true,results}));
} finally {await browser.close();}
