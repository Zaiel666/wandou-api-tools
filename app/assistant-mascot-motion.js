/* One portrait, continuously deformed. The nameplate and pointer target stay still. */
(() => {
  const button = document.getElementById('assistantToggleButton');
  const canvas = button?.querySelector('.assistant-mascot-motion');
  const portrait = button?.querySelector('.assistant-mascot');
  if (!canvas || !portrait) return;
  // A packaged data URL avoids opaque file-origin restrictions in desktop views.
  const textureImage = new Image();
  const portraitSource = window.WandouMascotPortrait;
  delete window.WandouMascotPortrait;
  if (!portraitSource) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const canvasWrap = document.querySelector('.canvas-wrap');
  const cycle = 8.4;
  let gl, program, texture, buffer, uniforms;
  let frame = 0, lastTime = null, elapsed = 0;
  let visible = true, ready = false, disposed = false, failed = false;

  const vertexSource = `
    attribute vec2 position;
    varying vec2 uv;
    void main() {
      uv = vec2(position.x * .5 + .5, .5 - position.y * .5);
      gl_Position = vec4(position, 0., 1.);
    }
  `;
  const fragmentSource = `
    precision mediump float;
    uniform sampler2D portrait;
    uniform vec4 pose; // gaze, breath, lean, sprout
    uniform float blink;
    varying vec2 uv;

    vec2 eye(vec2 p, vec2 center) {
      vec2 d = p - center;
      // Move the eye and its immediate skin together, with no cutout boundary.
      float gazeWeight = (1. - smoothstep(.052, .098, abs(d.x)))
                       * (1. - smoothstep(.064, .108, abs(d.y)));
      p.x -= pose.x * .009 * gazeWeight;
      d = p - center;
      // Inverse eyelid deformation: compress the eye; smoothly extend nearby skin.
      // The outer boundary is fixed, so no second expression or opacity blend is needed.
      float column = sqrt(max(0., 1. - pow(d.x / .057, 2.)));
      float outer = .069 * column;
      float openRadius = .060 * column;
      float lidRadius = openRadius * (1. - .88 * blink);
      float lidCenter = -.006 * blink * column;
      float offset = d.y - lidCenter;
      float sourceY;
      if (abs(offset) < lidRadius) {
        sourceY = offset * openRadius / max(lidRadius, .0001);
      } else if (offset > 0.) {
        sourceY = openRadius + (offset - lidRadius) * (outer - openRadius) / max(outer - lidCenter - lidRadius, .0001);
      } else {
        sourceY = -openRadius + (offset + lidRadius) * (outer - openRadius) / max(outer + lidCenter - lidRadius, .0001);
      }
      float lidWeight = 1. - smoothstep(.052, .057, abs(d.x));
      if (abs(d.y) < outer) p.y += (sourceY - d.y) * lidWeight;
      return p;
    }

    void main() {
      vec2 p = uv;
      // Motion fades out above the hands. Everything below y=.80 is unchanged.
      float head = 1. - smoothstep(.65, .80, p.y);
      vec2 pivot = p - vec2(.51, .76);
      float angle = pose.z * head;
      p = vec2(cos(angle) * pivot.x + sin(angle) * pivot.y,
               -sin(angle) * pivot.x + cos(angle) * pivot.y) + vec2(.51, .76);
      p.y += pose.y * head;
      p.x -= pose.x * .004 * head;
      p.x -= pose.w * (1. - smoothstep(.17, .34, p.y));
      p = eye(p, vec2(.418, .590));
      p = eye(p, vec2(.677, .590));
      // Use only the original open-eyed portrait.
      vec2 bounded = clamp(p, vec2(.001), vec2(.999));
      vec4 color = texture2D(portrait, bounded);
      float inside = step(0., p.x) * step(p.x, 1.) * step(0., p.y) * step(p.y, 1.);
      gl_FragColor = color * inside;
    }
  `;

  function smooth(a, b, t) {
    const v = Math.max(0, Math.min(1, (t - a) / (b - a)));
    return v * v * (3 - 2 * v);
  }
  function look(t, start, end) {
    return smooth(start, start + .55, t) * (1 - smooth(end - .55, end, t));
  }
  function eyelid(t, center) {
    const distance = Math.abs(t - center) / .14;
    return distance < 1 ? (1 + Math.cos(distance * Math.PI)) * .5 : 0;
  }
  function draw() {
    const t = elapsed % cycle, phase = t / cycle * Math.PI * 2;
    const gaze = -look(t, .8, 3.15) + look(t, 4.55, 7.25);
    gl.uniform4f(uniforms.pose, gaze, Math.sin(phase * 2) * .005,
      Math.sin(phase) * .016, Math.sin(phase + .35) * .006);
    gl.uniform1f(uniforms.blink, Math.max(eyelid(t, 3.65), eyelid(t, 7.65)));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    lastTime = null;
  }
  function tick(now) {
    frame = 0;
    if (lastTime !== null) elapsed += Math.min((now - lastTime) / 1000, .05);
    lastTime = now;
    draw();
    frame = requestAnimationFrame(tick);
  }
  function sync() {
    if (!ready || disposed) return;
    const active = !reducedMotion.matches && !document.hidden && visible
      && !button.hasAttribute('data-mascot-dragging')
      && !canvasWrap?.matches('.is-panning,.is-zooming')
      && !document.body.classList.contains('desktop-tab-inactive');
    if (active && !frame) frame = requestAnimationFrame(tick);
    else if (!active) stop();
  }
  function resize() {
    if (!ready) return;
    const size = Math.max(1, Math.round(canvas.clientWidth * Math.min(window.devicePixelRatio || 1, 2)));
    if (canvas.width !== size || canvas.height !== size) {
      canvas.width = canvas.height = size;
      gl.viewport(0, 0, size, size);
      draw();
    }
  }
  function release() {
    if (!gl || gl.isContextLost()) return;
    if (texture) gl.deleteTexture(texture);
    if (buffer) gl.deleteBuffer(buffer);
    if (program) gl.deleteProgram(program);
    texture = buffer = program = null;
  }
  function fallback() {
    ready = false;
    stop();
    delete button.dataset.mascotAnimated;
  }
  function shader(type, source) {
    const value = gl.createShader(type);
    gl.shaderSource(value, source);
    gl.compileShader(value);
    if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) {
      gl.deleteShader(value);
      throw new Error('Mascot shader unavailable');
    }
    return value;
  }
  function initialize() {
    if (ready || disposed || failed || reducedMotion.matches || !textureImage.naturalWidth) return;
    try {
      gl = canvas.getContext('webgl', {
        alpha: true, antialias: false, depth: false, stencil: false,
        premultipliedAlpha: true, powerPreference: 'low-power'
      });
      if (!gl) { failed = true; return; }
      program = gl.createProgram();
      for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]]) {
        const compiled = shader(type, source);
        gl.attachShader(program, compiled);
        gl.deleteShader(compiled);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Mascot program unavailable');
      gl.useProgram(program);
      buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'position');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      uniforms = {pose: gl.getUniformLocation(program, 'pose'), blink: gl.getUniformLocation(program, 'blink')};
      texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textureImage);
      ready = true;
      resize();
      draw();
      button.dataset.mascotAnimated = 'true';
      sync();
    } catch (_) {
      failed = true;
      fallback();
      release();
    }
  }
  const visibilityObserver = new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    sync();
  });
  visibilityObserver.observe(button);
  const dragObserver = new MutationObserver(sync);
  dragObserver.observe(button, {attributes: true, attributeFilter: ['data-mascot-dragging']});
  if (canvasWrap) dragObserver.observe(canvasWrap, {attributes: true, attributeFilter: ['class']});
  dragObserver.observe(document.body, {attributes: true, attributeFilter: ['class']});
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  document.addEventListener('visibilitychange', sync);
  reducedMotion.addEventListener('change', () => { initialize(); sync(); });
  textureImage.addEventListener('load', initialize, {once: true});
  textureImage.src = portraitSource;
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); fallback(); });
  canvas.addEventListener('webglcontextrestored', () => { failed = false; initialize(); });
  window.addEventListener('pagehide', event => {
    stop();
    if (event.persisted) return;
    disposed = true;
    visibilityObserver.disconnect();
    dragObserver.disconnect();
    resizeObserver.disconnect();
    release();
  });
  window.addEventListener('pageshow', sync);
  initialize();
})();
