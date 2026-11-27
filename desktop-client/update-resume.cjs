'use strict';
// The caller must supply the verified SHA-256 before this operation.
const fs=require('node:fs/promises'),nativeFs=require('node:fs'),crypto=require('node:crypto');
const DEFAULT_TOTAL_MS=2*60*60*1000;
class TransferError extends Error { constructor(message){super(message);this.name='TransferError';} }
function stop(reader,reason){try{Promise.resolve(reader?.cancel(reason)).catch(()=>{});}catch{}}
const strongEtag=value=>typeof value==='string'&&value.length<=512&&/^"[\x21\x23-\x7e\x80-\xff]*"$/.test(value);
async function fileHash(file){const hash=crypto.createHash('sha256');for await(const c of nativeFs.createReadStream(file))hash.update(c);return hash.digest('hex');}
async function download({url,destination,expectedSha256,fetchResponse,maxBytes=1024*1024*1024,idleMs=60000,totalMs=DEFAULT_TOTAL_MS,maxAttempts=3,onProgress=()=>{},signal}){
 if(!/^[a-f0-9]{64}$/.test(expectedSha256||''))throw Error('必须先取得可信 SHA256');
 if(!Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>5||!Number.isSafeInteger(idleMs)||idleMs<1||!Number.isSafeInteger(totalMs)||totalMs<1)throw Error('续传设置无效');
 const partial=destination+'.partial-'+crypto.randomBytes(8).toString('hex'),deadline=Date.now()+totalMs;let handle,total=0,size=null,etag=null,published=false,attempt=0;
 try{
  handle=await fs.open(partial,'wx');
  while(attempt<maxAttempts){
   attempt++;const resume=total>0,controller=new AbortController();let response,reader,idleTimer,deadlineTimer,expired=false,timedOut=false;
   let expire,cancel;const timeoutPromise=new Promise((_,reject)=>{expire=()=>{if(expired)return;expired=true;timedOut=true;const e=new TransferError('更新下载超时，原程序未被替换');controller.abort(e);stop(reader,e);reject(e)};cancel=()=>{if(expired)return;expired=true;const e=Error('更新下载已取消，原程序未被替换');controller.abort(e);stop(reader,e);reject(e)};deadlineTimer=setTimeout(expire,Math.max(1,deadline-Date.now()));idleTimer=setTimeout(expire,idleMs);});timeoutPromise.catch(()=>{});
   signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
   const reset=()=>{clearTimeout(idleTimer);idleTimer=setTimeout(expire,idleMs);};
   try{
    if(signal?.aborted)throw Error('更新下载已取消，原程序未被替换');
    if(Date.now()>=deadline)throw new TransferError('更新下载超过总时限');
    try{response=await Promise.race([fetchResponse(url,{start:resume?total:null,etag:resume?etag:null,signal:controller.signal}),timeoutPromise]);}catch(e){if(timedOut)throw new TransferError('更新请求超时');throw new TransferError('更新连接失败: '+String(e?.message||e));}
    const lengthText=response.headers?.get('content-length');
    if(lengthText!==null&&lengthText!==undefined&&!/^\d+$/.test(lengthText))throw Error('更新文件长度无效');
    const length=lengthText==null?null:Number(lengthText),currentEtag=response.headers?.get('etag'),encoding=response.headers?.get('content-encoding');
    if(encoding&&encoding.toLowerCase()!=='identity')throw Error('更新文件使用不支持的内容编码');
    if(!resume){
     if(response.status!==200)throw Error('更新下载响应无效 HTTP '+response.status);
     if(length!==null&&(!Number.isSafeInteger(length)||length<1||length>maxBytes))throw Error('更新文件长度无效');
     size=length;etag=strongEtag(currentEtag)?currentEtag:null;
    }else{
     if(response.status!==206)throw Error('服务器未接受安全续传');
     const range=response.headers?.get('content-range'),match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(range||'');
     if(!match||Number(match[1])!==total||Number(match[2])!==size-1||Number(match[3])!==size||length!==size-total)throw Error('续传范围或长度不匹配');
     if(!etag||currentEtag!==etag)throw Error('续传文件标识发生变化');
    }
    if(!response.body?.getReader)throw Error('更新下载没有可读取的数据流');reader=response.body.getReader();reset();
    while(true){let part;try{part=await Promise.race([reader.read(),timeoutPromise]);}catch(e){throw new TransferError('更新响应中断: '+String(e?.message||e));}if(expired)throw new TransferError('更新下载超时');if(part.done)break;if(!part.value?.byteLength)continue;
     if(total+part.value.byteLength>maxBytes||(size!==null&&total+part.value.byteLength>size))throw Error('更新文件超过声明长度');await handle.writeFile(part.value);total+=part.value.byteLength;onProgress({bytes:total,total:size||0,attempt});if(expired)throw new TransferError('更新下载超时');reset();
    }
    if(total===0||(size!==null&&total!==size))throw new TransferError('更新响应不完整');
    break;
   }catch(error){
    stop(reader,error);if(!controller.signal.aborted)controller.abort(error);
    if(signal?.aborted)throw Error('更新下载已取消，原程序未被替换');
    if(!(error instanceof TransferError)||attempt>=maxAttempts||Date.now()>=deadline||total>0&&(!etag||size===null))throw error;
   }finally{signal?.removeEventListener('abort',cancel);clearTimeout(idleTimer);clearTimeout(deadlineTimer);}
  }
  if(signal?.aborted)throw Error('更新下载已取消，原程序未被替换');
  if(total===0||(size!==null&&total!==size))throw Error('更新文件不完整');await handle.sync();await handle.close();handle=null;
  if(await fileHash(partial)!==expectedSha256)throw Error('更新文件 SHA256 校验失败');
  if(signal?.aborted)throw Error('更新下载已取消，原程序未被替换');
  await fs.copyFile(partial,destination,nativeFs.constants.COPYFILE_EXCL);await fs.unlink(partial);published=true;return {bytes:total,attempts:attempt};
 }finally{if(handle)await handle.close().catch(()=>{});if(!published)await fs.unlink(partial).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
module.exports={download,strongEtag,DEFAULT_TOTAL_MS};
