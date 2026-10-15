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
    const state = await page.evaluate(async () => {
      nodes = []; links = []; nodeId = 1;
      const makeImage = (color) => {
        const canvas = document.createElement("canvas");
        canvas.width = 32; canvas.height = 24;
        const context = canvas.getContext("2d");
        context.fillStyle = color;
        context.fillRect(0, 0, 32, 24);
        return canvas.toDataURL("image/png");
      };
      const firstUrl = makeImage("#777777");
      const secondUrl = makeImage("#bbbbbb");
      const first = createNode("image", 0, 0, {references:[{url:firstUrl, mediaType:"image", width:32, height:24}], _deferRender:true});
      const second = createNode("image", 0, 0, {references:[{url:secondUrl, mediaType:"image", width:32, height:24}], _deferRender:true});
      const generator = createNode("generator", 0, 0, {prompt:"绘制完整画面", model:"gpt-image-2", _deferRender:true});
      const outpaint = createNode("outpaint", 0, 0, {prompt:"扩展背景", model:"gpt-image-2", _deferRender:true});
      const style = createNode("style", 0, 0, {prompt:"改变风格", model:"gpt-image-2", _deferRender:true});
      links.push({from:first.id,to:generator.id}, {from:first.id,to:outpaint.id}, {from:first.id,to:style.id}, {from:second.id,to:style.id});
      const generatorRefs = collectReferenceItems([...getInputMediaList(generator.id), generator]);
      const outpaintRefs = collectReferenceItems([outpaint, ...getInputMediaList(outpaint.id)]).slice(0, 1);
      const styleRefs = styleTransferReferenceItems(style).filter(Boolean);
      const build = async (node, refs) => {
        const request = await buildApiRequest({...node, _apiTargetSize:"1024x1024"}, refs);
        return {isFormData:request.isFormData, imageCount:request.isFormData ? request.body.getAll("image").length : 0};
      };
      return {
        urls:{first:firstUrl, second:secondUrl},
        generator:{refs:generatorRefs.map((item) => item.url), request:await build(generator,generatorRefs)},
        outpaint:{refs:outpaintRefs.map((item) => item.url), request:await build(outpaint,outpaintRefs)},
        style:{refs:styleRefs.map((item) => item.url), request:await build(style,styleRefs)}
      };
    });
    assert.deepEqual(state.generator.refs, [state.urls.first]);
    assert.deepEqual(state.outpaint.refs, [state.urls.first]);
    assert.deepEqual(state.style.refs, [state.urls.first, state.urls.second]);
    assert.deepEqual(state.generator.request, {isFormData:true, imageCount:1});
    assert.deepEqual(state.outpaint.request, {isFormData:true, imageCount:1});
    assert.deepEqual(state.style.request, {isFormData:true, imageCount:2});
    assert.deepEqual(errors, []);
    console.log("PASS: linked references enter drawing, outpaint, and style-transfer image requests");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
