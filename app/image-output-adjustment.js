/* Optional local copies never replace or regenerate a provider's original. */
(function(root){
  'use strict';
  const LIMITS=Object.freeze({svgEdge:16384,gifBytes:32*1024*1024,svgBytes:8*1024*1024});
  function abort(signal){if(signal?.aborted)throw new DOMException('已取消本地副本处理','AbortError');}
  function request(value){return root.WandouImageOutputContract?.requestSnapshot(value)||null;}
  function actual(value={}){return{format:String(value.format||value.outputFormat||value.imageOutputFormat||'').toLowerCase(),width:Number(value.width),height:Number(value.height),frameCount:Number(value.frameCount??value.animationFrameCount)||null,frameDurationsMs:value.frameDurationsMs||value.animationFrameDurationsMs||[],loopCount:value.loopCount??value.animationLoopCount??null};}
  function plan(input,value){
    const snapshot=request(input),source=actual(value),base={eligible:false,format:source.format,operations:[],remainingDifferences:[],target:null,label:'',reason:''};
    if(!snapshot)return{...base,reason:'没有可唯一对应的原始请求参数，不能根据当前设置调整旧作品。'};
    if(snapshot.format!==source.format||!['svg','gif'].includes(source.format))return{...base,reason:'仅支持同格式的 SVG 尺寸或 GIF 帧时长副本。'};
    if(!Number.isFinite(source.width)||!Number.isFinite(source.height)||source.width<=0||source.height<=0)return{...base,reason:'原件尺寸信息不完整，请先重新读取原件。'};
    const comparison=root.WandouImageOutputContract.compare(snapshot,source);
    if(source.format==='svg'){
      if(!snapshot.size||snapshot.size==='auto')return{...base,reason:'原始请求使用自动尺寸，没有指定可匹配的 SVG 画布尺寸。'};
      const [width,height]=snapshot.size.split('x').map(Number);
      if(width>LIMITS.svgEdge||height>LIMITS.svgEdge)return{...base,reason:'本地 SVG 副本的最长边不能超过 16384。'};
      if(source.width===width&&source.height===height)return{...base,reason:'原件画布尺寸已与请求一致。'};
      return{...base,eligible:true,operations:['svg-size'],target:{width,height},label:`本地匹配 ${width}×${height} · 非原生生成`,reason:'等比缩放并居中留白，保留矢量内容，不裁切或拉伸。'};
    }
    const target=snapshot.frameDurationMs?Math.round(snapshot.frameDurationMs/10)*10:null;
    const remainingDifferences=comparison.differences.filter(item=>item!=='frame-duration');
    if(!target||target<20||target>655350)return{...base,remainingDifferences,reason:'原始请求没有有效的 GIF 帧时长。'};
    if(!Number.isInteger(source.frameCount)||source.frameCount<2||source.frameCount>16||source.frameDurationsMs.length!==source.frameCount)return{...base,remainingDifferences,reason:'原件动画帧信息不完整或超出 2–16 帧范围。'};
    if(source.frameDurationsMs.every(value=>value===target))return{...base,remainingDifferences,reason:remainingDifferences.length?'帧时长已一致；本地不能补出上游未生成的新画面，也不改变 GIF 尺寸。':'原件帧时长已与请求一致。'};
    return{...base,eligible:true,operations:['gif-timing'],remainingDifferences,target:{frameDurationMs:target},label:`本地调整每帧 ${target} 毫秒 · 非原生生成`,reason:'仅修改播放时长，保留全部原始帧、像素、透明度和循环设置。'+(remainingDifferences.length?'原有帧数或尺寸差异仍会保留，不补帧或放大。':'')};
  }
  async function digest(blob,signal){abort(signal);const bytes=await blob.arrayBuffer();abort(signal);const value=await root.crypto.subtle.digest('SHA-256',bytes);abort(signal);return Array.from(new Uint8Array(value),n=>n.toString(16).padStart(2,'0')).join('');}
  // The existing strict GIF validator runs before this walker. Only a copied
  // Graphic Control Extension's two delay bytes change; compressed pixels stay exact.
  function retimeGif(input,milliseconds,signal){
    const bytes=input.slice(),delay=milliseconds/10;let position=13+(bytes[10]&128?3*(1<<((bytes[10]&7)+1)):0),pending=null,frames=0;
    const insertions=[];
    function blocks(){while(bytes[position])position+=1+bytes[position];position++;}
    while(position<bytes.length){
      abort(signal);const start=position,marker=bytes[position++];
      if(marker===0x3b)break;
      if(marker===0x21){const label=bytes[position++];if(label===0xf9){pending=position+2;position+=6;}else if(label===0xff){position+=1+bytes[position];blocks();}else if(label===0xfe)blocks();else throw Error('本地副本遇到不支持的 GIF 扩展。');continue;}
      if(marker!==0x2c)throw Error('本地副本遇到无效 GIF 帧。');
      if(pending!==null){bytes[pending]=delay&255;bytes[pending+1]=(delay>>8)&255;}else insertions.push({at:start,data:Uint8Array.of(0x21,0xf9,4,0,delay&255,(delay>>8)&255,0,0)});
      pending=null;frames++;
      const packed=bytes[position+8];position+=9;if(packed&128)position+=3*(1<<((packed&7)+1));position++;blocks();
    }
    if(!frames)throw Error('本地副本没有读取到动画帧。');
    if(!insertions.length)return bytes;
    if(bytes.length+insertions.length*8>LIMITS.gifBytes)throw Error('GIF 副本超过 32 MiB 限制。');
    const output=new Uint8Array(bytes.length+insertions.length*8);let from=0,to=0;
    for(const insertion of insertions){output.set(bytes.subarray(from,insertion.at),to);to+=insertion.at-from;output.set(insertion.data,to);to+=insertion.data.length;from=insertion.at;}
    output.set(bytes.subarray(from),to);output.set(new TextEncoder().encode('GIF89a'),0);return output;
  }
  async function create(input,options={}){
    const snapshot=request(options.request);if(!snapshot)throw Error('缺少唯一对应的原始请求参数，无法创建本地副本。');abort(options.signal);
    let original,adjusted,choice;
    if(snapshot.format==='svg'){
      if(!root.WandouNativeSvg)throw Error('SVG 组件未加载。');
      original=await root.WandouNativeSvg.prepare(input,{signal:options.signal,preview:false});abort(options.signal);choice=plan(snapshot,original);if(!choice.eligible)throw Error(choice.reason);
      const doc=new DOMParser().parseFromString(await original.blob.text(),'image/svg+xml'),svg=doc.documentElement;abort(options.signal);
      if(!svg.hasAttribute('viewBox'))svg.setAttribute('viewBox',`0 0 ${original.width} ${original.height}`);
      svg.setAttribute('width',String(choice.target.width));svg.setAttribute('height',String(choice.target.height));svg.setAttribute('preserveAspectRatio','xMidYMid meet');
      const serialized=new XMLSerializer().serializeToString(svg);
      adjusted=await root.WandouNativeSvg.prepare(serialized,{signal:options.signal,previewMaxEdge:options.previewMaxEdge||640});abort(options.signal);
      if(adjusted.width!==choice.target.width||adjusted.height!==choice.target.height)throw Error('本地 SVG 尺寸校验未通过，原件未更改。');
    }else if(snapshot.format==='gif'){
      if(!root.WandouAnimatedImage)throw Error('GIF 组件未加载。');
      original=await root.WandouAnimatedImage.prepare(input,{signal:options.signal,preview:false});abort(options.signal);choice=plan(snapshot,original);if(!choice.eligible)throw Error(choice.reason);
      const bytes=new Uint8Array(await original.blob.arrayBuffer());abort(options.signal);
      const copy=retimeGif(bytes,choice.target.frameDurationMs,options.signal);abort(options.signal);
      adjusted=await root.WandouAnimatedImage.prepare(copy,{signal:options.signal,previewMaxEdge:options.previewMaxEdge||640});abort(options.signal);
      if(adjusted.width!==original.width||adjusted.height!==original.height||adjusted.frameCount!==original.frameCount||adjusted.loopCount!==original.loopCount||adjusted.hasTransparency!==original.hasTransparency||adjusted.frameDurationsMs.some(value=>value!==choice.target.frameDurationMs))throw Error('本地 GIF 副本校验未通过，原件未更改。');
    }else throw Error('本地副本仅支持 SVG 和 GIF。');
    const comparison=root.WandouImageOutputContract.compare(snapshot,adjusted),originalSha256=await digest(original.blob,options.signal),copySha256=await digest(adjusted.blob,options.signal);abort(options.signal);
    const source={sha256:originalSha256,width:original.width,height:original.height,format:original.format,byteLength:original.byteLength,...(original.format==='gif'?{frameCount:original.frameCount,frameDurationsMs:original.frameDurationsMs.slice(),durationMs:original.durationMs,loopCount:original.loopCount}: {})};
    const label=choice.label+(comparison.mismatch?'；帧数或尺寸仍与请求不同，未伪造新内容。':'。');
    const outputComparison={...comparison,message:`${label}请求：${comparison.requestSummary}；副本：${comparison.actualSummary}。渠道原件已保留，未再次请求生图。`};
    return{...adjusted,sha256:copySha256,source,nonNative:true,processing:original.format==='svg'?'local-vector-fit':'local-animation-timing',label,outputRequest:snapshot,outputComparison,remainingDifferences:comparison.differences.slice(),operations:choice.operations.slice()};
  }
  root.WandouImageOutputAdjustment=Object.freeze({plan,create,LIMITS});
})(globalThis);
