(function (global) {
  'use strict';
  // Display copies only. Node URLs, downloads, exports and editing retain originals.
  const records = new WeakMap(), cache = new Map(), pending = new Map();
  let worker, workerUrl, nextId = 0, observer;
  const workerCode = `
    async function preserveAnimation(blob) {
      const header = new Uint8Array(await blob.slice(0,32).arrayBuffer());
      const text = (bytes, start, length) => String.fromCharCode(...bytes.slice(start,start+length));
      if (text(header,0,3)==='GIF') return true;
      if (text(header,0,4)==='RIFF' && text(header,8,8)==='WEBPVP8X') return !!(header[20]&2);
      // APNG declares animation before the first image-data chunk. Skip payloads
      // without copying a large PNG into another buffer just to inspect headers.
      if (header[0]===137 && text(header,1,3)==='PNG') {
        let offset=8;
        while(offset+12<=blob.size) {
          const chunk=new Uint8Array(await blob.slice(offset,offset+8).arrayBuffer());
          const kind=text(chunk,4,4);
          if(kind==='acTL') return true;
          if(kind==='IDAT' || kind==='IEND') break;
          offset+=new DataView(chunk.buffer).getUint32(0)+12;
        }
      }
      return false;
    }
    self.onmessage = async ({data:{id,source}}) => {
      let bitmap;
      try {
        const response = await fetch(source);
        if (!response.ok) throw Error('HTTP '+response.status);
        const blob = await response.blob();
        bitmap = await createImageBitmap(blob);
        const width=bitmap.width, height=bitmap.height;
        // Bound both edge length and decoded area, especially for tall detail sheets.
        const scale=Math.min(1,1536/Math.max(width,height),Math.sqrt(786432/(width*height)));
        if(scale===1 || await preserveAnimation(blob)) { self.postMessage({id,blob,width,height}); return; }
        const surface=new OffscreenCanvas(Math.max(1,Math.round(width*scale)),Math.max(1,Math.round(height*scale)));
        surface.getContext('2d').drawImage(bitmap,0,0,surface.width,surface.height);
        const preview=await surface.convertToBlob({type:'image/webp',quality:.88});
        self.postMessage({id,blob:preview,width,height});
      } catch(error) { self.postMessage({id,error:String(error)}); }
      finally { bitmap?.close(); }
    };`;
  function getWorker() {
    if (worker) return worker;
    workerUrl = URL.createObjectURL(new Blob([workerCode], {type:'text/javascript'}));
    worker = new Worker(workerUrl);
    worker.onmessage = ({data}) => {
      const task=pending.get(data.id);if(!task)return;
      pending.delete(data.id);clearTimeout(task.timer);
      task.resolve(data.blob ? {blob:data.blob,width:data.width,height:data.height} : null);
    };
    worker.onerror = () => {
      for (const task of pending.values()) { clearTimeout(task.timer);task.resolve(null); }
      pending.clear();worker.terminate();worker=null;URL.revokeObjectURL(workerUrl);
    };
    return worker;
  }
  let queue = Promise.resolve();
  function preview(source) {
    if (cache.has(source)) { const task=cache.get(source);cache.delete(source);cache.set(source,task);return task; }
    // One decode at a time on a worker; never burst-decode an entire canvas.
    const task=queue.catch(()=>{}).then(()=>new Promise(resolve=>{
      try {
        const decoder=getWorker(),id=++nextId;
        const timer=setTimeout(()=>{pending.delete(id);resolve(null);decoder.terminate();if(worker===decoder)worker=null;URL.revokeObjectURL(workerUrl);},10000);
        pending.set(id,{resolve,timer});decoder.postMessage({id,source});
      } catch (_) { resolve(null); }
    }));
    queue=task;cache.set(source,task);
    while(cache.size>64)cache.delete(cache.keys().next().value);
    return task;
  }
  function interacting() {
    return document.querySelector('.canvas-wrap:is(.is-panning,.is-zooming)') || document.body.classList.contains('desktop-tab-inactive');
  }
  function assign(image,record,result) {
    if(records.get(image)!==record || !image.isConnected || !record.active)return;
    if(interacting()){record.timer=setTimeout(()=>assign(image,record,result),180);return;}
    record.width=result?.width;record.height=result?.height;
    if(record.objectUrl)URL.revokeObjectURL(record.objectUrl);
    record.objectUrl=result?.blob ? URL.createObjectURL(result.blob) : null;
    image.src=record.objectUrl || record.source;
  }
  function activate(image,record) {
    if(!record.source || !record.active)return;
    if(record.finished){if(!image.hasAttribute('src'))assign(image,record,record.result);return;}
    if(record.started)return;
    if(interacting()){record.timer=setTimeout(()=>activate(image,record),180);return;}
    record.started=true;
    preview(record.source).then(result=>{record.finished=true;record.result=result;assign(image,record,result);});
  }
  function setSource(image,source) {
    if(image.tagName!=='IMG') {if(source)image.src=source;else image.removeAttribute('src');return;}
    const previous=records.get(image);
    if(previous?.source===source){previous.active=true;activate(image,previous);return;}
    if(previous){clearTimeout(previous.timer);if(previous.objectUrl)URL.revokeObjectURL(previous.objectUrl);}
    image.removeAttribute('src');
    const record={source,active:true,started:false};records.set(image,record);
    if(source)activate(image,record);
  }
  function prepare(root) {
    if(!observer && typeof IntersectionObserver==='function')observer=new IntersectionObserver(entries=>{
      for(const entry of entries){const record=records.get(entry.target);if(!record)continue;
        record.active=entry.isIntersecting;if(record.active)activate(entry.target,record);
      }
    },{root:document.querySelector('.canvas-wrap'),rootMargin:'300px'});
    for(const image of root.querySelectorAll('.preview img:not(.ui-icon), .thumb img:not(.ui-icon)')){
      const source=image.getAttribute('src');
      if(!source || !/^(data:image|blob:|https?:)/i.test(source))continue;
      image.removeAttribute('src');image.decoding='async';
      const record={source,active:!observer,started:false};records.set(image,record);
      if(observer)observer.observe(image);else queueMicrotask(()=>activate(image,record));
    }
  }
  function release(root) {
    for(const image of root.querySelectorAll('img')){observer?.unobserve(image);const record=records.get(image);if(record){clearTimeout(record.timer);if(record.objectUrl)URL.revokeObjectURL(record.objectUrl);}records.delete(image);}
  }
  global.WandouCanvasPreview={prepare,setSource,release,dimensions:image=>records.get(image)};
})(window);
