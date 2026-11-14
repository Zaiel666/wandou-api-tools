/* Original GIF bytes and a static canvas thumbnail have separate lifetimes. */
function nativeGifRequested(node) {
  return node?.imageOutputFormat === 'gif' || node?.outputFormat === 'gif' || node?.mimeType === 'image/gif';
}
function specialImageRequested(node) { return nativeSvgRequested(node) || nativeGifRequested(node); }
function requestedImageMime(node) { return nativeSvgRequested(node) ? 'image/svg+xml' : nativeGifRequested(node) ? 'image/gif' : 'image/png'; }
function imageGenerationOptionsError(node, references = []) {
  if (['video','keyword','audio'].includes(node.type)) return '';
  const optionError = window.WandouImageOptions.validate({...node,model:imageGenerationApiModel(node.model)}, references);
  if (optionError) return optionError;
  if (nativeGifRequested(node)) {
    if (node.type !== 'generator') return 'GIF 动图请使用图片生成节点；抠图和扩图请使用 PNG。';
    if (node.autoSplit) return 'GIF 已包含多帧，请关闭自动拆分后生成。';
    if (references.some(ref => ref?.maskUrl || ref?.markupUrl)) return 'GIF 不支持遮罩或圈画标注，请清除标注或选择 PNG。';
  }
  const annotated = references.filter(ref => ref?.markupUrl);
  if (annotated.length) {
    if (!/^gpt-image-2\.[56]-(?:sunburst|flare)$/i.test(imageGenerationApiModel(node.model))) return '圈画修改需要 GPT-Image-2.5 或 2.6 Flare / Sunburst。';
    if (node.type !== 'generator' || specialImageRequested(node)) return '圈画修改请使用图片生成节点并选择 PNG。';
    if (annotated.length > 1) return '一次圈画修改只能标注一张原图；其余图片可作为普通参考图。';
    if (references.some(ref => ref?.maskUrl)) return '圈画标注和局部遮罩不能同时发送，请先清除其中一种。';
  }
  return '';
}
function capturedImageOptions(node) {
  return {imageQuality:node.imageQuality || 'high', imageComplexity:node.imageComplexity || 'high', gifFrameCount:node.gifFrameCount ?? 9, gifFrameDurationMs:node.gifFrameDurationMs ?? 200};
}
async function completeNativeGifResult({sourceNode,pending,rawUrl,signal,ensureCurrent,apiSeconds,startedAt}) {
  if (!window.WandouAnimatedImage) throw new Error('GIF 处理组件未加载，请重新打开软件。');
  let input = rawUrl;
  if (!/^data:/i.test(input)) {
    const response = await fetchMediaWithTimeout(input,{signal},20000);
    if (!response.ok) throw new Error('GIF 原文件读取失败，请检查渠道返回的文件。');
    input = await response.blob();
  }
  ensureCurrent();
  const animation = await window.WandouAnimatedImage.prepare(input,{signal,previewMaxEdge:640});
  ensureCurrent();
  // A decoder failure must not start many original animations as thumbnails.
  let previewUrl = animation.previewUrl;
  if (!previewUrl) { const canvas = document.createElement('canvas'); canvas.width=64; canvas.height=64; previewUrl=canvas.toDataURL('image/png'); }
  Object.assign(pending, {
    pending:false,apiReturned:true,apiSeconds,totalSeconds:Math.max(1,Math.round((Date.now()-startedAt)/1000)),mediaType:'image',
    imageOutputFormat:'gif',outputFormat:'gif',mimeType:'image/gif',
    fullUrl:animation.dataUrl,sourceUrl:animation.dataUrl,mediaUrl:animation.dataUrl,previewUrl,
    width:animation.width,height:animation.height,originalWidth:animation.width,originalHeight:animation.height,
    animationFrameCount:animation.frameCount,animationFrameDurationsMs:animation.frameDurationsMs,
    animationDurationMs:animation.durationMs,animationLoopCount:animation.loopCount,
    resolutionProcessing:'native-animation',outputResolutionReady:false,outputLongEdgeTarget:0,outputRatioMismatch:false,
    resolutionError:'',errorDetails:'',transparent:animation.hasTransparency,
    status:`GIF 已生成：${animation.frameCount} 帧，保留完整动画原件。` + (animation.previewFallback ? '静态预览暂不可用，可播放或下载原件。' : '')
  });
  pending.references=[{url:animation.dataUrl,mediaType:'image',width:animation.width,height:animation.height,name:pending.title || 'GIF 动图'}];
  setNodeStatus(pending.id,pending.status);refreshRenderedNode(pending.id);
  if (!sourceNode._deferCanvasSave) await saveCanvasState();
}

let canvasGifLightboxCleanup = null;
function configureGifLightbox(node) {
  canvasGifLightboxCleanup?.(); canvasGifLightboxCleanup=null;
  if (!nativeGifRequested(node) || activeLightbox.mode !== 'image') return;
  const source=node.fullUrl || node.sourceUrl || node.mediaUrl;
  const preview=node.previewUrl || '';
  const button=document.createElement('button');button.type='button';button.className='ghost mini';button.dataset.gifPlayback='true';
  button.textContent='播放 GIF';button.setAttribute('aria-pressed','false');lightboxDownload.insertAdjacentElement('beforebegin',button);
  let playing=false;
  const pause=()=>{ playing=false; lightboxImage.src=preview;button.textContent='播放 GIF';button.setAttribute('aria-pressed','false'); };
  const toggle=event=>{event.stopPropagation();if(playing){pause();return;}playing=true;lightboxImage.src=source;button.textContent='暂停 GIF';button.setAttribute('aria-pressed','true');};
  const visibility=()=>{if(document.hidden)pause();};
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const motion=()=>{if(reduced.matches)pause();};
  button.addEventListener('click',toggle);document.addEventListener('visibilitychange',visibility);reduced.addEventListener('change',motion);
  pause();
  canvasGifLightboxCleanup=()=>{button.remove();document.removeEventListener('visibilitychange',visibility);reduced.removeEventListener('change',motion);};
}
