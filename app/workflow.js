const apiStorageKey = "ai-tools-api-config";
const savedTheme = localStorage.getItem("ai-tools-theme");
const initialTheme = window.WandouLocalCache?.readTheme(savedTheme || "light") || savedTheme || "light";
let currentImageDataUrl = "";
let sourceImageDataUrl = "";
let sourceImageFile = null;
let uploadObjectUrl = "";
let currentImageBlob = null;
let hasGeneratedImage = false;
let previewZoom = 1;

document.documentElement.dataset.theme = initialTheme;

function readApiConfig() {
  try {
    const config = JSON.parse(localStorage.getItem(apiStorageKey) || "{}");
    return {
      url: defaultApiBaseUrl(),
      key: config.key || "",
      savedAt: config.savedAt || ""
    };
  } catch {
    return { url: defaultApiBaseUrl(), key: "" };
  }
}

function defaultApiBaseUrl() {
  return atob("aHR0cHM6Ly93d3cuemF5YXBpLnRvcA==");
}

function showToast(message) {
  let toast = document.querySelector("[data-toast]");
  if (!toast) {
    toast = document.createElement("div");
    toast.dataset.toast = "";
    toast.style.cssText = "position:fixed;left:50%;bottom:28px;z-index:60;transform:translateX(-50%);padding:10px 16px;border-radius:999px;background:rgba(10,16,8,.92);color:#f6fbf1;border:1px solid rgba(183,229,111,.35);font:600 14px Microsoft YaHei,Arial;box-shadow:0 12px 30px rgba(0,0,0,.28);opacity:0;transition:opacity .16s ease;";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.opacity = "1";
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.style.opacity = "0";
  }, 1800);
}

function renderThemeToggle() {
  const label = document.querySelector("[data-theme-label]");
  const icon = document.querySelector("[data-theme-icon]");
  if (!label || !icon) return;

  const isLight = document.documentElement.dataset.theme === "light";
  label.textContent = isLight ? "白天" : "暗色";
  icon.textContent = isLight ? "☼" : "☾";
}

function renderThemeToggleSvg() {
  const label = document.querySelector("[data-theme-label]");
  const icon = document.querySelector("[data-theme-icon]");
  if (!label || !icon) return;
  const isLight = document.documentElement.dataset.theme === "light";
  label.textContent = isLight ? "暗色" : "白天";
  icon.classList.add("theme-svg");
  icon.innerHTML = isLight
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 15.2A8.4 8.4 0 0 1 8.8 3.5 8.5 8.5 0 1 0 20.5 15.2Z"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/></svg>';
}

document.querySelector("[data-theme-toggle]")?.addEventListener("click", () => {
  const nextTheme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = nextTheme;
  localStorage.setItem("ai-tools-theme", nextTheme);
  window.WandouLocalCache?.syncTheme(nextTheme);
  renderThemeToggleSvg();
});

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

async function clearHeavyCacheSafe() {
  if (window.WandouLocalCache?.clearHeavyCache) return window.WandouLocalCache.clearHeavyCache();
  const dbResults = await Promise.all([
    deleteCacheDb("wandou-ai-local-cache"),
    deleteCacheDb("ai-node-canvas-media-v1"),
    deleteCacheDb("gpt-image-playground")
  ]);
  return { ok: dbResults.some(Boolean) };
}

document.querySelector("[data-cache-clear]")?.addEventListener("click", async () => {
  const ok = window.confirm("确定清理图片缓存和临时历史吗？API 密钥、主题和项目文件夹不会被清除。");
  if (!ok) return;
  const result = await clearHeavyCacheSafe();
  showToast(result?.ok ? "缓存已清理，重新打开页面后生效。" : "缓存清理完成。");
});

renderThemeToggleSvg();

const imageInput = document.querySelector("#imageInput");
const preview = document.querySelector("#preview");
const uploadZone = imageInput?.closest(".upload-zone");
const initialPreviewHtml = preview ? preview.innerHTML : "";

