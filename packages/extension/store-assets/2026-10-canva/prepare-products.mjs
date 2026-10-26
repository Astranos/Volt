import {fileURLToPath} from 'node:url';
import sharp from '../../node_modules/sharp/lib/index.js';
import fs from 'node:fs/promises';
const root=fileURLToPath(new URL('./sources/products',import.meta.url));
const urls={
 iphone13:'https://istore.co.na/cdn/shop/products/iPhone13_Midnight_2048x.png?v=1715683153',
 iphone13Pro:'https://www.telecomarmenia.am/eshop/images/product/5/16342785729819.png',
 iphone13Mini:'https://assets-bss-b2b-cms.mobile.rakuten.co.jp/ns-assets/20230314_1/static-assets/images/product/iphone/iphone-13-mini/pht-device-20.png',
 iphone13ProMax:'https://iplanet.one/cdn/shop/files/iPhone_13_Pro_Max_Gold_PDP_Image_Position-1A__GBEN.jpg?v=1691139207',
 iphone13Pink:'https://istore.co.na/cdn/shop/products/iPhone13_Pink_1200x.png?v=1661332366'};
for(const [name,url] of Object.entries(urls)){
const r=await fetch(url);if(!r.ok)throw Error(name+' '+r.status);const raw=Buffer.from(await r.arrayBuffer());
await sharp(raw).flatten({background:'#fff'}).trim({background:'#ffffff',threshold:16}).resize(900,900,{fit:'contain',background:'#fff'}).extend({top:62,bottom:62,left:62,right:62,background:'#fff'}).png().toFile(root+'/'+name+'.png');console.log(name,await sharp(root+'/'+name+'.png').metadata().then(({width,height})=>({width,height})));}
await fs.writeFile(root+'/sources.json',JSON.stringify(urls,null,2));
await sharp({create:{width:1250,height:250,channels:3,background:'#eee'}}).composite(await Promise.all(Object.keys(urls).map(async(name,i)=>({input:await sharp(root+'/'+name+'.png').resize(250,250).toBuffer(),left:i*250,top:0})))).png().toFile(root+'/../product-photo-proof.png');
