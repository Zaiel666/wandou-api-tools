(function () {
  const BRAND = "豌豆AI绘图工作台";
  const API_URL = `${atob("aHR0cHM6Ly93d3cuemF5YXBpLnRvcA==")}/v1`;
  const MODEL_OPTIONS = [
    "gpt-image-2",
    "Nano Banana2",
    "Nano BananaPro"
  ];
  const MODEL_API_MAP = {
    "gpt-image-2": "gpt-image-2",
    "Nano Banana2": "gemini-3.1-flash-image-preview",
    "Nano BananaPro": "gemini-3-pro-image-preview"
  };
  const API_MODEL_LABEL_MAP = {
    "gemini-3.1-flash-image-preview": "Nano Banana2",
    "gemini-3-pro-image-preview": "Nano BananaPro"
  };
  const DEFAULT_MODEL = MODEL_OPTIONS[0];
  const SIZE_OPTIONS = [
    "auto",
    "1024x1024",
    "1536x1024",
    "1024x1536",
    "2048x2048",
    "2048x1360",
    "1360x2048",
    "4096x4096",
    "4096x2304",
    "2304x4096",
    "4096x3072",
    "3072x4096"
  ];
  const QUALITY_OPTIONS = [
    { value: "low", label: "1k" },
    { value: "medium", label: "2k" },
    { value: "high", label: "4k" }
  ];
  const QUALITY_LEGACY_TITLE = "\u8d28\u91cf";
  const RESOLUTION_TITLE = "\u5206\u8fa8\u7387";
  const RESOLUTION_SOURCE_KEY = "wd-resolution-source";
  const TARGET_SIZE_KEY = "wd-last-target-size";
  const RESOLUTION_EDGE = { low: 1024, medium: 2048, high: 4096 };
  const COMMON_ASPECTS = [
    [1, 1],
    [2, 3],
    [3, 2],
    [3, 4],
    [4, 3],
    [5, 7],
    [7, 5],
    [7, 10],
    [10, 7],
    [9, 16],
    [16, 9]
  ];
  const nativeFetch = window.fetch.bind(window);
  const nativeMatchMedia = window.matchMedia?.bind(window);
  const inputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  let applying = false;
  let duplicatingSubmit = false;
  const themeMediaListeners = new Set();
  const AUTO_SAVE_DB = "wandou-auto-save-v1";
  const AUTO_SAVE_STORE = "handles";
  const AUTO_SAVE_HANDLE_KEY = "default-output-directory";
  const AUTO_SAVE_DONE_KEY = "wd-workbench-autosaved-v1";
  let autoSaveHandle = null;
  let autoSaveHandleLoaded = false;
  let autoSaveStatusTimer = null;

  function readGlobalApiKey() {
    try {
      const globalConfig = JSON.parse(localStorage.getItem("ai-tools-api-config") || "{}");
      if (globalConfig.key) return String(globalConfig.key);
    } catch {}
    try {
      const canvasConfig = JSON.parse(localStorage.getItem("aiCanvasApi") || "{}");
      if (canvasConfig.key) return String(canvasConfig.key);
    } catch {}
    return "";
  }

  function syncWorkbenchApiConfig() {
    try {
      const key = readGlobalApiKey();
      const raw = localStorage.getItem("gpt-image-playground");
      const store = raw ? JSON.parse(raw) : { state: {}, version: 0 };
      store.state = store.state || {};
      store.state.settings = store.state.settings || {};
      const settings = store.state.settings;
      settings.baseUrl = API_URL;
      if (key) settings.apiKey = key;
      settings.model = modelToApiModel(normalizeModelName(settings.model || DEFAULT_MODEL));
      settings.timeout = 999;
      settings.apiMode = settings.apiMode || "images";
      settings.profiles = Array.isArray(settings.profiles) && settings.profiles.length ? settings.profiles : [{
        id: "default-openai",
        name: "默认",
        provider: "openai",
        model: modelToApiModel(DEFAULT_MODEL),
        timeout: 999,
        apiMode: "images"
      }];
      settings.profiles = settings.profiles.map((profile, index) => ({
        ...profile,
        name: index === 0 ? "默认" : profile.name,
        provider: profile.provider || "openai",
        baseUrl: API_URL,
        apiKey: key || profile.apiKey || "",
        model: modelToApiModel(normalizeModelName(profile.model || settings.model || DEFAULT_MODEL)),
        timeout: 999,
        apiMode: profile.apiMode || settings.apiMode || "images"
      }));
      settings.activeProfileId = settings.activeProfileId || settings.profiles[0].id;
      localStorage.setItem("gpt-image-playground", JSON.stringify(store));
    } catch {}
  }

  syncWorkbenchApiConfig();

  function closeForeignMenus() {
    document.querySelectorAll(".wd-count-control.open").forEach((control) => control.classList.remove("open"));
    document.querySelectorAll(".wd-size-control.open").forEach((control) => control.classList.remove("open"));
    document.querySelectorAll(".wd-custom-quality-control.open").forEach((control) => control.classList.remove("open"));
  }

  function closeCountMenusWhenForeignMenuOpens() {
    const hasForeignOpen = Array.from(document.querySelectorAll(".fixed.bottom-4 .absolute, .fixed.bottom-6 .absolute, .fixed.bottom-24 .absolute, .safe-area-x > .flex:first-child .absolute"))
      .some((element) => !element.closest(".wd-count-control") && !element.closest(".wd-size-control") && !element.closest(".wd-custom-quality-control") && element.offsetParent !== null);
    if (hasForeignOpen) {
      document.querySelectorAll(".wd-count-control.open").forEach((control) => control.classList.remove("open"));
      document.querySelectorAll(".wd-size-control.open").forEach((control) => control.classList.remove("open"));
      document.querySelectorAll(".wd-custom-quality-control.open").forEach((control) => control.classList.remove("open"));
    }
  }

  function readTheme() {
    try {
      return window.WandouLocalCache?.readTheme(localStorage.getItem("wd-theme") || "light") || localStorage.getItem("wd-theme") || "light";
    } catch {
      return "light";
    }
  }

  function writeTheme(value) {
    try {
      window.WandouLocalCache?.syncTheme(value);
      localStorage.setItem("wd-theme", value);
    } catch {}
  }

  function makeThemeMediaQueryList(query) {
    const text = String(query || "");
    const isDarkQuery = /prefers-color-scheme\s*:\s*dark/i.test(text);
    const isLightQuery = /prefers-color-scheme\s*:\s*light/i.test(text);
    if (!isDarkQuery && !isLightQuery) return nativeMatchMedia?.(text);
    const mediaQueryList = {
      media: text,
      onchange: null,
      get matches() {
        const isDark = readTheme() === "dark";
        return isDarkQuery ? isDark : !isDark;
      },
      addEventListener(type, listener) {
        if (type === "change" && typeof listener === "function") themeMediaListeners.add(listener);
      },
      removeEventListener(type, listener) {
        if (type === "change") themeMediaListeners.delete(listener);
      },
      addListener(listener) {
        if (typeof listener === "function") themeMediaListeners.add(listener);
      },
      removeListener(listener) {
        themeMediaListeners.delete(listener);
      },
      dispatchEvent(event) {
        themeMediaListeners.forEach((listener) => listener.call(mediaQueryList, event));
        return true;
      }
    };
    return mediaQueryList;
  }

  if (nativeMatchMedia && window.matchMedia?.__wdForcedTheme !== true) {
    window.matchMedia = (query) => makeThemeMediaQueryList(query);
    window.matchMedia.__wdForcedTheme = true;
  }

  function normalizeModelName(value) {
    const text = String(value || "");
    const label = API_MODEL_LABEL_MAP[text] || text;
    return MODEL_OPTIONS.includes(label) ? label : DEFAULT_MODEL;
  }

  function modelToApiModel(model) {
    return MODEL_API_MAP[normalizeModelName(model)] || DEFAULT_MODEL;
  }

  function isNanoBananaModel(model) {
    return /^gemini-.*image-preview$/i.test(String(modelToApiModel(model) || model || ""));
  }

  function readModel() {
    try {
      const value = localStorage.getItem("wd-model");
      return normalizeModelName(value);
    } catch {
      return DEFAULT_MODEL;
    }
  }

  function readQuality() {
    try {
      const value = localStorage.getItem("wd-quality") || "medium";
      return QUALITY_OPTIONS.some((option) => option.value === value) ? value : "medium";
    } catch {
      return "medium";
    }
  }

  function writeQuality(value) {
    try {
      localStorage.setItem("wd-quality", QUALITY_OPTIONS.some((option) => option.value === value) ? value : "medium");
    } catch {}
  }

  function qualityLabel(value) {
    return QUALITY_OPTIONS.find((option) => option.value === value)?.label || "2k";
  }

  function qualityValueFromLabel(text) {
    const value = String(text || "").toLowerCase();
    if (value.includes("1k") || value.includes("low")) return "low";
    if (value.includes("4k") || value.includes("high")) return "high";
    if (value.includes("2k") || value.includes("medium")) return "medium";
    return null;
  }

  function readResolutionSource() {
    try {
      return localStorage.getItem(RESOLUTION_SOURCE_KEY) || "quality";
    } catch {
      return "quality";
    }
  }

  function writeResolutionSource(value) {
    try {
      localStorage.setItem(RESOLUTION_SOURCE_KEY, value === "size" ? "size" : "quality");
    } catch {}
  }

  function parseSizeText(text) {
    const match = String(text || "").match(/(\d{3,5})\s*[x×]\s*(\d{3,5})/i);
    return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
  }

  function writeTargetSize(sizeText) {
    if (!parseSizeText(sizeText)) return;
    try {
      localStorage.setItem(TARGET_SIZE_KEY, sizeText);
    } catch {}
    window.__wdLastTargetSize = sizeText;
  }

  function readTargetSize() {
    return window.__wdLastTargetSize || localStorage.getItem(TARGET_SIZE_KEY) || "";
  }

  function formatSize(width, height) {
    return `${Math.max(1, Math.round(width))}x${Math.max(1, Math.round(height))}`;
  }

  function nearestCommonAspect(width, height) {
    if (!width || !height) return null;
    const ratio = width / height;
    let best = null;
    let bestDelta = Infinity;
    COMMON_ASPECTS.forEach(([w, h]) => {
      const delta = Math.abs(ratio - w / h);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = { width: w, height: h };
      }
    });
    return bestDelta <= 0.035 ? best : null;
  }

  function qualityFromSize(sizeText) {
    const size = parseSizeText(sizeText);
    if (!size) return null;
    const edge = Math.max(size.width, size.height);
    if (edge <= 1280) return "low";
    if (edge <= 2304) return "medium";
    return "high";
  }

  function sizeForQuality(sizeText, quality) {
    const edge = RESOLUTION_EDGE[quality] || RESOLUTION_EDGE.medium;
    const size = parseSizeText(sizeText);
    if (!size) return formatSize(edge, edge);
    const aspect = nearestCommonAspect(size.width, size.height);
    if (aspect) {
      if (aspect.width >= aspect.height) return formatSize(edge, edge * aspect.height / aspect.width);
      return formatSize(edge * aspect.width / aspect.height, edge);
    }
    const maxSide = Math.max(size.width, size.height);
    if (!maxSide) return formatSize(edge, edge);
    const ratio = edge / maxSide;
    return formatSize(size.width * ratio, size.height * ratio);
  }

  function apiSafeGenerationSize(sizeText) {
    const size = parseSizeText(sizeText);
    const maxEdge = 3840;
    const maxPixels = 8294400;
    if (!size) return sizeText;
    if (size.width <= maxEdge && size.height <= maxEdge && size.width * size.height <= maxPixels) return sizeText;
    const scale = Math.min(maxEdge / size.width, maxEdge / size.height, Math.sqrt(maxPixels / (size.width * size.height)));
    let safeWidth = Math.max(16, Math.round(size.width * scale / 16) * 16);
    let safeHeight = Math.max(16, Math.round(size.height * scale / 16) * 16);
    while (safeWidth > maxEdge || safeHeight > maxEdge || safeWidth * safeHeight > maxPixels) {
      safeWidth = Math.max(16, safeWidth - 16);
      safeHeight = Math.max(16, safeHeight - 16);
    }
    return formatSize(safeWidth, safeHeight);
  }

  function isGoogleModel(model) {
    return String(modelToApiModel(model) || "").startsWith("gemini-");
  }

  function readVisibleCount() {
    const input = Array.from(document.querySelectorAll(".wd-count-input")).find((item) => visibleElement(item)) || document.querySelector(".wd-count-input");
    return input ? clampCount(input.value) : 1;
  }

  function readRawVisibleSize() {
    const label = getFieldLabel("尺寸");
    const visibleButton = Array.from(label?.querySelectorAll("button") || [])
      .find((button) => visibleElement(button) && button.title === "选择尺寸");
    const text = normalizeText(visibleButton || label || document.body);
    const match = text.match(/(auto|\d{3,5}x\d{3,5})/i);
    return match?.[1] || "";
  }

  function readVisibleSize() {
    const rawSize = readRawVisibleSize();
    if (readResolutionSource() === "size" && parseSizeText(rawSize)) return rawSize;
    return sizeForQuality(rawSize, readQuality());
  }

  function readCurrentOutputSize() {
    const rawSize = readRawVisibleSize();
    if (rawSize) {
      const sizeText = readResolutionSource() === "size" && parseSizeText(rawSize)
        ? rawSize
        : sizeForQuality(rawSize, readQuality());
      const visibleSize = parseSizeText(sizeText);
      if (visibleSize) return visibleSize;
    }
    return parseSizeText(readTargetSize());
  }

  function getRequestCount(body) {
    const values = [body.n, body.count, body.quantity, body.num_images, readVisibleCount()];
    return clampCount(values.find((value) => Number.parseInt(value, 10) > 1) || 1);
  }

  function isImageRequest(body) {
    return !!body && typeof body === "object" && ("prompt" in body || "image" in body || "input" in body) && ("size" in body || "quality" in body || "model" in body);
  }

  function normalizeImageBody(body, count = 1) {
    const next = { ...body };
    const model = readModel();
    const rawSize = readRawVisibleSize();
    const sizeSource = readResolutionSource();
    const effectiveQuality = sizeSource === "size" ? (qualityFromSize(rawSize) || readQuality()) : readQuality();
    const effectiveSize = sizeSource === "size" && parseSizeText(rawSize) ? rawSize : sizeForQuality(rawSize, effectiveQuality);
    const googleModel = isGoogleModel(model);
    if (effectiveSize) writeTargetSize(effectiveSize);
    if (Object.prototype.hasOwnProperty.call(next, "moderation")) next.moderation = "low";
    if (Object.prototype.hasOwnProperty.call(next, "safety_tolerance")) next.safety_tolerance = 6;
    if (Object.prototype.hasOwnProperty.call(next, "model")) next.model = modelToApiModel(model);
    next.quality = effectiveQuality;
    if (effectiveSize) next.size = apiSafeGenerationSize(effectiveSize);
    if (googleModel) {
      next.model = modelToApiModel(model);
      next.quality = effectiveQuality;
      next.resolution = qualityLabel(effectiveQuality);
      next.output_format = next.output_format || "png";
      if (effectiveSize) next.targetSize = effectiveSize;
      delete next.response_format;
      delete next.moderation;
    }
    ["timeout", "request_timeout", "requestTimeout", "timeout_seconds", "timeoutSeconds"].forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(next, key)) next[key] = 999;
    });
    ["n", "count", "quantity", "num_images"].forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(next, key)) next[key] = count;
    });
    if (!["n", "count", "quantity", "num_images"].some((key) => Object.prototype.hasOwnProperty.call(next, key)) && count > 1) next.n = count;
    window.__wdLastNormalizedImageBody = next;
    return next;
  }

  function normalizeGeminiGenerateEndpoint(input, model) {
    const raw = typeof input === "string" ? input : input?.url || API_URL;
    let clean = String(raw || API_URL).replace(/\/+$/, "");
    clean = clean.replace(/\/v1\/images\/(?:generations|edits).*$/i, "");
    clean = clean.replace(/\/v1(?:beta)?\/?$/i, "");
    return `${clean}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  }

  function dataUrlToGeminiPart(value) {
    const match = String(value || "").match(/^data:([^;,]+);base64,(.+)$/i);
    if (!match) return null;
    return {
      inlineData: {
        mimeType: match[1] || "image/png",
        data: match[2]
      }
    };
  }

  function collectImageDataUrls(value, output = []) {
    if (!value || output.length >= 6) return output;
    if (typeof value === "string") {
      if (/^data:image\//i.test(value) && !output.includes(value)) output.push(value);
      return output;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => collectImageDataUrls(item, output));
      return output;
    }
    if (typeof value === "object") Object.values(value).forEach((item) => collectImageDataUrls(item, output));
    return output;
  }

  function extractNanoBananaImage(data) {
    if (!data) return "";
    if (typeof data === "string") return /^data:image\//i.test(data) ? data : "";
    const inlineData = data.inlineData || data.inline_data;
    if (inlineData?.data) return `data:${inlineData.mimeType || inlineData.mime_type || "image/png"};base64,${String(inlineData.data).replace(/^data:[^,]+,/, "")}`;
    if (data.b64_json) return `data:image/png;base64,${data.b64_json}`;
    if (data.base64) return `data:image/png;base64,${String(data.base64).replace(/^data:image\/\w+;base64,/, "")}`;
    if (data.url || data.image_url) return data.url || data.image_url;
    if (Array.isArray(data)) {
      for (const item of data) {
        const found = extractNanoBananaImage(item);
        if (found) return found;
      }
    }
    if (typeof data === "object") {
      for (const item of Object.values(data)) {
        const found = extractNanoBananaImage(item);
        if (found) return found;
      }
    }
    return "";
  }

  async function requestNanoBananaImage(input, init, body) {
    const normalized = normalizeImageBody(body, 1);
    const model = modelToApiModel(readModel());
    const imageParts = collectImageDataUrls(normalized).map(dataUrlToGeminiPart).filter(Boolean);
    const prompt = [normalized.prompt || normalized.input || "", normalized.targetSize ? `输出比例和尺寸参考：${normalized.targetSize}` : ""].filter(Boolean).join("\n");
    const headers = new Headers(init?.headers || {});
    headers.set("Content-Type", "application/json");
    const response = await nativeFetch(normalizeGeminiGenerateEndpoint(input, model), {
      ...init,
      method: "POST",
      headers,
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{ text: prompt || "生成图片" }, ...imageParts]
        }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"]
        }
      })
    });
    const raw = await response.text();
    if (!response.ok) {
      return new Response(raw, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
    }
    let data;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      return new Response(raw, {
        status: 502,
        statusText: "Bad Gateway",
        headers: { "Content-Type": "text/plain;charset=utf-8" }
      });
    }
    const imageUrl = extractNanoBananaImage(data);
    return new Response(JSON.stringify({ data: imageUrl ? [{ url: imageUrl }] : [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  function extendStoredTimeouts() {
    try {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key) continue;
        const raw = localStorage.getItem(key);
        if (!raw || !/timeout|超时|request/i.test(raw)) continue;
        let changed = false;
        const value = JSON.parse(raw);
        const visit = (target) => {
          if (!target || typeof target !== "object") return;
          Object.keys(target).forEach((itemKey) => {
            const value = target[itemKey];
            if (/timeout|超时/i.test(itemKey) && Number(value) < 999) {
              target[itemKey] = typeof value === "number" ? 999 : "999";
              changed = true;
            } else if (value && typeof value === "object") {
              visit(value);
            }
          });
        };
        visit(value);
        if (changed) localStorage.setItem(key, JSON.stringify(value));
      }
    } catch {}
  }

  function bindTimeoutEnforcer() {
    if (document.documentElement.dataset.wdTimeoutBound === "1") return;
    document.documentElement.dataset.wdTimeoutBound = "1";
    extendStoredTimeouts();
    window.setInterval(extendStoredTimeouts, 1200);
  }

  async function requestMultipleImages(input, init, body, count) {
    const responses = await Promise.all(Array.from({ length: count }, async () => {
      const singleBody = normalizeImageBody(body, 1);
      const response = await nativeFetch(input, { ...init, body: JSON.stringify(singleBody) });
      return response;
    }));
    const failed = responses.find((response) => !response.ok);
    if (failed) return failed;
    const jsons = await Promise.all(responses.map((response) => response.json()));
    const jsonList = [];
    for (const json of jsons) {
      if (Array.isArray(json?.data)) jsonList.push(...json.data);
      else jsonList.push(json);
    }
    const merged = { ...(jsons[0] || {}), data: jsonList };
    return new Response(JSON.stringify(merged), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  function syncCountValue(value) {
    const next = String(clampCount(value));
    document.querySelectorAll(".wd-count-input").forEach((input) => {
      if (input.value !== next) input.value = next;
    });
    document.querySelectorAll(".wd-source-count").forEach((input) => {
      if (input.value !== next) setInputValue(input, next);
    });
  }

  function isGenerateButton(button) {
    if (!button || button.closest(".wd-count-control, .wd-size-control, .wd-model-control, .wd-custom-quality-control")) return false;
    if (button.closest(".task-card-wrapper") || button.closest("[role='dialog']") || button.closest(".wd-operation-guide")) return false;
    const bar = button.closest(".fixed[class*='bottom']");
    if (!bar) return false;
    const buttons = Array.from(bar.querySelectorAll("button")).filter((item) => visibleElement(item));
    return buttons[buttons.length - 1] === button;
  }

  function bindSeparateQuantitySubmit() {
    if (document.documentElement.dataset.wdSeparateQuantityBound === "1") return;
    document.documentElement.dataset.wdSeparateQuantityBound = "1";
    document.addEventListener("click", (event) => {
      const button = event.target?.closest?.("button");
      if (!isGenerateButton(button) || duplicatingSubmit) return;
      const count = readVisibleCount();
      if (count <= 1) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      duplicatingSubmit = true;
      syncCountValue(1);
      for (let index = 0; index < count; index += 1) {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      }
      window.setTimeout(() => {
        syncCountValue(count);
        duplicatingSubmit = false;
      }, 500);
    }, true);
  }

  function writeModel(value) {
    try {
      localStorage.setItem("wd-model", normalizeModelName(value));
    } catch {}
  }

  function setTheme(mode) {
    const isDark = mode === "dark";
    const nextTheme = isDark ? "dark" : "light";
    const previousTheme = document.documentElement.dataset.wdTheme;
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.classList.toggle("wd-dark", isDark);
    document.body?.classList.toggle("dark", isDark);
    document.body?.classList.toggle("wd-dark", isDark);
    document.documentElement.dataset.wdTheme = nextTheme;
    if (document.body) document.body.dataset.wdTheme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    if (document.body) document.body.style.colorScheme = nextTheme;
    document.querySelectorAll(".wd-theme-toggle").forEach((button) => {
      const nextMode = isDark ? "dark" : "light";
      if (button.dataset.mode !== nextMode) {
        button.dataset.mode = nextMode;
        button.innerHTML = themeIcon();
      }
    });
    writeTheme(nextTheme);
    if (previousTheme && previousTheme !== nextTheme) {
      const event = { type: "change", matches: isDark, media: "(prefers-color-scheme: dark)" };
      themeMediaListeners.forEach((listener) => listener.call(window.matchMedia("(prefers-color-scheme: dark)"), event));
    }
  }

  setTheme(readTheme());

  function enforceChosenTheme() {
    setTheme(readTheme());
  }

  function bindThemeEnforcer() {
    if (document.documentElement.dataset.wdThemeBound === "1") return;
    document.documentElement.dataset.wdThemeBound = "1";
    enforceChosenTheme();
    window.matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change", enforceChosenTheme);
    window.setInterval(enforceChosenTheme, 1000);
  }

  window.fetch = async function (input, init) {
    if (init && typeof init.body === "string" && init.body.trim().startsWith("{")) {
      let body = null;
      try { body = JSON.parse(init.body); } catch {}
      if (body && isImageRequest(body)) {
        const ready = await requireAutoSaveDirectory();
        if (!ready) throw new Error("生成前必须先设置本地强制保存位置。");
        if (isNanoBananaModel(readModel())) return requestNanoBananaImage(input, init, body);
        init = { ...init, body: JSON.stringify(normalizeImageBody(body, 1)) };
      }
    }
    return nativeFetch(input, init);
  };

  function directText(element) {
    return Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent.trim())
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  function nearestBlock(element) {
    return element.closest("label") || element.closest("button") || element.closest("div");
  }

  function hideDirectText(text, options = {}) {
    const { keepApiKey = false, parentLevel = 0 } = options;
    for (const element of document.querySelectorAll("button, label, div, p, span")) {
      if (directText(element) !== text) continue;
      if (keepApiKey && element.textContent.includes("API Key")) continue;
      let target = nearestBlock(element);
      for (let i = 0; i < parentLevel && target && target.parentElement; i += 1) {
        target = target.parentElement;
      }
      target?.classList.add("wd-hidden");
    }
  }

  function hideContains(text, options = {}) {
    const { keepApiKey = false } = options;
    for (const element of document.querySelectorAll("button, label, div")) {
      const value = element.textContent.replace(/\s+/g, " ").trim();
      if (!value.includes(text)) continue;
      if (keepApiKey && value.includes("API Key")) continue;
      nearestBlock(element)?.classList.add("wd-hidden");
    }
  }

  function setInputValue(input, value) {
    inputValueSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function clampCount(value) {
    const number = Number.parseInt(value, 10);
    if (!Number.isFinite(number)) return 1;
    return Math.min(9, Math.max(1, number));
  }

  function applyBrandLogo() {
    const titleLink = document.querySelector("header h1 a");
    if (!titleLink || titleLink.querySelector(".wd-brand-logo")) return;
    titleLink.textContent = BRAND;
    titleLink.style.display = "inline-flex";
    titleLink.style.alignItems = "center";
    titleLink.style.gap = "8px";
    const img = document.createElement("img");
    img.className = "wd-brand-logo";
    img.src = "./logo.png";
    img.alt = "";
    titleLink.prepend(img);
  }

  function themeIcon() {
    const isDark = document.documentElement.classList.contains("dark");
    return isDark
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.7 6.7 0 0 0 9.8 9.8Z"/></svg>';
  }

  function applyThemeButton() {
    const installButton = document.querySelector('button[aria-label="安装为应用"]');
    if (!installButton || document.querySelector(".wd-theme-toggle")) return;
    const installWrap = installButton.closest(".relative");
    const target = installWrap || installButton;
    const parent = target.parentElement || installButton.parentElement;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "wd-theme-toggle";
    button.setAttribute("aria-label", "切换主题");
    button.title = "切换主题";
    button.innerHTML = themeIcon();
    button.addEventListener("click", () => {
      const next = document.documentElement.classList.contains("dark") ? "light" : "dark";
      setTheme(next);
    });
    parent.insertBefore(button, target);
  }

  function applyCacheButton() {
    const themeButton = document.querySelector(".wd-theme-toggle");
    if (!themeButton || document.querySelector(".wd-cache-clear")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "wd-cache-clear";
    button.setAttribute("aria-label", "清理缓存");
    button.title = "清理缓存";
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m20.5 2.5-9.2 9.2"/><path d="m9.8 10.2 4 4-5.9 5.9c-1.7 1.7-4.5 1.7-6.2 0l8.1-9.9Z"/><path d="M4.2 18.2c1.3.1 2.4.6 3.2 1.5"/><path d="M7 15.2c1.4.1 2.5.6 3.3 1.4"/></svg>';
    button.addEventListener("click", async () => {
      const ok = window.confirm("确定清理绘图工作台缓存吗？API 密钥和主题不会被清除。");
      if (!ok) return;
      await clearWorkbenchCache();
      localStorage.removeItem("gpt-image-playground");
      syncWorkbenchApiConfig();
      window.location.reload();
    });
    themeButton.insertAdjacentElement("afterend", button);
  }

  function deleteCacheDb(name) {
    return new Promise((resolve) => {
      if (!window.indexedDB) {
        resolve(false);
        return;
      }
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve(true);
      request.onerror = () => resolve(false);
      request.onblocked = () => resolve(false);
    });
  }

  function clearWorkbenchCache() {
    if (window.WandouLocalCache?.clearHeavyCache) return window.WandouLocalCache.clearHeavyCache();
    return Promise.all([
      deleteCacheDb("gpt-image-playground"),
      deleteCacheDb("ai-node-canvas-media-v1"),
      deleteCacheDb("wandou-ai-local-cache")
    ]);
  }

  const WORKBENCH_IMAGE_DB = "gpt-image-playground";
  const WORKBENCH_IMAGE_DB_STORES = ["tasks", "images", "thumbnails"];
  const WORKBENCH_DB_REPAIR_KEY = "wd-image-db-repairing";

  function ensureWorkbenchDbStores(db) {
    WORKBENCH_IMAGE_DB_STORES.forEach((name) => {
      if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
    });
  }

  function hasWorkbenchDbStores(db) {
    return WORKBENCH_IMAGE_DB_STORES.every((name) => db.objectStoreNames.contains(name));
  }

  function repairWorkbenchImageDb() {
    if (!window.indexedDB) return;
    const request = indexedDB.open(WORKBENCH_IMAGE_DB, 2);
    request.onupgradeneeded = () => {
      ensureWorkbenchDbStores(request.result);
    };
    request.onerror = () => {};
    request.onsuccess = async () => {
      const db = request.result;
      if (hasWorkbenchDbStores(db)) {
        try {
          sessionStorage.removeItem(WORKBENCH_DB_REPAIR_KEY);
        } catch {}
        db.close();
        return;
      }
      db.close();
      try {
        if (sessionStorage.getItem(WORKBENCH_DB_REPAIR_KEY) === "1") return;
        sessionStorage.setItem(WORKBENCH_DB_REPAIR_KEY, "1");
      } catch {}
      const deleted = await deleteCacheDb(WORKBENCH_IMAGE_DB);
      if (deleted) window.location.reload();
    };
  }

  repairWorkbenchImageDb();

  function hideInstallButton() {
    const installButton = document.querySelector('button[aria-label="安装为应用"]');
    const installWrap = installButton?.closest(".relative");
    (installWrap || installButton)?.classList.add("wd-hidden");
  }

  function normalizeText(element) {
    return element.textContent.replace(/\s+/g, "").trim();
  }

  function closestCompactBlock(element) {
    let current = element;
    for (let i = 0; i < 5 && current && current !== document.body; i += 1) {
      if (current.classList?.contains("block") || current.tagName === "LABEL") return current;
      current = current.parentElement;
    }
    return element.closest("div") || element;
  }

  function markOperationGuideModal() {
    for (const element of document.querySelectorAll("h1, h2, h3, h4, div, span")) {
      if (normalizeText(element) !== "操作指南") continue;
      const panel = element.closest("[class*='rounded-3xl']") || element.closest("[role='dialog']") || element.closest(".fixed");
      if (panel) {
        panel.classList.add("wd-operation-guide");
        replaceGuideFooter(panel);
      }
      break;
    }
  }

  function replaceGuideFooter(panel) {
    if (panel.querySelector(".wd-guide-thanks")) return;
    const source = Array.from(panel.querySelectorAll("a, button, div, span")).find((item) => {
      const text = normalizeText(item);
      const href = item.getAttribute?.("href") || "";
      return text.includes("@CookSleep") || href.includes("CookSleep");
    });
    if (!source) return;
    const target = source.closest("a") || source;
    const replacement = document.createElement("div");
    replacement.className = "wd-guide-thanks";
    replacement.textContent = "谢谢支持的你";
    target.replaceWith(replacement);
  }

  function hideHabitConfigItems() {
    [
      "复用配置时临时复用该任务的API配置",
      "成功任务仍然展示重试按钮"
    ].forEach((text) => {
      const button = document.querySelector(`button[aria-label="${text.includes("API") ? "复用配置时临时复用该任务的 API 配置" : text}"]`);
      if (button?.getAttribute("aria-checked") === "true") button.click();
      const source = button || Array.from(document.querySelectorAll("span, div, button")).find((element) => normalizeText(element).includes(text));
      if (!source) return;
      closestCompactBlock(source)?.classList.add("wd-hidden");
    });
  }

  function fixClearInputSwitch() {
    [
      "提交任务后清空输入框",
      "重启后加载上次输入内容",
      "重启后加载上次的输入框"
    ].forEach((label) => {
      const button = document.querySelector(`button[aria-label="${label}"]`);
      if (!button) return;
      button.classList.add("wd-settings-switch");
      if (label === "提交任务后清空输入框") button.classList.add("wd-clear-input-switch");
      button.parentElement?.classList.add("wd-settings-switch-row");
      styleSettingsSwitch(button);
      if (button.dataset.wdSwitchVisualBound !== "1") {
        button.dataset.wdSwitchVisualBound = "1";
        button.addEventListener("click", () => window.setTimeout(() => styleSettingsSwitch(button), 80));
      }
    });
  }

  function styleSettingsSwitch(button) {
    const checked = button.getAttribute("aria-checked") === "true";
    button.style.setProperty("width", "44px", "important");
    button.style.setProperty("height", "24px", "important");
    button.style.setProperty("min-width", "44px", "important");
    button.style.setProperty("border-radius", "999px", "important");
    button.style.setProperty("background", checked ? "#3b82f6" : "#6b7280", "important");
    button.style.setProperty("border-color", checked ? "#3b82f6" : "#6b7280", "important");
    const knob = button.querySelector("span");
    if (knob) {
      knob.style.setProperty("width", "20px", "important");
      knob.style.setProperty("height", "20px", "important");
      knob.style.setProperty("background", "#ffffff", "important");
      knob.style.setProperty("border-color", "#ffffff", "important");
    }
  }

  function handleCodexCliPrompt() {
    const title = Array.from(document.querySelectorAll("h1, h2, h3, h4, div, span")).find((element) =>
      normalizeText(element).includes("检测到CodexCLIAPI")
    );
    if (!title) return;
    const panel = title.closest("[class*='rounded-3xl']") || title.closest("[role='dialog']") || title.closest(".fixed");
    if (panel) panel.classList.add("wd-hidden");
    const enableButton = Array.from(document.querySelectorAll("button")).find((button) => normalizeText(button) === "开启");
    enableButton?.click();
  }

  function setVisibleText(element, text) {
    const textNode = Array.from(element.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
    if (textNode) {
      if (textNode.textContent === text) return;
      textNode.textContent = text;
      return;
    }
    const labelNode = Array.from(element.querySelectorAll("span, div")).find((node) => directText(node));
    if (labelNode) {
      if (labelNode.textContent === text) return;
      labelNode.textContent = text;
      return;
    }
    if (element.textContent === text) return;
    element.textContent = text;
  }

  function getFieldLabel(labelText) {
    return Array.from(document.querySelectorAll("label")).find((label) =>
      Array.from(label.children).some((child) => normalizeText(child) === labelText)
    );
  }

  function getQualityFieldLabel() {
    return getFieldLabel(QUALITY_LEGACY_TITLE) || getFieldLabel(RESOLUTION_TITLE);
  }

  function renameQualityLabel(label) {
    const title = Array.from(label?.children || []).find((child) => {
      const text = normalizeText(child);
      return text === QUALITY_LEGACY_TITLE || text === RESOLUTION_TITLE;
    });
    if (title && normalizeText(title) !== RESOLUTION_TITLE) setVisibleText(title, RESOLUTION_TITLE);
  }

  function getFieldControl(label) {
    return Array.from(label.children).find((child) => child.tagName === "DIV" && child.classList.contains("relative"));
  }

  function setSelectDisplay(control, text) {
    const trigger = control?.firstElementChild;
    const label = trigger?.querySelector("span.truncate");
    if (label && label.textContent !== text) label.textContent = text;
  }

  function setOptionDisplay(option, text) {
    const label = option.querySelector("span.min-w-0.truncate") || option.querySelector("span.truncate");
    if (label) {
      if (label.textContent !== text) label.textContent = text;
      return;
    }
    setVisibleText(option, text);
  }

  function clearQualityMarks(currentLabel) {
    document.querySelectorAll(".wd-quality-control").forEach((element) => {
      if (element !== currentLabel) element.classList.remove("wd-quality-control");
    });
    document.querySelectorAll(".wd-quality-hidden-option, .wd-quality-option").forEach((element) => {
      if (!currentLabel?.contains(element)) element.classList.remove("wd-quality-hidden-option", "wd-quality-option");
    });
  }

function rewriteQualityOptions() {
    const label = getQualityFieldLabel();
    if (!label) return;
    renameQualityLabel(label);
    clearQualityMarks(label);
    if (!label.classList.contains("wd-quality-control")) label.classList.add("wd-quality-control");
    const control = getFieldControl(label);
    const displayMap = { auto: "2k", low: "1k", medium: "2k", high: "4k" };
    const selectedOption = Array.from(control?.querySelectorAll("[data-option-value]") || []).find((option) =>
      option.className.includes("bg-blue-50") || option.className.includes("bg-blue-500")
    );
    const currentValue = selectedOption?.getAttribute("data-option-value");
    if (currentValue && displayMap[currentValue]) setSelectDisplay(control, displayMap[currentValue]);
    else {
      const currentText = normalizeText(control || label).toLowerCase();
      if (currentText.includes("low") || currentText.includes("1k")) setSelectDisplay(control, "1k");
      else if (currentText.includes("medium") || currentText.includes("2k")) setSelectDisplay(control, "2k");
      else setSelectDisplay(control, "4k");
    }

    control?.querySelectorAll("[data-option-value]").forEach((option) => {
      const value = option.getAttribute("data-option-value");
      if (value === "auto") {
        if (!option.classList.contains("wd-quality-hidden-option")) option.classList.add("wd-quality-hidden-option");
        if (option.classList.contains("wd-quality-option")) option.classList.remove("wd-quality-option");
        return;
      }
      if (!displayMap[value]) return;
      if (option.classList.contains("wd-quality-hidden-option")) option.classList.remove("wd-quality-hidden-option");
      if (!option.classList.contains("wd-quality-option")) option.classList.add("wd-quality-option");
      setOptionDisplay(option, displayMap[value]);
    });
  }

  function updateCustomQualityControl(control) {
    const current = readQuality();
    const label = control.querySelector(".wd-quality-current");
    const currentLabel = qualityLabel(current);
    if (label && label.textContent !== currentLabel) label.textContent = currentLabel;
    control.querySelectorAll(".wd-custom-quality-option").forEach((button) => {
      button.classList.remove("wd-quality-hidden-option");
      const isSelected = button.dataset.value === current;
      button.classList.toggle("selected", isSelected);
      const ariaSelected = isSelected ? "true" : "false";
      if (button.getAttribute("aria-selected") !== ariaSelected) button.setAttribute("aria-selected", ariaSelected);
    });
  }

  function syncNativeQuality(value = readQuality()) {
    const label = getQualityFieldLabel();
    const control = getFieldControl(label);
    if (!control) return;
    const display = qualityLabel(value);
    setSelectDisplay(control, display);
    const options = Array.from(control.querySelectorAll("[data-option-value]"));
    const target = options.find((option) => option.getAttribute("data-option-value") === value);
    const selected = options.find((option) =>
      option.className.includes("bg-blue-50") || option.className.includes("bg-blue-500")
    );
    if (target && selected !== target) target.click();
  }

  function syncSizeDisplayFromQuality(value = readQuality()) {
    const label = getFieldLabel("尺寸");
    const rawSize = readRawVisibleSize();
    const nextSize = sizeForQuality(rawSize, value);
    writeTargetSize(nextSize);
    Array.from(label?.querySelectorAll("button") || []).forEach((button) => {
      if (button.title !== "选择尺寸" || !visibleElement(button)) return;
      const textNode = Array.from(button.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      if (textNode) textNode.textContent = nextSize;
      else button.textContent = nextSize;
    });
  }

  function syncQualityFromSize() {
    const rawSize = readRawVisibleSize();
    const nextQuality = qualityFromSize(rawSize);
    if (!nextQuality) return;
    writeQuality(nextQuality);
    syncNativeQuality(nextQuality);
    const custom = document.querySelector(".wd-custom-quality-control");
    if (custom) updateCustomQualityControl(custom);
  }

  function removeUnsupportedQualityTooltip() {
    const blocked = /Codex\s*CLI|质量参数|不支持质量|不支持.*分辨率/i;
    const attrs = ["title", "aria-description", "data-tooltip", "data-title", "data-tip", "data-content"];
    document.querySelectorAll(".wd-custom-quality-control, .wd-custom-quality-control *").forEach((element) => {
      attrs.forEach((attr) => {
        const value = element.getAttribute?.(attr);
        if (value && blocked.test(value)) element.removeAttribute(attr);
      });
    });
    document.querySelectorAll("body *").forEach((element) => {
      const text = normalizeText(element);
      if (!blocked.test(text)) return;
      const rect = element.getBoundingClientRect();
      const isTooltipLike = rect.width > 0 && rect.height > 0 && rect.width < 360 && rect.height < 90;
      if (isTooltipLike) element.classList.add("wd-hidden");
    });
  }

  function bindSizeResolutionSync() {
    if (document.documentElement.dataset.wdSizeResolutionBound === "1") return;
    document.documentElement.dataset.wdSizeResolutionBound = "1";
    document.addEventListener("click", (event) => {
      const button = event.target?.closest?.("button");
      if (!button) return;
      const text = normalizeText(button);
      if (button.closest(".wd-custom-quality-control") && qualityValueFromLabel(text)) {
        writeResolutionSource("quality");
        window.setTimeout(() => syncSizeDisplayFromQuality(readQuality()), 80);
        return;
      }
      const modal = button.closest(".fixed.inset-0");
      if (text === "确定" && modal && normalizeText(modal).includes("设置图像尺寸")) {
        writeResolutionSource("size");
        window.setTimeout(syncQualityFromSize, 120);
      }
    }, true);
  }

  function enhanceCustomQuality() {
    const label = getQualityFieldLabel();
    if (!label) return;
    renameQualityLabel(label);
    const existing = label.querySelector(".wd-custom-quality-control");
    if (existing) {
      syncNativeQuality();
      updateCustomQualityControl(existing);
      return;
    }

    const source = Array.from(label.children).find((child) => child.tagName === "DIV" && !child.classList.contains("wd-custom-quality-control"));
    if (!source) return;
    source.classList.add("wd-source-quality");

    const wrap = document.createElement("div");
    wrap.className = "wd-custom-quality-control";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "wd-custom-quality-button";
    button.setAttribute("aria-label", "选择分辨率");
    button.innerHTML = '<span class="wd-quality-current"></span><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 7.5 10 12.5 15 7.5"/></svg>';

    const menu = document.createElement("div");
    menu.className = "wd-custom-quality-menu";
    QUALITY_OPTIONS.forEach((option) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "wd-custom-quality-option";
      item.dataset.value = option.value;
      item.textContent = option.label;
      item.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        writeResolutionSource("quality");
        writeQuality(option.value);
        syncNativeQuality(option.value);
        syncSizeDisplayFromQuality(option.value);
        updateCustomQualityControl(wrap);
        wrap.classList.remove("open");
      });
      menu.appendChild(item);
    });

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const shouldOpen = !wrap.classList.contains("open");
      closeForeignMenus();
      if (shouldOpen) {
        updateCustomQualityControl(wrap);
        wrap.classList.add("open");
      }
    });
    wrap.addEventListener("pointerdown", (event) => event.stopPropagation());
    wrap.addEventListener("click", (event) => event.stopPropagation());
    document.addEventListener("click", (event) => {
      if (!wrap.contains(event.target)) wrap.classList.remove("open");
    });

    wrap.append(button, menu);
    source.style.display = "none";
    source.parentElement.insertBefore(wrap, source);
    syncNativeQuality();
    updateCustomQualityControl(wrap);
  }

  function updateModelControl(control) {
    const current = readModel();
    const text = control.querySelector(".wd-model-current");
    if (text) {
      if (text.textContent !== current) text.textContent = current;
      if (text.title !== current) text.title = current;
    }
    control.querySelectorAll(".wd-model-option").forEach((button) => {
      const isSelected = button.dataset.model === current;
      if (button.classList.contains("selected") !== isSelected) button.classList.toggle("selected", isSelected);
      const ariaSelected = isSelected ? "true" : "false";
      if (button.getAttribute("aria-selected") !== ariaSelected) button.setAttribute("aria-selected", ariaSelected);
    });
  }

  function createModelControl() {
    const sizeLabel = getFieldLabel("尺寸");
    if (!sizeLabel) return;
    const existing = document.querySelector(".wd-model-control");
    if (existing) {
      updateModelControl(existing);
      return;
    }

    const label = document.createElement("label");
    label.className = `${sizeLabel.className || "relative flex flex-col gap-0.5"} wd-model-control`;

    const title = document.createElement("span");
    title.className = "text-gray-400 dark:text-gray-500 ml-1";
    title.textContent = "模型";

    const select = document.createElement("div");
    select.className = "wd-model-select";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "wd-model-button";
    button.title = "选择模型";
    button.setAttribute("aria-label", "选择模型");
    button.innerHTML = '<span class="wd-model-current"></span><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 7.5 10 12.5 15 7.5"/></svg>';
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const shouldOpen = !label.classList.contains("open");
      document.querySelectorAll(".wd-model-control.open").forEach((item) => item.classList.remove("open"));
      closeForeignMenus();
      if (shouldOpen) label.classList.add("open");
    });

    const menu = document.createElement("div");
    menu.className = "wd-model-menu";
    MODEL_OPTIONS.forEach((model) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "wd-model-option";
      option.dataset.model = model;
      option.textContent = model;
      option.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        writeModel(model);
        updateModelControl(label);
        rewriteQualityOptions();
        enhanceCustomQuality();
        label.classList.remove("open");
      });
      menu.appendChild(option);
    });

    select.append(button, menu);
    label.append(title, select);
    sizeLabel.parentElement.insertBefore(label, sizeLabel);
    label.addEventListener("pointerdown", (event) => event.stopPropagation());
    label.addEventListener("click", (event) => event.stopPropagation());
    updateModelControl(label);
  }

  function bindModelControlClose() {
    if (document.documentElement.dataset.wdModelCloseBound === "1") return;
    document.documentElement.dataset.wdModelCloseBound = "1";
    document.addEventListener("click", (event) => {
      document.querySelectorAll(".wd-model-control.open").forEach((control) => {
        if (!control.contains(event.target)) control.classList.remove("open");
      });
    });
  }

  function enhanceSize() {
    const label = getFieldLabel("尺寸");
    if (!label) return;
    label.querySelectorAll(".wd-size-control").forEach((control) => control.remove());
    label.querySelectorAll(".wd-source-size").forEach((source) => {
      source.classList.remove("wd-source-size");
      source.style.display = "";
      delete source.dataset.wdSizeBound;
    });
  }

  function simplifySettings() {
    hideDirectText("关于");
    hideContains("复制导入配置", { keepApiKey: true });
    hideContains("复制一份配置", { keepApiKey: true });
    hideContains("默认 OpenAI", { keepApiKey: true });

    [
      "当前配置",
      "配置名称",
      "服务商类型",
      "API URL",
      "Codex CLI 兼容模式",
      "API 接口",
      "模型 ID",
      "返回 Base64 图片数据",
      "请求超时 (秒)",
      "API 代理"
    ].forEach((text) => hideDirectText(text, { keepApiKey: true }));

    const hiddenApiBlocks = [
      "当前配置",
      "默认OpenAI",
      "配置名称",
      "服务商类型",
      "APIURL",
      "CodexCLI兼容模式",
      "API接口",
      "模型ID",
      "返回Base64图片数据",
      "请求超时",
      "API代理"
    ];
    document.querySelectorAll(".space-y-4 > *").forEach((block) => {
      const text = block.textContent.replace(/\s+/g, "").trim();
      if (text.includes("APIKey")) return;
      if (hiddenApiBlocks.some((item) => text.includes(item))) {
        block.classList.add("wd-hidden");
      }
    });
    document.querySelectorAll("button").forEach((button) => {
      const text = button.textContent.replace(/\s+/g, "").trim();
      if (text === "默认OpenAI" || text.includes("复制导入配置") || text.includes("复制一份配置")) {
        button.classList.add("wd-hidden");
      }
    });
    document.querySelectorAll(".space-y-4 > *").forEach((block) => {
      if (!block.textContent.includes("API Key")) return;
      block.querySelectorAll("div, p, span").forEach((item) => {
        if (item.textContent.includes("?apiKey")) item.classList.add("wd-hidden");
      });
    });

    const apiInput = document.querySelector('input[placeholder="https://api.openai.com/v1"], input[aria-label*="API URL"]');
    if (apiInput) setInputValue(apiInput, API_URL);

    document.querySelectorAll(".space-y-4 > *").forEach((block) => {
      const text = block.textContent.replace(/\s+/g, "").trim();
      if (!text.includes("请求超时")) return;
      const timeoutInput = block.querySelector('input[type="number"]:not([data-wd-custom-count])');
      if (timeoutInput && timeoutInput.value !== "999") setInputValue(timeoutInput, "999");
    });
  }

  function hideModerationAndCompression() {
    hideDirectText("审核");
    hideDirectText("压缩率");
    const moderationInputs = document.querySelectorAll('[aria-label="审核"], [name="moderation"]');
    moderationInputs.forEach((element) => {
      if ("value" in element) setInputValue(element, "low");
      nearestBlock(element)?.classList.add("wd-hidden");
    });
    document.querySelectorAll('input[placeholder="0-100"]').forEach((input) => {
      nearestBlock(input)?.classList.add("wd-hidden");
    });
  }

  function makeCountControl(input) {
    if (input.dataset.wdControlBound === "1") return;
    input.dataset.wdControlBound = "1";
    input.min = "1";
    input.max = "9";
    setInputValue(input, String(clampCount(input.value)));
    input.classList.add("wd-source-count");

    const wrap = document.createElement("div");
    wrap.className = "wd-count-control";

    const visibleInput = document.createElement("input");
    visibleInput.className = "wd-count-input";
    visibleInput.dataset.wdCustomCount = "1";
    visibleInput.type = "number";
    visibleInput.min = "1";
    visibleInput.max = "9";
    visibleInput.value = input.value || "1";
    visibleInput.setAttribute("aria-label", "数量");

    const arrow = document.createElement("button");
    arrow.type = "button";
    arrow.className = "wd-count-arrow";
    arrow.setAttribute("aria-label", "选择数量");
    arrow.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 7.5 10 12.5 15 7.5"/></svg>';

    const menu = document.createElement("div");
    menu.className = "wd-count-menu";
    for (let i = 1; i <= 9; i += 1) {
      const option = document.createElement("button");
      option.type = "button";
      option.textContent = String(i);
      option.dataset.value = String(i);
      option.addEventListener("click", () => {
        visibleInput.value = String(i);
        setInputValue(input, String(i));
        updateSelected();
        wrap.classList.remove("open");
      });
      menu.appendChild(option);
    }

    function updateSelected() {
      const current = String(clampCount(visibleInput.value));
      menu.querySelectorAll("button").forEach((button) => {
        button.classList.toggle("selected", button.dataset.value === current);
        button.setAttribute("aria-selected", button.dataset.value === current ? "true" : "false");
      });
    }

    function syncFromVisible() {
      const value = String(clampCount(visibleInput.value));
      visibleInput.value = value;
      setInputValue(input, value);
      updateSelected();
    }

    visibleInput.addEventListener("input", () => {
      const value = clampCount(visibleInput.value);
      setInputValue(input, String(value));
      updateSelected();
    });
    visibleInput.addEventListener("blur", syncFromVisible);
    wrap.addEventListener("pointerdown", (event) => event.stopPropagation());
    wrap.addEventListener("click", (event) => event.stopPropagation());
    arrow.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const shouldOpen = !wrap.classList.contains("open");
      closeForeignMenus();
      if (shouldOpen) {
        updateSelected();
        wrap.classList.add("open");
      }
    });
    document.addEventListener("click", (event) => {
      if (!wrap.contains(event.target)) wrap.classList.remove("open");
    });

    input.style.display = "none";
    wrap.append(visibleInput, arrow, menu);
    input.parentElement.insertBefore(wrap, input);
    updateSelected();
  }

  function enhanceQuantity() {
    const inputs = Array.from(document.querySelectorAll('input[type="number"]'))
      .filter((input) => {
        if (input.placeholder || input.value === "" || input.dataset.wdControlBound === "1" || input.dataset.wdCustomCount === "1" || input.closest(".wd-count-control")) return false;
        const label = input.closest("label");
        return !!label && Array.from(label.children).some((child) => normalizeText(child) === "数量");
      });
    inputs.forEach(makeCountControl);
  }

  function downloadIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>';
  }

  function folderIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M12 11v5"/><path d="m9 13 3 3 3-3"/></svg>';
  }

  function autosaveSupported() {
    return typeof window.showDirectoryPicker === "function" && typeof window.indexedDB !== "undefined";
  }

  function openAutoSaveDb() {
    if (!window.indexedDB) return Promise.resolve(null);
    return new Promise((resolve) => {
      const request = indexedDB.open(AUTO_SAVE_DB, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(AUTO_SAVE_STORE)) request.result.createObjectStore(AUTO_SAVE_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
  }

  async function storeAutoSaveHandle(handle) {
    const db = await openAutoSaveDb();
    if (!db) return;
    await new Promise((resolve) => {
      const tx = db.transaction(AUTO_SAVE_STORE, "readwrite");
      tx.objectStore(AUTO_SAVE_STORE).put(handle, AUTO_SAVE_HANDLE_KEY);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
    db.close();
  }

  async function loadAutoSaveHandle() {
    if (autoSaveHandleLoaded || !window.indexedDB) return autoSaveHandle;
    autoSaveHandleLoaded = true;
    const db = await openAutoSaveDb();
    if (!db) return null;
    autoSaveHandle = await new Promise((resolve) => {
      const tx = db.transaction(AUTO_SAVE_STORE, "readonly");
      const request = tx.objectStore(AUTO_SAVE_STORE).get(AUTO_SAVE_HANDLE_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
    db.close();
    updateAutoSaveControl();
    return autoSaveHandle;
  }

  async function hasAutoSavePermission(handle, requestWrite) {
    if (!handle) return false;
    const options = { mode: "readwrite" };
    if (typeof handle.queryPermission === "function" && await handle.queryPermission(options) === "granted") return true;
    if (requestWrite && typeof handle.requestPermission === "function") {
      return await handle.requestPermission(options) === "granted";
    }
    return !handle.queryPermission;
  }

  function setAutoSaveStatus(text) {
    const status = document.getElementById("wdAutoSaveStatus");
    if (!status) return;
    status.textContent = text || "";
    window.clearTimeout(autoSaveStatusTimer);
    if (text) autoSaveStatusTimer = window.setTimeout(() => { status.textContent = ""; }, 3500);
  }

  function updateAutoSaveControl() {
    const button = document.getElementById("wdAutoSaveButton");
    if (!button) return;
    if (!autosaveSupported()) {
      button.classList.add("required-warning");
      button.innerHTML = `${folderIcon()}<span>\u26a0 \u4e0d\u652f\u6301\u5f3a\u5236\u4fdd\u5b58</span>`;
      button.disabled = false;
      button.title = "\u5f53\u524d\u6d4f\u89c8\u5668\u4e0d\u652f\u6301\u81ea\u52a8\u4fdd\u5b58\uff0c\u8bf7\u4f7f\u7528\u4e0b\u8f7d\u6309\u94ae";
      return;
    }
    const name = autoSaveHandle?.name ? `：${autoSaveHandle.name}` : "";
    button.classList.toggle("required-warning", !autoSaveHandle);
    button.innerHTML = `${folderIcon()}<span>${autoSaveHandle ? "\u4fdd\u5b58\u4f4d\u7f6e" : "\u26a0 \u5fc5\u987b\u8bbe\u7f6e\u4fdd\u5b58\u4f4d\u7f6e"}${name}</span>`;
    button.disabled = false;
    button.title = autosaveSupported() ? "\u9009\u62e9\u751f\u6210\u56fe\u7247\u81ea\u52a8\u4fdd\u5b58\u7684\u672c\u5730\u6587\u4ef6\u5939" : "\u5f53\u524d\u6d4f\u89c8\u5668\u4e0d\u652f\u6301\u81ea\u52a8\u4fdd\u5b58\uff0c\u8bf7\u4f7f\u7528\u4e0b\u8f7d\u6309\u94ae";
  }

  async function requireAutoSaveDirectory() {
    if (!autosaveSupported()) {
      updateAutoSaveControl();
      setAutoSaveStatus("当前浏览器不支持本地强制保存，无法生成图片。");
      return false;
    }
    await loadAutoSaveHandle();
    const ready = Boolean(autoSaveHandle && await hasAutoSavePermission(autoSaveHandle, false));
    if (!ready) {
      autoSaveHandle = null;
      updateAutoSaveControl();
      setAutoSaveStatus("请先点击红色按钮设置本地保存位置。");
    }
    return ready;
  }

  async function chooseAutoSaveDirectory() {
    if (!autosaveSupported()) {
      setAutoSaveStatus("\u5f53\u524d\u6d4f\u89c8\u5668\u4e0d\u652f\u6301\u81ea\u52a8\u4fdd\u5b58\uff0c\u8bf7\u4f7f\u7528\u4e0b\u8f7d\u6309\u94ae\u3002");
      updateAutoSaveControl();
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: "readwrite" });
      if (!await hasAutoSavePermission(handle, true)) {
        setAutoSaveStatus("\u672a\u83b7\u5f97\u5199\u5165\u6743\u9650\uff0c\u8bf7\u91cd\u65b0\u9009\u62e9\u6587\u4ef6\u5939\u3002");
        return;
      }
      autoSaveHandle = handle;
      await storeAutoSaveHandle(handle);
      updateAutoSaveControl();
      setAutoSaveStatus(`\u5df2\u9009\u62e9\u4fdd\u5b58\u4f4d\u7f6e\uff1a${handle.name}`);
      autoSaveGeneratedCards();
    } catch (error) {
      if (error?.name !== "AbortError") setAutoSaveStatus("\u9009\u62e9\u4fdd\u5b58\u4f4d\u7f6e\u5931\u8d25\u3002");
    }
  }

  function ensureAutoSaveControl() {
    const existing = document.getElementById("wdAutoSaveControl");
    const headerActions = document.querySelector(".wd-theme-toggle")?.parentElement;
    if (existing) {
      if (headerActions && existing.parentElement !== headerActions) headerActions.appendChild(existing);
      return;
    }
    const wrap = document.createElement("div");
    wrap.id = "wdAutoSaveControl";
    wrap.className = "wd-autosave-control";
    const button = document.createElement("button");
    button.id = "wdAutoSaveButton";
    button.type = "button";
    button.addEventListener("click", chooseAutoSaveDirectory);
    const status = document.createElement("span");
    status.id = "wdAutoSaveStatus";
    wrap.append(button, status);
    (headerActions || document.body).appendChild(wrap);
    updateAutoSaveControl();
    loadAutoSaveHandle();
  }

  function readAutoSaveDoneSet() {
    try {
      return new Set(JSON.parse(localStorage.getItem(AUTO_SAVE_DONE_KEY) || "[]"));
    } catch {
      return new Set();
    }
  }

  function markAutoSaveDone(key) {
    const done = readAutoSaveDoneSet();
    done.add(key);
    localStorage.setItem(AUTO_SAVE_DONE_KEY, JSON.stringify(Array.from(done).slice(-500)));
  }

  function safeFileNamePart(value) {
    return String(value || "wandou-ai").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-").slice(0, 80) || "wandou-ai";
  }

  async function uniqueFileName(directoryHandle, filename) {
    const dot = filename.lastIndexOf(".");
    const base = dot > 0 ? filename.slice(0, dot) : filename;
    const extension = dot > 0 ? filename.slice(dot) : "";
    for (let index = 0; index < 100; index += 1) {
      const candidate = index ? `${base}-${index + 1}${extension}` : filename;
      try {
        await directoryHandle.getFileHandle(candidate, { create: false });
      } catch {
        return candidate;
      }
    }
    return `${base}-${Date.now()}${extension}`;
  }

  async function writeBlobToAutoSaveDirectory(blob, filename) {
    const handle = autoSaveHandle || await loadAutoSaveHandle();
    if (!handle) return false;
    if (!await hasAutoSavePermission(handle, false)) {
      setAutoSaveStatus("\u4fdd\u5b58\u4f4d\u7f6e\u9700\u8981\u91cd\u65b0\u6388\u6743\uff0c\u8bf7\u70b9\u51fb\u66f4\u6539\u4fdd\u5b58\u4f4d\u7f6e\u3002");
      return false;
    }
    const safeName = await uniqueFileName(handle, safeFileNamePart(filename));
    const fileHandle = await handle.getFileHandle(safeName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    setAutoSaveStatus(`\u5df2\u81ea\u52a8\u4fdd\u5b58\uff1a${safeName}`);
    return true;
  }

  function visibleElement(element) {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function imageDisplayArea(image) {
    const rect = image.getBoundingClientRect();
    return rect.width * rect.height;
  }

  function imageNaturalArea(image) {
    return (image.naturalWidth * image.naturalHeight) || (image.clientWidth * image.clientHeight) || 0;
  }

  function findDownloadImage(scope) {
    const images = Array.from(scope.querySelectorAll("img"))
      .filter((img) => img.src && !img.classList.contains("wd-brand-logo") && visibleElement(img));
    const preferred = images
      .filter((img) => img.classList.contains("saveable-image") && img.getAttribute("data-image-id"))
      .sort((a, b) => (imageDisplayArea(b) - imageDisplayArea(a)) || (imageNaturalArea(b) - imageNaturalArea(a)));
    if (preferred[0]) return preferred[0];
    return images
      .sort((a, b) => (imageDisplayArea(b) - imageDisplayArea(a)) || (imageNaturalArea(b) - imageNaturalArea(a)))[0] || null;
  }

  function textIncludesAny(scope, values) {
    const text = [
      normalizeText(scope),
      scope.getAttribute?.("aria-label") || "",
      scope.getAttribute?.("title") || ""
    ].join("");
    return values.some((value) => text.includes(value));
  }

  function markGeneratedCards() {
    document.querySelectorAll(".task-card-wrapper.wd-generated-card-fixed").forEach((card) => {
      card.classList.remove("wd-generated-card-fixed");
      card.querySelectorAll(".wd-generated-card-image-frame, .wd-generated-card-actions").forEach((element) => {
        element.classList.remove("wd-generated-card-image-frame", "wd-generated-card-actions");
      });
    });
  }

  function isImageDetailScope(scope) {
    if (!findDownloadImage(scope)) return false;
    return textIncludesAny(scope, [
      "\u590d\u7528\u914d\u7f6e",
      "\u7f16\u8f91\u8f93\u51fa",
      "\u4e0b\u8f7d\u56fe\u7247",
      "\u8f93\u5165\u5185\u5bb9",
      "\u53c2\u6570\u914d\u7f6e"
    ]);
  }

  function findImageDetailPanel(overlay) {
    const candidates = Array.from(overlay.querySelectorAll("[class*='max-w-4xl'], [class*='max-w-3xl'], [class*='max-w-2xl'], [class*='rounded-3xl'], [role='dialog']"))
      .filter((item) => visibleElement(item) && isImageDetailScope(item))
      .sort((a, b) => (b.getBoundingClientRect().width * b.getBoundingClientRect().height) - (a.getBoundingClientRect().width * a.getBoundingClientRect().height));
    return candidates[0] || (isImageDetailScope(overlay) ? overlay : null);
  }

  function findDetailActionRow(panel) {
    const actionTexts = ["\u590d\u7528\u914d\u7f6e", "\u7f16\u8f91\u8f93\u51fa", "\u4e0b\u8f7d\u56fe\u7247"];
    const sourceButton = Array.from(panel.querySelectorAll("button")).find((button) => visibleElement(button) && textIncludesAny(button, actionTexts));
    let current = sourceButton?.parentElement || null;
    for (let i = 0; i < 5 && current && current !== panel; i += 1) {
      const buttons = Array.from(current.querySelectorAll("button")).filter((button) => visibleElement(button));
      if (buttons.length >= 2) return current;
      current = current.parentElement;
    }
    return sourceButton?.parentElement || null;
  }

  function bindDetailDownloadButton(button, panel) {
    if (!button || button.dataset.wdDetailDownloadBound === "1") return;
    button.dataset.wdDetailDownloadBound = "1";
    button.classList.add("wd-detail-download");
    button.title = "\u4e0b\u8f7d\u56fe\u7247";
    button.setAttribute("aria-label", "\u4e0b\u8f7d\u56fe\u7247");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      downloadImageFromScope(panel);
    });
  }

  function ensureDetailDownloadButton(panel) {
    const buttons = Array.from(panel.querySelectorAll("button"));
    const existing = buttons.find((button) => button.classList.contains("wd-detail-download") || textIncludesAny(button, ["\u4e0b\u8f7d\u56fe\u7247"]));
    if (existing) {
      bindDetailDownloadButton(existing, panel);
      return;
    }
    const row = findDetailActionRow(panel);
    const template = row ? Array.from(row.querySelectorAll("button")).find((button) => visibleElement(button)) : null;
    if (!row || !template) return;
    const button = template.cloneNode(false);
    button.type = "button";
    button.className = `${template.className || ""} wd-detail-download`;
    button.innerHTML = `${downloadIcon()}<span>\u4e0b\u8f7d\u56fe\u7247</span>`;
    bindDetailDownloadButton(button, panel);
    const favorite = Array.from(row.querySelectorAll("button")).find((item) => normalizeText(item) === "\u2606" || normalizeText(item) === "\u2605" || textIncludesAny(item, ["\u6536\u85cf", "\u53d6\u6d88\u6536\u85cf"]));
    if (favorite) row.insertBefore(button, favorite);
    else row.appendChild(button);
  }

  function markImageDetailModals() {
    document.querySelectorAll(".fixed.inset-0").forEach((overlay) => {
      const panel = findImageDetailPanel(overlay);
      if (!panel) return;
      overlay.classList.add("wd-image-detail-overlay");
      panel.classList.add("wd-image-detail-modal");
      const image = findDownloadImage(panel);
      image?.parentElement?.classList.add("wd-image-detail-preview");
      const actionRow = findDetailActionRow(panel);
      actionRow?.classList.add("wd-image-detail-actions");
      ensureDetailDownloadButton(panel);
    });
  }

  function readFullImageRecord(imageId) {
    if (!imageId || !window.indexedDB) return Promise.resolve(null);
    return new Promise((resolve) => {
      const request = indexedDB.open("gpt-image-playground", 2);
      request.onerror = () => resolve(null);
      request.onsuccess = () => {
        const db = request.result;
        try {
          const tx = db.transaction("images", "readonly");
          const getRequest = tx.objectStore("images").get(imageId);
          getRequest.onsuccess = () => resolve(getRequest.result || null);
          getRequest.onerror = () => resolve(null);
          tx.oncomplete = () => db.close();
          tx.onerror = () => {
            db.close();
            resolve(null);
          };
        } catch {
          db.close();
          resolve(null);
        }
      };
    });
  }

  async function getDownloadSource(image) {
    const imageId = image?.getAttribute?.("data-image-id");
    const record = await readFullImageRecord(imageId);
    return record?.dataUrl || image?.src || "";
  }

  function imageExtension(source) {
    if (source.startsWith("data:image/jpeg")) return "jpg";
    if (source.startsWith("data:image/webp")) return "webp";
    return "png";
  }

  const SIZE_TEXT_PATTERN = /(\d{3,5})\s*[x\u00d7]\s*(\d{3,5})/i;
  const EXACT_SIZE_TEXT_PATTERN = /^\d{3,5}\s*[x\u00d7]\s*\d{3,5}$/i;

  function sizeTextElements(scope) {
    return Array.from(scope.querySelectorAll("span, div"))
      .filter((item) => item.children.length === 0)
      .map((item) => ({ item, text: normalizeText(item) }))
      .filter(({ text }) => SIZE_TEXT_PATTERN.test(text));
  }

  function readDisplayedImageSize(scope) {
    const entries = sizeTextElements(scope);
    const safeText = (entries.find(({ text: value }) => EXACT_SIZE_TEXT_PATTERN.test(value)) || entries[0])?.text;
    const safeMatch = safeText?.match(SIZE_TEXT_PATTERN);
    if (safeMatch) return { width: Number(safeMatch[1]), height: Number(safeMatch[2]) };
    const text = Array.from(scope.querySelectorAll("span, div"))
      .map((item) => normalizeText(item))
      .find((value) => /(\d{3,5})\s*[x×脳]\s*(\d{3,5})/.test(value));
    const match = text?.match(/(\d{3,5})\s*[x×脳]\s*(\d{3,5})/);
    return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
  }

  function forced4kSize(scope, baseSize) {
    const target = parseSizeText(readTargetSize());
    if (target) return target;
    if (!baseSize?.width || !baseSize?.height) return null;
    if (!/4k/i.test(normalizeText(scope))) return null;
    const edge = 4096;
    const ratio = edge / Math.max(baseSize.width, baseSize.height);
    return {
      width: Math.max(1, Math.round(baseSize.width * ratio)),
      height: Math.max(1, Math.round(baseSize.height * ratio))
    };
  }

  function targetOutputSize(scope, baseSize) {
    const current = readCurrentOutputSize();
    if (current) return current;
    return forced4kSize(scope, baseSize);
  }

  async function resizeBlobToPngBlob(blob, width, height) {
    return new Promise((resolve) => {
      const objectUrl = URL.createObjectURL(blob);
      const image = new Image();
      image.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(image, 0, 0, width, height);
          canvas.toBlob((nextBlob) => resolve(nextBlob || blob), "image/png");
        } catch {
          resolve(blob);
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(blob);
      };
      image.src = objectUrl;
    });
  }

  async function buildWorkbenchImageBlob(scope, image) {
    const imageId = image.getAttribute("data-image-id");
    const record = await readFullImageRecord(imageId);
    const source = record?.dataUrl || image.src;
    if (!source) return null;
    const displayedSize = readDisplayedImageSize(scope);
    const targetSize = targetOutputSize(scope, displayedSize || record || { width: image.naturalWidth, height: image.naturalHeight });
    const targetWidth = targetSize?.width || displayedSize?.width || record?.width || 0;
    const targetHeight = targetSize?.height || displayedSize?.height || record?.height || 0;
    let extension = imageExtension(source);
    let blob = await (await nativeFetch(source)).blob();
    if (targetWidth && targetHeight && (image.naturalWidth !== targetWidth || image.naturalHeight !== targetHeight)) {
      blob = await resizeBlobToPngBlob(blob, targetWidth, targetHeight);
      extension = "png";
    }
    return {
      blob,
      extension,
      key: `${autoSaveHandle?.name || "dir"}:${imageId || source.slice(0, 120)}:${targetWidth || image.naturalWidth}x${targetHeight || image.naturalHeight}`,
      filename: `wandou-ai-${Date.now()}.${extension}`
    };
  }

  async function downloadImageFromScope(scope) {
    const image = findDownloadImage(scope);
    if (!image?.src) return;
    let output = null;
    try {
      output = await buildWorkbenchImageBlob(scope, image);
    } catch {
      const source = await getDownloadSource(image);
      if (!source) return;
      const fallback = document.createElement("a");
      fallback.download = `wandou-ai-${Date.now()}.${imageExtension(source)}`;
      fallback.rel = "noopener";
      fallback.href = source;
      document.body.appendChild(fallback);
      fallback.click();
      fallback.remove();
      return;
    }
    if (!output?.blob) return;
    const name = output.filename;
    const link = document.createElement("a");
    link.download = name;
    link.rel = "noopener";
    try {
      const url = URL.createObjectURL(output.blob);
      link.href = url;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      link.remove();
    }
  }

  async function autoSaveImageFromScope(scope, image) {
    if (!autoSaveHandle && !autoSaveHandleLoaded) await loadAutoSaveHandle();
    if (!autoSaveHandle || !image?.src || image.dataset.wdAutosaveState === "saving") return;
    try {
      const output = await buildWorkbenchImageBlob(scope, image);
      if (!output?.blob) return;
      const done = readAutoSaveDoneSet();
      if (done.has(output.key)) {
        image.dataset.wdAutosaveState = "saved";
        return;
      }
      image.dataset.wdAutosaveState = "saving";
      if (await writeBlobToAutoSaveDirectory(output.blob, output.filename)) {
        markAutoSaveDone(output.key);
        image.dataset.wdAutosaveState = "saved";
      } else {
        image.dataset.wdAutosaveState = "";
      }
    } catch (error) {
      image.dataset.wdAutosaveState = "";
      setAutoSaveStatus("\u81ea\u52a8\u4fdd\u5b58\u5931\u8d25\uff0c\u8bf7\u4f7f\u7528\u4e0b\u8f7d\u6309\u94ae\u3002");
    }
  }

  function autoSaveGeneratedCards() {
    if (!autoSaveHandle && autoSaveHandleLoaded) return;
    document.querySelectorAll(".task-card-wrapper").forEach((card) => {
      const image = findDownloadImage(card);
      if (!image?.src || image.dataset.wdAutosaveState === "saved" || image.dataset.wdAutosaveState === "saving") return;
      if (image.complete) autoSaveImageFromScope(card, image);
      else image.addEventListener("load", () => autoSaveImageFromScope(card, image), { once: true });
    });
  }

  function findCardActionRow(card) {
    const buttons = Array.from(card.querySelectorAll("button")).filter((button) => visibleElement(button));
    if (!buttons.length) return null;
    const actionTexts = [
      "\u6536\u85cf",
      "\u53d6\u6d88\u6536\u85cf",
      "\u590d\u7528\u914d\u7f6e",
      "\u7f16\u8f91\u8f93\u51fa",
      "\u5220\u9664\u8bb0\u5f55",
      "\u91cd\u8bd5\u4efb\u52a1"
    ];
    const sourceButton = buttons.find((button) => textIncludesAny(button, actionTexts)) || buttons[buttons.length - 1];
    let current = sourceButton.parentElement;
    for (let i = 0; i < 5 && current && current !== card; i += 1) {
      const rowButtons = Array.from(current.querySelectorAll("button")).filter((button) => visibleElement(button));
      if (rowButtons.length >= 2) return current;
      current = current.parentElement;
    }
    return sourceButton.parentElement;
  }

  function addCardDownloadButtons() {
    document.querySelectorAll(".task-card-wrapper").forEach((card) => {
      if (card.querySelector(".wd-card-download")) return;
      const row = findCardActionRow(card);
      if (!row) return;
      const buttons = Array.from(row.querySelectorAll("button")).filter((button) => visibleElement(button));
      if (!buttons.length) return;
      const target = buttons[0];
      const button = document.createElement("button");
      button.type = "button";
      button.className = `${target.className || ""} wd-card-download`;
      button.title = "\u4e0b\u8f7d\u56fe\u7247";
      button.setAttribute("aria-label", "\u4e0b\u8f7d\u56fe\u7247");
      button.innerHTML = downloadIcon();
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        downloadImageFromScope(card);
      });
      row.insertBefore(button, target);
    });
  }

  function replaceDetailDeleteWithDownload() {
    const candidates = Array.from(document.querySelectorAll("button")).filter((button) => normalizeText(button).includes("删除记录"));
    candidates.forEach((oldButton) => {
      if (oldButton.classList.contains("wd-detail-download")) return;
      const panel = oldButton.closest("[class*='rounded-3xl']") || oldButton.closest("[role='dialog']") || oldButton.closest(".fixed");
      if (!panel) return;
      const button = oldButton.cloneNode(false);
      button.type = "button";
      button.className = `${oldButton.className || ""} wd-detail-download`;
      button.title = "下载图片";
      button.setAttribute("aria-label", "下载图片");
      button.innerHTML = `${downloadIcon()}<span>下载图片</span>`;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        downloadImageFromScope(panel);
      });
      oldButton.replaceWith(button);
    });
  }

  function updateDisplayedImageSizes() {
    document.querySelectorAll(".task-card-wrapper, .fixed.inset-0").forEach((scope) => {
      const image = findDownloadImage(scope);
      if (!image) return;
      const update = async () => {
        const record = await readFullImageRecord(image.getAttribute("data-image-id"));
        const displayedSize = readDisplayedImageSize(scope);
        const targetSize = targetOutputSize(scope, displayedSize || record || { width: image.naturalWidth, height: image.naturalHeight });
        const width = targetSize?.width || displayedSize?.width || record?.width || image.naturalWidth;
        const height = targetSize?.height || displayedSize?.height || record?.height || image.naturalHeight;
        if (!width || !height) return;
        const textNodes = sizeTextElements(scope).map(({ item }) => item);
        textNodes.forEach((item) => {
          const separator = normalizeText(item).includes("\u00d7") ? "\u00d7" : "x";
          const sizeText = `${width}${separator}${height}`;
          const nextText = (item.textContent || "").replace(SIZE_TEXT_PATTERN, sizeText);
          if (item.textContent !== nextText) item.textContent = nextText;
        });
      };
      if (image.complete) update();
      else image.addEventListener("load", update, { once: true });
    });
  }

  function updateDisplayedQualityLabels() {
    const fallback = qualityLabel(readQuality());
    document.querySelectorAll(".task-card-wrapper, .fixed.inset-0").forEach((scope) => {
      const scopeSizeText = sizeTextElements(scope)
        .map(({ text }) => text)
        .find((text) => /^\d{3,5}[x×]\d{3,5}$/.test(text));
      const sizeQuality = qualityFromSize(scopeSizeText);
      Array.from(scope.querySelectorAll("div, span")).forEach((item) => {
        const compact = normalizeText(item).replace(/\s+/g, "");
        const match = compact.match(new RegExp(`^(?:${QUALITY_LEGACY_TITLE}|${RESOLUTION_TITLE})(auto|low|medium|high|1k|2k|4k)$`, "i"));
        if (!match) return;
        const valueText = match[1];
        const nextLabel = sizeQuality ? qualityLabel(sizeQuality) : valueText.toLowerCase() === "auto" ? fallback : qualityLabel(qualityValueFromLabel(valueText) || readQuality());
        const titleNode = Array.from(item.children).find((child) => normalizeText(child) === QUALITY_LEGACY_TITLE);
        if (titleNode) titleNode.textContent = RESOLUTION_TITLE;
        const valueNode = Array.from(item.children).find((child) => normalizeText(child).toLowerCase() === valueText.toLowerCase());
        if (valueNode) valueNode.textContent = nextLabel;
      });
    });
  }

  function runDownloadEnhancements() {
    window.setTimeout(() => {
      updateDisplayedImageSizes();
      updateDisplayedQualityLabels();
      markGeneratedCards();
      addCardDownloadButtons();
      markImageDetailModals();
      autoSaveGeneratedCards();
    }, 80);
  }

  function bindDownloadEnhancements() {
    if (document.documentElement.dataset.wdDownloadBound === "1") return;
    document.documentElement.dataset.wdDownloadBound = "1";
    runDownloadEnhancements();
    document.addEventListener("click", runDownloadEnhancements, true);
    window.setInterval(runDownloadEnhancements, 1500);
  }

  function applyAll() {
    if (applying) return;
    applying = true;
    try {
      document.title = BRAND;
      bindThemeEnforcer();
      bindTimeoutEnforcer();
      enforceChosenTheme();
      applyBrandLogo();
      applyThemeButton();
      applyCacheButton();
      hideInstallButton();
      markOperationGuideModal();
      simplifySettings();
      hideHabitConfigItems();
      fixClearInputSwitch();
      handleCodexCliPrompt();
      rewriteQualityOptions();
      enhanceCustomQuality();
      removeUnsupportedQualityTooltip();
      bindSizeResolutionSync();
      if (readResolutionSource() === "quality") syncSizeDisplayFromQuality(readQuality());
      ensureAutoSaveControl();
      createModelControl();
      bindModelControlClose();
      enhanceSize();
      hideModerationAndCompression();
      enhanceQuantity();
      bindSeparateQuantitySubmit();
      bindDownloadEnhancements();
      closeCountMenusWhenForeignMenuOpens();
    } finally {
      applying = false;
    }
  }

  const observer = new MutationObserver(() => applyAll());
  window.addEventListener("DOMContentLoaded", () => {
    applyAll();
    observer.observe(document.body, { childList: true, subtree: true });
  });
})();