function revokeObjectUrl(url) {
  if (typeof url === "string" && url.startsWith("blob:")) URL.revokeObjectURL(url);
}

function clearCurrentImage() {
  revokeObjectUrl(currentImageDataUrl);
  currentImageDataUrl = "";
  currentImageBlob = null;
  hasGeneratedImage = false;
  if (modalImage) modalImage.src = "";
}

function setCurrentImageBlob(blob) {
  clearCurrentImage();
  currentImageBlob = blob;
  currentImageDataUrl = URL.createObjectURL(blob);
  hasGeneratedImage = true;
  return currentImageDataUrl;
}

function clearUploadPreview() {
  revokeObjectUrl(uploadObjectUrl);
  uploadObjectUrl = "";
}

function showPreviewImage(src) {
  if (!preview) return;
  preview.innerHTML = "";
  preview.style.overflow = "hidden";
  const image = document.createElement("img");
  image.src = src;
  image.alt = "上传图片预览";
  image.style.cssText = "max-width:100%;max-height:100%;object-fit:contain;border-radius:12px;";
  preview.appendChild(image);
}

function showUploadImage(src) {
  if (!uploadZone) return;
  let holder = uploadZone.querySelector("[data-upload-preview]");
  if (!holder) {
    holder = document.createElement("div");
    holder.dataset.uploadPreview = "";
    holder.style.cssText = "position:absolute;inset:10px;z-index:1;display:grid;place-items:center;border-radius:10px;background:rgba(255,255,255,.72);overflow:hidden;pointer-events:none;";
    uploadZone.appendChild(holder);
  }
  holder.innerHTML = "";
  const image = document.createElement("img");
  image.src = src;
  image.alt = "上传图片预览";
  image.style.cssText = "max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;";
  holder.appendChild(image);
}

function resetResultPreview() {
  if (!preview) return;
  preview.innerHTML = initialPreviewHtml;
}

function showResultGenerating() {
  if (!preview) return;
  preview.innerHTML = "正在生成，完成后结果图会显示在这里";
}

function showResultFailed(message) {
  if (!preview) return;
  preview.textContent = message || "生成失败，请检查 API 密钥后重试。";
}

if (imageInput && preview) {
  imageInput.addEventListener("change", () => {
    const file = imageInput.files && imageInput.files[0];
    if (!file) return;

    clearUploadPreview();
    clearCurrentImage();
    sourceImageFile = file;
    uploadObjectUrl = URL.createObjectURL(file);
    sourceImageDataUrl = uploadObjectUrl;
    showUploadImage(sourceImageDataUrl);
    resetResultPreview();
    setStatus("已上传，待生成");
    showToast("图片已上传预览");
  });
}

document.querySelectorAll(".option, .ratio-option").forEach((button) => {
  button.addEventListener("click", () => {
    const group = button.parentElement;
    if (!group) return;
    group.querySelectorAll(".option, .ratio-option").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
  });
});

const modal = document.querySelector("[data-image-modal]");
const modalImage = document.querySelector("[data-modal-image]");
const zoomLabel = document.querySelector("[data-zoom-label]");

function updateZoom() {
  if (modalImage) modalImage.style.width = `${Math.round(previewZoom * 100)}%`;
  if (zoomLabel) zoomLabel.textContent = `${Math.round(previewZoom * 100)}%`;
}

function openPreviewModal() {
  if (!modal || !modalImage || !currentImageDataUrl || (isImageWorkflowPage() && !hasGeneratedImage)) {
    showToast(isImageWorkflowPage() ? "请先点击生成，生成完成后再预览。" : "请先上传或生成图片");
    return;
  }
  previewZoom = 1;
  modalImage.src = currentImageDataUrl;
  modal.hidden = false;
  updateZoom();
}

function closePreviewModal() {
  if (modal) modal.hidden = true;
}

