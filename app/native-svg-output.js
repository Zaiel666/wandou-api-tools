(function (root) {
  "use strict";
  const MIME = "image/svg+xml";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const XLINK_NS = "http://www.w3.org/1999/xlink";
  const LIMITS = Object.freeze({ bytes:8 * 1024 * 1024, elements:20000, depth:64, expandedElements:100000, pathCharacters:2000000, edge:65536 });
  const tags = new Set("svg g defs path rect circle ellipse line polyline polygon text tspan textPath title desc linearGradient radialGradient stop clipPath mask pattern symbol use style".split(" "));
  const attributes = new Set(("id class x y x1 y1 x2 y2 cx cy r rx ry width height viewBox preserveAspectRatio d points pathLength transform " +
    "fill fill-rule fill-opacity stroke stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset stroke-opacity opacity color " +
    "gradientUnits gradientTransform spreadMethod offset stop-color stop-opacity fx fy fr clip-path clip-rule clipPathUnits mask maskUnits maskContentUnits " +
    "patternUnits patternContentUnits patternTransform font-family font-size font-weight font-style font-variant font-stretch text-anchor dominant-baseline alignment-baseline " +
    "letter-spacing word-spacing text-decoration textLength lengthAdjust dx dy rotate startOffset method spacing vector-effect paint-order shape-rendering text-rendering " +
    "display visibility overflow style href version role aria-label").split(/\s+/));
  const cssProperties = new Set(("fill fill-rule fill-opacity stroke stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset stroke-opacity opacity color " +
    "stop-color stop-opacity clip-path clip-rule mask font-family font-size font-weight font-style font-variant font-stretch text-anchor dominant-baseline alignment-baseline " +
    "letter-spacing word-spacing text-decoration vector-effect paint-order shape-rendering text-rendering display visibility overflow transform transform-origin").split(/\s+/));
  const localId = /^[\p{L}_][\p{L}\p{N}_.:-]*$/u;

  function fail(message) { throw new Error(`SVG 文件无法使用：${message}`); }
  function checkAbort(signal) { if (signal?.aborted) throw new DOMException("已取消 SVG 处理", "AbortError"); }
  function reference(value) {
    const clean = String(value || "").trim();
    if (!clean.startsWith("#") || !localId.test(clean.slice(1))) fail("只允许文件内部的矢量引用");
    return clean.slice(1);
  }
  function valueReferences(value) {
    if (/[\\@\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) || /(?:expression|javascript|vbscript|image-set)\s*[:(]/i.test(value)) fail("包含不支持的样式内容");
    const refs = [];
    const remaining = value.replace(/url\(\s*(['"]?)(#[^\s'"()]+)\1\s*\)/gi, (_, quote, id) => { refs.push(reference(id)); return ""; });
    if (/url\s*\(/i.test(remaining) || /(?:https?:|data:|file:|blob:|\/\/)/i.test(remaining)) fail("不允许外部资源或嵌入位图");
    return refs;
  }
  function declarations(text) {
    if (/[{}]/.test(text)) fail("样式声明格式无效");
    const refs = [];
    for (const declaration of text.split(";")) {
      if (!declaration.trim()) continue;
      const colon = declaration.indexOf(":");
      if (colon < 1) fail("样式声明格式无效");
      const property = declaration.slice(0, colon).trim().toLowerCase();
      const value = declaration.slice(colon + 1).trim();
      if (!cssProperties.has(property) || !value) fail("包含不支持的样式属性");
      refs.push(...valueReferences(value));
    }
    return refs;
  }
  function stylesheet(text) {
    // No CSS escapes, at-rules or imports. Comments are removed only for validation;
    // the original UTF-8 bytes are retained for export.
    const clean = text.replace(/\/\*[\s\S]*?\*\//g, "");
    if (/[\\@]/.test(clean)) fail("不允许 CSS 导入、转义或动态规则");
    const refs = [];
    let position = 0;
    const pattern = /([^{}]+)\{([^{}]*)\}/g;
    let match;
    while ((match = pattern.exec(clean))) {
      if (clean.slice(position, match.index).trim()) fail("样式规则格式无效");
      if (!/^[\p{L}\p{N}_.#\s,:>*+~\-\[\]="'()|^$]+$/u.test(match[1])) fail("不支持此样式选择器");
      refs.push(...declarations(match[2]));
      position = pattern.lastIndex;
    }
    if (clean.slice(position).trim()) fail("样式规则格式无效");
    return refs;
  }
  function pixelLength(value) {
    const match = String(value || "").trim().match(/^([+]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(px|pt|pc|in|cm|mm)?$/i);
    if (!match) return null;
    const units = { px:1, pt:96 / 72, pc:16, in:96, cm:96 / 2.54, mm:96 / 25.4 };
    const n = Number(match[1]) * (units[(match[2] || "px").toLowerCase()] || 1);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  function validate(text) {
    if (typeof text !== "string" || !text.trim()) fail("接口没有返回 SVG 内容");
    if (new TextEncoder().encode(text).byteLength > LIMITS.bytes) fail("文件超过 8 MB 限制");
    if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(text)) fail("不允许文档类型或外部实体");
    const withoutDeclaration = text.replace(/^\uFEFF?\s*<\?xml\s[^?]*\?>/i, "");
    if (/<\?/.test(withoutDeclaration)) fail("不允许处理指令");
    const encoding = text.match(/^\uFEFF?\s*<\?xml\b[^?]*encoding\s*=\s*['"]([^'"]+)['"]/i);
    if (encoding && !/^utf-8$/i.test(encoding[1])) fail("只支持 UTF-8 XML 编码");
    if (typeof DOMParser === "undefined") fail("当前环境缺少 SVG 解析器");
    const doc = new DOMParser().parseFromString(text, MIME);
    const svg = doc.documentElement;
    if (!svg || svg.localName !== "svg" || svg.namespaceURI !== SVG_NS || doc.getElementsByTagName("parsererror").length) fail("接口返回的文件不是有效 SVG");
    const elements = [svg, ...svg.getElementsByTagName("*")];
    if (elements.length > LIMITS.elements) fail("矢量对象数量超过限制");
    const ids = new Map(), dependencies = new Map();
    let pathCharacters = 0;
    for (const element of elements) {
      if (element.namespaceURI !== SVG_NS || !tags.has(element.localName)) fail("含非静态矢量元素，不能作为原生 SVG 保存");
      let depth = 0;
      for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) if (++depth > LIMITS.depth) fail("矢量分组层级过深");
      const id = element.getAttribute("id");
      if (id) {
        if (!localId.test(id) || ids.has(id)) fail("矢量对象标识无效或重复");
        ids.set(id, element);
      }
      const refs = [];
      for (const attribute of element.attributes) {
        if (attribute.namespaceURI === "http://www.w3.org/2000/xmlns/") {
          if (![SVG_NS, XLINK_NS].includes(attribute.value)) fail("包含不支持的命名空间");
          continue;
        }
        if (attribute.namespaceURI === "http://www.w3.org/XML/1998/namespace" && ["space", "lang"].includes(attribute.localName)) continue;
        if (attribute.namespaceURI && !(attribute.namespaceURI === XLINK_NS && attribute.localName === "href")) fail("包含不支持的属性命名空间");
        const name = attribute.localName, value = attribute.value;
        if (/^on/i.test(name) || !attributes.has(name)) fail("包含不支持的矢量属性");
        if (name === "href") refs.push(reference(value));
        else if (name === "style") refs.push(...declarations(value));
        else if (!["id", "class", "aria-label"].includes(name)) refs.push(...valueReferences(value));
        if (name === "d" || name === "points") pathCharacters += value.length;
      }
      if (element.localName === "style") refs.push(...stylesheet(element.textContent));
      if (element.localName === "use" && !refs.length) fail("矢量复用对象缺少内部引用");
      dependencies.set(element, refs);
    }
    if (pathCharacters > LIMITS.pathCharacters) fail("矢量路径复杂度超过限制");
    // Count expanded references, not just source tags: small nested <use> chains
    // can otherwise expand exponentially and stall the renderer.
    const sizes = new Map(), visiting = new Set();
    function expanded(element, depth) {
      if (depth > LIMITS.depth || visiting.has(element)) fail("矢量引用循环或层级过深");
      if (sizes.has(element)) return sizes.get(element);
      visiting.add(element);
      let count = 1;
      for (const child of element.children) {
        count += expanded(child, depth + 1);
        if (count > LIMITS.expandedElements) fail("矢量引用展开数量超过限制");
      }
      for (const id of dependencies.get(element)) {
        const target = ids.get(id);
        if (!target) fail("矢量文件包含缺失的内部引用");
        count += expanded(target, depth + 1);
        if (count > LIMITS.expandedElements) fail("矢量引用展开数量超过限制");
      }
      visiting.delete(element); sizes.set(element, count); return count;
    }
    expanded(svg, 0);
    const viewBox = (svg.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
    const hasViewBox = viewBox.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0;
    if (svg.hasAttribute("viewBox") && !hasViewBox) fail("viewBox 尺寸无效");
    let width = pixelLength(svg.getAttribute("width")), height = pixelLength(svg.getAttribute("height"));
    if (!width && hasViewBox) width = height ? height * viewBox[2] / viewBox[3] : viewBox[2];
    if (!height && hasViewBox) height = width ? width * viewBox[3] / viewBox[2] : viewBox[3];
    if (!width || !height || Math.max(width, height) > LIMITS.edge) fail("SVG 尺寸缺失或超过 65536 限制");
    return Object.freeze({ width, height, format:"svg", mimeType:MIME, elementCount:elements.length });
  }
  function bytesFromBase64(value) {
    const clean = String(value || "").replace(/\s+/g, "");
    if (!clean || clean.length > Math.ceil(LIMITS.bytes / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) fail("base64 文件内容无效或过大");
    let decoded;
    try { decoded = atob(clean); } catch (_) { fail("base64 文件内容无效"); }
    return Uint8Array.from(decoded, character => character.charCodeAt(0));
  }
  function dataUrl(bytes) {
    let binary = "";
    for (let start = 0; start < bytes.length; start += 32768) binary += String.fromCharCode(...bytes.subarray(start, start + 32768));
    return `data:${MIME};base64,${btoa(binary)}`;
  }
  async function inputBytes(input) {
    if (typeof input === "string") {
      if (/^data:/i.test(input)) {
        const match = input.match(/^data:image\/svg\+xml(?:;charset=utf-8)?(;base64)?,([\s\S]*)$/i);
        if (!match) fail("输入类型不是 SVG");
        if (match[1]) return bytesFromBase64(match[2]);
        try { return new TextEncoder().encode(decodeURIComponent(match[2])); } catch (_) { fail("SVG data URL 编码无效"); }
      }
      return new TextEncoder().encode(input);
    }
    if (input instanceof Blob) {
      if (input.size > LIMITS.bytes) fail("文件超过 8 MB 限制");
      return new Uint8Array(await input.arrayBuffer());
    }
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    fail("未收到可读取的 SVG 文件");
  }
  function preview(blob, dimensions, maxEdge, signal) {
    checkAbort(signal);
    const url = URL.createObjectURL(blob);
    return new Promise((resolve, reject) => {
      const image = new Image();
      let finished = false;
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); image.onload = image.onerror = null; URL.revokeObjectURL(url); };
      const done = (error, value) => { if (finished) return; finished = true; cleanup(); if (error) reject(error); else resolve(value); };
      const abort = () => { image.src = ""; done(new DOMException("已取消 SVG 预览", "AbortError")); };
      const timer = setTimeout(() => { image.src = ""; done(new Error("SVG 预览超时")); }, 10000);
      signal?.addEventListener("abort", abort, { once:true });
      image.onerror = () => done(new Error("SVG 预览读取失败"));
      image.onload = () => {
        try {
          checkAbort(signal);
          const scale = Math.min(1, maxEdge / Math.max(dimensions.width, dimensions.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(dimensions.width * scale));
          canvas.height = Math.max(1, Math.round(dimensions.height * scale));
          const context = canvas.getContext("2d", { willReadFrequently:true });
          if (!context) throw new Error("无法创建 SVG 预览");
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          let hasTransparency = false;
          for (let index = 3; index < pixels.length; index += 4) if (pixels[index] < 255) { hasTransparency = true; break; }
          const previewUrl = canvas.toDataURL("image/png");
          canvas.width = canvas.height = 1;
          done(null, { previewUrl, hasTransparency });
        } catch (error) { done(error); }
      };
      image.src = url;
      if (signal?.aborted) abort();
    });
  }
  async function prepare(input, options = {}) {
    checkAbort(options.signal);
    const bytes = await inputBytes(input);
    checkAbort(options.signal);
    if (!bytes.byteLength || bytes.byteLength > LIMITS.bytes) fail("文件为空或超过 8 MB 限制");
    let text;
    try { text = new TextDecoder("utf-8", { fatal:true }).decode(bytes); } catch (_) { fail("接口返回的文件不是 UTF-8 SVG"); }
    const metadata = validate(text);
    const blob = new Blob([bytes], { type:MIME });
    const originalUrl = dataUrl(bytes);
    const result = { ...metadata, blob, dataUrl:originalUrl, previewUrl:originalUrl, byteLength:bytes.byteLength, previewFallback:false };
    if (options.preview === false) return result;
    try {
      const maxEdge = Math.max(32, Math.min(2048, Number(options.previewMaxEdge) || 1024));
      Object.assign(result, await preview(blob, metadata, maxEdge, options.signal));
    } catch (error) {
      checkAbort(options.signal);
      result.previewFallback = true;
      // A preview failure must not discard a valid original or cause regeneration.
    }
    checkAbort(options.signal);
    return result;
  }
  const api = Object.freeze({ prepare, validate, fromBase64:(value, options) => prepare(bytesFromBase64(value), options), mimeType:MIME, limits:LIMITS });
  root.WandouNativeSvg = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
