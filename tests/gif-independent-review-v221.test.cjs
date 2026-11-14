const {test,before}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),sharp=require('../desktop-client/node_modules/sharp');
const scope={Blob,Uint8Array,ArrayBuffer,DOMException,atob,btoa};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../app/animated-image-output.js'),'utf8'),scope);const api=scope.WandouAnimatedImage;
let gif;before(async()=>{const width=96,height=64,frames=3,raw=Buffer.alloc(width*height*frames*4);let seed=221;for(let i=0;i<raw.length;i+=4){seed=(seed*1664525+1013904223)>>>0;raw[i]=seed&255;raw[i+1]=(seed>>>8)&255;raw[i+2]=(seed>>>16)&255;raw[i+3]=255;}gif=await sharp(raw,{raw:{width,height:height*frames,pageHeight:height,channels:4}}).gif({loop:0,delay:[80,120,160],colours:256,dither:0}).toBuffer();});
test('independent parser review: deterministic truncations, trailing payload and subarray boundaries',()=>{
 const original=api.validate(new Uint8Array(gif));assert.equal(original.frameCount,3);
 for(let i=0;i<100;i++){const end=Math.floor(gif.length*i/100);assert.throws(()=>api.validate(new Uint8Array(gif.subarray(0,end))),/GIF|文件|帧|压缩/);}
 for(const bytes of [Buffer.concat([gif,Buffer.from([0])]),Buffer.concat([gif,Buffer.from('<script>ignored payload</script>')])])assert.throws(()=>api.validate(new Uint8Array(bytes)),/额外数据/);
 const padded=new Uint8Array(gif.length+10);padded.set(gif,5);assert.equal(api.validate(padded.subarray(5,-5)).frameCount,3);assert.throws(()=>api.validate(padded),/不是 GIF/);
});
test('independent parser review: compressed clear-code abuse is bounded and rejected',()=>{
 const commands=[4,...Array(10000).fill(4),0,5],compressed=new Uint8Array(Math.ceil(commands.length*3/8));for(let j=0;j<commands.length;j++)for(let bit=0;bit<3;bit++)compressed[(j*3+bit)>>3]|=((commands[j]>>bit)&1)<<((j*3+bit)&7);
 const data=[...Buffer.from('GIF89a'),1,0,1,0,128,0,0,0,0,0,255,255,255,44,0,0,0,0,1,0,1,0,0,2];for(let p=0;p<compressed.length;p+=255){const chunk=compressed.subarray(p,p+255);data.push(chunk.length,...chunk)}data.push(0,59);assert.throws(()=>api.validate(new Uint8Array(data),{allowStatic:true}),/指令过多/);
});
test('independent parser review: no MIME-only GIF acceptance, malformed base64 or canceled reads',async()=>{
 await assert.rejects(api.prepare(new Blob(['not an animation'],{type:'image/gif'}),{preview:false}),/GIF/);
 await assert.rejects(api.prepare('data:image/gif;base64,@@@@',{preview:false}),/数据地址/);
 const controller=new AbortController();controller.abort();await assert.rejects(api.prepare(new Uint8Array(gif),{signal:controller.signal,preview:false}),{name:'AbortError'});
 const parsed=await api.prepare(new Uint8Array(gif),{preview:false});assert.deepEqual(Buffer.from(await parsed.blob.arrayBuffer()),gif);
});
