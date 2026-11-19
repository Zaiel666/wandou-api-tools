const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
function cancel(value,reason){try{Promise.resolve(value?.cancel?.(reason)).catch(()=>{});}catch{}}

// A partial or timed-out download never becomes the candidate package.
async function download({url,destination,fetchResponse,maxBytes=1024*1024*1024,idleMs=60000,totalMs=30*60*1000,onProgress=()=>{}}) {
  const partial=destination+'.partial-'+crypto.randomBytes(8).toString('hex');
  let handle,reader,timer,totalTimer,total=0,done=false,expired=false;
  const response=await fetchResponse(url);
  if(!response.ok) {cancel(response.body);throw Error(`更新下载失败 HTTP ${response.status}`);}
  const declared=Number(response.headers?.get('content-length'))||0;
  if(declared>maxBytes) {cancel(response.body);throw Error('更新文件超过允许大小');}
  if(!response.body?.getReader) throw Error('更新下载没有可读取的数据流');
  reader=response.body.getReader();
  let rejectTimeout;
  const timedOut=new Promise((_,reject)=>{rejectTimeout=reject;});
  const timeout=()=>{expired=true;const error=Error('更新下载超时，原程序未被替换');rejectTimeout(error);cancel(reader,error);};
  const reset=()=>{clearTimeout(timer);timer=setTimeout(timeout,idleMs);};
  totalTimer=setTimeout(timeout,totalMs);reset();
  try {
    handle=await fs.open(partial,'wx');
    while(true) {
      const part=await Promise.race([reader.read(),timedOut]);
      if(part.done)break;
      if(!part.value?.byteLength)continue;
      total+=part.value.byteLength;
      if(total>maxBytes)throw Error('更新文件超过允许大小');
      await handle.writeFile(part.value);if(expired)throw Error('更新下载超时，原程序未被替换');reset();onProgress({bytes:total,total:declared});
    }
    if(expired)throw Error('更新下载超时，原程序未被替换');
    if(!total||(declared&&total!==declared))throw Error('更新文件不完整，已停止安装');
    clearTimeout(timer);clearTimeout(totalTimer);
    await handle.sync();await handle.close();handle=null;
    // Publishing must not overwrite a file left by another operation.
    await fs.copyFile(partial,destination,require('node:fs').constants.COPYFILE_EXCL);
    await fs.unlink(partial);done=true;return {bytes:total};
  } finally {
    clearTimeout(timer);clearTimeout(totalTimer);
    if(!done)cancel(reader);
    if(handle)await handle.close().catch(()=>{});
    if(!done)await fs.unlink(partial).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
}
function checksum(text,filename) {
  const line=String(text).trim(),match=/^([a-fA-F0-9]{64})(?:[ \t]+\*?([^\r\n]+))?$/.exec(line);
  if(!match || (match[2]&&match[2]!==filename) || path.basename(filename)!==filename)throw Error('更新校验文件无效或文件名不匹配');
  return match[1].toLowerCase();
}
async function sha256(file){const hash=crypto.createHash('sha256');for await(const chunk of require('node:fs').createReadStream(file))hash.update(chunk);return hash.digest('hex');}
module.exports={download,checksum,sha256};
