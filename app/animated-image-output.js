(function (root) {
  'use strict';
  const MIME = 'image/gif';
  const LIMITS = Object.freeze({bytes:32 * 1024 * 1024, edge:4096, pixels:16777216, totalPixels:67108864, frames:16, assetFrames:256});
  function fail(reason) { throw Error('GIF 文件无法使用：' + reason); }
  function aborted(signal) { if (signal?.aborted) throw new DOMException('已取消动图处理', 'AbortError'); }
  // Validate the compressed stream as well as block boundaries. A corrupt later
  // frame must not be accepted just because the browser can decode frame one.
  function checkLzw(data, minimum, pixels, colors, signal) {
    const clear=1 << minimum, end=clear+1, lengths=new Uint32Array(4096);
    for(let i=0;i<clear;i++) lengths[i]=1;
    let bit=0, size=minimum+1, next=end+1, previous=-1, count=0, codes=0, ended=false;
    function code() {
      if(bit+size>data.length*8) fail('图像压缩数据不完整');
      let value=0;
      for(let i=0;i<size;i++) value|=((data[(bit+i)>>3]>>((bit+i)&7))&1)<<i;
      bit+=size; return value;
    }
    if(code()!==clear) fail('图像压缩数据缺少起始标记');
    while(bit+size<=data.length*8) {
      if((codes++ & 16383)===0) aborted(signal);
      if(codes>pixels*4+4096)fail('图像压缩指令过多');
      const current=code();
      if(current===clear) {size=minimum+1;next=end+1;previous=-1;continue;}
      if(current===end) {ended=true;break;}
      let length;
      if(current<clear) {if(current>=colors) fail('图像颜色索引无效');length=1;}
      else if(current<next) length=lengths[current];
      else if(current===next&&previous>=0) length=lengths[previous]+1;
      else fail('图像压缩字典无效');
      if(!length||(count+=length)>pixels) fail('帧像素数量无效');
      if(previous>=0&&next<4096) {
        lengths[next++]=lengths[previous]+1;
        if(next===(1<<size)&&size<12) size++;
      }
      previous=current;
    }
    if(!ended||count!==pixels) fail('帧像素数量不完整');
  }
  function validate(input, options={}) {
    const bytes=input instanceof Uint8Array?input:input instanceof ArrayBuffer?new Uint8Array(input):null;
    if(!bytes||bytes.length<14||bytes.length>LIMITS.bytes) fail('文件为空、过短或超过 32 MiB');
    aborted(options.signal);
    const word=offset=>bytes[offset]|bytes[offset+1]<<8;
    const signature=String.fromCharCode(...bytes.subarray(0,6));
    if(!/^GIF8[79]a$/.test(signature)) fail('返回内容不是 GIF 原件');
    const width=word(6),height=word(8),globalColors=(bytes[10]&128)?1<<((bytes[10]&7)+1):0;
    if(!width||!height||width>LIMITS.edge||height>LIMITS.edge||width*height>LIMITS.pixels) fail('画布尺寸超出限制');
    let position=13,frameCount=0,totalPixels=0,loopCount=null,hasTransparency=false,pending=null,trailer=false;
    const frameDurationsMs=[];
    function take(length) {if(position+length>bytes.length)fail('文件块不完整');const value=bytes.subarray(position,position+length);position+=length;return value;}
    function blocks(collect=false) {
      const chunks=[];let total=0;
      while(true){const size=take(1)[0];if(!size)break;const chunk=take(size);if(collect)chunks.push(chunk);total+=size;}
      if(!collect)return null;
      const joined=new Uint8Array(total);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.length;}return joined;
    }
    take(globalColors*3);
    while(position<bytes.length) {
      aborted(options.signal);
      const marker=take(1)[0];
      if(marker===0x3b){trailer=true;break;}
      if(marker===0x21) {
        const label=take(1)[0];
        if(label===0xf9) {
          if(take(1)[0]!==4)fail('帧控制块无效');
          const control=take(4);if(take(1)[0]!==0||(control[0]&224)||((control[0]>>2)&7)>3)fail('帧控制块无效');
          pending={delay:(control[1]|control[2]<<8)*10,transparent:Boolean(control[0]&1),color:control[3]};
        } else if(label===0xff) {
          if(take(1)[0]!==11)fail('应用扩展块无效');
          const application=String.fromCharCode(...take(11)),data=blocks(true);
          if(application==='NETSCAPE2.0'||application==='ANIMEXTS1.0'){
            if(data.length!==3||data[0]!==1)fail('循环信息无效');loopCount=data[1]|data[2]<<8;
          }
        } else if(label===0xfe) blocks();
        else fail('包含不支持的 GIF 扩展块');
        continue;
      }
      if(marker!==0x2c) fail('文件块类型无效');
      if(++frameCount>(options.allowStatic?LIMITS.assetFrames:LIMITS.frames))fail(options.allowStatic?'资产预览最多支持 256 帧动图':'最多支持 16 帧动图');
      const descriptor=take(9),x=descriptor[0]|descriptor[1]<<8,y=descriptor[2]|descriptor[3]<<8;
      const w=descriptor[4]|descriptor[5]<<8,h=descriptor[6]|descriptor[7]<<8,packed=descriptor[8];
      if(!w||!h||x+w>width||y+h>height||(packed&24))fail('帧尺寸或位置无效');
      totalPixels+=w*h;if(totalPixels>LIMITS.totalPixels)fail('累计帧像素超出限制');
      const localColors=(packed&128)?1<<((packed&7)+1):0,colors=localColors||globalColors;
      if(!colors)fail('缺少调色板');take(localColors*3);
      if(pending?.transparent&&pending.color>=colors)fail('透明色索引无效');
      const minimum=take(1)[0];if(minimum<2||minimum>8)fail('图像压缩格式无效');
      checkLzw(blocks(true),minimum,w*h,colors,options.signal);
      frameDurationsMs.push(pending?.delay||0);hasTransparency||=Boolean(pending?.transparent);pending=null;
    }
    if(!trailer||position!==bytes.length)fail('文件结尾不完整或含额外数据');
    if(frameCount<(options.allowStatic?1:2))fail('生成动图应包含 2 至 16 个实际图像帧');
    return {width,height,frameCount,frameDurationsMs,durationMs:frameDurationsMs.reduce((a,b)=>a+b,0),loopCount,hasTransparency,format:'gif',mimeType:MIME,byteLength:bytes.length};
  }
  async function read(input,signal) {
    aborted(signal);
    let bytes;
    if(input instanceof Blob){if(input.size>LIMITS.bytes)fail('文件超过 32 MiB');bytes=new Uint8Array(await input.arrayBuffer());}
    else if(input instanceof Uint8Array){if(input.byteLength>LIMITS.bytes)fail('文件超过 32 MiB');bytes=input.slice();}
    else if(input instanceof ArrayBuffer){if(input.byteLength>LIMITS.bytes)fail('文件超过 32 MiB');bytes=new Uint8Array(input.slice(0));}
    else if(typeof input==='string') {
      const match=/^data:image\/gif(?:;[^,;]*)?;base64,([A-Za-z0-9+/]*={0,2})$/i.exec(input);
      if(!match||match[1].length>Math.ceil(LIMITS.bytes/3)*4)fail('动图数据地址无效或过大');
      const raw=atob(match[1]);bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
    } else fail('不支持此文件数据');
    aborted(signal);return bytes;
  }
  function dataUrl(bytes){let raw='';for(let i=0;i<bytes.length;i+=16384)raw+=String.fromCharCode(...bytes.subarray(i,i+16384));return 'data:'+MIME+';base64,'+btoa(raw);}
  async function preview(blob,metadata,edge,signal) {
    let bitmap,canvas;
    try {
      aborted(signal);bitmap=await createImageBitmap(blob);aborted(signal);
      if(bitmap.width!==metadata.width||bitmap.height!==metadata.height)fail('图像解码尺寸不一致');
      const scale=Math.min(1,edge/Math.max(bitmap.width,bitmap.height));
      canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      const context=canvas.getContext('2d');if(!context)throw Error('无法创建动图预览');
      context.drawImage(bitmap,0,0,canvas.width,canvas.height);aborted(signal);
      const result=canvas.toDataURL('image/png');if(!result.startsWith('data:image/png;'))throw Error('无法创建静态预览');return result;
    } finally {bitmap?.close();if(canvas){canvas.width=1;canvas.height=1;}}
  }
  async function prepare(input,options={}) {
    const bytes=await read(input,options.signal),metadata=validate(bytes,options),blob=new Blob([bytes],{type:MIME});
    let previewUrl='',previewFallback=false;
    if(options.preview!==false) {
      try {previewUrl=await preview(blob,metadata,Math.max(1,Math.min(2048,Number(options.previewMaxEdge)||640)),options.signal);}
      catch(error){if(error?.name==='AbortError')throw error;previewFallback=true;}
    }
    aborted(options.signal);
    return {...metadata,blob,dataUrl:dataUrl(bytes),previewUrl,previewFallback};
  }
  root.WandouAnimatedImage=Object.freeze({prepare,validate,LIMITS});
})(typeof window!=='undefined'?window:globalThis);
