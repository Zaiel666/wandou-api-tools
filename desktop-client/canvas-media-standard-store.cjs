'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {Worker}=require('node:worker_threads');
const files=require('./canvas-media-files.cjs');
const workerCode=fs.readFileSync(path.join(__dirname,'canvas-media-files.cjs'),'utf8')+[
  '',
  'const {parentPort}=require("node:worker_threads");',
  'const mediaFiles=module.exports;',
  'parentPort.on("message",async message=>{',
  ' try { const result=await mediaFiles[message.action](message.root,message.id);parentPort.postMessage({token:message.token,result}); }',
  ' catch(error){parentPort.postMessage({token:message.token,error:{message:error.message,code:error.code}});}',
  '});'
].join('\n');
module.exports=function createStandardMediaStore({directory,guardWrite=task=>task(),isBusy=()=>false,delayMs=40}){
  let worker=null,current=null,sequence=0,disposed=false,paused=false,scan=null;
  const queue=[],pending=new Map();
  const stats={running:false,scanned:0,converted:0,skipped:0,failed:0,addedBytes:0,lastError:'',lastCode:'',legacyRetained:true};
  function ensureWorker(){
    if(worker)return worker;
    const created=new Worker(workerCode,{eval:true});worker=created;created.unref();
    created.on('message',message=>{
      if(worker!==created || current?.token!==message.token)return;
      const active=current;current=null;created.unref();
      if(message.error)active.reject(Object.assign(Error(message.error.message),{code:message.error.code}));else active.resolve(message.result);
    });
    const fail=error=>{if(worker!==created)return;const active=current;current=null;worker=null;active?.reject(error);};
    created.on('error',fail);created.on('exit',()=>fail(Error('原图标准化工作进程已停止')));
    return created;
  }
  async function drain(){
    if(drain.running)return;drain.running=true;
    try{
      while(queue.length && !disposed){
        const entry=queue.shift();
        try{
          if(entry.action==='ensureStandard' && paused)throw Object.assign(Error('原图标准化已暂停'),{code:'MEDIA_PAUSED'});
          if(path.resolve(directory())!==entry.root)throw Object.assign(Error('项目数据目录已切换，旧任务未写入新目录'),{code:'MEDIA_ROOT_CHANGED'});
          const work=()=>new Promise((resolve,reject)=>{
            const decoder=ensureWorker();decoder.ref();
            current={token:++sequence,resolve,reject};
            decoder.postMessage({token:sequence,action:entry.action,root:entry.root,id:entry.id});
          });
          const result=entry.action==='ensureStandard'?await guardWrite(work):await work();
          entry.resolve(result);
        }catch(error){entry.resolve({success:false,error:error.message,code:error.code||'MEDIA_IO_FAILED',legacyRetained:true});}
        finally{if(pending.get(entry.key)===entry.task)pending.delete(entry.key);}
      }
    }finally{drain.running=false;}
  }
  function request(action,id){
    if(disposed)return Promise.resolve({success:false,error:'原图存储已关闭',code:'MEDIA_CLOSED'});
    if(!files.validId(id))return Promise.resolve({success:false,error:'原图标识无效',code:'INVALID_MEDIA_ID'});
    const root=path.resolve(directory()),key=root+'\0'+action+'\0'+id;
    if(pending.has(key))return pending.get(key);
    let resolve;const task=new Promise(done=>resolve=done);
    const entry={action,id,root,key,task,resolve};pending.set(key,task);
    // Interactive reads take precedence over the next background conversion.
    if(action==='readValue')queue.unshift(entry);else queue.push(entry);
    void drain();return task;
  }
  async function ensure(id){
    const result=await request('ensureStandard',id);
    if(!result.success){stats.lastError=result.error||'标准副本尚未完成';stats.lastCode=result.code||'';}
    return result;
  }
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function start(){
    if(disposed || paused || scan)return scan;
    const root=path.resolve(directory());
    scan=(async()=>{
      stats.running=true;
      try{
        await files.realDirectory(root);
        const entries=await fs.promises.opendir(root);
        for await(const entry of entries){
          if(disposed || paused || path.resolve(directory())!==root)break;
          if(!entry.isFile() || !entry.name.endsWith('.data'))continue;
          const id=entry.name.slice(0,-5);if(!files.validId(id))continue;
          while(isBusy() && !disposed && !paused)await sleep(250);
          if(disposed || paused || path.resolve(directory())!==root)break;
          const result=await ensure(id);stats.scanned++;
          if(result.success){if(!result.deduplicated){stats.converted++;stats.addedBytes+=result.bytes||0;}}
          else if(result.unsupported)stats.skipped++;
          else {
            stats.failed++;
            if(['ENOSPC','MEDIA_PAUSED','MEDIA_ROOT_CHANGED','PROJECT_STORAGE_UNAVAILABLE'].includes(result.code)||result.storageUnavailable)break;
          }
          await sleep(delayMs);
        }
      }catch(error){if(error.code!=='ENOENT'){stats.lastError=error.message;stats.lastCode=error.code||'MEDIA_SCAN_FAILED';}}
      finally{stats.running=false;scan=null;}
    })();
    return scan;
  }
  return {
    ensure,read:id=>request('readValue',id),start,
    pause(){paused=true;},
    resume(){paused=false;const previous=scan;if(previous)void previous.finally(()=>{if(!paused&&!disposed)void start();});else void start();},
    info(){return {...stats,paused,extraStorage:true,originalDirectory:path.join(directory(),'originals')};},
    dispose(){
      disposed=true;paused=true;
      const active=current,decoder=worker;current=null;worker=null;
      active?.reject(Object.assign(Error('原图存储已关闭'),{code:'MEDIA_CLOSED'}));void decoder?.terminate();
      for(const entry of queue.splice(0)){pending.delete(entry.key);entry.resolve({success:false,error:'原图存储已关闭',code:'MEDIA_CLOSED'});}
    }
  };
};
