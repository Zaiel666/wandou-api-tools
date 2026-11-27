'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=process.env.WANDOU_TEST_APP_ROOT||path.resolve(__dirname,'../app'),source=fs.readFileSync(path.join(app,'ai-node-canvas.html'),'utf8');
function sourceOf(name){const start=source.search(new RegExp(`^    (?:async )?function ${name}\\(`,'m'));assert.ok(start>=0,name);const re=/\n    (?:async )?function /g;re.lastIndex=start+1;const end=re.exec(source)?.index;assert.ok(end>start,name);return source.slice(start,end)}
function context(extra={}){const ctx=vm.createContext({console,Promise,JSON,...extra});vm.runInContext(['nativeGifRequested','nativeSvgRequested','callApi'].map(sourceOf).join('\n'),ctx);return ctx;}
test('legacy canvas refuses unsupported GIF and SVG before profile access or any generation call',async()=>{
 let calls=0;const ctx=context({apiProfileForModel:()=>{calls++;throw Error('must not access the API')},callAudioApi:()=>{calls++;throw Error('must not call API')}});
 for(const outputFormat of ['gif','svg'])await assert.rejects(ctx.callApi({type:'generator',outputFormat}),/旧画布暂不支持生成 SVG 或 GIF.*未发送生成请求/);
 assert.equal(calls,0);
});
test('legacy canvas refuses annotated references before contacting a provider',async()=>{
 let network=0;const ctx=context({apiProfileForModel:()=>({url:'https://example.invalid',key:'synthetic'}),getInputMedia:()=>null,getInputMediaList:()=>[],collectReferenceItems:()=>[{url:'data:image/png;base64,eA==',markupUrl:'data:image/png;base64,eQ=='}],fetchMaybeProxied:()=>{network++;throw Error('must not fetch')},callNanoBananaApi:()=>{network++;throw Error('must not generate')}});
 await assert.rejects(ctx.callApi({type:'generator',id:'synthetic'}),/旧画布暂不支持圈画标注生成.*未发送生成请求/);assert.equal(network,0);
});
test('legacy GPT Image standard-capability requests use the supported native dimensions',async()=>{
 const caps=require(path.join(app,'image-model-capabilities.js'));
 const options=require(path.join(app,'image-generation-options.js'));
 const ctx=vm.createContext({window:{WandouImageCapabilities:caps,WandouImageOptions:options},imageEditModelError:()=>'',imageGenerationApiModel:m=>m,imageNativeResolutionForModel:(_m,r)=>r,ratioKey:r=>r,promptRequestsTransparentPng:()=>false,isGrokImageModel:()=>false,isGptImageModel:()=>true,promptWithSize:(p,s)=>`${p} ${s}`,apiSafeGenerationSize:s=>s,apiSizeFromTarget:s=>s,nativeImageApiHost:()=>'',console,JSON});
 vm.runInContext(sourceOf('buildApiRequest'),ctx);
 for(const [requested,expected] of [['4096x4096','1024x1024'],['3840x2160','1536x1024'],['2160x3840','1024x1536']]){
  const request=await ctx.buildApiRequest({type:'generator',model:'gpt-image-2.6-flare',resolution:'4K',ratio:'auto',_apiTargetSize:requested,prompt:'synthetic',imageQuality:'medium',imageComplexity:'low'},[]);
  const payload=JSON.parse(request.body);assert.equal(payload.size,expected);assert.equal(payload.quality,'medium');assert.equal(payload.complexity,'low');assert.equal(payload.output_format,'png');
 }
 const base=await ctx.buildApiRequest({type:'generator',model:'gpt-image-2.6-flare',resolution:'1K',ratio:'auto',_apiTargetSize:'1024x1024',prompt:'synthetic',_forceBaseGeneration:true,imageQuality:'medium',imageComplexity:'low'},[]);
 const fields=JSON.parse(base.body);for(const name of ['quality','complexity','output_format','resolution','response_format'])assert.equal(Object.hasOwn(fields,name),false,`basic request cannot add ${name}`);
});
