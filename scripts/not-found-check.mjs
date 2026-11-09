import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';

const origin=process.env.CHECK_ORIGIN??'http://localhost:3000';
const browser=await chromium.launch({channel:'msedge',headless:true});
await mkdir('.local/404-check',{recursive:true});
try {
 for(const [name,viewport,reducedMotion] of [
  ['desktop',{width:1440,height:900},'no-preference'],
  ['mobile',{width:390,height:844},'reduce'],
  ['small',{width:320,height:568},'reduce']
 ]) {
  const page=await browser.newPage({viewport,reducedMotion});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const response=await page.goto(origin+'/missing/page?test=404');
  assert.equal(response.status(),404);
  await page.getByRole('heading',{name:'404: Not Found'}).waitFor();
  await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.locator('meta[name="robots"]').first().getAttribute('content'),'noindex');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.keyboard.press('Tab');
  assert.equal(await page.getByRole('link',{name:'go back home'}).evaluate(el=>el===document.activeElement),true);
  const before=await page.locator('svg > path').first().getAttribute('style');
  await page.mouse.move(20,20);await page.waitForTimeout(150);
  const after=await page.locator('svg > path').first().getAttribute('style');
  if(reducedMotion==='reduce')assert.equal(before,after);else assert.notEqual(before,after);
  await page.mouse.move(viewport.width/2,viewport.height/2);await page.waitForTimeout(100);
  await page.screenshot({path:'.local/404-check/'+name+'.png',fullPage:true});
  await page.getByRole('link',{name:'go back home'}).click();
  await page.waitForURL(origin+'/');
  assert.deepEqual(errors,[]);
  await page.close();console.log(name+': HTTP 404, noindex, layout, keyboard, motion and home navigation passed');
 }
 const page=await browser.newPage({javaScriptEnabled:false});
 assert.equal((await page.goto(origin+'/another-missing-page')).status(),404);
 assert.equal(await page.getByRole('link',{name:'go back home'}).getAttribute('href'),'/');
 console.log('No-JavaScript fallback passed');
} finally {await browser.close();}
