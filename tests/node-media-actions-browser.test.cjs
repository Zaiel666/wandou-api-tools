const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  });
  try {
    const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
    const pagePath = path.resolve(__dirname, "../app/ai-node-canvas.html");
    await page.goto(pathToFileURL(pagePath).href, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.dataset.canvasReady === "true");

    const modelState = await page.evaluate(() => {
      nodes = [];
      links = [];
      nodeId = 1;
      const node = createNode("generator", 100, 100, { _deferRender: true });
      render();
      return {
        models: [...document.querySelectorAll(`[data-id="${node.id}"] [data-node-model]`)].map((item) => item.dataset.nodeModel),
        resolutions: imageResolutionOptionsForModel("grok-imagine-image-2.0"),
        nativeResolutions: WandouImageCapabilities.resolve("grok-imagine-image-2.0").nativeTiers,
        apiModel: modelToApiModel("grok-imagine-image-2.0"),
      };
    });
    assert.ok(modelState.models.includes("grok-imagine-image-2.0"), JSON.stringify(modelState));
    assert.deepEqual(modelState.resolutions, ["1K", "2K", "4K"]);
    assert.deepEqual(modelState.nativeResolutions, ["1K", "2K"]);
    assert.equal(modelState.apiModel, "grok-imagine-image-2.0");

    const grokRequest = await page.evaluate(async () => {
      const request = await buildApiRequest({
        id: "grok-request-check",
        type: "generator",
        model: "grok-imagine-image-2.0",
        prompt: "一只绿色豌豆荚，纯色背景",
        ratio: "16:9 横屏",
        resolution: "2K",
        count: 1,
        _targetSize: "2048x1152",
        _apiTargetSize: "2048x1152",
      }, []);
      return JSON.parse(request.body);
    });
    assert.equal(grokRequest.model, "grok-imagine-image-2.0");
    assert.equal(grokRequest.resolution, "2k");
    assert.equal(grokRequest.quality, "auto");
    assert.equal(grokRequest.size, "16:9");
    assert.equal(grokRequest.aspect_ratio, "16:9");
    assert.equal("output_format" in grokRequest, false);

    const copyState = await page.evaluate(async () => {
      const sample = document.createElement("canvas");
      sample.width = 24;
      sample.height = 24;
      sample.getContext("2d").fillRect(0, 0, 24, 24);
      let copiedBytes = 0;
      Object.defineProperty(window, "wandouShell", {
        configurable: true,
        value: {
          copyImage: async (bytes) => {
            copiedBytes = bytes.length;
            return { success: true };
          },
        },
      });
      window.expectedImageBase64 = sample.toDataURL("image/png").split(",")[1];
      openLightbox(`data:image/png;base64,${window.expectedImageBase64}`, { mode: "image" });
      await copyActiveLightboxImage(lightboxCopy);
      return {
        copiedBytes,
        toastText: toast.textContent,
        toastVisible: toast.classList.contains("show"),
        toastPosition: getComputedStyle(toast).position,
        toastZ: Number(getComputedStyle(toast).zIndex),
        lightboxZ: Number(getComputedStyle(lightbox).zIndex),
        buttonText: lightboxCopy.textContent,
        buttonBusy: lightboxCopy.hasAttribute("aria-busy"),
      };
    });
    assert.ok(copyState.copiedBytes > 0, JSON.stringify(copyState));
    assert.equal(copyState.toastText, "图片已复制，可直接粘贴使用");
    assert.equal(copyState.toastVisible, true);
    assert.equal(copyState.toastPosition, "fixed");
    assert.ok(copyState.toastZ > copyState.lightboxZ, JSON.stringify(copyState));
    assert.equal(copyState.buttonText, "复制图片");
    assert.equal(copyState.buttonBusy, false);

    const saveFailure = await page.evaluate(async () => {
      nativeAutoSaveDirectory = { directory: "C:\\missing", name: "missing" };
      window.wandouShell.writeSaveFile = async () => ({ success: false, error: "磁盘已满" });
      const ok = await writeBlobToAutoSaveDirectory(new Blob(["png"], { type: "image/png" }), "test.png");
      return { ok, text: toast.textContent, tone: toast.dataset.tone };
    });
    assert.equal(saveFailure.ok, false);
    assert.match(saveFailure.text, /保存失败：磁盘已满/);
    assert.equal(saveFailure.tone, "error");

    const saveSuccess = await page.evaluate(async () => {
      window.wandouShell.writeSaveFile = async () => ({ success: true, filename: "test.png" });
      const ok = await writeBlobToAutoSaveDirectory(new Blob(["png"], { type: "image/png" }), "test.png");
      return { ok, text: toast.textContent, tone: toast.dataset.tone };
    });
    assert.equal(saveSuccess.ok, true);
    assert.equal(saveSuccess.text, "已保存到：test.png");
    assert.equal(saveSuccess.tone, "success");

    await page.evaluate(() => {
      window.savedImageAs = null;
      window.wandouShell.saveFileAs = async (filename, bytes, mimeType) => {
        window.savedImageAs = { filename, bytes: Array.from(bytes), mimeType };
        return { success: true, filename };
      };
    });
    await page.locator("#lightboxDownload").click();
    await page.waitForFunction(() => window.savedImageAs && !lightboxDownload.disabled);
    const savedImage = await page.evaluate(() => ({ ...window.savedImageAs, expected: window.expectedImageBase64 }));
    const downloadedBytes = Buffer.from(savedImage.bytes);
    assert.equal(downloadedBytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.deepEqual(downloadedBytes, Buffer.from(savedImage.expected, "base64"));
    assert.equal(savedImage.mimeType, "image/png");
    assert.match(savedImage.filename, /\.png$/);
    const downloadResult = await page.evaluate(() => ({ text: toast.textContent, tone: toast.dataset.tone }));
    assert.match(downloadResult.text, /^已保存：/);
    assert.equal(downloadResult.tone, "success");

    const filePreviewSave = await page.evaluate(async () => {
      delete window.wandouShell;
      let pickerCalled = false;
      window.showDirectoryPicker = async () => { pickerCalled = true; return { name: "我的图片", queryPermission: async () => "granted" }; };
      storeAutoSaveDirectoryHandle = async () => {};
      await chooseAutoSaveDirectory();
      return { name: autoSaveDirectoryHandle?.name, text: toast.textContent, pickerCalled };
    });
    assert.equal(filePreviewSave.name, undefined);
    assert.equal(filePreviewSave.pickerCalled, false);
    assert.match(filePreviewSave.text, /项目自动保留在软件内；需要导出文件时请使用下载按钮/);

    console.log("PASS: node model selection, copy, local save, download, and overlay feedback work in Chromium");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
