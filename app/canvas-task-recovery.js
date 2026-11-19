/* Recover only the existing, explicitly supported asynchronous image protocol.
   A recovery action can issue GETs, never another generation POST. */
const imageRecoveryJobs = new Map();
const imageTaskLedger = WandouImageTaskLedger.create();
const imageTaskRecordWrites = new Set();
const imageTaskLeases = new Map();

function trackedImageTask(node) {
  try { return node?.imageTask ? WandouImageTaskLedger.validate(node.imageTask) : null; }
  catch (_) { return null; }
}
function imageTaskNeedsAttention(node) {
  return Boolean(node?.imageTask && !['completed', 'failed', 'cancelled'].includes(node.imageTask.state));
}
function rememberImageTaskWrite(promise) {
  imageTaskRecordWrites.add(promise);
  promise.finally(() => imageTaskRecordWrites.delete(promise)).catch(() => {});
  return promise;
}
function imageRecoveryIdentity(record) {
  return { folderId: currentFolderId, projectId: activeProjectId, sourceId: record.sourceId, resultId: record.resultId };
}
function sameImageTaskIdentity(left, right) {
  return JSON.stringify(left.output) === JSON.stringify(right.output) && ['id', 'folderId', 'projectId', 'sourceId', 'resultId', 'channelId', 'provider', 'endpoint', 'model', 'targetSize', 'resolution', 'credentialFingerprint']
    .every(key => left[key] === right[key]);
}
async function imageTaskCredentialFingerprint(key) {
  if (!key) throw new Error('请填写原渠道的 API 密钥；任务记录不保存密钥。');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function imageTaskStatus(record) {
  if (!record) return '上次提交结果未知；没有可安全续查的任务编号，未自动重发生图。请在原渠道核对任务与用量。';
  if (record.state === 'cancelled') return '已停止跟踪原任务；服务商是否继续生成或计费取决于原渠道，未发送新的生成请求。';
  if (record.state === 'failed') return '原渠道任务已失败或过期，未自动重发生图。';
  return record.taskId ? '上次图片查询已中断，可继续查询原任务；不会重新发送生图请求。'
    : '上次提交结果未知，尚未收到任务编号；请在原渠道核对任务与用量，未自动重发生图。';
}
function imageTaskRecoveryActionsHtml(node) {
  if (!node?.imageTask || node.imageTask.state === 'completed' || node.imageTask.state === 'failed' || node.imageTask.state === 'cancelled') return '';
  const task = trackedImageTask(node), busy = imageRecoveryJobs.has(node.id) || imageResultControllers.has(node);
  return `<div class="canvas-task-actions">${!busy && task?.taskId ? '<button type="button" class="ghost mini" data-resume-image-task>继续查询原任务</button>' : ''}<button type="button" class="ghost mini" data-stop-image-tracking>${busy ? '停止查询' : '停止跟踪'}</button><small>不会重新生图；原任务计费由渠道决定</small></div>`;
}
function trackedImageOutputRequest(record) { return {version:1,format:'png',size:record.output.size,frameCount:null,frameDurationMs:null}; }
async function beginTrackedImageTask(requestNode, profile, body) {
  const pending = requestNode._taskPending;
  if (!pending || !nodes.includes(pending) || requestNode._taskProjectId !== activeProjectId) throw new Error('任务结果节点已失效，未发送请求。');
  const submitted = JSON.parse(body);
  if (specialImageRequested(requestNode) || submitted.output_format && submitted.output_format !== 'png') throw new Error('此任务恢复协议仅支持普通或透明 PNG，不会推测其他格式。');
  const task = await imageTaskLedger.begin({
    id: 'image-' + crypto.randomUUID(), folderId: currentFolderId, projectId: activeProjectId,
    sourceId: requestNode.id, resultId: pending.id, channelId: profile.id,
    provider: profile.provider || 'gateway', endpoint: WandouImageTaskLedger.endpoint(profile.url),
    model: requestNode.model, targetSize: requestNode._targetSize || '1024x1024', resolution: requestNode.resolution || '1K',
    credentialFingerprint: await imageTaskCredentialFingerprint(profile.key),
    output: {format:'png',background:submitted.background || 'auto',quality:requestNode.imageQuality || 'high',complexity:requestNode.imageComplexity || 'high',size:submitted.size || requestNode._targetSize || '1024x1024'}
  });
  pending.imageTask = task;
  pending.outputRequest = trackedImageOutputRequest(task);
  // The result-node identity must be durable before a paid submission. The
  // separate transaction preserves a received task ID even if later save fails.
  const saved = await saveCanvasState();
  if (!saved || !nodes.includes(pending) || activeProjectId !== task.projectId) {
    pending.imageTask = await imageTaskLedger.state(task.id, 'cancelled');
    throw new Error('任务记录尚未安全保存，未发送生成请求。');
  }
  return task;
}
async function acknowledgeTrackedImageTask(requestNode, taskId) {
  const pending = requestNode._taskPending, task = trackedImageTask(pending);
  if (!task) throw new Error('任务记录缺失，未重复生成。');
  // Keep the received ID on the project too. A ledger write failure must never
  // turn into another POST, and the status remains explicitly unresolved.
  pending.imageTask = WandouImageTaskLedger.validate({ ...task, taskId, state: 'awaiting', updatedAt: Date.now() });
  try { pending.imageTask = await imageTaskLedger.acknowledge(task.id, taskId); }
  catch (error) { await saveCanvasState(); throw error; }
  if (pending.imageTask.state === 'cancelled') throw new DOMException('任务跟踪已停止。', 'AbortError');
  if (!await saveCanvasState()) throw new Error('任务编号已保留，但画布保存失败；请修复存储后继续查询，不要重复生成。');
  return pending.imageTask;
}
async function queryTrackedImageTask(record, pending, signal) {
  const owner = canvasSessionId + ':' + crypto.randomUUID();
  const lease = { record, owner, signal, failure: null, timer: null, controller: new AbortController() };
  const abort = () => lease.controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  lease.cleanup = () => { clearInterval(lease.timer); signal?.removeEventListener('abort', abort); };
  const ensure = async () => {
    if (lease.failure) throw lease.failure;
    if (signal?.aborted || !nodes.includes(pending) || pending.id !== record.resultId || activeProjectId !== record.projectId || currentFolderId !== record.folderId
      || !nodes.some(node => node.id === record.sourceId)) throw new DOMException('原任务所属节点或项目已变化。', 'AbortError');
    const profile = apiProfileForModel(record.model);
    if (!WandouImageTaskLedger.matches(record, profile, imageRecoveryIdentity(record))) throw new Error('原渠道的接口地址或类型已改变；请恢复原配置后继续查询，未向其他渠道发送。');
    if (!profile.key) throw new Error('请填写原渠道的 API 密钥后继续查询；任务记录不保存密钥。');
    if (await imageTaskCredentialFingerprint(profile.key) !== record.credentialFingerprint) throw new Error('原渠道的密钥已更换，无法确认原任务归属；请在设置中恢复原密钥后续查，未发送查询。');
    const leased = imageTaskLeases.get(pending) === lease ? await imageTaskLedger.renew(record.id, owner) : await imageTaskLedger.claim(record.id, owner);
    if (leased.taskId !== record.taskId) throw new Error('任务编号不一致，未继续查询。');
    return profile;
  };
  try {
    const profile = await ensure();
    imageTaskLeases.set(pending, lease);
    lease.verify = ensure;
    lease.timer = setInterval(() => ensure().catch(error => { lease.failure = error; lease.controller.abort(error); }), 10000);
    const headers = { Authorization: `Bearer ${profile.key}` };
    const url = imagePollEndpoint(record.endpoint, record.taskId);
    const data = await pollImageResult(url, headers, lease.controller.signal, record.taskId, ensure);
    await ensure();
    const returned = extractOutputMediaUrl(data) || imageContentEndpoint(record.endpoint, record.taskId);
    const resultUrl = absoluteApiResultUrl(returned, record.endpoint), parsed = new URL(resultUrl);
    if (!/^data:image\//i.test(resultUrl) && (parsed.protocol !== 'https:' || parsed.username || parsed.password)) throw new Error('原任务返回了不安全的图片地址。');
    const image = await fetchAuthenticatedImageResult(resultUrl, parsed.origin === new URL(record.endpoint).origin ? headers : {}, lease.controller.signal);
    await ensure();
    return { url: image, urls: [image], mediaType: 'image', fromApi: true };
  } catch (error) {
    if (error.imageTaskTerminal && !lease.failure) pending.imageTask = await imageTaskLedger.state(record.id, 'failed', owner);
    await releaseTrackedImageTaskLease(pending, lease);
    throw error;
  }
}
async function verifyTrackedImageTaskLease(pending) {
  const lease = imageTaskLeases.get(pending);
  if (lease) await lease.verify();
}
async function releaseTrackedImageTaskLease(pending, expected = imageTaskLeases.get(pending)) {
  if (!expected) return;
  expected.cleanup();
  if (imageTaskLeases.get(pending) === expected) imageTaskLeases.delete(pending);
  await imageTaskLedger.release(expected.record.id, expected.owner).catch(() => {});
}
async function completeTrackedImageTask(pending) {
  const task = trackedImageTask(pending);
  if (!task || !pending.fullUrl || pending.pending || task.state === 'cancelled') return;
  await verifyTrackedImageTaskLease(pending);
  if (!await saveCanvasState()) throw new Error('原图已返回但尚未安全保存；任务编号已保留，未重复生成。');
  await verifyTrackedImageTaskLease(pending);
  pending.imageTask = await imageTaskLedger.state(task.id, 'completed', imageTaskLeases.get(pending)?.owner || '');
  await saveCanvasState();
}
async function resumeTrackedImageTask(id) {
  if (canvasProjectTransition || imageRecoveryJobs.has(id)) return;
  const pending = nodes.find(node => node.id === id), metadata = trackedImageTask(pending);
  if (!pending || !metadata || metadata.resultId !== pending.id || !metadata.taskId || pending.pending || !imageTaskNeedsAttention(pending)) return;
  const source = nodes.find(node => node.id === metadata.sourceId);
  if (!source) { pending.status = '原生成节点已不存在，未查询或重发；请在原渠道核对任务。'; render(); return; }
  const job = { node: source, projectId: activeProjectId, pendingNodes: [pending], controllers: new Set(), cancelled: false };
  imageRecoveryJobs.set(id, job); // Claim before the first asynchronous read.
  try {
    let record = await imageTaskLedger.get(metadata.id);
    if (!record || !sameImageTaskIdentity(record, metadata)) throw new Error('项目与原任务记录不一致，未发送查询。');
    if (record && !record.taskId && metadata.taskId && !WandouImageTaskLedger.terminal(record.state)) record = await imageTaskLedger.acknowledge(record.id, metadata.taskId);
    if (!record || record.taskId !== metadata.taskId || WandouImageTaskLedger.terminal(record.state)) throw new Error('原任务记录不可恢复或已停止，未发送查询。');
    if (!generationJobIsCurrent(job) || !nodes.includes(pending)) return;
    if (!WandouImageTaskLedger.matches(record, apiProfileForModel(record.model), imageRecoveryIdentity(record))) throw new Error('原渠道配置已改变，请恢复原接口地址后继续查询。');
    pending.pending = true; pending.status = '正在查询原任务，不会重新发送生成请求…'; render();
    await generateOneResult({ ...source, type: 'generator', model: record.model, resolution: record.resolution,
      imageOutputFormat: record.output.format, outputFormat: record.output.format, transparentBackground: record.output.background === 'transparent', autoSplit: false,
      imageQuality:record.output.quality, imageComplexity:record.output.complexity,
      prompt: pending.prompt || '', _outputRequest: trackedImageOutputRequest(record),
      references: [], _directReferencesOnly: true, _generationJob: job, _resumeImageTask: record,
      _deferCanvasSave: false }, pending, 0, record.targetSize);
  } catch (error) {
    if (activeProjectId === job.projectId && nodes.includes(pending)) { pending.pending = false; pending.status = error.message; render(); }
  } finally {
    if (imageRecoveryJobs.get(id) === job) imageRecoveryJobs.delete(id);
    if (activeProjectId === job.projectId && nodes.includes(pending)) { pending.pending = false; render(); await saveCanvasState(); }
  }
}
function cancelTrackedImageTasksForNode(id) {
  for (const pending of nodes) {
    const task = trackedImageTask(pending);
    if (!task || (task.sourceId !== id && pending.id !== id) || WandouImageTaskLedger.terminal(task.state)) continue;
    pending.imageTask = { ...task, state: 'cancelled', updatedAt: Date.now() };
    const job = imageRecoveryJobs.get(pending.id);
    if (job) { job.cancelled = true; job.controllers.forEach(controller => controller.abort(new DOMException('用户停止查询。', 'AbortError'))); }
    imageResultControllers.get(pending)?.controller.abort(new DOMException('用户停止任务跟踪。', 'AbortError'));
    rememberImageTaskWrite(imageTaskLedger.state(task.id, 'cancelled')).catch(() => { pending.status = '停止跟踪的记录尚未保存，请检查存储；不会自动继续查询。'; });
  }
}
async function stopTrackedImageTask(id) {
  const pending = nodes.find(node => node.id === id);
  if (!pending) return;
  cancelTrackedImageTasksForNode(id);
  pending.pending = false; pending.status = imageTaskStatus(pending.imageTask); render();
  await Promise.allSettled([...imageTaskRecordWrites]); await saveCanvasState();
}
async function restoreTrackedImageTask(node) {
  if (!node?.imageTask) return;
  const record = trackedImageTask(node);
  if (!record) { node.pending = false; node.status = imageTaskStatus(null); return; }
  try {
    const durable = await imageTaskLedger.get(record.id);
    if (durable && durable.folderId === currentFolderId && durable.projectId === activeProjectId && durable.resultId === node.id) {
      if (record.state === 'cancelled') { await imageTaskLedger.state(record.id, 'cancelled'); }
      else if (!record.taskId || durable.taskId || WandouImageTaskLedger.terminal(durable.state)) node.imageTask = durable;
    }
  } catch (_) { /* Keep the project copy and explain; never send on restore. */ }
  node.pending = false;
  if (node.imageTask.state !== 'completed') node.status = imageTaskStatus(node.imageTask);
}
