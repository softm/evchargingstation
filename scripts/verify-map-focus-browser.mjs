// Published mobile focus-mode checks. Uses the CI-only Playwright installation.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const {chromium}=await import(pathToFileURL(resolve('.cache/ad-browser/node_modules/playwright/index.mjs')));
const base=process.env.DEPLOYMENT_URL||'https://softm.github.io/evchargingstation/';
const out=resolve('verification/map-focus');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const results=[];

async function state(page,value){
  await page.waitForFunction(expected=>document.querySelector('#appLayout')?.dataset.mapFocusState===expected,value);
}
async function drag(page,selector,deltaY){
  const handle=page.locator(selector);
  const box=await handle.boundingBox();
  assert.ok(box,'drag handle must be visible');
  const x=box.x+box.width/2,y=box.y+box.height/2;
  await page.mouse.move(x,y);
  await page.mouse.down();
  await page.mouse.move(x,y+deltaY,{steps:6});
  await page.mouse.up();
}

try{
  for(const viewport of [{width:390,height:844},{width:320,height:700}]){
    const context=await browser.newContext({viewport});
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',error=>{if(error.stack?.includes('/evchargingstation/js/'))errors.push(error.message);});
    const name=`${viewport.width}x${viewport.height}`;
    try{
      await page.goto(`${base}?region=11&sort=name&lat=37.5665&lng=126.978&z=15`,{waitUntil:'domcontentloaded'});
      await page.locator('.ev-map-pin').first().waitFor({state:'attached',timeout:90000});
      await state(page,'map-browse');
      assert.equal(await page.locator('body').getAttribute('data-map-focus-state'),'map-browse');
      assert.equal(await page.locator('.search-panel').isVisible(),true);
      assert.equal(await page.locator('.map-focus-dock').isVisible(),true);

      const target=await page.evaluate(()=>[...document.querySelectorAll('.ev-map-pin')].find(pin=>{
        const b=pin.getBoundingClientRect(),map=document.querySelector('#map')?.getBoundingClientRect();
        return map&&b.left>map.left+20&&b.right<map.right-20&&b.top>map.top+80&&b.bottom<map.bottom-80;
      })?.dataset.stationId);
      assert.ok(target,'a selectable marker must be visible');
      await page.locator(`.ev-map-pin[data-station-id=${JSON.stringify(target)}]`).click();
      await page.locator('#stationDialog[open]').waitFor();
      await state(page,'focus-detail');
      assert.equal(await page.locator('.search-panel').isVisible(),false);
      assert.equal(await page.locator('.focus-detail-expand').isVisible(),true);
      await page.waitForFunction(id=>{
        const pin=document.querySelector(`.ev-map-pin.is-selected[data-station-id="${CSS.escape(id)}"]`);
        return pin&&pin.querySelector('.ev-map-pin-label')&&!pin.querySelector('.ev-map-pin-label').hidden;
      },target);

      const compact=await page.evaluate(()=>{
        const sheet=document.querySelector('#stationDialog').getBoundingClientRect();
        const pin=document.querySelector('.ev-map-pin.is-selected').getBoundingClientRect();
        return {sheetHeight:sheet.height,pinBottom:pin.bottom,sheetTop:sheet.top,overflow:document.documentElement.scrollWidth>innerWidth};
      });
      assert.ok(compact.pinBottom<compact.sheetTop,'selected marker must remain above the detail sheet');
      assert.equal(compact.overflow,false);

      await page.locator('.focus-detail-expand').click();
      await state(page,'expanded-tools');
      assert.equal(await page.locator('.search-panel').isVisible(),true);
      assert.equal(await page.locator('.map-focus-advanced').isVisible(),true);
      const expandedHeight=await page.locator('#stationDialog').evaluate(node=>node.getBoundingClientRect().height);
      assert.ok(expandedHeight>compact.sheetHeight+80,'expanded detail sheet must grow');

      await page.locator('.focus-detail-expand').click();
      await state(page,'focus-detail');
      await drag(page,'#stationDialog > .focus-sheet-handle',-90);
      await state(page,'expanded-tools');
      await drag(page,'#stationDialog > .focus-sheet-handle',90);
      await state(page,'focus-detail');

      const provider=await page.locator('#map').getAttribute('data-map-provider');
      if(provider==='naver'){
        const typeButton=page.locator('[data-focus-action="map-type"]');
        assert.equal(await typeButton.isVisible(),false,'map type is advanced-only while compact detail is open');
        await page.locator('.focus-detail-expand').click();
        await state(page,'expanded-tools');
        assert.equal(await typeButton.isVisible(),true);
        const before=await typeButton.getAttribute('aria-pressed');
        await typeButton.click();
        const after=await typeButton.getAttribute('aria-pressed');
        assert.notEqual(after,before,'Naver map type button must toggle the real SDK map type');
        await page.locator('.focus-detail-expand').click();
        await state(page,'focus-detail');
      }

      await page.locator('#stationDialog [data-action="close"]').click();
      await state(page,'map-browse');
      await page.waitForFunction(()=>!document.querySelector('#stationDialog')?.open);
      assert.equal(await page.locator(`.ev-map-pin.is-selected[data-station-id=${JSON.stringify(target)}]`).count(),1,'closing detail must retain selected marker');

      await page.locator('[data-focus-action="list"]').click();
      await state(page,'list-sheet');
      assert.equal(await page.locator('#results').isVisible(),true);
      await drag(page,'#results .focus-sheet-handle',-90);
      await state(page,'list-sheet-expanded');
      const listHeight=await page.locator('#results').evaluate(node=>node.getBoundingClientRect().height);
      assert.ok(listHeight>viewport.height*.65,'expanded list sheet should occupy most of the viewport');

      const listTarget=page.locator('#listContent [data-action="select"]').first();
      await listTarget.waitFor({state:'visible'});
      await listTarget.click();
      await page.locator('#stationDialog[open]').waitFor();
      await state(page,'focus-detail');
      await page.keyboard.press('Escape');
      await state(page,'map-browse');
      await page.waitForFunction(()=>!document.querySelector('#stationDialog')?.open);

      await page.locator('.map-focus-dock [data-focus-action="collapse"]').click();
      await state(page,'map-collapsed');
      assert.equal(await page.locator('.search-panel').isVisible(),false);
      assert.equal(await page.locator('.map-focus-expand-fab').isVisible(),true);
      await page.locator('.map-focus-expand-fab').click();
      await state(page,'map-browse');

      await page.screenshot({path:resolve(out,`map-focus-${name}.png`),fullPage:true});
      assert.deepEqual(errors,[]);
      results.push({viewport,provider,pass:true});
    }catch(error){
      await page.screenshot({path:resolve(out,`failure-${name}.png`),fullPage:true}).catch(()=>{});
      throw error;
    }finally{
      await context.close();
    }
  }
  await writeFile(resolve(out,'result.json'),JSON.stringify({pass:true,results},null,2));
  console.log(JSON.stringify({pass:true,results}));
}finally{
  await browser.close();
}
