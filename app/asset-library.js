(function () {
  const content = document.getElementById("assetContent");
  const search = document.getElementById("assetSearch");
  const title = document.getElementById("assetTitle");
  const subtitle = document.getElementById("assetSubtitle");
  const folderSelect = document.getElementById("folderFilter");
  const sortSelect = document.getElementById("assetSort");
  const importButton = document.getElementById("importSkill");
  const openSkillDirectoryButton = document.getElementById("openSkillDirectory");
  const toast = document.getElementById("assetToast");
  const locationDialog = document.getElementById("assetLocationDialog");
  const locationName = document.getElementById("assetLocationName");
  const locationStatus = document.getElementById("assetLocationStatus");
  const locationPath = document.getElementById("assetLocationPath");
  const locationDetails = document.getElementById("assetLocationDetails");
  const locationOpenButton = document.getElementById("assetLocationOpenFolder");
  const locationDownloadButton = document.getElementById("assetLocationDownload");
  const locationDownloadStatus = document.getElementById("assetLocationDownloadStatus");
  const canvasPrefix = "aiCanvasStateV1";
  const indexedPrefix = "indexed-media:";
  let filter = "all";
  let assets = [];
  let folders = [];
  let visibleLimit = 120;
  let toastTimer = 0;
  let loadRevision = 0;
  let gridController = null;
  let locationRevision = 0;
  let locationRef = "";
  let locationAsset = null;
  let imageDownloadPending = false;
  let exportBusy = false;
  let stopBatch = false;
  let currentVisibleImages = [];
  const selectedImages = new Set();
  let previewFit = localStorage.getItem('wandouAssetPreviewFit') === 'cover' ? 'cover' : 'contain';
  const toolbar = document.createElement('div');
  toolbar.className = 'asset-selection-toolbar';
  toolbar.innerHTML = '<div class="asset-preview-switch" role="group" aria-label="缩略图显示方式"><button type="button" class="button" data-fit="contain">完整显示</button><button type="button" class="button" data-fit="cover">裁切填满</button></div><button type="button" class="button" id="assetSelectVisible">选中当前图片</button><button type="button" class="button" id="assetClearSelection">清除选择</button><button type="button" class="button primary" id="assetBatchSave">批量另存为</button><button type="button" class="button" id="assetStopBatch" hidden>停止后续保存</button><span id="assetSelectionStatus" role="status" aria-live="polite"></span>';
  content.before(toolbar);
  const batchButton = toolbar.querySelector('#assetBatchSave');
  const selectionStatus = toolbar.querySelector('#assetSelectionStatus');
  const infoDialog = document.createElement('dialog');
  infoDialog.className = 'asset-location-dialog asset-info-dialog';
  infoDialog.id = 'assetInfoDialog';
  infoDialog.setAttribute('aria-labelledby', 'assetInfoTitle');
  infoDialog.innerHTML = '<div class="asset-location-head"><h2 id="assetInfoTitle">图片信息与导出</h2><button type="button" class="button" id="assetInfoClose">关闭</button></div><p id="assetInfoName" class="asset-location-name"></p><div id="assetFileFacts" class="asset-file-facts" role="status">正在读取原图信息…</div><p class="asset-info-note">实际像素和文件大小按原文件读取；不改动项目中的图片。</p><label class="asset-export-format">导出格式 <select id="assetExportFormat"><option value="original">保留原格式</option><option value="image/png">PNG</option><option value="image/jpeg">JPG（白底）</option><option value="image/webp">WebP</option></select></label><p id="assetExportFormatNote" class="asset-info-note">原格式保留原始字节，适合透明图片和动图。</p><p id="assetInfoSaveStatus" class="asset-download-status" role="status"></p><div class="asset-location-actions"><button type="button" class="button primary" id="assetInfoSave" disabled>另存为图片</button></div>';
  document.body.append(infoDialog);
  const animationPreview=document.createElement('div');
  animationPreview.id='assetAnimationPreview';animationPreview.hidden=true;
  animationPreview.innerHTML='<img id="assetAnimationImage" alt="动图首帧预览" style="display:block;max-width:100%;max-height:240px;margin:0 auto 12px;object-fit:contain"><button type="button" class="button" id="assetAnimationToggle" aria-pressed="false">播放动图</button><p class="asset-info-note" id="assetAnimationNote">默认显示静态首帧，播放不会更改原文件。</p>';
  document.getElementById('assetFileFacts').after(animationPreview);
  let animationMedia=null,animationPlaying=false;
  const motionPreference=window.matchMedia('(prefers-reduced-motion: reduce)');
  function pauseAnimation(){animationPlaying=false;const image=document.getElementById('assetAnimationImage');if(animationMedia?.previewUrl)image.src=animationMedia.previewUrl;else image.removeAttribute('src');document.getElementById('assetAnimationToggle').textContent='播放动图';document.getElementById('assetAnimationToggle').setAttribute('aria-pressed','false');}
  function clearAnimation(){pauseAnimation();animationMedia=null;animationPreview.hidden=true;document.getElementById('assetAnimationImage').removeAttribute('src');}
  document.getElementById('assetAnimationToggle').onclick=()=>{
    if(!animationMedia||document.hidden)return;
    if(animationPlaying){pauseAnimation();return;}
    animationPlaying=true;document.getElementById('assetAnimationImage').src=animationMedia.dataUrl;
    document.getElementById('assetAnimationToggle').textContent='暂停动图';document.getElementById('assetAnimationToggle').setAttribute('aria-pressed','true');
  };
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseAnimation();});
  motionPreference.addEventListener?.('change',pauseAnimation);
  if(typeof IntersectionObserver==='function')new IntersectionObserver(entries=>{if(!entries[0]?.isIntersecting)pauseAnimation();}).observe(animationPreview);
  let infoRevision=0,infoController=null,infoBlob=null,infoAsset=null,infoFacts=null;
  let imageToolQueue=Promise.resolve();
  function imageToolWorker(){
    self.onmessage=async({data})=>{
      let bitmap;
      try{
        bitmap=await createImageBitmap(data.blob);
        if(!data.type){self.postMessage({width:bitmap.width,height:bitmap.height});return;}
        const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');
        if(data.type==='image/jpeg'){ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);}
        ctx.drawImage(bitmap,0,0);
        const blob=await canvas.convertToBlob({type:data.type,quality:.92});
        if(blob.type!==data.type)throw Error('当前环境不支持所选格式，请保留原格式导出。');
        self.postMessage({blob});
      }catch(error){self.postMessage({error:error?.message||'无法读取这张图片'});}
      finally{bitmap?.close();}
    };
  }
  function runImageTool(blob,type='',signal){
    const run=()=>new Promise((resolve,reject)=>{
      if(signal?.aborted){reject(new DOMException('读取已取消','AbortError'));return;}
      const url=URL.createObjectURL(new Blob(['('+imageToolWorker.toString()+')()'],{type:'text/javascript'}));
      let worker,timer,settled=false;
      const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);worker?.terminate();URL.revokeObjectURL(url);error?reject(error):resolve(value);};
      const abort=()=>finish(new DOMException('读取已取消','AbortError'));
      try{worker=new Worker(url);worker.onmessage=event=>event.data.error?finish(Error(event.data.error)):finish(null,event.data);worker.onerror=()=>finish(Error('图片处理组件未能运行，请重试或保留原格式下载。'));signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>finish(Error('图片处理超时，请重试或保留原格式下载。')),30000);worker.postMessage({blob,type});}
      catch(error){finish(error);}
    });
    const task=imageToolQueue.catch(()=>{}).then(run);imageToolQueue=task.catch(()=>{});return task;
  }
  const previousHasTasks=window.wandouHasActiveTasks;
  const previousClose=window.wandouSaveBeforeClose;
  window.wandouHasActiveTasks=()=>imageDownloadPending||Boolean(previousHasTasks?.());
  window.wandouSaveBeforeClose=async()=>{
    if(imageDownloadPending)return {success:false,busy:true,error:'图片正在另存为，请完成或取消保存后再关闭。'};
    return previousClose ? previousClose() : {success:true};
  };
  function updateSelection(){
    const busy=imageDownloadPending;
    batchButton.disabled=busy||selectedImages.size===0;
    batchButton.textContent='批量另存为'+(selectedImages.size?'（'+selectedImages.size+'）':'');
    toolbar.querySelector('#assetClearSelection').disabled=busy||selectedImages.size===0;
    toolbar.querySelector('#assetSelectVisible').disabled=busy||!currentVisibleImages.length;
    toolbar.querySelector('#assetStopBatch').hidden=!exportBusy;
    if(!exportBusy)selectionStatus.textContent=selectedImages.size?'已选择 '+selectedImages.size+' 张；每张分别选择保存位置':'每张分别选择保存位置，取消即停止后续保存';
    content.querySelectorAll('[data-asset-select]').forEach(input=>{const source=assets[Number(input.dataset.assetSelect)]?.originalStored;input.disabled=busy||!source;input.checked=Boolean(source)&&selectedImages.has(source);});
    document.body.dataset.assetFit=previewFit;
    toolbar.querySelectorAll('[data-fit]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.fit===previewFit)));
  }
  async function saveBatch(){
    if(imageDownloadPending||!selectedImages.size)return;
    if(!window.wandouShell?.saveFileAs&&typeof window.showSaveFilePicker!=='function')return showToast('批量另存为需要可选择位置的保存窗口，请在桌面版使用。');
    const queue=assets.filter(asset=>asset.type==='image'&&selectedImages.has(asset.originalStored));
    imageDownloadPending=true;exportBusy=true;stopBatch=false;updateDownloadButtons();
    let saved=0,message='';
    try{
      for(const asset of queue){
        if(stopBatch){message='已停止后续保存';break;}
        selectionStatus.textContent='正在保存 '+(saved+1)+' / '+queue.length+'：'+asset.name;
        const source=await resolveMedia(asset.originalStored);
        if(stopBatch){message='已停止后续保存';break;}
        if(!source)throw Error('未找到“'+asset.name+'”的原图，已停止后续保存');
        const result=await window.WandouImageExport.save({source,filename:asset.name||'图片'});
        if(result?.canceled){message='已取消，后续图片未导出';break;}
        if(!result?.success)throw Error(result?.error||'图片保存失败，已停止后续保存');
        saved++;selectedImages.delete(asset.originalStored);
      }
      if(!message)message=saved===queue.length?'所选图片已全部另存为':'已停止后续保存';
    }catch(error){message=error?.message||'保存失败，已停止后续保存';}
    finally{imageDownloadPending=false;exportBusy=false;updateDownloadButtons();selectionStatus.textContent=message+'；已保存 '+saved+' / '+queue.length+' 张';showToast(selectionStatus.textContent);}
  }
  function formatBytes(bytes){return bytes<1024?bytes+' B':bytes<1048576?(bytes/1024).toFixed(1)+' KiB':(bytes/1048576).toFixed(2)+' MiB';}
  async function inspectBlob(blob,signal){
    const head=new Uint8Array(await blob.slice(0,32).arrayBuffer());const text=String.fromCharCode(...head);let format='';
    const prefix=(await blob.slice(0,4096).text()).replace(/^\uFEFF/,'').trimStart();
    if(blob.type.split(';')[0]==='image/svg+xml'||/^(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(prefix)){
      if(!window.WandouNativeSvg)throw Error('SVG 读取组件尚未就绪，请刷新后重试。');
      const vector=await window.WandouNativeSvg.prepare(blob,{signal,preview:false});
      return {format:'SVG',width:vector.width,height:vector.height,bytes:blob.size,vector:true};
    }
    if(head[0]===137&&text.slice(1,4)==='PNG')format='PNG';
    else if(head[0]===255&&head[1]===216)format='JPG';
    else if(/^GIF8[79]a/.test(text)){
      if(!window.WandouAnimatedImage)throw Error('动图读取组件尚未就绪，请刷新后重试。');
      const animation=await window.WandouAnimatedImage.prepare(blob,{signal,allowStatic:true,previewMaxEdge:640});
      return {format:'GIF',width:animation.width,height:animation.height,bytes:blob.size,animated:true,animation};
    }
    else if(text.startsWith('RIFF')&&text.slice(8,12)==='WEBP')format='WebP';
    else if(text.slice(4,8)==='ftyp'&&/avif|avis/.test(text.slice(8)))format='AVIF';
    else format=(blob.type.split('/')[1]||'未知格式').toUpperCase();
    const dimensions=await runImageTool(blob,'',signal);
    return {format,...dimensions,bytes:blob.size};
  }
  async function showImageInfo(asset){
    if(!asset?.originalStored)return showToast('这条记录仅有预览，无法读取原图信息。');
    const revision=++infoRevision;infoController?.abort();infoController=new AbortController();const controller=infoController;
    clearAnimation();
    infoBlob=null;infoAsset=asset;infoFacts=null;
    document.getElementById('assetInfoName').textContent=asset.name;
    document.getElementById('assetFileFacts').textContent='正在读取原图信息…';
    document.getElementById('assetInfoSaveStatus').textContent='';
    document.getElementById('assetExportFormat').value='original';updateFormatNote();
    document.getElementById('assetInfoSave').disabled=true;
    if(!infoDialog.open)infoDialog.showModal();
    const timeout=setTimeout(()=>controller.abort(),20000);
    try{
      const source=await resolveMedia(asset.originalStored);if(controller.signal.aborted)throw Error('读取已取消');
      const response=await fetch(source,{signal:controller.signal});if(!response.ok)throw Error('原文件读取失败');
      const blob=await response.blob();if(!blob.size)throw Error('原文件为空');
      const facts=await inspectBlob(blob,controller.signal);
      if(revision!==infoRevision||!infoDialog.open||controller.signal.aborted)return;
      infoBlob=blob;infoFacts=facts;asset.fileFacts={...facts,animation:undefined};
      const provenance=asset.resolutionProcessing==='native-vector'?' · 模型原生 SVG，可编辑矢量路径':asset.resolutionProcessing==='local-upscale'?' · 本地放大，非原生生成':'';
      const animationFacts=facts.animated?' · '+facts.animation.frameCount+' 帧 · '+(facts.animation.durationMs/1000).toFixed(2)+' 秒'+(facts.animation.loopCount===0?' · 循环播放':facts.animation.loopCount===null?' · 单次播放':' · 重复 '+facts.animation.loopCount+' 次'):'';
      document.getElementById('assetFileFacts').textContent=facts.format+' · '+facts.width+' × '+facts.height+(facts.vector?' 画布':' 像素')+' · '+formatBytes(facts.bytes)+animationFacts+provenance;
      if(facts.animated){animationMedia=facts.animation;animationPreview.hidden=false;pauseAnimation();document.getElementById('assetAnimationNote').textContent=facts.animation.previewFallback?'静态预览暂不可用；原始动图仍可播放和下载。':motionPreference.matches?'已遵循减少动态效果设置，默认静止；可手动播放，暂停后回到首帧。':'默认显示静态首帧；暂停后回到首帧，原文件不变。';}
      updateFormatNote();
      const meta=content.querySelector('[data-file-meta="'+assets.indexOf(asset)+'"]');if(meta)meta.textContent=document.getElementById('assetFileFacts').textContent;
      document.getElementById('assetInfoSave').disabled=imageDownloadPending;
    }catch(error){if(revision===infoRevision&&infoDialog.open)document.getElementById('assetFileFacts').textContent=controller.signal.aborted?'原图读取超时，请关闭后重试。':(error?.message||'暂时无法读取原图信息');}
    finally{clearTimeout(timeout);}
  }
  function updateFormatNote(){
    const select=document.getElementById('assetExportFormat');
    const vector=Boolean(infoFacts?.vector),animated=Boolean(infoFacts?.animated);
    for(const option of select.options)option.disabled=(vector||animated)&&option.value!=='original';
    if(vector||animated)select.value='original';
    const type=select.value;
    document.getElementById('assetExportFormatNote').textContent=vector?'SVG 按原文件导出，保留可编辑路径与透明度；预览不会替换矢量原件。':animated?'GIF 按原文件导出，保留全部帧、透明度与循环信息；静态预览不会替换动图原件。':type==='original'?'原格式保留原始字节，适合透明图片和动图。':type==='image/jpeg'?'JPG 不支持透明，透明区域将填白；项目原图不变。':'转换格式会重新编码；项目原图不变。';
  }
  async function saveInfoImage(){
    if(imageDownloadPending||!infoBlob||!infoAsset)return;
    const original=infoBlob,asset=infoAsset,type=document.getElementById('assetExportFormat').value,button=document.getElementById('assetInfoSave');
    const revision=infoRevision;
    const report=(message)=>{
      if(infoDialog.open&&infoRevision===revision&&infoAsset===asset)document.getElementById('assetInfoSaveStatus').textContent=message;
      else showToast('“'+(asset.name||'图片')+'”：'+message);
    };
    imageDownloadPending=true;updateDownloadButtons();button.disabled=true;
    try{
      let blob=original;
      if(type!=='original'){
        if(infoFacts?.vector)throw Error('SVG 请保留原格式导出，以保留可编辑矢量路径。');
        if(infoFacts?.animated)throw Error('GIF 请保留原格式导出，以保留全部动画帧。');
        blob=(await runImageTool(original,type)).blob;
      }
      const result=await window.WandouImageExport.save({blob,filename:asset.name||'图片'});
      report(result?.canceled?'已取消，未导出图片。':result?.success?'图片已另存为，项目原图未改变。':result?.error||'保存失败，请重试。');
    }catch(error){report(error?.message||'转换或保存失败，项目原图未改变。');}
    finally{imageDownloadPending=false;updateDownloadButtons();button.disabled=!infoBlob;}
  }
  toolbar.querySelector('#assetSelectVisible').onclick=()=>{currentVisibleImages.forEach(asset=>selectedImages.add(asset.originalStored));updateSelection();};
  toolbar.querySelector('#assetClearSelection').onclick=()=>{selectedImages.clear();updateSelection();};
  batchButton.onclick=saveBatch;
  toolbar.querySelector('#assetStopBatch').onclick=()=>{stopBatch=true;selectionStatus.textContent='将在当前保存窗口结束后停止。';};
  toolbar.querySelectorAll('[data-fit]').forEach(button=>button.onclick=()=>{previewFit=button.dataset.fit;try{localStorage.setItem('wandouAssetPreviewFit',previewFit);}catch(_){}updateSelection();});
  document.getElementById('assetInfoClose').onclick=()=>infoDialog.close();
  document.getElementById('assetExportFormat').onchange=updateFormatNote;
  document.getElementById('assetInfoSave').onclick=saveInfoImage;
  infoDialog.addEventListener('close',()=>{infoRevision++;infoController?.abort();infoController=null;infoBlob=null;infoAsset=null;infoFacts=null;clearAnimation();});


  const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  }[char]));

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null");
      return value ?? fallback;
    } catch (_error) {
      return fallback;
    }
  }

  function applyTheme() {
    const value = localStorage.getItem("ai-tools-theme")
      || localStorage.getItem("wd-theme")
      || localStorage.getItem("aiCanvasProjectHubTheme")
      || "light";
    const theme = value === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    document.body.classList.toggle("dark", theme === "dark");
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("show");
    toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
  }

  function updateDownloadButtons() {
    content.querySelectorAll("[data-asset-download]").forEach((button) => {
      button.disabled = imageDownloadPending;
    });
    locationDownloadButton.disabled = imageDownloadPending || !locationAsset?.originalStored;
    document.getElementById("assetInfoSave").disabled = imageDownloadPending || !infoBlob;
    updateSelection();
  }

  function showDownloadResult(asset, message) {
    if (locationDialog.open && locationAsset === asset) {
      locationDownloadStatus.textContent = message;
      locationDownloadStatus.hidden = false;
    } else {
      showToast(message);
    }
  }

  async function downloadImage(asset, button) {
    if (imageDownloadPending) return;
    if (!asset?.originalStored) return showDownloadResult(asset, "这条记录只保留了预览，无法下载原图。请回到项目检查原图是否存在。");
    imageDownloadPending = true;
    clearTimeout(toastTimer);
    toast.classList.remove("show");
    locationDownloadStatus.hidden = true;
    const originalLabel = button.textContent;
    button.textContent = "保存中…";
    updateDownloadButtons();
    try {
      const source = await resolveMedia(asset.originalStored);
      if (!source) throw new Error("未找到原图，文件可能已被移走或清理。请检查项目存储目录后重试。");
      if (!window.WandouImageExport?.save) throw new Error("图片下载组件尚未就绪，请刷新资产后重试。");
      const result = await window.WandouImageExport.save({ source, filename: asset.name || "图片" });
      if (result?.canceled) return;
      if (!result?.success) throw new Error(result?.error || "图片保存失败，请重新选择保存位置后重试。");
      showDownloadResult(asset, result.path ? `图片已保存到 ${result.path}` : "已发起图片下载。");
    } catch (error) {
      showDownloadResult(asset, error?.message || "图片保存失败，请稍后重试。");
    } finally {
      imageDownloadPending = false;
      button.textContent = originalLabel;
      updateDownloadButtons();
    }
  }

  async function showOriginalLocation(asset) {
    const revision = ++locationRevision;
    locationRef = "";
    locationAsset = asset;
    locationDownloadStatus.textContent = "";
    locationDownloadStatus.hidden = true;
    updateDownloadButtons();
    locationName.textContent = asset.name;
    locationStatus.textContent = "正在查找原图存储文件…";
    locationPath.value = "";
    locationDetails.hidden = true;
    locationOpenButton.disabled = true;
    if (!locationDialog.open) locationDialog.showModal();
    if (!window.wandouShell?.getCanvasMediaLocation) {
      locationStatus.textContent = "浏览器版无法查看电脑中的原文件位置，请在豌豆 AI 桌面版打开。";
      return;
    }
    const ref = asset.originalStored;
    if (!ref) {
      locationStatus.textContent = "这条记录只保留了预览，无法确定原图文件位置。";
      return;
    }
    // Do not send inline image bytes or treat a preview/download folder as the original.
    if (!/^(?:indexed-media:|wandou-media:\/\/)/.test(ref)) {
      locationStatus.textContent = "原图尚未保存为本机项目文件。保存项目后，可刷新资产再查看。";
      return;
    }
    try {
      const result = await window.wandouShell.getCanvasMediaLocation(ref);
      if (revision !== locationRevision || !locationDialog.open) return;
      if (!result?.success || !result.path) {
        locationStatus.textContent = result?.missing
          ? "未找到本机原图存储文件，文件可能已被移走或清理。"
          : (result?.error || "这张原图没有可查看的本机文件位置。");
        return;
      }
      locationRef = ref;
      locationPath.value = result.path;
      locationPath.title = result.path;
      locationDetails.hidden = false;
      locationStatus.textContent = result.storageFormat === "data-url"
        ? "这是由软件管理的项目原图存储文件（.data），资源管理器不能直接预览。点击“另存为图片”，选择位置后即可保存为可查看的图片；无需修改或移动这个存储文件。"
        : "这是由软件管理的项目原图存储文件。";
      locationOpenButton.disabled = !window.wandouShell?.showCanvasMediaInFolder;
    } catch (_error) {
      if (revision === locationRevision && locationDialog.open) locationStatus.textContent = "暂时无法读取原文件位置，请稍后重试。";
    }
  }

  async function resolveMedia(value) {
    if (!String(value || "").startsWith(indexedPrefix)) return value || "";
    const id = value.slice(indexedPrefix.length);
    const runtimeUrl = await window.WandouMediaUrls?.resolve(id);
    if (runtimeUrl) return runtimeUrl;
    try {
      const result = await window.wandouShell?.readCanvasMedia?.({ id });
      if (result?.success) return result.value || "";
    } catch (_error) {}
    return await new Promise((resolve) => {
      const request = indexedDB.open("ai-node-canvas-media-v1", 2);
      request.onerror = () => resolve("");
      request.onsuccess = () => {
        try {
          const get = request.result.transaction("media", "readonly").objectStore("media").get(id);
          get.onsuccess = () => resolve(get.result?.value || "");
          get.onerror = () => resolve("");
        } catch (_error) {
          resolve("");
        }
      };
    });
  }

  function projectContextForStorageKey(key, state = null) {
    const ownedFolderId = String(state?.folderId || "");
    if (ownedFolderId) {
      const folder = folders.find((item) => String(item.id) === ownedFolderId);
      const projectId = String(state?.projectId || "");
      const projects = readJson(`${canvasPrefix}:project-collection:${ownedFolderId}`, []);
      const project = Array.isArray(projects) ? projects.find((item) => String(item.id) === projectId) : null;
      return {
        folderId: ownedFolderId,
        folderName: folder?.name || state?.folderName || "未命名文件夹",
        projectId,
        projectName: project?.name || state?.projectName || ""
      };
    }
    const ordered = [...folders].sort((left, right) => String(right.id).length - String(left.id).length);
    for (const folder of ordered) {
      const base = `${canvasPrefix}:${folder.id}`;
      if (key !== base && !key.startsWith(`${base}:`)) continue;
      const projectId = key === base ? "" : key.slice(base.length + 1);
      if (/^(session-|download-seq|deleted-results)/.test(projectId)) return null;
      const projects = readJson(`${canvasPrefix}:project-collection:${folder.id}`, []);
      const project = Array.isArray(projects) ? projects.find((item) => item.id === projectId) : null;
      return {
        folderId: folder.id,
        folderName: folder.name || "未命名文件夹",
        projectId,
        projectName: project?.name || ""
      };
    }
    return { folderId: "ungrouped", folderName: "未归类", projectId: "", projectName: "" };
  }

  function collectMediaAssets(stateRecords = null) {
    const keys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key === canvasPrefix || key?.startsWith(`${canvasPrefix}:`)) keys.push(key);
    }
    keys.sort((left, right) => right.split(":").length - left.split(":").length);
    const media = [];
    const seen = new Set();
    const records = stateRecords || keys.map((key) => ({ key, state: readJson(key, null) }));
    for (const { key, state } of records) {
      if (key.includes(":project-collection:") || key.includes(":active-project-collection:")) continue;
      if (!state || !Array.isArray(state.nodes)) continue;
      const project = projectContextForStorageKey(key, state);
      if (!project) continue;
      for (const node of state.nodes) {
        if (node?.type !== "result" || !["image", "video"].includes(node.mediaType)) continue;
        const stored = node.previewUrl || node.mediaUrl || node.fullUrl || "";
        const vector = node.imageOutputFormat === 'svg' || node.outputFormat === 'svg' || node.resolutionProcessing === 'native-vector';
        const animated = node.imageOutputFormat === 'gif' || node.outputFormat === 'gif' || node.resolutionProcessing === 'native-animation' || node.mimeType === 'image/gif';
        const originalStored = node.transparent && !vector && !animated
          ? node.mediaUrl || node.fullUrl || ""
          : node.fullUrl || node.sourceUrl || node.mediaUrl || "";
        const fullStored = originalStored || node.previewUrl || "";
        const identity = fullStored || stored;
        if (!stored || seen.has(identity)) continue;
        seen.add(identity);
        media.push({
          type: node.mediaType,
          name: node.title || node.prompt?.slice(0, 36) || (node.mediaType === "video" ? "视频资产" : "图片资产"),
          stored,
          fullStored,
          originalStored,
          createdAt: Number(node.createdAt || state.savedAt) || 0,
          sequence: Number(String(node.id || "").replace(/\D/g, "")) || 0,
          resolutionProcessing: node.resolutionProcessing || "",
          imageOutputFormat: node.imageOutputFormat || node.outputFormat || "",
          animated,
          animationFrameCount: node.animationFrameCount,
          width: node.width,
          height: node.height,
          ...project
        });
      }
    }
    return media;
  }

  function refreshFolderOptions() {
    const counts = new Map();
    assets.filter((item) => item.type !== "skill").forEach((item) => {
      counts.set(item.folderId, (counts.get(item.folderId) || 0) + 1);
    });
    const current = folderSelect.value || "all";
    const options = ['<option value="all">全部项目文件夹</option>'];
    const direction = sortSelect?.value === "asc" ? 1 : -1;
    const folderTimes = new Map();
    assets.filter((item) => item.type !== "skill").forEach((item) => {
      const currentTime = folderTimes.get(item.folderId);
      const itemTime = Number(item.createdAt) || 0;
      folderTimes.set(item.folderId, currentTime === undefined
        ? itemTime
        : (direction < 0 ? Math.max(currentTime, itemTime) : Math.min(currentTime, itemTime)));
    });
    const orderedFolders = [...folders].sort((left, right) => {
      const timeDifference = (folderTimes.get(left.id) || 0) - (folderTimes.get(right.id) || 0);
      if (timeDifference) return timeDifference * direction;
      return String(left.name || "").localeCompare(String(right.name || ""), "zh-CN") * direction;
    });
    for (const folder of orderedFolders) {
      options.push(`<option value="${escapeHtml(folder.id)}">${escapeHtml(folder.name)}（${counts.get(folder.id) || 0}）</option>`);
    }
    if (counts.get("ungrouped")) options.push(`<option value="ungrouped">未归类（${counts.get("ungrouped")}）</option>`);
    folderSelect.innerHTML = options.join("");
    folderSelect.value = [...folderSelect.options].some((option) => option.value === current) ? current : "all";
  }

  async function load() {
    const revision = ++loadRevision;
    applyTheme();
    visibleLimit = 120;
    folders = readJson("aiCanvasProjectsV1", []);
    if (!Array.isArray(folders)) folders = [];
    const [skills, stateRecords] = await Promise.all([
      WandouSkills.list(),
      window.WandouAssetStates?.read(folders).catch(() => {
        if (revision === loadRevision) showToast("部分项目暂时无法读取，请稍后刷新资产。");
        return null;
      })
    ]);
    if (revision !== loadRevision) return;
    assets = [...collectMediaAssets(stateRecords), ...skills.map((skill) => ({ ...skill, type: "skill" }))];
    const available=new Set(assets.map(asset=>asset.originalStored));for(const key of selectedImages){if(!available.has(key))selectedImages.delete(key);}
    refreshFolderOptions();
    render();
  }

  function mediaCard(asset) {
    const index = assets.indexOf(asset);
    const directory = [asset.folderName, asset.projectName].filter(Boolean).map(escapeHtml).join(" / ");
    const label = asset.animated ? 'GIF 动图'+(asset.animationFrameCount?' · '+asset.animationFrameCount+' 帧':'') : asset.resolutionProcessing === 'native-vector' ? '原生 SVG 矢量' : asset.imageOutputFormat === 'svg' ? 'SVG 矢量' : asset.type === 'video' ? '视频' : '图片';
    return `<article class="asset-card media-card" data-media-index="${index}"><button type="button" class="media-preview" data-open-media="${index}" data-preview-index="${index}" aria-label="预览${escapeHtml(asset.name)}"><span>正在读取…</span></button><div class="asset-card-body"><h3 class="asset-card-title">${escapeHtml(asset.name)}</h3><div class="asset-card-meta" data-file-meta="${index}">${label}${asset.width && asset.height ? ` · ${asset.width}×${asset.height}（项目记录）` : ""}</div>${directory ? `<div class="asset-card-directory" title="${directory}">${directory}</div>` : ""}${asset.type === "image" ? `<label class="asset-select-label"><input type="checkbox" data-asset-select="${index}" aria-label="选择${escapeHtml(asset.name)}"${!asset.originalStored ? " disabled" : ""}>选择图片</label><div class="asset-media-actions"><button class="asset-info-button" type="button" data-asset-info="${index}">图片信息</button><button class="asset-download-button" type="button" data-asset-download="${index}" aria-label="下载${escapeHtml(asset.name)}，选择保存位置" title="选择位置保存原图"${imageDownloadPending ? " disabled" : ""}>下载图片</button><button class="asset-location-button" type="button" data-asset-location="${index}" aria-label="查看${escapeHtml(asset.name)}的原文件位置">原文件位置</button></div>` : ""}</div></article>`;
  }

  function skillCard(skill, selected) {
    const index = assets.indexOf(skill);
    const deleteButton = skill.canDelete
      ? `<button class="skill-delete" data-delete-skill="${index}" type="button" title="删除个人 Skill" aria-label="删除 ${escapeHtml(skill.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5"/></svg><span>删除</span></button>`
      : `<span class="skill-protected" title="系统核心 Skill，为保证生图功能完整不能删除"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg><span>系统保留</span></span>`;
    return `<article class="asset-card skill-card"><div class="skill-card-head"><span class="skill-mark">SK</span><span class="installed-badge">${escapeHtml(skill.source || "已安装")}</span></div><div><h3>${escapeHtml(skill.name)}</h3><p>${escapeHtml(skill.description)}</p></div><div class="skill-actions"><button class="skill-use ${selected?.id === skill.id ? "selected" : ""}" data-skill-index="${index}" type="button">${selected?.id === skill.id ? "已用于绘图" : "用于绘图"}</button>${deleteButton}</div></article>`;
  }

  function groupMarkup(name, items, cardRenderer) {
    return `<section class="asset-group"><header class="asset-group-head"><h2>${escapeHtml(name)}</h2><span class="asset-group-count">${items.length} 项</span></header><div class="asset-grid">${items.map(cardRenderer).join("")}</div></section>`;
  }

  function render() {
    gridController?.abort();gridController=new AbortController();const gridSignal=gridController.signal;
    const query = search.value.trim().toLowerCase();
    const selected = WandouSkills.getSelected();
    const chosenFolder = folderSelect.value || "all";
    const matching = assets.filter((asset) => {
      if (filter !== "all" && asset.type !== filter) return false;
      if (asset.type !== "skill" && chosenFolder !== "all" && asset.folderId !== chosenFolder) return false;
      return !query || `${asset.name || ""} ${asset.description || ""} ${asset.folderName || ""} ${asset.projectName || ""}`.toLowerCase().includes(query);
    });
    const direction = sortSelect?.value === "asc" ? 1 : -1;
    const ordered = [...matching].sort((left, right) => {
      const timeDifference = (Number(left.createdAt) || 0) - (Number(right.createdAt) || 0);
      if (timeDifference) return timeDifference * direction;
      const sequenceDifference = (Number(left.sequence) || 0) - (Number(right.sequence) || 0);
      if (sequenceDifference) return sequenceDifference * direction;
      return String(left.name || "").localeCompare(String(right.name || ""), "zh-CN") * direction;
    });
    const limited = ordered.slice(0, visibleLimit);
    currentVisibleImages=limited.filter(asset=>asset.type==="image"&&asset.originalStored);
    toolbar.hidden=filter==="skill"||filter==="video";
    for (const type of ["image", "video", "skill"]) {
      document.querySelector(`[data-count="${type}"]`).textContent = assets.filter((asset) => asset.type === type).length;
    }
    document.querySelector('[data-count="all"]').textContent = assets.length;
    title.textContent = { all: "全部资产", image: "所有图片", video: "视频资产", skill: "绘图 Skill" }[filter];
    subtitle.textContent = filter === "skill"
      ? "绘图 Skill 为提示词补充可复用的写法与规则，不会执行代码或增加模型额度。ZIP 请先解压，再导入含 SKILL.md 的文件夹。"
      : `按软件内的项目文件夹归类，当前${direction < 0 ? "最近生成优先" : "最早生成优先"}；点击“下载图片”选择保存位置，“原文件位置”可查看内部存储文件。`;
    importButton.hidden = filter !== "skill";
    openSkillDirectoryButton.hidden = filter !== "skill";
    folderSelect.hidden = filter === "skill";
    search.placeholder = filter === "skill" ? "搜索绘图 Skill…" : "搜索资产或项目…";
    if (!limited.length) {
      content.innerHTML = `<div class="asset-empty">${filter === "skill" ? "暂时没有可用的绘图 Skill。可以导入自己的 Skill。" : "这个分类中还没有资产。"}</div>`;
      updateSelection();
      return;
    }
    const sections = [];
    const media = limited.filter((asset) => asset.type !== "skill");
    const skills = limited.filter((asset) => asset.type === "skill");
    const directoryGroups = new Map();
    for (const asset of media) {
      const key = `${asset.folderId || "ungrouped"}:${asset.projectId || ""}`;
      if (!directoryGroups.has(key)) directoryGroups.set(key, []);
      directoryGroups.get(key).push(asset);
    }
    for (const items of directoryGroups.values()) {
      const first = items[0];
      const directoryName = [first.folderName || "未归类", first.projectName].filter(Boolean).join(" / ");
      sections.push(groupMarkup(directoryName, items, mediaCard));
    }
    if (skills.length) sections.push(groupMarkup("绘图 Skill", skills, (skill) => skillCard(skill, selected)));
    if (matching.length > visibleLimit) sections.push(`<button class="asset-load-more" type="button">加载更多（剩余 ${matching.length - visibleLimit}）</button>`);
    content.innerHTML = sections.join("");
    updateSelection();
    content.querySelectorAll('[data-asset-select]').forEach(input=>{
      input.onclick=event=>event.stopPropagation();
      input.onchange=()=>{const asset=assets[Number(input.dataset.assetSelect)];if(!asset?.originalStored)return;if(input.checked)selectedImages.add(asset.originalStored);else selectedImages.delete(asset.originalStored);updateSelection();};
    });
    content.querySelectorAll('[data-asset-info]').forEach(button=>button.onclick=event=>{event.stopPropagation();showImageInfo(assets[Number(button.dataset.assetInfo)]);});
    content.querySelectorAll("[data-skill-index]").forEach((button) => {
      button.onclick = () => { WandouSkills.setSelected(assets[Number(button.dataset.skillIndex)]); render(); };
    });
    content.querySelectorAll("[data-delete-skill]").forEach((button) => {
      button.onclick = () => deleteSkill(assets[Number(button.dataset.deleteSkill)]);
    });
    content.querySelectorAll("[data-asset-location]").forEach((button) => {
      button.onclick = (event) => {
        event.stopPropagation();
        showOriginalLocation(assets[Number(button.dataset.assetLocation)]);
      };
    });
    content.querySelectorAll("[data-asset-download]").forEach((button) => {
      button.onclick = (event) => {
        event.stopPropagation();
        downloadImage(assets[Number(button.dataset.assetDownload)], button);
      };
    });
    content.querySelectorAll("[data-preview-index]").forEach(async (box) => {
      try {
      const asset = assets[Number(box.dataset.previewIndex)];
      let url = await resolveMedia(asset.stored);
      if(gridSignal.aborted||!box.isConnected)return;
      if(asset.type==='image'&&(asset.animated||/^data:image\/gif[;,]/i.test(url)||/\.gif(?:[?#]|$)/i.test(url)||(!asset.imageOutputFormat&&asset.stored===asset.originalStored&&/^(?:wandou-media:|blob:|https?:)/i.test(url)))&&!/^data:image\/(?:png|jpeg|webp)[;,]/i.test(url)){
        const response=await fetch(url,{signal:gridSignal});if(!response.ok)throw Error('动图预览读取失败');
        const blob=await response.blob(),head=String.fromCharCode(...new Uint8Array(await blob.slice(0,6).arrayBuffer()));
        if(/^GIF8[79]a$/.test(head)){
          const animation=await window.WandouAnimatedImage.prepare(blob,{signal:gridSignal,allowStatic:true,previewMaxEdge:480});
          asset.animated=true;url=animation.previewUrl;
        }
      }
      asset.url = url;
      if(gridSignal.aborted||!box.isConnected)return;
      if(!url){box.textContent='媒体暂不可用';return;}
      const media=document.createElement(asset.type==='video'?'video':'img');
      media.src=url;if(asset.type==='video'){media.muted=true;media.preload='metadata';}else{media.alt='';media.loading='lazy';media.decoding='async';}
      box.replaceChildren(media);
      }catch(_error){if(box.isConnected)box.textContent='静态预览暂不可用，请查看图片信息或下载原件';}
    });
    content.querySelectorAll("[data-media-index]").forEach((card) => {
      card.onclick = async (event) => {
        if(event.target.closest("button:not([data-open-media]),input,label"))return;
        const asset = assets[Number(card.dataset.mediaIndex)];
        const url = await resolveMedia(asset.fullStored || asset.stored);
        if (!url) return;
        if(asset.type==='image'&&(asset.animated||/^data:image\/gif[;,]/i.test(url)||/\.gif(?:[?#]|$)/i.test(url)||(!asset.imageOutputFormat&&asset.stored===asset.originalStored&&/^(?:wandou-media:|blob:|https?:)/i.test(url)))){showImageInfo(asset);return;}
        const media=document.createElement(asset.type==='video'?'video':'img');media.src=url;
        if(asset.type==='video'){media.controls=true;media.autoplay=true;}else media.alt=asset.name;
        document.getElementById('lightboxMedia').replaceChildren(media);
        const lightbox=document.getElementById('assetLightbox');lightbox.classList.add('open');lightbox.showModal();
      };
    });
    content.querySelector(".asset-load-more")?.addEventListener("click", () => { visibleLimit += 120; render(); });
  }

  async function importSkill() {
    if (!window.wandouShell?.importSkill) return showToast("请在豌豆 AI 客户端中导入 Skill。");
    importButton.disabled = true;
    const result = await window.wandouShell.importSkill();
    importButton.disabled = false;
    if (result?.canceled) return;
    if (!result?.success) return showToast(result?.error || "Skill 导入失败");
    showToast(`已导入 ${result.skill?.name || "Skill"}`);
    await load();
  }

  async function deleteSkill(skill) {
    if (!skill?.canDelete) return;
    if (!window.wandouShell?.deleteSkill) return showToast("临时浏览器预览不能删除，请在豌豆 AI 客户端中操作。");
    if (!window.confirm(`确定删除个人 Skill“${skill.name}”吗？\n\n文件将移到系统回收站，可以恢复。`)) return;
    const result = await window.wandouShell.deleteSkill(skill.id);
    if (!result?.success) return showToast(result?.error || "Skill 删除失败");
    if (WandouSkills.getSelected()?.id === skill.id) WandouSkills.setSelected(null);
    showToast(`已将 ${skill.name} 移到回收站`);
    await load();
  }

  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.onclick = () => {
      filter = button.dataset.filter;
      visibleLimit = 120;
      document.querySelectorAll("[data-filter]").forEach((item) => item.classList.toggle("active", item === button));
      render();
    };
  });
  search.oninput = () => { visibleLimit = 120; render(); };
  folderSelect.onchange = () => { visibleLimit = 120; render(); };
  sortSelect.onchange = () => { visibleLimit = 120; refreshFolderOptions(); render(); };
  importButton.onclick = importSkill;
  openSkillDirectoryButton.onclick = async () => {
    const result = await window.wandouShell?.openSkillDirectory?.();
    if (!result?.success) showToast(result?.error || "无法打开 Skill 目录");
  };
  document.getElementById("refreshAssets").onclick = load;
  document.getElementById("assetLocationClose").onclick = () => locationDialog.close();
  locationDialog.addEventListener("close", () => { locationRevision += 1; locationRef = ""; locationAsset = null; updateDownloadButtons(); });
  locationDownloadButton.onclick = () => downloadImage(locationAsset, locationDownloadButton);
  locationDialog.addEventListener("click", (event) => {
    if (event.target !== locationDialog) return;
    const bounds = locationDialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) locationDialog.close();
  });
  locationOpenButton.onclick = async () => {
    if (!locationRef || !window.wandouShell?.showCanvasMediaInFolder) return;
    const ref = locationRef;
    locationOpenButton.disabled = true;
    try {
      const result = await window.wandouShell.showCanvasMediaInFolder(ref);
      if (!result?.success) {
        showToast(result?.error || "无法打开原图所在文件夹，请刷新后重试。");
        if (result?.missing && locationRef === ref) {
          locationRef = "";
          locationDetails.hidden = true;
          locationStatus.textContent = "未找到本机原图存储文件，文件可能已被移走或清理。";
        }
      }
    } catch (_error) { showToast("无法打开原图所在文件夹，请稍后重试。"); }
    finally { if (locationRef === ref && locationDialog.open) locationOpenButton.disabled = false; }
  };
  const oldLightbox=document.getElementById('assetLightbox');
  const lightbox=document.createElement('dialog');lightbox.id=oldLightbox.id;lightbox.className=oldLightbox.className;lightbox.setAttribute('aria-label','资产原图预览');
  while(oldLightbox.firstChild)lightbox.append(oldLightbox.firstChild);oldLightbox.replaceWith(lightbox);
  lightbox.addEventListener('close',()=>{lightbox.classList.remove('open');document.getElementById('lightboxMedia').replaceChildren();});
  document.querySelector(".lightbox-close").onclick = () => lightbox.close();
  document.getElementById("assetLightbox").onclick = (event) => {
    if (event.target.id === "assetLightbox") event.currentTarget.close();
  };
  window.addEventListener("storage", (event) => {
    if (["ai-tools-theme", "wd-theme", "aiCanvasProjectHubTheme"].includes(event.key)) applyTheme();
  });
  window.addEventListener("focus", applyTheme);
  load();
})();
