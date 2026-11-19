/* Describe the submitted output contract without changing a provider's original file. */
(function (root) {
  'use strict';
  const formats = ['png', 'jpeg', 'webp', 'svg', 'gif'];
  const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
  function capture(body) {
    try {
      if (typeof body === 'string') body = JSON.parse(body);
      if (!body || typeof body !== 'object') return null;
      const read = key => typeof body.get === 'function' ? body.get(key) : body[key];
      const format = String(read('output_format') || '').toLowerCase();
      if (!formats.includes(format)) return null;
      const rawSize = String(read('size') || '').toLowerCase();
      const size = rawSize === 'auto' || /^\d{1,5}x\d{1,5}$/.test(rawSize) && rawSize.split('x').every(v => +v > 0 && +v <= 65535) ? rawSize : null;
      const count = Number(read('frame_count')), duration = Number(read('frame_duration_ms'));
      return {version:1, format, size, frameCount:format === 'gif' && Number.isInteger(count) && count >= 2 && count <= 16 ? count : null,
        frameDurationMs:format === 'gif' && Number.isInteger(duration) && duration >= 20 && duration <= 655350 ? duration : null};
    } catch { return null; }
  }
  function requestSnapshot(value) {
    if (!value || value.version !== 1) return null;
    return capture({output_format:value.format, size:value.size, frame_count:value.frameCount, frame_duration_ms:value.frameDurationMs});
  }
  function seconds(value) { return String(Math.round(value / 10) / 100); }
  function compare(input, actual = {}) {
    const request = requestSnapshot(input), format = String(actual.format || '').toLowerCase();
    const width = positive(actual.width), height = positive(actual.height), dimensions = width && height ? `${width}×${height}` : '未知尺寸';
    const count = positive(actual.frameCount);
    const durations = Array.isArray(actual.frameDurationsMs) ? actual.frameDurationsMs.slice(0, 256).filter(v => Number.isFinite(v) && v >= 0) : [];
    const completeDurations = count && durations.length === count;
    const duration = completeDurations ? durations.reduce((sum, value) => sum + value, 0) : null;
    let animation = count ? `${count} 帧` : '帧数未知';
    if (completeDurations) animation += durations.every(value => value === durations[0]) ? ` × ${durations[0]} 毫秒` : `（每帧 ${Math.min(...durations)}–${Math.max(...durations)} 毫秒）`;
    if (duration !== null) animation += `，共 ${seconds(duration)} 秒`;
    const actualSummary = format === 'gif' ? `${animation}，${dimensions}` : `${dimensions} SVG 画布`;
    if (!request) return {version:1, hasRequest:false, mismatch:false, ratioMismatch:false, differences:[], requestSummary:'', actualSummary, message:''};
    const differences = [], size = request.size && request.size !== 'auto' ? request.size.split('x').map(Number) : null;
    if (request.format !== format) differences.push('format');
    if (size && width && height && (size[0] !== width || size[1] !== height)) differences.push('size');
    if (format === 'gif' && request.frameCount && count && request.frameCount !== count) differences.push('frame-count');
    // The documented GIF contract rounds submitted durations to the nearest 10 ms.
    const expectedDuration = request.frameDurationMs ? Math.round(request.frameDurationMs / 10) * 10 : null;
    if (format === 'gif' && expectedDuration && completeDurations && durations.some(value => value !== expectedDuration)) differences.push('frame-duration');
    let requestSummary = request.size === 'auto' ? '自动尺寸' : size ? `${size[0]}×${size[1]}` : '未指定尺寸';
    if (request.format === 'gif') requestSummary = `${request.frameCount ? request.frameCount + ' 帧' : '帧数未指定'}${request.frameDurationMs ? ' × ' + request.frameDurationMs + ' 毫秒' + (expectedDuration !== request.frameDurationMs ? '（按规范取 ' + expectedDuration + ' 毫秒）' : '') : ''}，${requestSummary}`;
    if (request.format !== format) requestSummary = request.format.toUpperCase() + '，' + requestSummary;
    const mismatch = differences.length > 0;
    return {version:1, hasRequest:true, mismatch,
      ratioMismatch:Boolean(size && width && height && Math.abs(width / height - size[0] / size[1]) / (size[0] / size[1]) > .08),
      differences, requestSummary, actualSummary,
      message:`${mismatch ? '渠道返回参数与请求不一致。' : ''}请求：${requestSummary}；实际：${actualSummary}。${mismatch ? '已保留返回原件，未调整尺寸或帧时长，也未再次请求生图。' : '已保留返回原件。'}`};
  }
  root.WandouImageOutputContract = Object.freeze({capture, compare, requestSnapshot});
})(globalThis);
