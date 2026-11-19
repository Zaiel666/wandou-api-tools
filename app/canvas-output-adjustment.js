/* Local derivative tasks share the canvas close gate; originals are immutable. */
const localOutputAdjustmentJobs=new Map();
function outputAdjustmentActionsHtml(node){
  if(node.type!=='result'||node.pending||node.mediaType!=='image')return '';
  if(localOutputAdjustmentJobs.has(node.id)){const job=localOutputAdjustmentJobs.get(node.id);return job.phase==='processing'?'<div class="canvas-task-actions"><button type="button" class="ghost mini" data-cancel-output-adjustment>取消本地处理</button><small>正在处理本地文件，不会再次请求生图</small></div>':`<div class="canvas-task-actions"><small>${job.phase==='exporting'?'正在另存为，可在保存窗口取消。':'副本已创建，正在保存；副本将保留在画布中。'}</small></div>`;}
  if(node.outputAdjustment?.nonNative&&node.sourceUrl)return '<div class="canvas-task-actions"><button type="button" class="ghost mini" data-download-channel-original>下载渠道原件</button><small>此节点为本地调整副本；图片上的下载按钮保存副本</small></div>';
  const choice=window.WandouImageOutputAdjustment?.plan(node.outputRequest,node);
  if(!choice?.eligible)return '';
  return `<div class="canvas-task-actions"><button type="button" class="ghost mini" data-create-output-adjustment title="${escapeHtml(choice.reason)}">创建本地调整副本</button><small>${escapeHtml(choice.label)}</small></div>`;
}
function cancelOutputAdjustmentForNode(id){const job=localOutputAdjustmentJobs.get(id);if(job?.phase==='processing')job.controller.abort(new DOMException('已取消本地副本处理','AbortError'));}
function outputAdjustmentJob(node){
  if(canvasProjectTransition||localOutputAdjustmentJobs.has(node.id)||node.pending||node.regenerating)return null;
  const job={node,projectId:activeProjectId,folderId:currentFolderId,controller:new AbortController(),phase:'processing',source:node.fullUrl||node.sourceUrl||node.mediaUrl,requestKey:JSON.stringify(node.outputRequest||null)};
  localOutputAdjustmentJobs.set(node.id,job);return job;
}
function outputAdjustmentCurrent(job){return nodes.includes(job.node)&&activeProjectId===job.projectId&&currentFolderId===job.folderId&&!job.controller.signal.aborted;}
function assertOutputAdjustmentCurrent(job){if(!outputAdjustmentCurrent(job))throw new DOMException('结果或项目已变更，已取消本地副本处理。','AbortError');}
async function readOutputAdjustmentOriginal(source,job){
  const resolved=await getLocalMedia(source);assertOutputAdjustmentCurrent(job);
  if(!/^(?:data:image\/|blob:|wandou-media:|file:)/i.test(resolved||source))throw Error('请先读取软件内保存的原件，不能从远程地址调整。');
  const response=await fetchMediaWithTimeout(resolved||source,{signal:job.controller.signal},20000);assertOutputAdjustmentCurrent(job);if(!response.ok)throw Error('原件读取失败。');
  const blob=await response.blob();assertOutputAdjustmentCurrent(job);return blob;
}
async function createOutputAdjustmentCopy(id){
  const node=nodes.find(item=>item.id===id);if(!node||node.outputAdjustment?.nonNative)return null;
  const choice=window.WandouImageOutputAdjustment?.plan(node.outputRequest,node);if(!choice?.eligible){showToast(choice?.reason||'本地副本组件未就绪。','error');return null;}
  const job=outputAdjustmentJob(node);if(!job)return null;
  let created=null;
  try{
    refreshRenderedNode(node.id);
    const original=await readOutputAdjustmentOriginal(job.source,job);assertOutputAdjustmentCurrent(job);
    const copy=await window.WandouImageOutputAdjustment.create(original,{request:node.outputRequest,signal:job.controller.signal,previewMaxEdge:640});assertOutputAdjustmentCurrent(job);
    if(JSON.stringify(node.outputRequest||null)!==job.requestKey||(node.fullUrl||node.sourceUrl||node.mediaUrl)!==job.source)throw Error('原结果或请求参数已变更，未创建调整副本。');
    let preview=copy.previewUrl;if(copy.format==='gif'&&!preview){const placeholder=document.createElement('canvas');placeholder.width=placeholder.height=64;preview=placeholder.toDataURL('image/png');}
    pushHistory();created=createNode('result',node.x+(Number(node.frameWidth)||360)+48,node.y,{_deferRender:true,
      title:(node.title||copy.format.toUpperCase())+' · 本地副本',model:node.model,prompt:node.prompt||'',mediaType:'image',pending:false,
      imageOutputFormat:copy.format,outputFormat:copy.format,mimeType:copy.mimeType,fullUrl:copy.dataUrl,mediaUrl:copy.dataUrl,previewUrl:preview||copy.dataUrl,sourceUrl:job.source,
      width:copy.width,height:copy.height,originalWidth:copy.source.width,originalHeight:copy.source.height,
      resolutionProcessing:copy.processing,outputResolutionReady:false,outputLongEdgeTarget:0,outputRatioMismatch:copy.outputComparison.ratioMismatch,
      outputRequest:copy.outputRequest,outputComparison:copy.outputComparison,outputAdjustment:{version:1,nonNative:true,source:copy.source,sha256:copy.sha256,operations:copy.operations,sourceNodeId:node.id},
      transparent:copy.hasTransparency??Boolean(node.transparent),status:copy.outputComparison.message,resolutionError:'',errorDetails:'',
      ...(copy.format==='gif'?{animationFrameCount:copy.frameCount,animationFrameDurationsMs:copy.frameDurationsMs,animationDurationMs:copy.durationMs,animationLoopCount:copy.loopCount}:{}),
      references:[{url:copy.dataUrl,mediaType:'image',width:copy.width,height:copy.height,name:'本地调整副本'}]
    });
    job.phase='saving';render();const saved=await saveCanvasState();
    if(saved===false&&activeProjectId===job.projectId&&nodes.includes(created)){created.status=copy.outputComparison.message+' 自动保存未完成，副本仍在画布中，请重试保存。';refreshRenderedNode(created.id);showToast('本地副本已创建，但自动保存未完成。','error',5000);}
    else if(activeProjectId===job.projectId&&nodes.includes(created))showToast('已添加本地调整副本，渠道原件保持不变。','success');
    return created;
  }catch(error){if(activeProjectId===job.projectId&&currentFolderId===job.folderId&&nodes.includes(node))showToast(created?'本地副本已创建并保留，但保存未确认，请重试保存。':error?.name==='AbortError'?'本地副本处理已取消，原件未更改。':'本地副本未完成：'+(error?.message||'处理失败')+' 原件已保留，未再次请求生图。',!created&&error?.name==='AbortError'?'info':'error',5000);return created;}
  finally{if(localOutputAdjustmentJobs.get(id)===job)localOutputAdjustmentJobs.delete(id);if(activeProjectId===job.projectId&&currentFolderId===job.folderId&&nodes.includes(node)){try{refreshRenderedNode(node.id);}catch{console.warn('本地副本控件刷新失败，任务锁已释放。');}}}
}
async function downloadOutputAdjustmentOriginal(id){
  const node=nodes.find(item=>item.id===id);if(!node?.outputAdjustment?.nonNative||!node.sourceUrl)return false;
  const job=outputAdjustmentJob(node);if(!job)return false;
  try{
    refreshRenderedNode(node.id);
    const blob=await readOutputAdjustmentOriginal(node.sourceUrl,job),bytes=await blob.arrayBuffer();assertOutputAdjustmentCurrent(job);
    const digest=await crypto.subtle.digest('SHA-256',bytes);assertOutputAdjustmentCurrent(job);const hash=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
    if(hash!==node.outputAdjustment.source.sha256)throw Error('渠道原件校验失败，未导出其他文件。');
    if(!window.WandouImageExport?.save)throw Error('下载组件尚未就绪。');
    job.phase='exporting';refreshRenderedNode(node.id);
    const saved=await window.WandouImageExport.save({blob,filename:`wandou-original-${node.outputAdjustment.source.width}x${node.outputAdjustment.source.height}.${node.outputAdjustment.source.format}`});
    if(!saved?.success&&!saved?.canceled)throw Error(saved?.error||'保存失败。');if(activeProjectId===job.projectId&&currentFolderId===job.folderId&&nodes.includes(node))showToast(saved?.canceled?'已取消保存，原件仍保留。':'已保存渠道原件。',saved?.canceled?'info':'success');return Boolean(saved?.success);
  }catch(error){if(activeProjectId===job.projectId&&nodes.includes(node))showToast(error?.name==='AbortError'?'原件下载已取消。':'原件下载失败：'+(error?.message||'无法保存'),'error',4500);return false;}
  finally{if(localOutputAdjustmentJobs.get(id)===job)localOutputAdjustmentJobs.delete(id);if(activeProjectId===job.projectId&&nodes.includes(node)){try{refreshRenderedNode(node.id);}catch{console.warn('原件下载控件刷新失败，任务锁已释放。');}}}
}
window.addEventListener('pagehide',()=>{for(const job of localOutputAdjustmentJobs.values())job.controller.abort();});
