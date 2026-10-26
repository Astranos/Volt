import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';import sharp from '../../node_modules/sharp/lib/index.js';
const root=fileURLToPath(new URL('.',import.meta.url)).replace(/\/$/,'');
const crop = async (source, target, cssWidth, rect) => {
  const meta=await sharp(root+'/sources/'+source).metadata();
  const scale=meta.width/cssWidth;
  const pixels=Object.fromEntries(Object.entries(rect).map(([key,value])=>[key,Math.round(value*scale)]));
  await sharp(root+'/sources/'+source).extract(pixels).png().toFile(root+'/sources/'+target);
};
await crop('upc-hover.png','upc-focus.png',1190,{left:0,top:0,width:900,height:430});
await crop('context-menu.png','context-focus.png',1190,{left:880,top:190,width:310,height:420});
await crop('context-menu.png','context-page.png',1190,{left:0,top:0,width:880,height:610});
await crop('calculator-full.png','calculator.png',480,{left:0,top:56,width:480,height:698});
await crop('product-page-full.png','research-page.png',1440,{left:125,top:75,width:1190,height:610});
await sharp(root+'/sources/compare.png').extract({left:52,top:168,width:1696,height:1050}).png().toFile(root+'/sources/compare-focus.png');
const image=async(file,style,alt)=>`<img alt="${alt}" style="${style}" src="data:image/png;base64,${(await fs.readFile(root+'/sources/'+file)).toString('base64')}">`;
const logo=(await fs.readFile(new URL('../../public/assets/icons/logo-hd.svg',import.meta.url))).toString('base64');
const cards=[
['01-inventory','Your inventory, one search away',await image('inventory.png','left:48px;top:220px;width:1184px;height:auto','Volt new tab with two inventory products selected to compare')],
['02-upc-research','Research prices from any page',await image('upc-focus.png','left:48px;top:190px;width:1184px;height:auto','Actual Volt UPC hover actions on UPCitemdb')],
['03-quick-actions','Quick actions, right where you work',(await image('context-page.png','left:48px;top:240px;width:670px;height:auto','Real product page with selected text'))+(await image('context-focus.png','left:770px;top:164px;width:435px;height:auto','Actual Volt right-click menu enlarged for readability'))],
['04-offer-calculator','Turn sale prices into offers',(await image('research-page.png','left:48px;top:266px;width:665px;height:auto','Real product research page'))+(await image('calculator.png','left:790px;top:168px;width:410px;height:auto','Actual Volt offer calculator with 400 dollars projected sale price'))+'<p class="note" style="left:64px;top:650px;width:620px">Suggested and maximum offers, as you type.</p>'],
['05-product-comparison','Compare products side by side',await image('compare-focus.png','left:165px;top:172px;width:950px;height:auto','Real Volt comparison UI with sample inventory and square product photos')]
];
const css=`*{box-sizing:border-box}body{margin:0}section{position:relative;width:1280px;height:800px;overflow:hidden;background:linear-gradient(150deg,#ffffff 0%,#f8faf9 45%,#e9f2ec 100%);font-family:Inter,sans-serif;color:#14251b}h1{position:absolute;left:48px;top:94px;width:1184px;margin:0;font-family:Inter,sans-serif;font-size:53px;line-height:1.1;font-weight:400;letter-spacing:-1.8px;text-align:center}img{position:absolute;border-radius:16px;box-shadow:0 12px 34px rgba(22,48,31,.11)}.brand{position:absolute;left:48px;top:31px;display:flex;align-items:center;gap:8px;font-family:Inter,sans-serif;font-size:24px;font-weight:600;letter-spacing:-.7px}.brand img{position:static;width:25px;height:31px;border-radius:0;box-shadow:none}.note{position:absolute;margin:0;font-family:Inter,sans-serif;font-size:22px;font-weight:400;line-height:1.4;color:#45604d}.feature{position:absolute;right:50px;top:44px;font-family:Inter,sans-serif;font-size:13px;font-weight:500;letter-spacing:1.5px;color:#6b8073;text-transform:uppercase}`;
const names=['Inventory search','UPC research','Quick actions','Offer calculator','Product comparison'];
const pages=cards.map(([slug,title,content],i)=>`<section data-document-role="page" data-label="${slug}"><img style="position:absolute;left:48px;top:31px;width:25px;height:31px;border-radius:0;box-shadow:none" src="data:image/svg+xml;base64,${logo}" alt="Volt logo"><div class="brand" style="left:82px;top:33px">Volt</div><div class="feature">${names[i]}</div><h1>${title}</h1>${content}</section>`).join('');
const html=`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${pages}</body></html>`;await fs.writeFile(root+'/canva-import.html',html);await fs.writeFile(root+'/page-order.json',JSON.stringify(cards.map(([slug,title])=>({slug,title})),null,2));console.log('Created five editable 1280x800 page sources with Inter typography.');