document.querySelectorAll("[data-preview-open]").forEach((button) => {
  button.addEventListener("click", openPreviewModal);
});

document.querySelector("[data-modal-close]")?.addEventListener("click", closePreviewModal);
document.querySelector("[data-zoom-in]")?.addEventListener("click", () => {
  previewZoom = Math.min(3, previewZoom + 0.25);
  updateZoom();
});
document.querySelector("[data-zoom-out]")?.addEventListener("click", () => {
  previewZoom = Math.max(0.5, previewZoom - 0.25);
  updateZoom();
});
modal?.addEventListener("click", (event) => {
  if (event.target === modal) closePreviewModal();
});

document.querySelectorAll("[data-download-image]").forEach((button) => {
  button.addEventListener("click", async () => {
    if (!currentImageDataUrl || (isImageWorkflowPage() && !hasGeneratedImage)) {
      showToast(isImageWorkflowPage() ? "请先点击生成，生成完成后再下载。" : "请先上传或生成图片");
      return;
    }
    const filename = document.body.classList.contains("png-page") ? "wandou-cutout-4k.png" : document.body.classList.contains("watermark-page") ? "wandou-watermark-remove.png" : "wandou-upscale-4k.png";
    if (window.WandouSaveDirectory) {
      const blob = currentImageBlob || await fetch(currentImageDataUrl).then((response) => response.blob());
      if (await window.WandouSaveDirectory.writeBlob(blob, filename)) showToast("图片已保存到本地文件夹");
      return;
    }
    const link = document.createElement("a");
    link.href = currentImageDataUrl;
    link.download = filename;
    link.click();
  });
});

window.addEventListener("pagehide", () => {
  clearUploadPreview();
  clearCurrentImage();
});

const apiModal = document.querySelector("[data-api-modal]");
const apiForm = document.querySelector("[data-api-form]");
const apiKeyInput = document.querySelector("[data-api-key]");

function fillApiForm() {
  const config = readApiConfig();
  if (apiKeyInput) apiKeyInput.value = config.key || "";
}

function openApiModal() {
  if (!apiModal) return;
  fillApiForm();
  apiModal.hidden = false;
}

function closeApiModal() {
  if (apiModal) apiModal.hidden = true;
}

document.querySelector("[data-api-open]")?.addEventListener("click", openApiModal);
document.querySelector("[data-api-close]")?.addEventListener("click", closeApiModal);
apiForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const key = apiKeyInput?.value.trim() || "";
  localStorage.setItem(apiStorageKey, JSON.stringify({
    key,
    savedAt: new Date().toISOString()
  }));
  localStorage.setItem("aiCanvasApi", JSON.stringify({
    url: defaultApiBaseUrl(),
    key
  }));
  closeApiModal();
  showToast("API 设置已保存");
});
document.querySelector("[data-api-clear]")?.addEventListener("click", () => {
  localStorage.removeItem(apiStorageKey);
  localStorage.removeItem("aiCanvasApi");
  fillApiForm();
  showToast("API 设置已清除");
});
apiModal?.addEventListener("click", (event) => {
  if (event.target === apiModal) closeApiModal();
});

function setStatus(text) {
  document.querySelectorAll(".status-pill").forEach((item) => {
    item.textContent = text;
  });
}

function resultBoxes() {
  return Array.from(document.querySelectorAll(".result-box"));
}

function setResultLoading(isLoading) {
  resultBoxes().forEach((box) => {
    box.classList.toggle("loading", isLoading);
    if (isLoading) box.textContent = "";
  });
}

function pageType() {
  const name = location.pathname.split("/").pop();
  if (name === "keyword-reverse.html") return "keyword";
  if (name === "plain-to-pro.html") return "plain";
  if (name === "video-prompt-pro.html") return "video";
  return "";
}

function isImageWorkflowPage() {
  return document.body.classList.contains("upscale-page") || document.body.classList.contains("png-page") || document.body.classList.contains("watermark-page");
}

