'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const sharp=require('../desktop-client/node_modules/sharp');
const source=fs.readFileSync(path.join(__dirname,'../app/canvas-media-preview.js'),'utf8');
const context=vm.createContext({window:{},atob:value=>Buffer.from(value,'base64').toString('latin1'),Uint8Array,DataView,Map,WeakMap,Set,Promise,TextEncoder});
vm.runInContext(source,context,{filename:'canvas-media-preview.js'});
const accept=value=>context.window.WandouCanvasPreview.smallStaticPreview(value);
const data=(mime,buffer)=>`data:${mime};base64,${buffer.toString('base64')}`;
const png=(width,height)=>sharp({create:{width,height,channels:4,background:{r:30,g:100,b:160,alpha:.6}}}).png().toBuffer();
const jpg=(width,height)=>sharp({create:{width,height,channels:3,background:{r:30,g:100,b:160}}}).jpeg().toBuffer();
function crc32(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(kind,payload){const name=Buffer.from(kind),body=Buffer.concat([name,payload]),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(payload.length);crc.writeUInt32BE(crc32(body));return Buffer.concat([size,body,crc]);}
function beforeIdat(png,extra){let pos=8;while(pos+12<=png.length){const size=png.readUInt32BE(pos),kind=png.subarray(pos+4,pos+8).toString();if(kind==='IDAT')return Buffer.concat([png.subarray(0,pos),extra,png.subarray(pos)]);pos+=size+12;}throw Error('PNG fixture lacks IDAT');}
const fixtures=Promise.all([png(640,360),jpg(640,360),png(640,640),png(641,360),png(4096,2304)]).then(([smallPng,smallJpeg,boundary,wide,original])=>({smallPng,smallJpeg,boundary,wide,original}));

test('overview helper exposes a synchronous decision without decoding media',()=>{
 assert.equal(typeof context.window.WandouCanvasPreview.smallStaticPreview,'function');
 for(const invalid of [undefined,null,42,{},'', 'blob:synthetic','https://example.invalid/image.png','wandou-media://synthetic/preview'])assert.equal(Boolean(accept(invalid)),false);
});
test('verified small static PNG and JPEG previews are allowed, including 640 square boundary',async()=>{
 const f=await fixtures;
 for(const [mime,bytes] of [['image/png',f.smallPng],['image/jpeg',f.smallJpeg],['image/png',f.boundary]])assert.equal(Boolean(accept(data(mime,bytes))),true,mime);
});
test('a 4K original in previewUrl and a 641-pixel preview never bypass the overview budget',async()=>{
 const f=await fixtures;assert.equal(Boolean(accept(data('image/png',f.original))),false);assert.equal(Boolean(accept(data('image/png',f.wide))),false);
});
test('PNG animation declaration is rejected before any frame can play',async()=>{
 const f=await fixtures,control=Buffer.alloc(8);control.writeUInt32BE(1,0);control.writeUInt32BE(0,4);
 const animated=beforeIdat(f.smallPng,chunk('acTL',control));assert.equal(Boolean(accept(data('image/png',animated))),false);
});
test('animation metadata after a large ancillary chunk cannot be mistaken for static PNG',async()=>{
 const f=await fixtures,control=Buffer.alloc(8);control.writeUInt32BE(1,0);
 const extra=Buffer.concat([chunk('tEXt',Buffer.concat([Buffer.from('padding\0'),Buffer.alloc(33000,65)])),chunk('acTL',control)]);
 assert.equal(Boolean(accept(data('image/png',beforeIdat(f.smallPng,extra)))),false);
});
test('actual bytes must match declared PNG or JPEG MIME',async()=>{
 const f=await fixtures;
 for(const [mime,bytes] of [['image/png',f.smallJpeg],['image/jpeg',f.smallPng],['image/png',Buffer.from('GIF89a\x01\0\x01\0')]])assert.equal(Boolean(accept(data(mime,bytes))),false,mime);
});
test('GIF, WebP and malformed or truncated raster headers are excluded',async()=>{
 const f=await fixtures;
 const webp=await sharp(f.smallPng).webp().toBuffer();
 for(const value of [data('image/webp',webp),data('image/gif',Buffer.from('GIF89a\x01\0\x01\0')),data('image/png',f.smallPng.subarray(0,16)),data('image/jpeg',f.smallJpeg.subarray(0,6)),'data:image/png;base64,%%%%','data:image/png,not-base64'])assert.equal(Boolean(accept(value)),false);
});
test('small image dimensions do not bypass the 400k encoded source limit',async()=>{
 const f=await fixtures,large=beforeIdat(f.smallPng,chunk('tEXt',Buffer.concat([Buffer.from('padding\0'),Buffer.alloc(310000,65)])));
 const url=data('image/png',large);assert.ok(url.length>400000);assert.equal(Boolean(accept(url)),false);
});
