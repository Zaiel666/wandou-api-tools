/* Native vectors keep their original XML; previews and raster output remain separate. */
function nativeSvgRequested(node) {
  return node?.imageOutputFormat === 'svg' || node?.outputFormat === 'svg';
}

function nativeSvgModelSupported(model) {
  return /^gpt-image-2\.6-(?:sunburst|flare)$/.test(String(imageGenerationApiModel(model)).toLowerCase());
}

function nativeSvgFormatRowHtml(node) {
  if (node.type !== 'generator') return '';
  return window.WandouImageOptions.render({...node, model:imageGenerationApiModel(node.model)}, {includeFormat:true, disabled:imageGenerationJobs.has(node.id)});
}

function nativeSvgRequestError(node, references = []) {
  if (!nativeSvgRequested(node)) return '';
  if (node.type !== 'generator') return '原生 SVG 请使用图片生成节点；图片编辑、抠图和扩图请使用 PNG。';
  if (!nativeSvgModelSupported(node.model)) return '原生 SVG 需要 GPT-Image-2.6 Flare 或 Sunburst。请切换模型或选择 PNG。';
  if (node.autoSplit) return '原生 SVG 暂不使用自动拆分，请关闭自动拆分后生成。';
  if (references.length) return '原生 SVG 当前支持文字生成。请移除参考图及图片连线，或选择 PNG 进行图片编辑。';
  return '';
}

function imageResponseMime(value, fallback = 'image/png') {
  const formats = { png:'image/png', jpeg:'image/jpeg', jpg:'image/jpeg', webp:'image/webp', gif:'image/gif', svg:'image/svg+xml' };
  const format = formats[String(value?.output_format || value?.outputFormat || '').toLowerCase()];
  const explicit = String(value?.mime_type || value?.mimeType || '').split(';')[0].toLowerCase();
  return format || (Object.values(formats).includes(explicit) ? explicit : fallback);
}

async function nativeSvgReferenceFile(blob, index) {
  const vector = await window.WandouNativeSvg.prepare(blob, {previewMaxEdge:2048});
  if (vector.previewFallback || !vector.previewUrl.startsWith('data:image/png')) throw new Error('SVG 参考图转换失败，原件已保留；请先导出 PNG 副本再作为参考图。');
  const raster = await fetch(vector.previewUrl).then(response => response.blob());
  return new File([raster], `reference-${index + 1}.png`, {type:'image/png'});
}

async function completeNativeSvgResult({sourceNode, pending, rawUrl, signal, ensureCurrent, apiSeconds, startedAt}) {
  if (!window.WandouNativeSvg) throw new Error('SVG 处理组件未加载，请重新打开软件。');
  let input = rawUrl;
  if (!/^data:/i.test(input)) {
    const response = await fetchMediaWithTimeout(input, {signal}, 20000);
    if (!response.ok) throw new Error('SVG 原文件读取失败，请检查渠道返回的文件。');
    input = await response.blob();
  }
  ensureCurrent();
  const vector = await window.WandouNativeSvg.prepare(input, {signal, previewMaxEdge:640});
  ensureCurrent();
  const comparison = window.WandouImageOutputContract.compare(pending.outputRequest, {format:'svg',width:vector.width,height:vector.height});
  const totalSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
  Object.assign(pending, {
    pending:false, apiReturned:true, apiSeconds, totalSeconds, mediaType:'image',
    imageOutputFormat:'svg', outputFormat:'svg', mimeType:'image/svg+xml',
    fullUrl:vector.dataUrl, sourceUrl:vector.dataUrl, mediaUrl:vector.dataUrl,
    previewUrl:vector.previewUrl || vector.dataUrl,
    width:vector.width, height:vector.height, originalWidth:vector.width, originalHeight:vector.height,
    resolutionProcessing:'native-vector', outputResolutionReady:false, outputLongEdgeTarget:0,
    outputComparison:comparison, outputRatioMismatch:comparison.ratioMismatch, resolutionError:'', errorDetails:'',
    transparent:vector.hasTransparency ?? Boolean(sourceNode.transparentBackground),
    status:'原生 SVG 已生成。' + (comparison.message || '保留可编辑矢量原文件；下载可选择保存位置。') + (vector.previewFallback ? '缩略图暂不可用，正在显示矢量预览。' : '')
  });
  pending.references = [{url:vector.dataUrl, mediaType:'image', width:vector.width, height:vector.height, name:pending.title || 'SVG 矢量图'}];
  setNodeStatus(pending.id, pending.status);
  refreshRenderedNode(pending.id);
  if (!sourceNode._deferCanvasSave) await saveCanvasState();
}