function imageWorkflowKind() {
  if (document.body.classList.contains("upscale-page")) return "upscale";
  if (document.body.classList.contains("png-page")) return "png";
  if (document.body.classList.contains("watermark-page")) return "watermark";
  return "";
}

function selectedText(selector) {
  return Array.from(document.querySelectorAll(selector))
    .filter((button) => button.classList.contains("active"))
    .map((button) => button.textContent.trim())
    .join(" / ");
}

function makeDemoResult() {
  const type = pageType();

  if (type === "plain") {
    const category = selectedText(".four-options .option") || "文案";
    const model = selectedText(".keyword-option-grid .option") || "GPT";
    return [
      `【${category}专业表达】基于用户需求，建议以清晰卖点、目标人群、使用场景和情绪价值为核心，提炼出更具转化力和品牌质感的专业文案表达。\n\n模型：${model}`,
      `Based on the user's brief, clarify key benefits, target audience, usage scenario, and emotional value to create stronger brand-driven copy.\n\nModel: ${model}`
    ];
  }

  if (type === "video") {
    const model = selectedText(".keyword-option-grid .option") || "Claude";
    const promptType = selectedText(".two-options .option") || "正常提示词";
    return [
      `【视频提示词】镜头缓慢推进，主体保持清晰，背景自然虚化，柔和光线营造高级氛围。画面节奏稳定，强调产品质感、空间层次和情绪表达。\n\n类型：${promptType}\n模型：${model}`,
      `A slow push-in camera movement keeps the subject sharp while softly blurring the background. Gentle lighting creates a premium atmosphere.\n\nType: ${promptType}\nModel: ${model}`
    ];
  }

  if (type === "keyword") {
    const model = selectedText(".keyword-option-grid .option") || "GPT";
    return [
      `主体清晰，构图完整，光线自然，材质细节丰富，画面干净，高级商业摄影风格，适合 AI 生图使用。\n\n模型：${model}`,
      `Clear subject, balanced composition, natural lighting, rich material details, clean visual presentation, premium commercial photography style.\n\nModel: ${model}`
    ];
  }

  return ["请先在首页右上角打开 API 设置，粘贴 API 平台密钥后再生成。", ""];
}

function selectedModelId() {
  const selected = Array.from(document.querySelectorAll(".keyword-option-grid .option, .model-choice-grid .option"))
    .find((button) => button.classList.contains("active"))?.textContent.trim() || "";
  if (/claude/i.test(selected)) return "claude-sonnet-4-6";
  if (/gemini/i.test(selected)) return "gemini-3.1-pro-preview";
  if (/gpt/i.test(selected)) return "gpt-5.5";
  return "gemini-3.1-pro-preview";
}

function collectInputText() {
  const values = [];
  document.querySelectorAll("textarea, input[type='text']").forEach((field) => {
    if (field.value.trim()) values.push(field.value.trim());
  });
  return values.join("\n\n");
}

function buildTextPrompt() {
  const type = pageType();
  const input = collectInputText() || "用户未填写具体内容，请给出可直接替换使用的专业模板。";
  const category = selectedText(".four-options .option") || selectedText(".keyword-option-grid .option");
  const promptType = selectedText(".two-options .option");
  if (type === "plain") {
    return `你是资深文案策略专家。请把用户的大白话需求转换成专业语言。\n分类：${category || "文案"}\n用户内容：\n${input}\n\n请输出两部分：\n中文结果：\n英文结果：`;
  }
  if (type === "video") {
    return `你是视频生成提示词专家。请把用户的视频想法转换成专业视频提示词。\n提示词类型：${promptType || "正常提示词"}\n用户内容：\n${input}\n\n请输出两部分：\n中文结果：\nEnglish Result：`;
  }
  if (type === "keyword") {
    return `你是 AI 生图提示词专家。请根据用户输入或图片分类，生成中文和英文提示词。\n用户内容：\n${input}\n\n请输出两部分：\n中文结果：\nEnglish Result：`;
  }
  return input;
}

