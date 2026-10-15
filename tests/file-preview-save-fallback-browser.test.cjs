const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("../desktop-client/node_modules/playwright");

(async () => {
  const browser = await chromium.launch({ headless:true, executablePath:"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(pathToFileURL(path.resolve(__dirname, "../app/ai-node-canvas.html")).href, {waitUntil:"domcontentloaded"});
    await page.waitForFunction(() => document.body.dataset.canvasReady === "true");
    const result = await page.evaluate(async () => {
      const supported = autoSaveSupported();
      const handle = await loadAutoSaveDirectoryHandle();
      const button = document.getElementById("autoSaveDirectoryButton");
      nodes = []; links = []; nodeId = 1;
      const generator = createNode("generator", 20, 20, {prompt:"一个白色方块", model:"gpt-image-2", count:1, _deferRender:true});
      apiKeyInput.value = "test-only-key";
      let pickerCalls = 0;
      let apiCalls = 0;
      chooseAutoSaveDirectory = async () => { pickerCalls += 1; };
      callApi = async () => {
        apiCalls += 1;
        const image = document.createElement("canvas");
        image.width = 32; image.height = 32;
        image.getContext("2d").fillRect(0, 0, 32, 32);
        return {url:image.toDataURL("image/png"), mediaType:"image"};
      };
      await generateFromNode(generator.id);
      return {supported, handle:!!handle, button:button.textContent, warning:button.classList.contains("required-warning"), pickerCalls, apiCalls};
    });
    assert.equal(result.supported, false);
    assert.equal(result.handle, false);
    assert.equal(result.button, "生成后下载");
    assert.equal(result.warning, false);
    assert.equal(result.pickerCalls, 0);
    assert.equal(result.apiCalls, 1);
    assert.deepEqual(errors, []);
    console.log("PASS: file preview generates without repeatedly requesting an unavailable save directory");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
