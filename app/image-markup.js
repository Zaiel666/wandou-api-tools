(function(root){
  'use strict';
  const MAX_PIXELS=16777216,MAX_BYTES=50*1024*1024,MAX_STROKES=300,MAX_POINTS=50000;
  let active=null;
  const abort=signal=>{if(signal?.aborted)throw new DOMException('已取消圈画编辑','AbortError');};
  const fail=message=>{throw new Error(message);};
  function inspect(bytes){
    const b=bytes,v=new DataView(b.buffer,b.byteOffset,b.byteLength),ascii=(a,n)=>String.fromCharCode(...b.subarray(a,a+n));
    let width=0,height=0,type='';
    if(b.length>=33&&[137,80,78,71,13,10,26,10].every((x,i)=>b[i]===x)){
      if(v.getUint32(8)!==13||ascii(12,4)!=='IHDR')fail('PNG 文件头无效。');
      width=v.getUint32(16);height=v.getUint32(20);type='image/png';
      for(let at=8;at+12<=b.length;){const n=v.getUint32(at);if(n>b.length-at-12)fail('PNG 文件不完整。');if(ascii(at+4,4)==='acTL')fail('圈画编辑请使用静态图片。');at+=n+12;}
    }else if(b.length>=12&&b[0]===255&&b[1]===216){
      type='image/jpeg';let p=2;
      while(p+4<=b.length){if(b[p++]!==255)break;while(b[p]===255)p++;const marker=b[p++];if(marker===217||marker===218)break;if(marker===1||marker>=208&&marker<=215)continue;const n=v.getUint16(p);if(n<2||p+n>b.length)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&n>=7){height=v.getUint16(p+3);width=v.getUint16(p+5);break;}p+=n;}
    }else if(b.length>=30&&ascii(0,4)==='RIFF'&&ascii(8,4)==='WEBP'){
      type='image/webp';const tag=ascii(12,4);
      if(tag==='VP8X'){if(b[20]&2)fail('圈画编辑请使用静态图片。');width=1+b[24]+(b[25]<<8)+(b[26]<<16);height=1+b[27]+(b[28]<<8)+(b[29]<<16);}
      else if(tag==='VP8 '&&b[23]===157&&b[24]===1&&b[25]===42){width=v.getUint16(26,true)&16383;height=v.getUint16(28,true)&16383;}
      else if(tag==='VP8L'&&b[20]===47){const bits=v.getUint32(21,true);width=(bits&16383)+1;height=((bits>>>14)&16383)+1;}
    }
    if(!type||!width||!height)fail('圈画编辑仅支持完整的 PNG、JPEG 或 WebP 静态图片。');
    if(width*height>MAX_PIXELS)fail('圈画编辑的原图和标注最多为 1677 万像素，请先使用较小的图片副本。');
    return{width,height,type};
  }
  async function load(blob,signal){
    abort(signal);if(!(blob instanceof Blob))fail('图片数据无效。');
    if(!blob.size||blob.size>MAX_BYTES)fail('圈画编辑的图片文件必须大于 0 且不超过 50 MB。');
    const meta=inspect(new Uint8Array(await blob.arrayBuffer()));abort(signal);
    let bitmap;try{bitmap=await createImageBitmap(new Blob([blob],{type:meta.type}),{imageOrientation:'from-image'});}catch{abort(signal);fail('图片解码失败，请重新选择原图。');}
    try{abort(signal);if(!bitmap.width||bitmap.width*bitmap.height>MAX_PIXELS)fail('图片像素超出圈画编辑限制。');return{...meta,width:bitmap.width,height:bitmap.height,bitmap};}catch(e){bitmap.close();throw e;}
  }
  function dataUrl(blob,signal){return new Promise((resolve,reject)=>{abort(signal);const reader=new FileReader();const stop=()=>reader.abort();const done=()=>signal?.removeEventListener('abort',stop);reader.onload=()=>{done();resolve(reader.result);};reader.onerror=()=>{done();reject(new Error('标注文件读取失败。'));};reader.onabort=()=>{done();reject(new DOMException('已取消圈画编辑','AbortError'));};signal?.addEventListener('abort',stop,{once:true});reader.readAsDataURL(blob);});}
  function canvasBlob(canvas,signal){return new Promise((resolve,reject)=>{abort(signal);canvas.toBlob(blob=>{try{abort(signal);if(!blob)fail('标注文件生成失败，原图保持不变。');resolve(blob);}catch(e){reject(e);}},'image/png');});}
  function alphaStats(bitmap){
    const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
    try{const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);let transparent=false,painted=false;
      for(let y=0;y<canvas.height&&!(transparent&&painted);y+=64){const pixels=ctx.getImageData(0,y,canvas.width,Math.min(64,canvas.height-y)).data;for(let i=3;i<pixels.length;i+=4){transparent ||= pixels[i]<255;painted ||= pixels[i]>0;if(transparent&&painted)break;}}
      return{transparent,painted};
    }finally{canvas.width=canvas.height=1;}
  }
  async function prepare(originalBlob,overlayBlob,options={}){
    if(options.mask)fail('圈画标注与遮罩不能同时使用，请选择一种编辑方式。');
    let original,overlay;try{
      original=await load(originalBlob,options.signal);overlay=await load(overlayBlob,options.signal);
      if(overlay.type!=='image/png')fail('圈画标注必须是带透明区域的 PNG。');
      if(original.width!==overlay.width||original.height!==overlay.height)fail('圈画标注尺寸必须与调整方向后的原图完全一致。');
      const alpha=alphaStats(overlay.bitmap);if(!alpha.transparent)fail('圈画标注需要透明区域，请勿将标注与原图合并。');if(!alpha.painted)fail('请先在图片上画出需要修改的位置。');
      abort(options.signal);const extension={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[original.type];
      return{imageFile:new File([originalBlob],`markup-original.${extension}`,{type:original.type}),markupFile:new File([overlayBlob],'markup-overlay.png',{type:'image/png'}),width:original.width,height:original.height,hasTransparency:true,markupUrl:await dataUrl(new Blob([overlayBlob],{type:'image/png'}),options.signal)};
    }finally{original?.bitmap.close();overlay?.bitmap.close();}
  }
  async function sourceBlob(source,options,signal){
    abort(signal);let value=options.resolve?await options.resolve(source,{signal}):source;abort(signal);
    if(value instanceof Blob)return value;
    if(typeof value!=='string'||!value)fail('图片地址无效。');
    const response=await(options.fetch||root.fetch)(value,{signal,credentials:'omit'});if(!response.ok)fail('图片读取失败，请稍后重试。');return response.blob();
  }
  const icons={circle:'<circle cx="12" cy="12" r="7"/>',arrow:'<path d="M5 19 19 5M7 5h12v12"/>',pen:'<path d="m4 17 1 3 3-1L20 7l-3-3Z"/>',eraser:'<path d="m4 14 9-10 7 7-9 10H7ZM10 8l7 7M11 21h9"/>'};
  function drawStroke(ctx,s,width,height){
    if(!s.points.length)return;const xy=p=>[p.x*width,p.y*height],a=xy(s.points[0]),b=xy(s.points.at(-1));
    ctx.save();ctx.lineCap=ctx.lineJoin='round';ctx.strokeStyle=ctx.fillStyle='#e5484d';ctx.lineWidth=Math.max(.5,s.width*width);ctx.globalCompositeOperation=s.tool==='eraser'?'destination-out':'source-over';ctx.beginPath();
    if(s.tool==='circle'){ctx.ellipse((a[0]+b[0])/2,(a[1]+b[1])/2,Math.max(.5,Math.abs(b[0]-a[0])/2),Math.max(.5,Math.abs(b[1]-a[1])/2),0,0,Math.PI*2);ctx.stroke();}
    else if(s.tool==='arrow'){ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();const angle=Math.atan2(b[1]-a[1],b[0]-a[0]),len=Math.max(ctx.lineWidth*3,width*.018);ctx.beginPath();ctx.moveTo(b[0]-len*Math.cos(angle-.5),b[1]-len*Math.sin(angle-.5));ctx.lineTo(...b);ctx.lineTo(b[0]-len*Math.cos(angle+.5),b[1]-len*Math.sin(angle+.5));ctx.stroke();}
    else{ctx.moveTo(...a);for(const p of s.points.slice(1))ctx.lineTo(...xy(p));if(s.points.length===1){ctx.arc(...a,ctx.lineWidth/2,0,Math.PI*2);ctx.fill();}else ctx.stroke();}
    ctx.restore();
  }
  async function open(options={}){
    if(active)return active.promise;
    const controller=new AbortController(),signal=controller.signal;let resolvePromise,rejectPromise;
    const promise=new Promise((resolve,reject)=>{resolvePromise=resolve;rejectPromise=reject;});
    active={promise};let dialog,original,existing,initialOverlay,originalBlob,overlayCanvas,baseCanvas,observer,raf=0,done=false,applying=false,current=null;
    let tool='circle',strokes=[],history=[],totalPoints=0;const externalAbort=()=>finish(null,new DOMException('已取消圈画编辑','AbortError'));
    function finish(value,error){if(done)return;done=true;controller.abort();options.signal?.removeEventListener('abort',externalAbort);observer?.disconnect();cancelAnimationFrame(raf);original?.bitmap.close();initialOverlay?.bitmap.close();if(dialog){if(dialog.open)dialog.close();dialog.remove();}if(baseCanvas)baseCanvas.width=baseCanvas.height=1;if(overlayCanvas)overlayCanvas.width=overlayCanvas.height=1;active=null;error?rejectPromise(error):resolvePromise(value);}
    options.signal?.addEventListener('abort',externalAbort,{once:true});
    if(options.signal?.aborted){externalAbort();return promise;}
    (async()=>{
      try{
        originalBlob=await sourceBlob(options.imageUrl,options,signal);original=await load(originalBlob,signal);
        if(options.existingMarkup){const blob=await sourceBlob(options.existingMarkup,options,signal);await prepare(originalBlob,blob,{signal});existing=initialOverlay=await load(blob,signal);}
        abort(signal);dialog=document.createElement('dialog');dialog.className='image-markup-dialog';dialog.setAttribute('aria-labelledby','image-markup-title');
        dialog.innerHTML=`<form method="dialog" class="image-markup-shell"><header><div><h2 id="image-markup-title">圈画修改</h2><p>圈出、画箭头或涂画需要修改的位置，应用后再描述修改要求。</p></div><button type="button" class="image-markup-close" aria-label="关闭圈画修改">×</button></header><div class="image-markup-toolbar" role="group" aria-label="标注工具">${[['circle','画圈'],['arrow','箭头'],['pen','画笔'],['eraser','橡皮']].map(([id,label])=>`<button type="button" data-markup-tool="${id}" aria-pressed="${id==='circle'}"><svg viewBox="0 0 24 24" aria-hidden="true">${icons[id]}</svg>${label}</button>`).join('')}<label class="image-markup-width">笔触<input type="range" min="2" max="24" value="5" aria-label="标注笔触粗细"></label><button type="button" data-markup-undo disabled>撤销</button><button type="button" data-markup-reset>清空标注</button></div><div class="image-markup-stage"><div class="image-markup-surface"><canvas class="image-markup-base" aria-hidden="true"></canvas><canvas class="image-markup-overlay" aria-label="标注画布，使用画圈、箭头或画笔标记修改区域"></canvas></div></div><footer><div><p class="image-markup-meta"></p><p class="image-markup-error" role="status" aria-live="polite"></p></div><div class="image-markup-actions"><button type="button" data-markup-cancel>取消</button><button type="button" data-markup-apply class="image-markup-primary" disabled>应用标注</button></div></footer></form>`;
        baseCanvas=dialog.querySelector('.image-markup-base');overlayCanvas=dialog.querySelector('.image-markup-overlay');const stage=dialog.querySelector('.image-markup-stage'),surface=dialog.querySelector('.image-markup-surface'),error=dialog.querySelector('.image-markup-error'),apply=dialog.querySelector('[data-markup-apply]'),undo=dialog.querySelector('[data-markup-undo]');
        dialog.querySelector('.image-markup-meta').textContent=`${original.width} × ${original.height} · 原图保持不变，标注单独保存`;
        function paint(target,strokeList,base=existing?.bitmap){const ctx=target.getContext('2d');ctx.clearRect(0,0,target.width,target.height);if(base)ctx.drawImage(base,0,0,target.width,target.height);for(const stroke of strokeList)drawStroke(ctx,stroke,target.width,target.height);}
        function render(){raf=0;if(done)return;paint(overlayCanvas,current?[...strokes,current]:strokes);undo.disabled=applying||!history.length;apply.disabled=applying||(!existing&&!strokes.length);}
        function schedule(){if(!raf)raf=requestAnimationFrame(render);}
        function resize(){if(done)return;const ratio=Math.min(1,(stage.clientWidth-32)/original.width,(stage.clientHeight-32)/original.height);const w=Math.max(1,Math.floor(original.width*ratio)),h=Math.max(1,Math.floor(original.height*ratio));surface.style.width=w+'px';surface.style.height=h+'px';baseCanvas.width=overlayCanvas.width=w;baseCanvas.height=overlayCanvas.height=h;baseCanvas.getContext('2d').drawImage(original.bitmap,0,0,w,h);render();}
        function checkpoint(){history.push({strokes:strokes.slice(),existing,totalPoints});if(history.length>40)history.shift();}
        const point=event=>{const rect=overlayCanvas.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),y:Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height))};};
        overlayCanvas.addEventListener('pointerdown',event=>{if(applying||event.button!==0||current)return;if(strokes.length>=MAX_STROKES||totalPoints>=MAX_POINTS){error.textContent='标注已达到上限，请先撤销或清空部分标注。';return;}event.preventDefault();error.textContent='';overlayCanvas.setPointerCapture(event.pointerId);current={tool,width:Number(dialog.querySelector('input[type=range]').value)/overlayCanvas.width,points:[point(event)],pointerId:event.pointerId};schedule();});
        overlayCanvas.addEventListener('pointermove',event=>{if(!current||current.pointerId!==event.pointerId)return;const p=point(event);if(current.tool==='circle'||current.tool==='arrow')current.points[1]=p;else if(current.points.length+totalPoints<MAX_POINTS)current.points.push(p);schedule();});
        overlayCanvas.addEventListener('pointerup',event=>{if(!current||current.pointerId!==event.pointerId)return;checkpoint();strokes.push(current);totalPoints+=current.points.length;current=null;if(overlayCanvas.hasPointerCapture(event.pointerId))overlayCanvas.releasePointerCapture(event.pointerId);render();});
        overlayCanvas.addEventListener('pointercancel',()=>{current=null;render();});
        dialog.querySelectorAll('[data-markup-tool]').forEach(button=>button.addEventListener('click',()=>{tool=button.dataset.markupTool;dialog.querySelectorAll('[data-markup-tool]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));}));
        undo.addEventListener('click',()=>{if(!history.length||applying)return;const previous=history.pop();strokes=previous.strokes;existing=previous.existing;totalPoints=previous.totalPoints;error.textContent='';render();});
        dialog.querySelector('[data-markup-reset]').addEventListener('click',()=>{if(applying)return;checkpoint();strokes=[];existing=null;totalPoints=0;error.textContent='';render();});
        dialog.querySelector('[data-markup-cancel]').addEventListener('click',()=>finish(null));dialog.querySelector('.image-markup-close').addEventListener('click',()=>finish(null));dialog.addEventListener('cancel',event=>{event.preventDefault();finish(null);});dialog.addEventListener('close',()=>finish(null));dialog.querySelector('form').addEventListener('submit',event=>event.preventDefault());
        dialog.addEventListener('keydown',event=>{event.stopPropagation();if((event.ctrlKey||event.metaKey)&&!event.shiftKey&&String(event.key).toLowerCase()==='z'){event.preventDefault();undo.click();return;}if(event.key!=='Tab')return;const controls=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled)')],first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}});
        dialog.addEventListener('keyup',event=>event.stopPropagation());dialog.addEventListener('paste',event=>event.stopPropagation());
        apply.addEventListener('click',async()=>{if(applying)return;applying=true;error.textContent='';apply.textContent='正在保存标注…';render();let output;
          try{output=document.createElement('canvas');output.width=original.width;output.height=original.height;paint(output,strokes);const blob=await canvasBlob(output,signal);const checked=await prepare(originalBlob,blob,{signal});finish({markupUrl:checked.markupUrl,markupBlob:blob,width:checked.width,height:checked.height,hasTransparency:true});}
          catch(e){if(!done){error.textContent=e.message;applying=false;apply.textContent='应用标注';render();}}
          finally{if(output)output.width=output.height=1;}
        });
        document.body.append(dialog);dialog.showModal();observer=new ResizeObserver(resize);observer.observe(stage);resize();
      }catch(error){finish(null,error);}
    })();return promise;
  }
  root.WandouImageMarkup=Object.freeze({open,prepare,limits:Object.freeze({maxPixels:MAX_PIXELS,maxBytes:MAX_BYTES})});
})(globalThis);
