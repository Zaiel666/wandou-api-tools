/* Local-only director data: no credentials, HTTP or generation calls. */
(function (root) {
  const clamp = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
  const vector = (value, fallback, limit = 100) => fallback.map((v, i) => clamp(value?.[i], -limit, limit, v));
  function pose(value = {}) {
    return { position: vector(value.position, [5, 3, 6]), target: vector(value.target, [0, .7, 0]),
      subject: vector(value.subject, [0, 0, 0]), yaw: clamp(value.yaw, -720, 720, 0),
      fov: clamp(value.fov, 20, 90, 45) };
  }
  function normalize(value = {}) {
    return { version: 1, duration: clamp(value.duration, 2, 15, 4),
      ratio: ['16:9', '9:16', '1:1'].includes(value.ratio) ? value.ratio : '16:9',
      easing: value.easing === 'linear' ? 'linear' : 'smooth',
      background: /^#[0-9a-f]{6}$/i.test(value.background || '') ? value.background : '#dddddd',
      light: clamp(value.light, .3, 5, 2.5), grid: value.grid !== false,
      current: pose(value.current), start: value.start ? pose(value.start) : null,
      end: value.end ? pose(value.end) : null };
  }
  function interpolate(a, b, progress, easing = 'smooth') {
    a = pose(a); b = pose(b);
    let t = clamp(progress, 0, 1, 0);
    if (easing !== 'linear') t = t * t * (3 - 2 * t);
    const lerp = (x, y) => x + (y - x) * t;
    return {position: a.position.map((v, i) => lerp(v, b.position[i])),
      target: a.target.map((v, i) => lerp(v, b.target[i])),
      subject: a.subject.map((v, i) => lerp(v, b.subject[i])),
      yaw: lerp(a.yaw, b.yaw), fov: lerp(a.fov, b.fov)};
  }
  function dimensions(ratio) { return ratio === '9:16' ? [720, 1280] : ratio === '1:1' ? [960, 960] : [1280, 720]; }
  function recordingFormat(Recorder) {
    return ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
      .find(type => Recorder?.isTypeSupported?.(type)) || '';
  }
  function validateModel(name, size) {
    if (/\.blend$/i.test(name)) throw new Error('BLEND_CONVERSION_REQUIRED');
    if (!/\.(glb|obj|fbx)$/i.test(name)) throw new Error('请选择 GLB、OBJ 或 FBX 文件。Blender 工程需先在本地转换为 GLB。');
    if (!(size > 0) || size > 20 * 1024 * 1024) throw new Error('模型须大于 0 且不超过 20 MB。');
    return name.toLowerCase().split('.').pop();
  }
  const api = {clamp, pose, normalize, interpolate, dimensions, recordingFormat, validateModel};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WandouDirectorCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
