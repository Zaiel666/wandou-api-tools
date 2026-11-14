(function (root) {
  'use strict';
  // Image quality is independent of the requested output dimensions.
  const levels = ['low', 'medium', 'high'];
  const formats = ['png', 'svg', 'gif'];
  function model(node) { return root.WandouImageCapabilities?.normalize(node?.model) || String(node?.model || '').toLowerCase(); }
  function capabilities(node) {
    const id = model(node), advanced = /^gpt-image-2\.6-(?:flare|sunburst)$/.test(id);
    return { svg: advanced, gif: advanced, complexity: advanced, quality: advanced || /^gpt-image-(?:1(?:\.5|-mini)?|2|2\.5-(?:flare|sunburst))$/.test(id) };
  }
  function normalise(node = {}) {
    return {format: String(node.imageOutputFormat || node.outputFormat || 'png').toLowerCase(), quality: node.imageQuality || 'high', complexity: node.imageComplexity || 'high', frameCount: node.gifFrameCount == null ? 9 : Number(node.gifFrameCount), frameDurationMs: node.gifFrameDurationMs == null ? 200 : Number(node.gifFrameDurationMs)};
  }
  function validate(node, references = []) {
    const value = normalise(node), cap = capabilities(node);
    if (!formats.includes(value.format)) return '请选择 PNG、SVG 或 GIF 输出格式。';
    if (value.format !== 'png' && !cap[value.format]) return 'SVG 矢量和 GIF 动图需要 GPT-Image-2.6 Flare 或 Sunburst；请切换模型或选择 PNG。';
    if (cap.quality && !levels.includes(value.quality)) return '生成质量应选择低、中或高。';
    if (cap.complexity && !levels.includes(value.complexity)) return '复杂度应选择低、中或高。';
    if (value.format === 'svg' && references?.length) return 'SVG 目前仅支持文字生成，请移除参考图，或改用 PNG / GIF。';
    if (value.format === 'gif') {
      if (!Number.isInteger(value.frameCount) || value.frameCount < 2 || value.frameCount > 16) return 'GIF 帧数应为 2–16 的整数。';
      if (!Number.isInteger(value.frameDurationMs) || value.frameDurationMs < 20 || value.frameDurationMs > 2000 || value.frameDurationMs % 10) return 'GIF 每帧时长应为 20–2000 毫秒，且为 10 的倍数。';
      if (node.markupDataUrl || node.markupImage || node.mask || node.maskDataUrl) return 'GIF 动图不支持蒙版或标注编辑，请改用 PNG。';
    }
    return '';
  }
  function requestFields(node) {
    const error = validate(node); if (error) throw new Error(error);
    const value = normalise(node), cap = capabilities(node), result = {};
    if (cap.quality) result.quality = value.quality;
    if (cap.complexity) result.complexity = value.complexity;
    if (cap.quality || value.format !== 'png') result.output_format = value.format;
    if (value.format === 'svg') result.n = 1;
    if (value.format === 'gif') Object.assign(result, {n: 1, size: 'auto', frame_count: value.frameCount, frame_duration_ms: value.frameDurationMs});
    return result;
  }
  function escape(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]); }
  function render(node, options = {}) {
    const value = normalise(node), cap = capabilities(node), disabled = options.disabled ? ' disabled' : '';
    const select = (label, field, selected) => `<div class="form-row wd-generation-row"><label>${label}</label><select class="wd-generation-select" aria-label="${label}" data-image-option="${field}"${disabled}>${levels.map((level, index) => `<option value="${level}"${selected === level ? ' selected' : ''}>${['低','中','高'][index]}</option>`).join('')}</select></div>`;
    let html = '';
    if (options.includeFormat) html += `<div class="form-row wd-generation-row"><label>输出格式</label><div class="choice-options wd-generation-formats">${formats.map((format, index) => `<button type="button" class="choice-option ${value.format === format ? 'active' : ''}" data-image-format="${format}" aria-pressed="${value.format === format}"${disabled || (format !== 'png' && !cap[format] ? ' disabled title="需要 GPT-Image-2.6 Flare 或 Sunburst"' : '')}>${['PNG 图片','SVG 矢量','GIF 动图'][index]}</button>`).join('')}</div></div>`;
    if (cap.quality) html += select('生成质量', 'imageQuality', value.quality);
    if (cap.complexity) html += select('内容复杂度', 'imageComplexity', value.complexity);
    if (cap.quality) html += '<p class="wd-generation-help">生成质量影响细节与耗时；输出尺寸单独设置。</p>';
    if (value.format === 'svg') html += '<p class="wd-generation-help">SVG 保留矢量原文件；仅文字生成，单次 1 张，不进行像素放大。需当前渠道开放对应模型。本软件的透明背景选项仅用于 PNG。</p>';
    if (value.format === 'gif') html += `<div class="wd-generation-animation"><div class="form-row wd-generation-row"><label>帧数</label><input class="wd-generation-input" type="number" aria-label="GIF 帧数" data-image-option="gifFrameCount" min="2" max="16" step="1" value="${escape(value.frameCount)}"${disabled}></div><div class="form-row wd-generation-row"><label>每帧时长（毫秒）</label><input class="wd-generation-input" type="number" aria-label="GIF 每帧时长（毫秒）" data-image-option="gifFrameDurationMs" min="20" max="2000" step="10" value="${escape(value.frameDurationMs)}"${disabled}></div></div><p class="wd-generation-help">GIF 单次生成 1 个动画，尺寸由模型自动选择；保留原始帧，不做 1K / 2K / 4K 本地放大。</p>`;
    if (value.format === 'gif') html += '<p class="wd-generation-help">GIF 需渠道开通对应模型的 GIF 预览权限。本软件不提供 GIF 透明背景选项；如返回透明像素，将保留在原件中。</p>';
    const error = validate(node);
    html += `<p class="wd-generation-error" role="status"${error ? '' : ' hidden'}>${escape(error)}</p>`;
    return `<div class="wd-generation-options" data-image-options>${html}</div>`;
  }
  function bind(container, node, hooks = {}) {
    // Called on each panel render; remove old delegation if a persistent host is reused.
    container.__wdImageOptionsCleanup?.();
    const change = event => {
      const element = event.target.closest?.('[data-image-format], [data-image-option]');
      if (!element || !container.contains(element) || element.disabled || hooks.isBusy?.()) return;
      const isFormat = element.hasAttribute('data-image-format');
      if ((isFormat && event.type !== 'click') || (!isFormat && event.type !== 'change')) return;
      event.preventDefault(); event.stopPropagation();
      const field = isFormat ? 'imageOutputFormat' : element.dataset.imageOption;
      if (!['imageOutputFormat','imageQuality','imageComplexity','gifFrameCount','gifFrameDurationMs'].includes(field)) return;
      const value = isFormat ? element.dataset.imageFormat : field.startsWith('gif') ? Number(element.value) : element.value;
      const previous = node[field], next = {...node, [field]: value};
      const error = validate(next);
      const notice = container.querySelector('.wd-generation-error');
      if (notice) { notice.textContent = error; notice.hidden = !error; }
      if (error) { element.setAttribute('aria-invalid', 'true'); return; }
      element.removeAttribute('aria-invalid');
      if (previous === value) return;
      const detail = {field, value, previous, node, formatChanged: isFormat};
      hooks.onBeforeChange?.(detail);
      node[field] = value;
      if (isFormat) { node.outputFormat = value; if (value !== 'png') { node.count = 1; node.autoSplit = false; } }
      hooks.onChange?.(detail);
    };
    container.addEventListener('click', change); container.addEventListener('change', change);
    const cleanup = () => { container.removeEventListener('click', change); container.removeEventListener('change', change); };
    container.__wdImageOptionsCleanup = cleanup;
    return cleanup;
  }
  const api = Object.freeze({normalise, capabilities, validate, requestFields, render, bind});
  root.WandouImageOptions = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
