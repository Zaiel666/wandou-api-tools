const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('../desktop-client/node_modules/playwright');
const caps = require('../app/image-model-capabilities.js');
let browser;
before(async () => { browser = await chromium.launch({ headless:true, executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' }); });
after(async () => { if (browser) await browser.close(); });
async function withPage(run) {
  const page = await browser.newPage();
  const external = [];
  await page.route(/^https?:/, route => { external.push(route.request().url()); return route.abort(); });
  await page.addScriptTag({ path:path.resolve(__dirname, '../app/native-svg-output.js') });
  try { await run(page); assert.deepEqual(external, [], 'SVG processing must not fetch external resources'); }
  finally { await page.close(); }
}
const basic = '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="64"><rect x="20" y="10" width="40" height="30" fill="#f00"/></svg>';

test('native SVG preserves original UTF-8 bytes and produces a separate transparent PNG preview', () => withPage(async page => {
  const source = '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="640" height="320" viewBox="0 0 640 320"><title>豌豆矢量</title><defs><linearGradient id="paint"><stop offset="0" stop-color="#20a040"/><stop offset="1" stop-color="#88cc88"/></linearGradient><clipPath id="crop"><rect x="100" y="80" width="200" height="150"/></clipPath><path id="shape" d="M100 80h200v150H100z"/></defs><style>.logo{fill:url(#paint);stroke:#123;stroke-width:2}</style><g clip-path="url(#crop)"><use xlink:href="#shape" class="logo"/></g></svg>';
  const result = await page.evaluate(async source => {
    const result = await WandouNativeSvg.prepare(new Blob([source], { type:'image/svg+xml' }), { previewMaxEdge:320 });
    const preview = await createImageBitmap(await fetch(result.previewUrl).then(r => r.blob()));
    const canvas = document.createElement('canvas'); canvas.width=preview.width; canvas.height=preview.height;
    const ctx=canvas.getContext('2d'); ctx.drawImage(preview,0,0);
    return { width:result.width,height:result.height,mime:result.blob.type,format:result.format,source:await result.blob.text(),bytes:Array.from(new Uint8Array(await result.blob.arrayBuffer())),originalType:result.dataUrl.slice(0,26),previewType:result.previewUrl.slice(0,22),previewSize:[preview.width,preview.height],transparent:result.hasTransparency,corner:ctx.getImageData(0,0,1,1).data[3],center:ctx.getImageData(100,80,1,1).data[3],fallback:result.previewFallback };
  }, source);
  assert.equal(result.source, source);
  assert.equal(crypto.createHash('sha256').update(Buffer.from(result.bytes)).digest('hex'), crypto.createHash('sha256').update(source).digest('hex'));
  assert.equal(result.mime,'image/svg+xml'); assert.equal(result.format,'svg');
  assert.equal(result.width,640); assert.equal(result.height,320); assert.deepEqual(result.previewSize,[320,160]);
  assert.match(result.originalType,/^data:image\/svg\+xml/); assert.match(result.previewType,/^data:image\/png/);
  assert.equal(result.transparent,true); assert.equal(result.corner,0); assert.equal(result.center,255); assert.equal(result.fallback,false);
}));

test('metadata inspection does not rasterize and accepts viewBox, physical units and local styled vectors', () => withPage(async page => {
  const result = await page.evaluate(async basic => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = () => { throw new Error('Unexpected rasterization'); };
    try {
      const prepared = await WandouNativeSvg.prepare(basic,{preview:false});
      const viewBox = WandouNativeSvg.validate('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60"><path d="M0 0L10 20"/></svg>');
      const units = WandouNativeSvg.validate('<svg xmlns="http://www.w3.org/2000/svg" width="2in" height="1in"><text x="10" y="20" style="font-family:Arial;fill:#111">文字</text></svg>');
      return {same:prepared.previewUrl===prepared.dataUrl,viewBox:[viewBox.width,viewBox.height],units:[units.width,units.height]};
    } finally { HTMLCanvasElement.prototype.getContext=original; }
  }, basic);
  assert.deepEqual(result,{same:true,viewBox:[120,60],units:[192,96]});
}));

test('SVG validation rejects active content, external resources, embedded bitmaps and CSS escapes before preview', () => withPage(async page => {
  const cases = [
    '<script>alert(1)</script>',
    '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">HTML</div></foreignObject>',
    '<rect width="20" height="20" onload="alert(1)"/>',
    '<image href="data:image/png;base64,aaaa"/>',
    '<use href="https://external.invalid/icon.svg#x"/>',
    '<rect style="fill:url(https://external.invalid/pattern.svg)"/>',
    '<style>@import "https://external.invalid/x.css";</style>',
    '<style>.x{fill:u\\72l(https://external.invalid/x)}</style>',
    '<style>.x{background-image:url(https://external.invalid/x)}</style>',
    '<animate attributeName="x" values="1;2"/>',
    '<svg xml:base="https://external.invalid/"><use href="#x"/></svg>',
    '<filter id="f"><feImage href="https://external.invalid/x"/></filter>'
  ];
  const results=await page.evaluate(async cases=>{
    const results=[];
    for(const content of cases){try{await WandouNativeSvg.prepare(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">${content}</svg>`);results.push('accepted');}catch(error){results.push(error.message);}}
    return results;
  },cases);
  assert.equal(results.length,cases.length); assert.ok(results.every(value=>value.startsWith('SVG 文件无法使用：')),JSON.stringify(results));
}));

test('SVG parser rejects DTD, processing instructions, invalid XML, PNG disguised as SVG and malformed encoding', () => withPage(async page => {
  const invalid=[
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "https://external.invalid/x">]>'+basic,
    '<?xml-stylesheet href="https://external.invalid/x.css"?>'+basic,
    basic.replace('</svg>',''),
    '<svg width="10" height="10"></svg>',
    '<?xml version="1.0" encoding="UTF-16"?>'+basic,
    'data:image/png;base64,iVBORw0KGgo=',
    new Uint8Array([0x89,0x50,0x4e,0x47]).toString()
  ];
  const results=await page.evaluate(async invalid=>Promise.all(invalid.map(async value=>{try{await WandouNativeSvg.prepare(value,{preview:false});return false;}catch(error){return /SVG 文件无法使用/.test(error.message);}})),invalid);
  assert.ok(results.every(Boolean));
  assert.equal(await page.evaluate(async()=>{try{await WandouNativeSvg.prepare(new Uint8Array([0xff,0xfe,0x80]));return false;}catch(error){return /UTF-8/.test(error.message);}}),true);
}));

test('reference graph prevents cycles, exponential expansion and missing targets', () => withPage(async page => {
  const results=await page.evaluate(()=>{
    const cases=[
      '<defs><g id="a"><use href="#a"/></g></defs><use href="#a"/>',
      '<defs><g id="a"><use href="#b"/></g><g id="b"><use href="#a"/></g></defs>',
      '<use href="#missing"/>',
      '<defs><g id="x"><path d="M0 0L1 1"/></g><g id="x"/></defs>'
    ];
    let huge='<defs><g id="g0"><path d="M0 0L1 1"/></g>';
    for(let i=1;i<20;i++) huge+=`<g id="g${i}"><use href="#g${i-1}"/><use href="#g${i-1}"/></g>`;
    cases.push(huge+'</defs><use href="#g19"/>');
    return cases.map(content=>{try{WandouNativeSvg.validate(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">${content}</svg>`);return false;}catch(error){return /SVG 文件无法使用/.test(error.message);}});
  });
  assert.ok(results.every(Boolean));
}));

test('bounded SVG dimensions, nesting, path complexity and input bytes reject oversized data', () => withPage(async page => {
  const result=await page.evaluate(async()=>{
    const cases=[
      '<svg xmlns="http://www.w3.org/2000/svg" width="1000000" height="1"/>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="1"/>',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 10"/>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">'+'<g>'.repeat(70)+'</g>'.repeat(70)+'</svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><path d="'+'M0 0 '.repeat(400001)+'"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">'+'<path/>'.repeat(20001)+'</svg>'
    ];
    const results=cases.map(value=>{try{WandouNativeSvg.validate(value);return false;}catch(error){return /SVG 文件无法使用/.test(error.message);}});
    try{await WandouNativeSvg.prepare(new Blob([new Uint8Array(WandouNativeSvg.limits.bytes+1)]));results.push(false);}catch(error){results.push(/8 MB/.test(error.message));}
    return results;
  });
  assert.ok(result.every(Boolean));
}));

test('failed preview keeps validated original SVG available for saving without API retry', () => withPage(async page => {
  const result=await page.evaluate(async basic=>{
    const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=()=>null;
    try{const result=await WandouNativeSvg.prepare(basic);return {text:await result.blob.text(),fallback:result.previewFallback,same:result.previewUrl===result.dataUrl};}
    finally{HTMLCanvasElement.prototype.getContext=original;}
  },basic);
  assert.deepEqual(result,{text:basic,fallback:true,same:true});
}));

test('cancel before or during preview aborts and revokes temporary object URLs', () => withPage(async page => {
  const result=await page.evaluate(async basic=>{
    const first=new AbortController();first.abort();
    let firstName='';try{await WandouNativeSvg.prepare(basic,{signal:first.signal});}catch(error){firstName=error.name;}
    const NativeImage=Image,originalRevoke=URL.revokeObjectURL;
    let created=0,revoked=0;
    window.Image=class {constructor(){created++;}set src(value){this._src=value;}get src(){return this._src;}};
    URL.revokeObjectURL=function(url){revoked++;return originalRevoke.call(URL,url);};
    let secondName='';
    try{const second=new AbortController();const pending=WandouNativeSvg.prepare(basic,{signal:second.signal});await new Promise(resolve=>setTimeout(resolve,10));second.abort();try{await pending;}catch(error){secondName=error.name;}}
    finally{window.Image=NativeImage;URL.revokeObjectURL=originalRevoke;}
    return {firstName,secondName,created,revoked};
  },basic);
  assert.deepEqual(result,{firstName:'AbortError',secondName:'AbortError',created:1,revoked:1});
}));

test('base64 and data URL paths preserve UTF-8 bytes, reject malformed payloads', () => withPage(async page => {
  const unicode=basic.replace('/></svg>','/><title>中文图形</title></svg>');
  const encoded=Buffer.from(unicode).toString('base64');
  const result=await page.evaluate(async({encoded,unicode})=>{
    const a=await WandouNativeSvg.fromBase64(encoded,{preview:false});
    const b=await WandouNativeSvg.prepare(`data:image/svg+xml;base64,${encoded}`,{preview:false});
    const c=await WandouNativeSvg.prepare(`data:image/svg+xml,${encodeURIComponent(unicode)}`,{preview:false});
    let rejected=false;try{await WandouNativeSvg.fromBase64('!!!not base64');}catch(error){rejected=true;}
    return {values:await Promise.all([a,b,c].map(value=>value.blob.text())),rejected};
  },{encoded,unicode});
  assert.deepEqual(result.values,[unicode,unicode,unicode]);assert.equal(result.rejected,true);
}));

test('GPT-Image-2.6 has documented native SVG capability without assuming undocumented native 4K',()=>{
  for(const model of ['gpt-image-2.6-flare','gpt-image-2.6-sunburst']){
    const cap=caps.resolve(model);assert.equal(cap.verified,true);assert.equal(cap.nativeSvg,true);assert.equal(cap.kind,'openai-standard');assert.deepEqual(cap.nativeTiers,['1K']);
    assert.equal(caps.nativeSize(model,'4K','4096x4096'),'1024x1024');
    assert.equal(caps.nativeSize(model,'4K','4096x2048'),'1536x1024');
    assert.equal(caps.nativeSize(model,'2K','1024x2048'),'1024x1536');
  }
  assert.equal(caps.resolve('gpt-image-2.6-flare-custom').verified,false);
  assert.deepEqual(caps.resolve('gpt-image-2.5-flare').nativeTiers,['1K','2K','4K']);
});
