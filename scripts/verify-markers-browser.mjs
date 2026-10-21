// Published real-data UI checks. Uses the same CI-only browser as the ad checks.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(resolve('.cache/ad-browser/node_modules/playwright/index.mjs')));
const base=process.env.DEPLOYMENT_URL||'https://softm.github.io/evchargingstation/';
const out=resolve('verification/markers');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true}),results=[];
try {
 for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:844}]){
  const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>{if(e.stack?.includes('/evchargingstation/js/'))errors.push(e.message);});
  const name=`${viewport.width}x${viewport.height}`;
  try {
   await page.goto(`${base}?region=11&sort=name&lat=37.5665&lng=126.978&z=13`,{waitUntil:'domcontentloaded'});
   await page.locator('.ev-map-pin').first().waitFor({state:'attached',timeout:90000});
   const stages=[];
   for(let zoom=13;zoom<=18;zoom++){
    if(zoom>13)await page.getByRole('button',{name:'지도 확대',exact:true}).click();
    const scale=zoom<14?'dot':zoom<16?'pin':zoom<18?'name':'detail';
    await page.waitForFunction(s=>document.querySelector('#map')?.dataset.markerScale===s,scale);
    await page.waitForFunction(()=>[...document.querySelectorAll('.ev-map-pin')].some(p=>{const b=p.getBoundingClientRect(),m=document.querySelector('#map').getBoundingClientRect();return b.left>m.left+30&&b.right<m.right-30&&b.top>m.top+30&&b.bottom<m.bottom-30;}));
    const state=await page.evaluate(()=>{
     const bounds=document.querySelector('#map').getBoundingClientRect();
     const pins=[...document.querySelectorAll('.ev-map-pin')];
     const pin=pins.find(p=>{const b=p.getBoundingClientRect();return b.left>bounds.left+30&&b.right<bounds.right-30&&b.top>bounds.top+30&&b.bottom<bounds.bottom-30;});
     const box=pin.getBoundingClientRect(),anchor=pin.closest('.ev-map-marker').getBoundingClientRect();
     return {count:pins.length,width:box.width,height:box.height,anchorX:Math.abs((box.left+box.width/2)-(anchor.left+anchor.width/2)),anchorY:Math.abs((document.querySelector('#map').dataset.markerScale==='dot'?box.top+box.height/2:box.bottom+6)-anchor.bottom),countVisible:getComputedStyle(pin.querySelector('.ev-map-pin-count')).display!=='none',symbolVisible:getComputedStyle(pin.querySelector('.ev-map-pin-symbol')).display!=='none',overflow:document.documentElement.scrollWidth>innerWidth};
    });
    assert.ok(state.count<=800);assert.ok(state.anchorX<1&&state.anchorY<1,'scale preserves the geographic anchor');assert.equal(state.overflow,false);
    assert.equal(state.countVisible,zoom>=16);assert.equal(state.symbolVisible,zoom>=14&&zoom<16);
    if(zoom===13)assert.equal(state.width,12);
    if(zoom===14)assert.equal(state.width,26);
    if(zoom>=16){
     const level=zoom>=18?'2':'1';
     await page.waitForFunction(l=>[...document.querySelectorAll('.ev-map-pin-label')].some(n=>!n.hidden&&n.dataset.labelLevel===l),level);
    }
    stages.push({zoom,scale,...state});
    if([13,14,16,18].includes(zoom))await page.screenshot({path:resolve(out,`zoom-${zoom}-${name}.png`)});
   }
   // The ordinary marker button still selects the same station in map/list/detail.
   const target=await page.evaluate(()=>[...document.querySelectorAll('.ev-map-pin')].find(p=>{const b=p.getBoundingClientRect();return document.elementFromPoint(b.left+b.width/2,b.top+b.height/2)?.closest('.ev-map-pin')===p;})?.dataset.stationId);
   assert.ok(target);await page.locator(`.ev-map-pin[data-station-id=${JSON.stringify(target)}]`).click();
   await page.locator('#stationDialog[open]').waitFor();
   assert.equal(await page.locator('.ev-map-pin.is-selected').getAttribute('data-station-id'),target);
   assert.equal(await page.locator('.station-card.selected').getAttribute('data-station-id'),target);
   assert.deepEqual(errors,[]);results.push({viewport,pass:true,stages});
  }catch(error){await page.screenshot({path:resolve(out,`failure-${name}.png`)}).catch(()=>{});throw error;}
  finally{await context.close();}
 }
 await writeFile(resolve(out,'result.json'),JSON.stringify({pass:true,results},null,2));console.log(JSON.stringify({pass:true,results}));
}finally{await browser.close();}
