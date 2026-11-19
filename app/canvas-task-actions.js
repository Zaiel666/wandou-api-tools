/* Task controls share the canvas owner/close gate and never create paid work implicitly. */
const localResolutionJobs = new Map();
const canvasTaskIndexes = new WeakMap();

function canvasTaskIndex() {
  const renderIndex = typeof activeCanvasRenderIndex === 'undefined' ? null : activeCanvasRenderIndex;
  if (renderIndex && canvasTaskIndexes.has(renderIndex)) return canvasTaskIndexes.get(renderIndex);
  const nodeById = renderIndex?.nodeById || new Map(nodes.map(node => [node.id,node]));
  const candidates = new Map(), retried = new Map();
  for (const link of links) {
    const node = nodeById.get(link.to);
    if (!node) continue;
    if (node.regeneratedFromId) {
      if (!retried.has(link.from)) retried.set(link.from,new Set());
      retried.get(link.from).add(node.regeneratedFromId);
    }
    if (failedImageResult(node)) {
      if (!candidates.has(link.from)) candidates.set(link.from,new Set());
      candidates.get(link.from).add(node);
    }
  }
  const failed = new Map();
  for (const [id,list] of candidates) failed.set(id,[...list].filter(node => !retried.get(id)?.has(node.id)));
  const value = {failed, regenerating:new Set([...imageRegenerationJobs.values()].map(job=>job.node.id))};
  if (renderIndex) canvasTaskIndexes.set(renderIndex,value);
  return value;
}

function canvasTaskRenderKey(node) {
  if (node.type === "result") return [localResolutionJobs.has(node.id), localOutputAdjustmentJobs.has(node.id), localOutputAdjustmentJobs.get(node.id)?.phase || '', Boolean(node.regenerating), node.imageTask?.state, node.imageTask?.taskId, imageRecoveryJobs.has(node.id)];
  if (!["generator", "outpaint", "style", "png", "upscale", "video"].includes(node.type)) return null;
  const index = canvasTaskIndex();
  return [imageGenerationJobs.has(node.id), index.regenerating.has(node.id), index.failed.get(node.id)?.length || 0];
}

function failedImageResult(node) {
  return !imageTaskNeedsAttention(node) && node?.type === "result" && node.mediaType === "image" && !node.pending && !node.regenerating
    && !favoriteMediaUrl(node) && /失败|错误|超时|中断|取消|停止/.test(node.status || "");
}

function failedImageResultsForSource(sourceId) {
  return canvasTaskIndex().failed.get(sourceId) || [];
}

function generatorTaskActionsHtml(node) {
  const busy = imageGenerationJobs.has(node.id) || [...imageRegenerationJobs.values()].some(job => job.node.id === node.id);
  const count = failedImageResultsForSource(node.id).length;
  return `<div class="canvas-task-actions">${busy ? '<button type="button" class="ghost mini" data-stop-task>停止后续生成</button><small>已发出的请求由服务商结算</small>' : count ? `<button type="button" class="ghost mini" data-retry-failed>只重试失败项（${count}）</button>` : ""}</div>`;
}

function taskErrorDetails(error) {
  // Only return diagnostic identifiers. Provider payloads can contain prompts or credentials.
  const raw = String(error?.message || error || "");
  const status = raw.match(/HTTP\s+(\d{3})/i)?.[1];
  const requestId = raw.match(/request[ _-]?id[\s:：=]+([A-Za-z0-9_-]{6,100})/i)?.[1];
  return [status ? "HTTP " + status : "", requestId ? "请求编号：" + requestId : ""].filter(Boolean).join(" · ");
}

function resultTaskActionsHtml(node) {
  if (node.mediaType !== "image") return "";
  const canResize = node.resolutionProcessing === "incomplete" && node.outputResolutionReady && !imageResultControllers.has(node) && (node.fullUrl || node.sourceUrl);
  const resizing = localResolutionJobs.has(node.id);
  const retry = failedImageResult(node) && resultGenerationSource(node);
  return `<div class="canvas-task-actions">${resizing ? '<button type="button" class="ghost mini" data-stop-output>停止尺寸处理</button>' : canResize ? '<button type="button" class="ghost mini" data-retry-output>重试尺寸处理（不重新生图）</button>' : retry ? '<button type="button" class="ghost mini" data-retry-result>重试这一张</button>' : ""}</div>${node.errorDetails ? `<details class="canvas-task-details"><summary>技术详情</summary><p>${escapeHtml(node.errorDetails)}</p></details>` : ""}`;
}

