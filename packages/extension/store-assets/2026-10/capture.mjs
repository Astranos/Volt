// Capture real UI from the extension's existing preview scenarios.
// Start its preview server first. Optional calculator recapture:
// node capture.mjs http://127.0.0.1:5198 /absolute/unpacked/release
import {chromium} from '../../node_modules/playwright-core/index.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
const root=path.dirname(fileURLToPath(import.meta.url));
const base=process.argv[2]||'http://127.0.0.1:5198';
const options=process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{channel:'chrome'};
const b=await chromium.launch(options);
try {
for(const [name,scenario,width,height,scheme] of [
 ['inventory','newtab&q=s+iphone&compare=1',1280,900,'dark'],
 ['scanner','scanner-history&expanded=1',460,900,'dark'],
 ['handbook','handbook-sidepanel',460,780,'dark'],
 ['upc','upc-hover',700,400,'light'],
]){
const p=await b.newPage({viewport:{width,height},deviceScaleFactor:2,colorScheme:scheme});
await p.clock.setFixedTime(new Date('2026-10-25T10:30:00'));
await p.goto(`${base}/preview/?scenario=${scenario}`);
await p.waitForSelector('html[data-preview-ready="true"]',{timeout:60000});
await p.evaluate(()=>document.fonts.ready);
if(name==='inventory')await p.locator('.shopify-product-compare').nth(1).click();
await p.mouse.move(0,0);
await p.waitForTimeout(1200);
await (name==='inventory'?p.locator('.closed-tabs-panel'):p).screenshot({path:path.join(root,'sources',name+'.png'),animations:'disabled'});
await p.close();
}
}finally{await b.close();}
if(process.argv[3]){
const extension=path.resolve(process.argv[3]);
const profile=await mkdtemp(path.join(tmpdir(),'volt-store-capture-'));
const c=await chromium.launchPersistentContext(profile,{...options,headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],viewport:{width:460,height:780},colorScheme:'dark'});
try{
const w=c.serviceWorkers()[0]||await c.waitForEvent('serviceworker');
await w.evaluate(()=>chrome.storage.local.set({sidePanelTool:'top-offers','volt.topOffers.projectionAmount':'400'}));
await new Promise(r=>setTimeout(r,1000));
const p=await c.newPage();await p.goto(`chrome-extension://${new URL(w.url()).host}/sidepanel.html`);
await p.locator('input').first().fill('400');
await p.screenshot({path:path.join(root,'sources/calculator.png'),animations:'disabled'});
}finally{await c.close();await rm(profile,{recursive:true,force:true});}
}
