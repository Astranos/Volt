import {fileURLToPath} from 'node:url';
import {chromium} from '../../node_modules/playwright-core/index.mjs';
import fs from 'node:fs/promises';
const root=fileURLToPath(new URL('.',import.meta.url)).replace(/\/$/,'');
const products=['iphone13','iphone13Pro','iphone13Mini','iphone13ProMax','iphone13Pink'];
const browser=await chromium.launch(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{channel:'chrome'});
for(const [name,scenario,width,height] of [['inventory','newtab&q=s+iphone&compare=1',1280,900],['compare','shopify-compare&ids=101,102',900,650]]){
const p=await browser.newPage({viewport:{width,height},deviceScaleFactor:2,colorScheme:'dark'});
await p.clock.setFixedTime(new Date('2026-10-26T10:30:00'));
await p.route('**/preview/fixtures/shopify.ts',async route=>{
const response=await route.fetch();let body=await response.text();
body=body.replace(/export const productImages = \{[\s\S]*?\n\};/,`export const productImages = ${JSON.stringify(Object.fromEntries(products.map(n=>[n,'https://volt-demo-assets.local/'+n+'.png'])))};`);
body=body.replace('[productImages.iphone13, productImages.iphone13Mini]', '[productImages.iphone13]').replace('[productImages.iphone13Pro, productImages.iphone13ProMax]', '[productImages.iphone13Pro]');
body=body.replace(/("For parts",\s*)productImages\.iphone13\)/,'$1productImages.iphone13Pink)');
await route.fulfill({response,body});});
await p.route('https://volt-demo-assets.local/**',async route=>{const n=new URL(route.request().url()).pathname.slice(1);await route.fulfill({path:root+'/sources/products/'+n,contentType:'image/png'});});
await p.goto((process.env.VOLT_PREVIEW_URL||'http://127.0.0.1:5198')+'/preview/?scenario='+scenario);
await p.waitForSelector('html[data-preview-ready="true"]',{timeout:60000});
if(name==='inventory')await p.locator('.shopify-product-compare').nth(1).click();
await p.mouse.move(0,0);
await p.waitForFunction(()=>[...document.querySelectorAll('img')].every(i=>i.complete));
await p.waitForTimeout(500);
console.log(name,await p.locator('img').evaluateAll(es=>es.filter(e=>e.src.includes('volt-demo-assets')).map(e=>({loaded:e.naturalWidth>0,width:e.naturalWidth,height:e.naturalHeight}))));
await(name==='inventory'?p.locator('.closed-tabs-panel'):p).screenshot({path:root+'/sources/'+name+'.png',animations:'disabled'});
await p.close();}
await browser.close();