function splitBilingualResult(text) {
  const normalized = text.trim();
  const englishMatch = normalized.match(/(?:English Result|英文结果|English|EN)\s*[:：]\s*([\s\S]*)/i);
  const chineseMatch = normalized.match(/(?:中文结果|中文|CN)\s*[:：]\s*([\s\S]*?)(?=(?:English Result|英文结果|English|EN)\s*[:：]|$)/i);
  if (chineseMatch || englishMatch) {
    return [
      (chineseMatch?.[1] || normalized).trim(),
      (englishMatch?.[1] || "").trim() || "No English result returned."
    ];
  }
  return [normalized, ""];
}

async function callTextApi() {
  const config = readApiConfig();
  if (!config.url || !config.key) return null;
  let baseUrl = config.url.replace(/\/$/, "");
  if (!/\/v1$/i.test(baseUrl)) baseUrl += "/v1";
  const endpoint = baseUrl + "/chat/completions";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Authorization": `Bearer ${config.key}`
    },
    body: JSON.stringify({
      model: selectedModelId(),
      messages: [
        { role: "system", content: "你是专业 AI 创作工具助手。请严格按用户要求输出，不要输出多余解释。" },
        { role: "user", content: buildTextPrompt() }
      ],
      max_tokens: 1200,
      stream: false
    })
  });
  if (!response.ok) {
    throw new Error(`接口请求失败：${response.status}`);
  }
  const text = await response.text();
  if (text.startsWith("data:")) {
    const chunks = text.split("\n").filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"));
    const content = chunks.map((line) => {
      try {
        const json = JSON.parse(line.slice(6));
        return json.choices?.[0]?.delta?.content || json.choices?.[0]?.message?.content || "";
      } catch {
        return "";
      }
    }).join("");
    return splitBilingualResult(content || text);
  }
  const json = JSON.parse(text);
  const content = json.choices?.[0]?.message?.content || json.choices?.[0]?.message?.reasoning_content || "";
  if (!content.trim()) throw new Error("接口没有返回文本内容");
  return splitBilingualResult(content);
}

function dataUrlToFile(dataUrl, fileName = "source.png") {
  const parts = String(dataUrl || "").split(",");
  if (parts.length < 2) throw new Error("图片数据无效，请重新上传。");
  const mime = (parts[0].match(/data:(.*?);base64/i) || [])[1] || "image/png";
  const binary = atob(parts[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], fileName, { type: mime });
}

function getImageDimensions(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height });
    image.onerror = () => reject(new Error("图片读取失败，请重新上传。"));
    image.src = src;
  });
}

function selectedOptionText(selector) {
  return Array.from(document.querySelectorAll(selector))
    .find((button) => button.classList.contains("active"))?.textContent.trim() || "";
}

function formatImageSize(width, height) {
  return `${Math.max(16, Math.round(width / 16) * 16)}x${Math.max(16, Math.round(height / 16) * 16)}`;
}

function apiSafeImageSize(sizeText) {
  const [width, height] = String(sizeText).split("x").map((value) => Number(value) || 1024);
  const maxEdge = 3840;
  const maxPixels = 8294400;
  if (width <= maxEdge && height <= maxEdge && width * height <= maxPixels) return sizeText;
  const scale = Math.min(maxEdge / width, maxEdge / height, Math.sqrt(maxPixels / (width * height)));
  let safeWidth = Math.max(16, Math.round(width * scale / 16) * 16);
  let safeHeight = Math.max(16, Math.round(height * scale / 16) * 16);
  while (safeWidth > maxEdge || safeHeight > maxEdge || safeWidth * safeHeight > maxPixels) {
    safeWidth = Math.max(16, safeWidth - 16);
    safeHeight = Math.max(16, safeHeight - 16);
  }
  return `${safeWidth}x${safeHeight}`;
}

