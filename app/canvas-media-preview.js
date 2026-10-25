(function (global) {
  'use strict';
  // Display copies only. Node URLs, downloads, exports and editing retain originals.
  const records = new WeakMap(), cache = new Map(), pending = new Map(), inflight = new Map();
  const CACHE_BUDGET = 24 * 1024 * 1024;
  const CACHE_ENTRY_LIMIT = 1024;
  let cacheBytes = 0, queuedDecodes = 0, completedDecodes = 0;
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
    self.onmessage = async ({data:{id,source,blob}}) => {
      let bitmap;
      try {
        if (!blob) {
          const response = await fetch(source);
          if (!response.ok) throw Error('HTTP '+response.status);
          blob = await response.blob();
        }
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
  function imageHeaderSize(bytes) {
    const length=bytes.length;
    const word=(offset,count)=>String.fromCharCode(...bytes.subarray(offset,offset+count));
    const u16=offset=>bytes[offset]+bytes[offset+1]*256;
    const u24=offset=>bytes[offset]+bytes[offset+1]*256+bytes[offset+2]*65536;
    if(length>=24 && bytes[0]===137 && word(1,3)==='PNG' && word(12,4)==='IHDR') {
      const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
      return {width:view.getUint32(16),height:view.getUint32(20)};
    }
    if(length>=10 && (word(0,6)==='GIF87a' || word(0,6)==='GIF89a'))return {width:u16(6),height:u16(8)};
    if(length>=30 && word(0,4)==='RIFF' && word(8,4)==='WEBP') {
      const kind=word(12,4);
      if(kind==='VP8X')return {width:1+u24(24),height:1+u24(27)};
      if(kind==='VP8 ' && bytes[23]===157 && bytes[24]===1 && bytes[25]===42)return {width:u16(26)&16383,height:u16(28)&16383};
      if(kind==='VP8L' && bytes[20]===47) {
        const bits=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(21,true);
        return {width:(bits&16383)+1,height:((bits>>>14)&16383)+1};
      }
    }
    if(length>=4 && bytes[0]===255 && bytes[1]===216) {
      let offset=2;
      while(offset+4<=length) {
        if(bytes[offset++]!==255)break;
        while(offset<length && bytes[offset]===255)offset++;
        const marker=bytes[offset++];
        if(marker===217 || marker===218)break;
        if(marker===1 || (marker>=208 && marker<=216))continue;
        if(offset+2>length)break;
        const size=bytes[offset]*256+bytes[offset+1];
        if(size<2 || offset+size>length)break;
        if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && size>=7)
          return {width:bytes[offset+5]*256+bytes[offset+6],height:bytes[offset+3]*256+bytes[offset+4]};
        offset+=size;
      }
    }
    return null;
  }
  function boundedSize(size) {
    return size?.width>0 && size?.height>0 && Math.max(size.width,size.height)<=1536 && size.width*size.height<=786432;
  }
  function inlineImageSize(source) {
    if(!/^data:image\//i.test(source))return null;
    const comma=source.indexOf(',');
    if(comma<0 || !/;base64$/i.test(source.slice(0,comma)))return null;
    try {
      // Headers only: never decode an original's entire base64 string on the UI thread.
      const encoded=source.slice(comma+1,comma+1+32768);
      const header=atob(encoded.slice(0,encoded.length-encoded.length%4));
      return imageHeaderSize(Uint8Array.from(header,char=>char.charCodeAt(0)));
    } catch (_) { return null; }
  }
  async function sourceCacheKey(source) {
    if(source.startsWith('data:') && global.crypto?.subtle) {
      try {
        const bytes=await global.crypto.subtle.digest('SHA-256',new TextEncoder().encode(source));
        return 'data-sha256:'+Array.from(new Uint8Array(bytes),value=>value.toString(16).padStart(2,'0')).join('');
      } catch (_) { /* Keep the full-key accounting fallback in restricted contexts. */ }
    }
    return source;
  }
  async function download(source, entry) {
    const controller = new AbortController();
    entry.controller = controller;
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(source, {signal:controller.signal});
      if (!response.ok) return null;
      return await response.blob();
    } catch (_) { return null; }
    finally { clearTimeout(timer); entry.controller = null; }
  }
  function dropCached(key) {
    const entry=cache.get(key);
    if(entry){cacheBytes-=entry.bytes;cache.delete(key);}
  }
  function cacheResult(key,result) {
    if(!result?.blob)return;
    // Digest keys avoid retaining original base64 images. Keep byte and entry
    // bounds, including bookkeeping, without evicting at only 64 thumbnails.
    const bytes=key.length*2+result.blob.size+256;
    if(bytes>CACHE_BUDGET)return;
    dropCached(key);cache.set(key,{result,bytes});cacheBytes+=bytes;
    while(cache.size>CACHE_ENTRY_LIMIT || cacheBytes>CACHE_BUDGET)dropCached(cache.keys().next().value);
  }
  function hasConsumers(entry) {
    return !entry.cancelled && [...entry.consumers].some(record=>record.active && record.source===entry.source && record.image.isConnected);
  }
  function detachRequest(record) {
    const entry=record.request;
    record.request=null;
    if(!entry)return;
    entry.consumers.delete(record);
    if(!entry.settled && !hasConsumers(entry)){
      entry.cancelled=true;entry.controller?.abort();
      if(inflight.get(entry.source)===entry)inflight.delete(entry.source);
    }
  }
  function preview(source,record) {
    const inlineSize=inlineImageSize(source);
    // A verified small preview can be decoded by its img immediately, without
    // waiting behind large references. Its original bytes and animation remain intact.
    if(boundedSize(inlineSize))return Promise.resolve({...inlineSize,passthrough:true});
    const existing=inflight.get(source);
    if(existing && !existing.cancelled){existing.consumers.add(record);record.request=existing;return existing.task;}
    const entry={source,consumers:new Set([record]),cancelled:false,settled:false};
    record.request=entry;inflight.set(source,entry);
    // Download outside the decode queue: a slow remote image must not hold up
    // already available local results. Decoding still runs one image at a time.
    const remote = /^(https?:|wandou-media:)/i.test(source);
    const task=sourceCacheKey(source).then(async key=>{
      entry.cacheKey=key;
      if(!hasConsumers(entry))return null;
      const cached=cache.get(key);
      if(cached){cache.delete(key);cache.set(key,cached);return cached.result;}
      const blob=remote ? await download(source,entry) : null;
      if (!hasConsumers(entry) || (remote && !blob)) return null; // Native img may still load a non-CORS URL.
      if(blob) {
        const size=imageHeaderSize(new Uint8Array(await blob.slice(0,24576).arrayBuffer()));
        if(!hasConsumers(entry))return null;
        if(boundedSize(size))return {...size,blob};
      }
      queuedDecodes++;
      const decoded=queue.catch(()=>{}).then(()=>{
        queuedDecodes--;
        // A fast pan can enqueue many thumbnails then leave them off-screen.
        // Skip those jobs before allocating an original-size bitmap.
        if(!hasConsumers(entry))return null;
        return new Promise(resolve=>{
        try {
          const decoder=getWorker(),id=++nextId;
          const timer=setTimeout(()=>{pending.delete(id);resolve(null);decoder.terminate();if(worker===decoder)worker=null;URL.revokeObjectURL(workerUrl);},10000);
          pending.set(id,{resolve,timer});decoder.postMessage({id,source,blob});
          completedDecodes++;
        } catch (_) { resolve(null); }
        });
      });
      queue=decoded;return decoded;
    }).then(result=>{
      if(!entry.noCache && hasConsumers(entry))cacheResult(entry.cacheKey,result);
      return result;
    }).catch(()=>null).finally(()=>{
      entry.settled=true;
      if(inflight.get(source)===entry)inflight.delete(source);
      for(const consumer of entry.consumers)if(consumer.request===entry)consumer.request=null;
      entry.consumers.clear();
    });
    entry.task=task;
    return task;
  }
  function interacting() {
    return document.querySelector('.canvas-wrap:is(.is-panning,.is-zooming)') || document.body.classList.contains('desktop-tab-inactive');
  }
  function clearRecord(image,record) {
    record.active=false;record.generation=(record.generation||0)+1;detachRequest(record);
    clearTimeout(record.timer);clearTimeout(record.loadTimer);
    image.removeEventListener('load',record.onLoad);
    image.removeEventListener('error',record.onError);
    record.retry?.remove();
    if(record.objectUrl)URL.revokeObjectURL(record.objectUrl);
    record.objectUrl=null;record.result=null;
  }
  function suspend(image,record) {
    record.active=false;record.generation=(record.generation||0)+1;detachRequest(record);
    clearTimeout(record.timer);clearTimeout(record.loadTimer);
    record.retry?.remove();record.retry=null;
    if(record.objectUrl)URL.revokeObjectURL(record.objectUrl);
    record.objectUrl=null;record.result=null;record.started=false;record.finished=false;
    image.removeAttribute('src');
  }
  function showRetry(image,record) {
    if(record.retry || !image.isConnected)return;
    if(!document.getElementById('canvas-media-retry-style')){
      const style=document.createElement('style');style.id='canvas-media-retry-style';
      style.textContent='.preview:has(> .canvas-media-retry),.thumb:has(> .canvas-media-retry){position:relative}.canvas-media-retry{position:absolute;inset:0;z-index:6;width:100%;height:100%;min-height:60px;border:0;border-radius:inherit;background:rgba(28,28,28,.94);color:#ddd;font:inherit;font-size:13px;line-height:1.6;cursor:pointer;white-space:pre-line;padding:12px}.canvas-media-retry:hover{background:#333}.canvas-media-retry:focus-visible{outline:2px solid #c5ed79;outline-offset:-3px}';
      document.head.append(style);
    }
    const button=document.createElement('button');button.type='button';button.className='canvas-media-retry';
    button.textContent='图片未能加载\n点击重试';button.title='重新加载图片，不会重新生成或扣费';
    button.addEventListener('pointerdown',event=>event.stopPropagation());
    button.addEventListener('dblclick',event=>event.stopPropagation());
    button.addEventListener('click',async event=>{
      event.preventDefault();event.stopPropagation();
      if(records.get(image)!==record)return;
      await Promise.all(record.sources.map(async source=>dropCached(await sourceCacheKey(source))));
      if(records.get(image)!==record || !image.isConnected)return;
      button.remove();record.retry=null;record.index=0;record.source=record.sources[0];
      record.failed=false;record.started=false;record.finished=false;activate(image,record);
    });
    record.retry=button;image.after(button);
  }
  function makeRecord(image,sources,active) {
    const record={image,sources,index:0,source:sources[0]||'',active,started:false,generation:0};
    record.onLoad=()=>{
      if(records.get(image)!==record)return;
      clearTimeout(record.loadTimer);record.retry?.remove();record.retry=null;
    };
    record.onError=()=>{
      if(records.get(image)!==record || !record.active || record.failed || !record.source)return;
      record.generation++;detachRequest(record);
      clearTimeout(record.loadTimer);clearTimeout(record.timer);
      if(record.objectUrl){URL.revokeObjectURL(record.objectUrl);record.objectUrl=null;}
      image.removeAttribute('src');record.started=false;record.finished=false;
      record.width=record.height=undefined;
      if(++record.index<record.sources.length){record.source=record.sources[record.index];activate(image,record);}
      else {record.failed=true;showRetry(image,record);}
    };
    image.addEventListener('load',record.onLoad);image.addEventListener('error',record.onError);
    records.set(image,record);return record;
  }
  function assign(image,record,result) {
    if(records.get(image)!==record || !image.isConnected || !record.active)return;
    if(interacting()){record.timer=setTimeout(()=>assign(image,record,result),180);return;}
    record.width=result?.width;record.height=result?.height;
    if(record.objectUrl)URL.revokeObjectURL(record.objectUrl);
    record.objectUrl=result?.blob ? URL.createObjectURL(result.blob) : null;
    // Visibility is already managed by our observer; native lazy loading can
    // otherwise leave a freshly replaced result waiting indefinitely.
    image.loading='eager';image.decoding='async';
    clearTimeout(record.loadTimer);record.loadTimer=setTimeout(record.onError,12000);
    image.src=record.objectUrl || record.source;
  }
  function activate(image,record) {
    if(records.get(image)!==record || !record.source || !record.active || record.failed)return;
    if(record.finished){if(!image.hasAttribute('src'))assign(image,record,record.result);return;}
    if(record.started)return;
    if(interacting()){record.timer=setTimeout(()=>activate(image,record),180);return;}
    record.started=true;
    const source=record.source,generation=record.generation;
    preview(source,record).then(result=>{
      if(records.get(image)!==record || record.source!==source || record.generation!==generation || !record.active)return;
      record.finished=true;record.result=result;assign(image,record,result);
    });
  }
  function setSource(image,source,fallbacks=[]) {
    if(image.tagName!=='IMG') {if(source)image.src=source;else image.removeAttribute('src');return;}
    const sources=source ? [...new Set([source,...fallbacks].filter(value=>typeof value==='string' && value))] : [];
    const previous=records.get(image);
    if(previous && previous.sources.length===sources.length && sources.every((value,index)=>value===previous.sources[index])){previous.active=true;activate(image,previous);return;}
    if(previous)clearRecord(image,previous);
    image.removeAttribute('src');
    const record=makeRecord(image,sources,true);
    if(source)activate(image,record);
  }
  function prepare(root) {
    if(!observer && typeof IntersectionObserver==='function')observer=new IntersectionObserver(entries=>{
      for(const entry of entries){const record=records.get(entry.target);if(!record)continue;
        if(entry.isIntersecting){record.active=true;if(record.failed)showRetry(entry.target,record);else activate(entry.target,record);}
        else suspend(entry.target,record);
      }
    },{root:document.querySelector('.canvas-wrap'),rootMargin:'300px'});
    for(const image of root.querySelectorAll('.preview img:not(.ui-icon), .thumb img:not(.ui-icon)')){
      const source=image.getAttribute('src');
      if(!source || !/^(data:image|blob:|https?:|wandou-media:)/i.test(source))continue;
      image.removeAttribute('src');image.decoding='async';
      const previous=records.get(image);if(previous)clearRecord(image,previous);
      const record=makeRecord(image,[source],!observer);
      if(observer)observer.observe(image);else queueMicrotask(()=>activate(image,record));
    }
  }
  function release(root) {
    for(const image of root.querySelectorAll('img')){observer?.unobserve(image);const record=records.get(image);if(record)clearRecord(image,record);records.delete(image);}
  }
  function releaseSource(source) {
    const entry=inflight.get(source);
    if(entry)entry.noCache=true;
    if(entry && !hasConsumers(entry)){entry.cancelled=true;entry.controller?.abort();inflight.delete(source);}
    sourceCacheKey(source).then(dropCached).catch(()=>{});
  }
  global.WandouCanvasPreview={prepare,setSource,release,releaseSource,dimensions:image=>records.get(image),stats:()=>({cacheEntries:cache.size,cacheBytes,cacheBudget:CACHE_BUDGET,cacheEntryLimit:CACHE_ENTRY_LIMIT,inflight:inflight.size,queuedDecodes,completedDecodes})};
})(window);
