(function (root) {
  'use strict';
  const tiers = ['1K', '2K', '4K'];
  let tail = Promise.resolve(), hasRecords;
  function plan(model, quality, size) {
    const tier = ({low:'1K',medium:'2K',high:'4K'})[quality] || '2K';
    const cap = root.WandouImageCapabilities.resolve(model);
    const supported = cap.nativeTiers.filter(value => tiers.indexOf(value) <= tiers.indexOf(tier));
    const nativeTier = supported.at(-1) || cap.nativeTiers[0] || tier;
    let nativeSize = root.WandouImageCapabilities.nativeSize(model, nativeTier, size);
    if(cap.kind==='unknown') {
      const {width,height}=root.WandouImageCapabilities.dimensions(size);
      nativeSize=/dall[-_. ]?e/i.test(model)||Math.abs(width-height)<=Math.max(width,height)*.08?'1024x1024':width>height?'1536x1024':'1024x1536';
    }
    const mayUpscale = !cap.nativeTiers.includes(tier) || Math.max(...nativeSize.split('x').map(Number)) < Math.max(...size.split('x').map(Number));
    return {model, tier, nativeTier, nativeSize, targetSize:size, kind:cap.kind, verified:cap.verified, mayUpscale};
  }
  function abort(signal) { if(signal?.aborted) throw signal.reason || new DOMException('图片处理已取消','AbortError'); }
  function dataUrl(blob) { return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(r.error);r.readAsDataURL(blob);}); }
  function database() { return new Promise((resolve,reject)=>{
    let settled=false;const fail=error=>{if(!settled){settled=true;clearTimeout(timer);reject(error);}};
    const timer=setTimeout(()=>fail(new Error('图片标记存储超时')),5000);
    const r=indexedDB.open('wandou-workbench-output-metadata',1);
    r.onupgradeneeded=()=>r.result.createObjectStore('outputs',{keyPath:'id'});
    r.onsuccess=()=>{if(settled){r.result.close();return;}settled=true;clearTimeout(timer);resolve(r.result);};r.onerror=()=>fail(r.error);r.onblocked=()=>fail(new Error('图片标记存储被占用'));
  }); }
  async function save(record) {
    const db=await database();
    try { await new Promise((resolve,reject)=>{const tx=db.transaction('outputs','readwrite');tx.objectStore('outputs').put(record);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('图片标记保存失败'));});hasRecords=true; }
    finally {db.close();}
  }
  async function metadata(source) {
    if(!source || !root.WandouMediaHash) return null;
    const db=await database();
    try {
      if(hasRecords===undefined)hasRecords=await new Promise((resolve,reject)=>{const r=db.transaction('outputs').objectStore('outputs').count();r.onsuccess=()=>resolve(r.result>0);r.onerror=()=>reject(r.error);});
      if(!hasRecords)return null;
      const id=await root.WandouMediaHash.idAsync(source);
      const record=await new Promise((resolve,reject)=>{const r=db.transaction('outputs').objectStore('outputs').get(id);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error);});
      if(!record)return null;
      const {originalBlob,...info}=record;return info;
    } finally {db.close();}
  }
  async function processResponse(response, options) {
    if(!response.ok)return response;
    let payload;try{payload=await response.clone().json();}catch{return response;}
    if(!Array.isArray(payload.data))return response;
    const work=async()=>{
      abort(options.signal);
      for(const entry of payload.data) {
        const outputFormat=entry.output_format||payload.output_format;
        const mime=entry.mime_type||entry.mimeType||({png:'image/png',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',svg:'image/svg+xml'})[outputFormat]||'image/png';
        const source=entry.b64_json ? `data:${mime};base64,${entry.b64_json}` : entry.url;
        if(typeof source!=='string'||!source)continue;
        let originalUrl,originalBlob;
        try {
          const fetched=await options.fetch(source,{signal:options.signal});
          if(!fetched.ok)throw new Error('无法读取生成原图');
          originalBlob=await fetched.blob();abort(options.signal);
          const prefix=(await originalBlob.slice(0,4096).text()).replace(/^\uFEFF/,'').trimStart();abort(options.signal);
          if(options.outputFormat==='gif'||outputFormat==='gif'||originalBlob.type.split(';')[0]==='image/gif'||/^GIF8[79]a/.test(prefix)) {
            let animation;
            try {
              if(!root.WandouAnimatedImage)throw new Error('GIF 读取组件尚未就绪');
              animation=await root.WandouAnimatedImage.prepare(originalBlob,{signal:options.signal,previewMaxEdge:640});abort(options.signal);
            } catch(error) {
              abort(options.signal);
              const message='接口已返回文件，但 GIF 校验未通过：'+(error?.message||'无效 GIF')+'。未再次请求生图。';
              root.dispatchEvent(new CustomEvent('wandou-output-processing-warning',{detail:message}));
              return new Response(JSON.stringify({error:{message,type:'local_output_error',code:'invalid_gif_output'}}),{status:422,headers:{'content-type':'application/json'}});
            }
            originalUrl=animation.dataUrl;entry.url=originalUrl;entry.mime_type='image/gif';entry.output_format='gif';delete entry.b64_json;
            entry.revised_prompt=[entry.revised_prompt,`GIF 动图 · ${animation.frameCount} 帧；已保留原始动画，未进行像素放大。`].filter(Boolean).join('\n');
            try {
              await save({id:await root.WandouMediaHash.idAsync(originalUrl),processing:'native-animation',width:animation.width,height:animation.height,tier:'GIF',format:'gif',previewUrl:animation.previewUrl,previewFallback:animation.previewFallback,animationFrameCount:animation.frameCount,animationFrameDurationsMs:animation.frameDurationsMs,animationDurationMs:animation.durationMs,animationLoopCount:animation.loopCount,hasTransparency:animation.hasTransparency});abort(options.signal);
            } catch(error) {
              abort(options.signal);
              entry.revised_prompt+='\nGIF 信息标记保存失败，动画原文件已保留；未再次请求生图。';
              root.dispatchEvent(new CustomEvent('wandou-output-processing-warning',{detail:'GIF 信息标记保存失败，动画原文件已保留；未再次请求生图。'}));
            }
            continue;
          }
          if(options.outputFormat==='svg'||outputFormat==='svg'||originalBlob.type.split(';')[0]==='image/svg+xml'||/^(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(prefix)) {
            let vector;
            try {
              if(!root.WandouNativeSvg)throw new Error('SVG 读取组件尚未就绪');
              vector=await root.WandouNativeSvg.prepare(originalBlob,{signal:options.signal,preview:false});abort(options.signal);
            } catch(error) {
              abort(options.signal);
              // A local format failure after a successful paid response is terminal.
              // 422 is intentionally outside the workbench client's retryable status list.
              const message='接口已返回文件，但 SVG 校验未通过：'+(error?.message||'无效 SVG')+'。未再次请求生图。';
              root.dispatchEvent(new CustomEvent('wandou-output-processing-warning',{detail:message}));
              return new Response(JSON.stringify({error:{message,type:'local_output_error',code:'invalid_svg_output'}}),{status:422,headers:{'content-type':'application/json'}});
            }
            originalUrl=vector.dataUrl;entry.url=originalUrl;entry.mime_type='image/svg+xml';entry.output_format='svg';delete entry.b64_json;
            entry.revised_prompt=[entry.revised_prompt,'已保留 SVG 矢量原文件，未进行位图放大。'].filter(Boolean).join('\n');
            try {
              await save({id:await root.WandouMediaHash.idAsync(originalUrl),processing:'native-vector',width:vector.width,height:vector.height,tier:'SVG',format:'svg'});abort(options.signal);
            } catch(error) {
              abort(options.signal);
              entry.revised_prompt+='\nSVG 信息标记保存失败，原文件已保留；未再次请求生图。';
              root.dispatchEvent(new CustomEvent('wandou-output-processing-warning',{detail:'SVG 信息标记保存失败，矢量原文件已保留；未再次请求生图。'}));
            }
            continue;
          }
          originalUrl=source.startsWith('data:')?source:await dataUrl(originalBlob);
          const result=await root.WandouImageOutput.processBlob({blob:originalBlob,url:originalUrl,targetSize:options.plan.targetSize,signal:options.signal});
          abort(options.signal);
          if(result.nonNative) {
            const record={id:await root.WandouMediaHash.idAsync(result.url),processing:'local-upscale',width:result.width,height:result.height,originalWidth:result.originalWidth,originalHeight:result.originalHeight,tier:options.plan.tier,originalBlob};
            await save(record);abort(options.signal);
            entry.revised_prompt=[entry.revised_prompt,`本地放大 · 非原生生成；原图 ${result.originalWidth}×${result.originalHeight}，输出 ${result.width}×${result.height}`].filter(Boolean).join('\n');
          } else if(result.processing==='original-animation-preserved' && Math.max(result.width,result.height)<result.targetLongEdge) {
            await save({id:await root.WandouMediaHash.idAsync(result.url),processing:result.processing,width:result.width,height:result.height,originalWidth:result.width,originalHeight:result.height,tier:options.plan.tier});
            entry.revised_prompt=[entry.revised_prompt,'已保留动图原格式和尺寸，未将动画转换为静态放大图。'].filter(Boolean).join('\n');
          }
          entry.url=result.url;delete entry.b64_json;
        } catch(error) {
          abort(options.signal);
          // A completed paid generation must never be retried just because local processing failed.
          if(originalUrl){entry.url=originalUrl;delete entry.b64_json;}
          entry.revised_prompt=[entry.revised_prompt,'本地尺寸处理未完成，保留生成原图；未再次请求生图。'].filter(Boolean).join('\n');
          root.dispatchEvent(new CustomEvent('wandou-output-processing-warning',{detail:'本地放大或保存标记失败，已保留生成原图，输出可能未达到所选尺寸。'}));
        }
      }
      const headers=new Headers(response.headers);headers.delete('content-length');headers.delete('content-encoding');headers.set('content-type','application/json');
      return new Response(JSON.stringify(payload),{status:response.status,statusText:response.statusText,headers});
    };
    const result=tail.catch(()=>{}).then(work);tail=result.then(()=>{},()=>{});
    if(!options.signal)return result;
    return new Promise((resolve,reject)=>{
      const cancel=()=>reject(options.signal.reason||new DOMException('图片处理已取消','AbortError'));
      const cleanup=()=>options.signal.removeEventListener('abort',cancel);
      options.signal.addEventListener('abort',cancel,{once:true});if(options.signal.aborted)cancel();
      result.then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
    });
  }
  root.WandouWorkbenchOutput=Object.freeze({plan,processResponse,metadata});
  root.addEventListener('wandou-output-processing-warning',event=>{
    if(!document.body)return;
    let notice=document.getElementById('wd-output-processing-warning');
    if(!notice){notice=document.createElement('div');notice.id='wd-output-processing-warning';notice.setAttribute('role','alert');document.body.prepend(notice);}
    notice.textContent=event.detail;
  });
})(globalThis);