async function imageSourceToBlob(src) {
  const response = await fetch(src);
  return response.blob();
}

function resizeImageToBlob(src, sizeText, transparent = false) {
  const [width, height] = String(sizeText).split("x").map((value) => Number(value) || 1024);
  return new Promise((resolve) => {
    const image = new Image();
    let tempUrl = "";
    image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!transparent) {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, width, height);
        }
        ctx.drawImage(image, 0, 0, width, height);
        canvas.toBlob((blob) => resolve(blob), "image/png");
      } catch {
        imageSourceToBlob(src).then(resolve, () => resolve(null));
      } finally {
        revokeObjectUrl(tempUrl);
      }
    };
    image.onerror = () => {
      revokeObjectUrl(tempUrl);
      imageSourceToBlob(src).then(resolve, () => resolve(null));
    };
    imageSourceToBlob(src).then((blob) => {
      tempUrl = URL.createObjectURL(blob);
      image.src = tempUrl;
    }, () => {
      image.src = src;
    });
  });
}

function targetImageSize(sourceWidth, sourceHeight) {
  const quality = selectedOptionText(".quality-switch .option") || "4K";
  const ratioText = selectedOptionText(".ratio-grid .ratio-option em") || selectedOptionText(".ratio-grid .ratio-option") || "原图";
  const maps = {
    "2K": {
      "1:1": [2048, 2048],
      "3:2": [2048, 1360],
      "2:3": [1360, 2048],
      "4:3": [2048, 1536],
      "3:4": [1536, 2048],
      "16:9": [2048, 1152],
      "9:16": [1152, 2048]
    },
    "4K": {
      "1:1": [4096, 4096],
      "3:2": [4096, 2736],
      "2:3": [2736, 4096],
      "4:3": [4096, 3072],
      "3:4": [3072, 4096],
      "16:9": [4096, 2304],
      "9:16": [2304, 4096]
    }
  };
  const map = maps[quality.includes("2K") ? "2K" : "4K"];
  const explicit = Object.keys(map).find((key) => ratioText.includes(key));
  if (explicit) return { size: `${map[explicit][0]}x${map[explicit][1]}`, label: explicit };
  const sourceRatio = Math.max(1, sourceWidth) / Math.max(1, sourceHeight);
  const longEdge = quality.includes("2K") ? 2048 : 4096;
  if (sourceRatio >= 1) return { size: formatImageSize(longEdge, longEdge / sourceRatio), label: "原图" };
  return { size: formatImageSize(longEdge * sourceRatio, longEdge), label: "原图" };
  let best = map["1:1"];
  let bestKey = "1:1";
  let bestScore = Number.POSITIVE_INFINITY;
  for (const [key, size] of Object.entries(map)) {
    const score = Math.abs(Math.log((size[0] / size[1]) / sourceRatio));
    if (score < bestScore) {
      bestScore = score;
      best = size;
      bestKey = key;
    }
  }
  return { size: `${best[0]}x${best[1]}`, label: bestKey };
}

function extractGeneratedImage(data) {
  const first = Array.isArray(data?.data) ? data.data[0] : data;
  if (!first) return "";
  if (first.b64_json) return `data:image/png;base64,${first.b64_json}`;
  return first.url || first.image_url || first.output_url || "";
}

