const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("../desktop-client/node_modules/playwright");

(async () => {
  const browser = await chromium.launch({headless:true, executablePath:"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"});
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(pathToFileURL(path.resolve(__dirname, "../app/ai-node-canvas.html")).href, {waitUntil:"domcontentloaded"});
    await page.waitForFunction(() => document.body.dataset.canvasReady === "true");
    const result = await page.evaluate(async () => {
      nodes = []; links = []; nodeId = 1;
      const makeImage = (color) => {
        const canvas = document.createElement("canvas");
        canvas.width = 100; canvas.height = 100;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = color; ctx.fillRect(0, 0, 100, 100);
        return canvas.toDataURL("image/png");
      };
      const source = createNode("image", 20, 20, {references:[{
        url:makeImage("#ff0000"), mediaType:"image", width:100, height:100,
        comments:[
          {id:"a", shape:"rect", x:.2, y:.2, w:.2, h:.2, text:"第一处修改"},
          {id:"b", shape:"rect", x:.6, y:.6, w:.2, h:.2, text:"第二处修改"}
        ]
      }], _deferRender:true});
      const generator = createNode("generator", 400, 20, {prompt:"只修改两个批注区域", model:"gpt-image-2", count:1, ratio:"1:1", resolution:"1K", _deferRender:true});
      links.push({from:source.id, to:generator.id});
      apiKeyInput.value = "test-only-key";
      let calls = 0;
      callApi = async (requestNode) => {
        calls += 1;
        return {url:makeImage("#0000ff"), mediaType:"image", fromApi:true};
      };
      await generateFromNode(generator.id);
      const generated = nodes.find((node) => node.type === "result");
      const loaded = await loadImageForCanvas(generated.fullUrl);
      const canvas = document.createElement("canvas");
      canvas.width = 100; canvas.height = 100;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(loaded.image, 0, 0, 100, 100);
      const pixel = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data).slice(0, 3);
      const sampled = {outside:pixel(5, 5), first:pixel(30, 30), middle:pixel(50, 50), second:pixel(70, 70)};
      loaded.revoke();
      return {calls, status:generated.status, sampled};
    });
    assert.equal(result.calls, 1);
    assert.deepEqual(result.sampled.outside, [255, 0, 0]);
    assert.deepEqual(result.sampled.middle, [255, 0, 0]);
    assert.deepEqual(result.sampled.first, [0, 0, 255]);
    assert.deepEqual(result.sampled.second, [0, 0, 255]);
    assert.deepEqual(errors, []);
    console.log("PASS: two annotation regions change while unmarked pixels stay identical to the source");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
