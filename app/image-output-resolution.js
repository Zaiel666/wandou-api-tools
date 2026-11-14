(function(root){
  "use strict";
  let tail=Promise.resolve();
  function aborted(signal){if(signal?.aborted)throw signal.reason||new DOMException("图片处理已取消","AbortError");}
  function workerMain(){
    async function preservedAnimationSize(blob){
      // Inspect bounded headers without copying a large original or decoding its
      // first frame. Animated containers must never be flattened by local output
      // sizing. Static GIFs are conservatively preserved as well.
      const header=new Uint8Array(await blob.slice(0,32).arrayBuffer());
      const text=(bytes,offset,length)=>String.fromCharCode(...bytes.slice(offset,offset+length));
      if(header.length>=10 && /^GIF8[79]a$/.test(text(header,0,6)))return {width:header[6]+header[7]*256,height:header[8]+header[9]*256};
      if(header.length>=30 && text(header,0,4)==='RIFF' && text(header,8,8)==='WEBPVP8X' && (header[20]&2))return {width:1+header[24]+header[25]*256+header[26]*65536,height:1+header[27]+header[28]*256+header[29]*65536};
      if(header.length>=24 && header[0]===137 && text(header,1,3)==='PNG' && text(header,12,4)==='IHDR'){
        const view=new DataView(header.buffer),size={width:view.getUint32(16),height:view.getUint32(20)};
        let offset=8,chunks=0;
        while(offset+12<=blob.size && chunks++<256){
          const bytes=new Uint8Array(await blob.slice(offset,offset+8).arrayBuffer()),kind=text(bytes,4,4);
          if(kind==='acTL')return size;
          if(kind==='IDAT'||kind==='IEND')return null;
          offset+=new DataView(bytes.buffer).getUint32(0)+12;
        }
        // Unusually complex headers are not evidence that a PNG is static.
        if(chunks>=256)return size;
      }
      return null;
    }
    self.onmessage=async({data})=>{
      let bitmap;
      try{
        const animation=await preservedAnimationSize(data.blob);
        if(animation?.width>0 && animation?.height>0){self.postMessage({...animation,originalWidth:animation.width,originalHeight:animation.height,processing:'original-animation-preserved'});return;}
        bitmap=await createImageBitmap(data.blob);
        const originalWidth=bitmap.width,originalHeight=bitmap.height;
        const edge=Math.max(1,Math.min(8192,Number(data.targetEdge)||1));
        if(Math.max(originalWidth,originalHeight)>=edge){self.postMessage({width:originalWidth,height:originalHeight,originalWidth,originalHeight,processing:"native"});return;}
        const scale=edge/Math.max(originalWidth,originalHeight);
        const width=Math.max(1,Math.round(originalWidth*scale)),height=Math.max(1,Math.round(originalHeight*scale));
        const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext("2d");
        ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";
        ctx.drawImage(bitmap,0,0,width,height);
        const blob=await canvas.convertToBlob({type:"image/png"});
        self.postMessage({blob,width,height,originalWidth,originalHeight,processing:"local-upscale"});
      }catch(error){self.postMessage({error:String(error?.message||error)});}
      finally{bitmap?.close();}
    };
  }
  const workerSource=`(${workerMain.toString()})();`;
  function blobAsDataUrl(blob,signal){return new Promise((resolve,reject)=>{
    const reader=new FileReader();let done=false;
    const finish=(error,value)=>{if(done)return;done=true;signal?.removeEventListener("abort",cancel);reader.onload=reader.onerror=reader.onabort=null;error?reject(error):resolve(value);};
    const cancel=()=>{reader.abort();finish(signal.reason||new DOMException("图片处理已取消","AbortError"));};
    reader.onload=()=>finish(null,String(reader.result));reader.onerror=()=>finish(reader.error||new Error("无法读取处理后的图片"));
    signal?.addEventListener("abort",cancel,{once:true});if(signal?.aborted){cancel();return;}reader.readAsDataURL(blob);
  });}
  function transform(blob,targetEdge,signal){return new Promise((resolve,reject)=>{
    aborted(signal);let worker,url,done=false;
    const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener("abort",cancel);worker?.terminate();if(url)URL.revokeObjectURL(url);error?reject(error):resolve(value);};
    const cancel=()=>finish(signal.reason||new DOMException("图片处理已取消","AbortError"));
    const timer=setTimeout(()=>finish(new Error("图片尺寸处理超时；原图已保留，请重试。")),45000);
    try {
      url=URL.createObjectURL(new Blob([workerSource],{type:"text/javascript"}));worker=new Worker(url);
      worker.onmessage=({data})=>data.error?finish(new Error(data.error)):finish(null,data);
      worker.onerror=()=>finish(new Error("图片处理线程无法启动；原图已保留。"));
      signal?.addEventListener("abort",cancel,{once:true});aborted(signal);worker.postMessage({blob,targetEdge});
    }catch(error){finish(error);}
  });}
  async function runBlob({blob,url="",targetSize="1024x1024",signal}) {
    aborted(signal);
    const targetEdge=Math.max(...String(targetSize).split(/[x×]/i).map(Number).filter(Number.isFinite),1);
    const result=await transform(blob,targetEdge,signal);aborted(signal);
    const outputUrl=result.blob?await blobAsDataUrl(result.blob,signal):url||await blobAsDataUrl(blob,signal);aborted(signal);
    return {...result,blob:result.blob||blob,url:outputUrl,sourceUrl:url,nonNative:result.processing==="local-upscale",targetLongEdge:targetEdge};
  }
  function enqueue(work,signal){
    const result=tail.catch(()=>{}).then(()=>{aborted(signal);const run=work;work=null;return run();});
    // Cancellation settles this caller immediately, but never advances the
    // serial queue past an unrelated active fetch/worker. Queued cancelled work
    // is skipped when its turn arrives, without fetching another original.
    tail=result.then(()=>{},()=>{});
    if(!signal)return result;
    return new Promise((resolve,reject)=>{
      let done=false;
      const finish=(error,value)=>{if(done)return;done=true;signal.removeEventListener("abort",cancel);error?reject(error):resolve(value);};
      const cancel=()=>{work=null;finish(signal.reason||new DOMException("图片处理已取消","AbortError"));};
      signal.addEventListener("abort",cancel,{once:true});
      result.then(value=>finish(null,value),error=>finish(error));
      if(signal.aborted)cancel();
    });
  }
  function processBlob(options){return enqueue(()=>runBlob(options),options.signal);}
  function process(options){return enqueue(async()=>{
    const {url,targetSize,signal,fetchBlob,fetch:fetcher}=options;aborted(signal);
    const blob=fetchBlob?await fetchBlob(url,signal):await (fetcher||root.fetch.bind(root))(url,{signal}).then(response=>{if(!response.ok)throw new Error("无法读取生成原图");return response.blob();});
    return runBlob({blob,url,targetSize,signal});
  },options.signal);}
  root.WandouImageOutput=Object.freeze({process,processBlob});
})(globalThis);