function stopCanvasImageTask(sourceId) {
  cancelTrackedImageTasksForNode(sourceId);
  const source = nodes.find(node => node.id === sourceId);
  if (!source) return;
  const jobs = [imageGenerationJobs.get(sourceId), ...imageRegenerationJobs.values()].filter(job => job && job.node.id === sourceId);
  for (const job of jobs) {
    job.cancelled = true;
    for (const pending of job.pendingNodes) if (pending.pending || pending.resolutionProcessing === 'incomplete') {
      pending.pending = false;
      pending.status = pending.sourceUrl ? "尺寸处理已取消，原图已保留，可单独重试尺寸处理。" : "生成已取消。可单独重试，已完成的图片已保留。";
    }
    for (const controller of job.controllers) controller.abort(new DOMException("用户停止生成", "AbortError"));
  }
  source.status = "已停止后续生成，已完成的图片已保留。已发出的请求是否计费由服务商决定。";
  render();
  scheduleCanvasSave(0);
}

async function retryFailedFromNode(sourceId) {
  if (canvasProjectTransition || imageGenerationJobs.has(sourceId)) return;
  const source = nodes.find(node => node.id === sourceId);
  const failed = failedImageResultsForSource(sourceId);
  if (!source || !failed.length || [...imageRegenerationJobs.values()].some(job => job.node.id === sourceId)) return;
  if (!apiProfileForModel(source.model).key) { setSettingsOpen(true); showToast("请先填写当前渠道的 API 密钥"); return; }
  const job = {node:source, projectId:activeProjectId, cancelled:false, controllers:new Set(), pendingNodes:[]};
  imageGenerationJobs.set(sourceId, job);
  render();
  try {
    for (const result of failed) {
      if (!generationJobIsCurrent(job)) break;
      if (failedImageResultsForSource(sourceId).includes(result)) await regenerateResultNode(result.id);
    }
    if (generationJobIsCurrent(job)) source.status = "失败项重试结束，剩余 " + failedImageResultsForSource(sourceId).length + " 张未成功。已成功图片未重新生成。";
  } finally {
    if (imageGenerationJobs.get(sourceId) === job) imageGenerationJobs.delete(sourceId);
    if (activeProjectId === job.projectId) { render(); await saveCanvasState(); }
  }
}

function cancelLocalResolutionForNode(id) {
  const job = localResolutionJobs.get(id);
  if (job) job.controller.abort(new DOMException("用户停止尺寸处理", "AbortError"));
}

async function retryResultResolution(id) {
  if (canvasProjectTransition || localResolutionJobs.has(id)) return;
  const node = nodes.find(item => item.id === id);
  if (!node || node.pending || imageResultControllers.has(node) || !node.outputResolutionReady || node.resolutionProcessing !== "incomplete") return;
  const source = node.fullUrl || node.sourceUrl;
  if (!source) return;
  const job = {node, projectId:activeProjectId, controller:new AbortController()};
  localResolutionJobs.set(id, job);
  window.WandouMascotState?.set('resize:' + id, 'thinking');
  const current = () => activeProjectId === job.projectId && nodes.includes(node) && !job.controller.signal.aborted;
  const edge = imageOutputEdge(node.requestedResolution || node.resolution || "1K");
  node.status = "正在重新处理输出尺寸，不会发送生图请求…";
  render();
  try {
    const resolved = await getLocalMedia(source);
    if (!current()) return;
    const output = await window.WandouImageOutput.process({url:resolved || source, targetSize:edge + "x" + edge, signal:job.controller.signal,
      fetch:(url, options) => fetchMediaWithTimeout(url, options, 20000)});
    if (!current()) return;
    const preview = await createPreviewImageUrl(output.url, 320, Boolean(node.transparent));
    if (!current()) return;
    Object.assign(node, {mediaUrl:output.url, fullUrl:output.url, previewUrl:preview || output.url,
      width:output.width, height:output.height, originalWidth:output.originalWidth, originalHeight:output.originalHeight,
      resolutionProcessing:output.processing, outputLongEdgeTarget:edge, resolutionError:"", errorDetails:"",
      status:output.nonNative ? "尺寸处理完成：本地放大（非原生生成），原图已保留。" : "尺寸核验完成，原图已保留。"});
    node.references = [{url:output.url, mediaType:"image", width:output.width, height:output.height, name:node.title || "效果图"}];
  } catch (error) {
    if (activeProjectId === job.projectId && nodes.includes(node)) {
      node.status = job.controller.signal.aborted ? "尺寸处理已取消，原图已保留，可再次重试。" : "尺寸处理失败，原图已保留：" + friendlyApiError(error);
      node.resolutionError = friendlyApiError(error);
    }
  } finally {
    if (localResolutionJobs.get(id) === job) localResolutionJobs.delete(id);
    window.WandouMascotState?.set('resize:' + id, job.controller.signal.aborted ? 'idle' : node.resolutionProcessing === 'incomplete' ? 'error' : 'complete');
    if (activeProjectId === job.projectId) { render(); await saveCanvasState(); }
  }
}