async function callImageWorkflowApi(kind) {
  const config = readApiConfig();
  if (!config.key) throw new Error("请先在首页设置 API 密钥。");
  if (!sourceImageDataUrl || !sourceImageFile) throw new Error("请先上传图片。");

  const dimensions = await getImageDimensions(sourceImageDataUrl);
  const target = targetImageSize(dimensions.width, dimensions.height);
  const promptInput = Array.from(document.querySelectorAll("textarea"))
    .map((field) => field.value.trim())
    .filter(Boolean)
    .join("\n\n");
  const isPng = kind === "png";
  const isWatermark = kind === "watermark";
  let prompt = isPng
    ? (promptInput || "保留图片中的主要主体，精准去除背景并输出透明底 PNG。")
    : [
        promptInput || "保留原图主体结构，提高边缘清晰度，增强材质细节，避免过度锐化。",
        `输出尺寸必须按 ${target.size} 生成，清晰度达到高清 ${target.size}。`
      ].join("\n");
  if (isWatermark) {
    prompt = promptInput || "去除图片中的文字水印、Logo水印或半透明水印，保持背景纹理、光影和边缘自然衔接，不改变主体内容，不新增元素，修复区域干净真实。";
  }

  let baseUrl = config.url.replace(/\/$/, "");
  if (!/\/v1$/i.test(baseUrl)) baseUrl += "/v1";
  const form = new FormData();
  form.append("model", "gpt-image-2");
  form.append("prompt", prompt);
  form.append("n", "1");
  form.append("size", apiSafeImageSize(target.size));
  const targetEdge = Math.max(...target.size.split("x").map((value) => Number(value) || 0));
  form.append("resolution", targetEdge >= 3000 ? "4k" : "2k");
  form.append("quality", "high");
  form.append("output_format", "png");
  form.append("response_format", "b64_json");
  form.append("targetSize", target.size);
  if (isPng) form.append("background", "transparent");
  form.append("image", sourceImageFile, isPng ? "cutout-source.png" : isWatermark ? "watermark-source.png" : "upscale-source.png");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 240000);
  let response;
  try {
    response = await fetch(`${baseUrl}/images/edits`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${config.key}` },
      body: form,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
  const text = await response.text();
  if (!response.ok) throw new Error(text || `接口请求失败：${response.status}`);
  const data = JSON.parse(text);
  const imageUrl = extractGeneratedImage(data);
  if (!imageUrl) throw new Error("接口没有返回图片，请稍后再试。");
  const finalImageBlob = await resizeImageToBlob(imageUrl, target.size, isPng);
  if (!finalImageBlob) throw new Error("图片处理失败，请稍后再试。");
  return { imageBlob: finalImageBlob, targetSize: target.size };
}

document.querySelectorAll(".generate-button").forEach((button) => {
  button.addEventListener("click", async () => {
    const boxes = resultBoxes();
    if (boxes.length) {
      button.disabled = true;
      setStatus("生成中");
      setResultLoading(true);
      try {
        const config = readApiConfig();
        if (!config.key) {
          setResultLoading(false);
          boxes[0].textContent = "请先在首页右上角打开 API 设置，粘贴 API 平台密钥后再生成。";
          if (boxes[1]) boxes[1].textContent = "";
          setStatus("请填写密钥");
          showToast("请先填写 API 密钥");
          return;
        }
        const result = await callTextApi();
        setResultLoading(false);
        const [zh, en] = result || makeDemoResult();
        boxes[0].textContent = zh;
        if (boxes[1]) boxes[1].textContent = en;
        setStatus("已生成");
        showToast("已生成");
      } catch (error) {
        setResultLoading(false);
        boxes[0].textContent = "生成失败，请检查 API 密钥是否正确，然后再试一次。";
        if (boxes[1]) boxes[1].textContent = "";
        setStatus("生成失败");
        showToast("生成失败，请检查 API 密钥");
      } finally {
        button.disabled = false;
      }
      return;
    }

    if (isImageWorkflowPage()) {
      if (window.WandouSaveDirectory && !(await window.WandouSaveDirectory.require())) {
        showToast("生成前必须先设置本地保存位置");
        return;
      }
      if (!sourceImageDataUrl) {
        showToast("请先上传图片。");
        return;
      }
      button.disabled = true;
      const originalText = button.textContent;
      const workflowKind = imageWorkflowKind();
      button.textContent = workflowKind === "png" ? "正在抠图..." : workflowKind === "watermark" ? "正在消除..." : "正在放大...";
      setStatus("生成中");
      showResultGenerating();
      try {
        const result = await callImageWorkflowApi(workflowKind);
        setCurrentImageBlob(result.imageBlob);
        showPreviewImage(currentImageDataUrl);
        if (window.WandouSaveDirectory) {
          const autoName = workflowKind === "png" ? "wandou-cutout.png" : workflowKind === "watermark" ? "wandou-watermark-remove.png" : "wandou-upscale.png";
          await window.WandouSaveDirectory.writeBlob(result.imageBlob, autoName);
        }
        setStatus(result.targetSize || "已生成");
        showToast(workflowKind === "png" ? "透明 PNG 已生成，可下载。" : workflowKind === "watermark" ? "水印已消除，可下载。" : "4K 图片已生成，可下载。");
      } catch (error) {
        setStatus("生成失败");
        showResultFailed(error?.message || "生成失败，请检查 API 密钥后重试。");
        showToast(error?.message || "生成失败，请检查 API 密钥后重试。");
      } finally {
        button.disabled = false;
        button.textContent = originalText;
      }
      return;
    }

    showToast("请先上传图片或填写内容");
  });
});

function copyText(text) {
  if (!text.trim()) {
    showToast("暂无可复制内容");
    return;
  }
  navigator.clipboard?.writeText(text).then(
    () => showToast("已复制"),
    () => showToast("复制失败，请手动选择文本")
  );
}

document.querySelectorAll("button").forEach((button) => {
  const label = button.textContent.trim();
  if (label === "复制中文") {
    button.addEventListener("click", () => copyText(resultBoxes()[0]?.textContent || ""));
  } else if (label === "复制英文") {
    button.addEventListener("click", () => copyText(resultBoxes()[1]?.textContent || ""));
  } else if (label === "复制") {
    button.addEventListener("click", () => {
      const pane = button.closest(".result-pane");
      copyText(pane?.querySelector(".result-box")?.textContent || "");
    });
  } else if (label.includes("下载TXT") || label === "下载文本") {
    button.addEventListener("click", () => {
      const text = resultBoxes().map((box) => box.textContent.trim()).filter(Boolean).join("\n\n---\n\n");
      if (!text) {
        showToast("暂无可下载内容");
        return;
      }
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "ai-tools-result.txt";
      link.click();
      URL.revokeObjectURL(link.href);
    });
  }
});

let activeTextForModal = "";

function ensureTextModal() {
  let textModal = document.querySelector("[data-text-modal]");
  if (textModal) return textModal;

  textModal = document.createElement("div");
  textModal.className = "text-modal";
  textModal.dataset.textModal = "";
  textModal.hidden = true;
  textModal.innerHTML = `
    <div class="text-modal-toolbar">
      <button class="secondary" type="button" data-text-copy>复制</button>
      <button class="secondary" type="button" data-text-close>关闭</button>
    </div>
    <div class="text-modal-content" data-text-content></div>
  `;
  document.body.appendChild(textModal);
  textModal.querySelector("[data-text-close]").addEventListener("click", () => {
    textModal.hidden = true;
  });
  textModal.querySelector("[data-text-copy]").addEventListener("click", () => {
    copyText(activeTextForModal);
  });
  textModal.addEventListener("click", (event) => {
    if (event.target === textModal) textModal.hidden = true;
  });
  return textModal;
}

function openTextModal(text) {
  if (!text.trim()) {
    showToast("暂无可预览内容");
    return;
  }
  activeTextForModal = text;
  const textModal = ensureTextModal();
  textModal.querySelector("[data-text-content]").textContent = text;
  textModal.hidden = false;
}

document.addEventListener("click", (event) => {
  const box = event.target.closest?.(".result-box");
  if (!box || box.classList.contains("loading")) return;
  openTextModal(box.textContent || "");
});
