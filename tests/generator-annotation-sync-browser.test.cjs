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
      const imageCanvas = document.createElement("canvas");
      imageCanvas.width = 100; imageCanvas.height = 100;
      imageCanvas.getContext("2d").fillRect(0, 0, 100, 100);
      const source = createNode("image", 0, 0, {
        references:[{url:imageCanvas.toDataURL("image/png"), mediaType:"image", width:100, height:100, comments:[{id:"comment-1", shape:"rect", x:.1, y:.2, w:.3, h:.2, text:"把证书编号改清晰"}]}],
        _deferRender:true
      });
      const generator = createNode("generator", 0, 0, {prompt:"保持原有布局", _deferRender:true});
      links.push({from:source.id, to:generator.id});
      const connected = renderGeneratorBody(generator);
      document.body.append(connected);
      const item = connected.querySelector(".generator-annotation-item");
      const connectedState = {
        label:item?.querySelector(".generator-annotation-number")?.textContent,
        text:item?.querySelector(".generator-annotation-text")?.textContent,
        prompt:connected.querySelector('[data-field="prompt"]')?.value,
        requestPrompt:generatorPromptWithAnnotations(generator, generator.prompt),
        numberColor:getComputedStyle(item.querySelector(".generator-annotation-number")).backgroundColor,
        markerColor:getComputedStyle(document.querySelector(".reference-comment-marker") || (() => { const marker = document.createElement("span"); marker.className = "reference-comment-marker"; document.body.append(marker); return marker; })()).borderTopColor
      };
      const maskedRefs = applyGeneratorAnnotationMask(generator, collectReferenceItems([...getInputMediaList(generator.id), generator]));
      const frozenSource = {...generator, references:maskedRefs, _directReferencesOnly:true};
      connectedState.maskSurvivesRequestCollection = Boolean(collectReferenceItems(frozenSource._directReferencesOnly ? [frozenSource] : [...getInputMediaList(generator.id), frozenSource])[0]?.maskUrl);
      const request = await buildApiRequest({...generator, prompt:connectedState.requestPrompt, _apiTargetSize:"1024x1024"}, maskedRefs);
      connectedState.submittedPrompt = request.body.get("prompt");
      connectedState.submittedImageCount = request.body.getAll("image").length;
      connectedState.submittedMaskCount = request.body.getAll("mask").length;
      const loadedMask = await loadImageForCanvas(maskedRefs[0].maskUrl);
      const maskCanvas = document.createElement("canvas");
      maskCanvas.width = 100; maskCanvas.height = 100;
      const maskCtx = maskCanvas.getContext("2d");
      maskCtx.drawImage(loadedMask.image, 0, 0);
      connectedState.maskOutsideAlpha = maskCtx.getImageData(5, 5, 1, 1).data[3];
      connectedState.maskInsideAlpha = maskCtx.getImageData(20, 30, 1, 1).data[3];
      loadedMask.revoke();
      source.references[0].comments.push({id:"comment-2", shape:"rect", x:.6, y:.6, w:.2, h:.2, text:"把落款日期改清晰"});
      const multipleRefs = await appendGeneratorAnnotationGuide(generator,
        applyGeneratorAnnotationMask(generator, collectReferenceItems([...getInputMediaList(generator.id), generator])));
      const multiplePrompt = generatorPromptWithAnnotations(generator, generator.prompt, multipleRefs);
      const multipleRequest = await buildApiRequest({...generator, prompt:multiplePrompt, _apiTargetSize:"1024x1024"}, multipleRefs);
      connectedState.multiple = {
        rows:renderGeneratorBody(generator).querySelectorAll(".generator-annotation-item").length,
        guide:!!multipleRefs[1]?.annotationGuideFor,
        imageCount:multipleRequest.body.getAll("image").length,
        maskCount:multipleRequest.body.getAll("mask").length,
        prompt:multipleRequest.body.get("prompt")
      };
      const secondMask = await loadImageForCanvas(multipleRefs[0].maskUrl);
      maskCtx.clearRect(0, 0, 100, 100);
      maskCtx.drawImage(secondMask.image, 0, 0);
      connectedState.multiple.secondRegionAlpha = maskCtx.getImageData(70, 70, 1, 1).data[3];
      secondMask.revoke();
      source.references[0].comments[0].text = "只修改编号";
      const editedText = renderGeneratorBody(generator).querySelector(".generator-annotation-text")?.textContent;
      render();
      const renderedBeforeDelete = document.querySelectorAll(`.node[data-id="${generator.id}"] .generator-annotation-item`).length;
      source.references[0].comments = source.references[0].comments.filter((comment) => comment.id !== "comment-2");
      render();
      const renderedAfterDelete = [...document.querySelectorAll(`.node[data-id="${generator.id}"] .generator-annotation-item`)]
        .map((item) => item.textContent.trim());
      const promptAfterDelete = generatorPromptWithAnnotations(generator, generator.prompt);
      links = [];
      const disconnected = renderGeneratorBody(generator).querySelectorAll(".generator-annotation-item").length;
      return {connectedState, editedText, renderedBeforeDelete, renderedAfterDelete, promptAfterDelete, disconnected};
    });
    assert.equal(state.connectedState.label, "图1 · 1");
    assert.equal(state.connectedState.text, "把证书编号改清晰");
    assert.equal(state.connectedState.prompt, "保持原有布局");
    assert.match(state.connectedState.requestPrompt, /图1 黄色批注1（区域从图片左侧 10%、顶部 20% 开始，宽 30%、高 20%）：把证书编号改清晰/);
    assert.match(state.connectedState.submittedPrompt, /图1 黄色批注1（区域从图片左侧 10%、顶部 20% 开始，宽 30%、高 20%）：把证书编号改清晰/);
    assert.equal(state.connectedState.submittedImageCount, 1);
    assert.equal(state.connectedState.submittedMaskCount, 1);
    assert.equal(state.connectedState.maskSurvivesRequestCollection, true);
    assert.equal(state.connectedState.maskOutsideAlpha, 255);
    assert.equal(state.connectedState.maskInsideAlpha, 0);
    assert.equal(state.connectedState.multiple.rows, 2);
    assert.equal(state.connectedState.multiple.guide, true);
    assert.equal(state.connectedState.multiple.imageCount, 2);
    assert.equal(state.connectedState.multiple.maskCount, 1);
    assert.equal(state.connectedState.multiple.secondRegionAlpha, 0);
    assert.match(state.connectedState.multiple.prompt, /批注1[^\n]*把证书编号改清晰/);
    assert.match(state.connectedState.multiple.prompt, /批注2[^\n]*把落款日期改清晰/);
    assert.match(state.connectedState.multiple.prompt, /第 2 张参考图是图1的黄色编号批注定位图/);
    assert.equal(state.connectedState.numberColor, state.connectedState.markerColor);
    assert.equal(state.editedText, "只修改编号");
    assert.equal(state.renderedBeforeDelete, 2);
    assert.deepEqual(state.renderedAfterDelete, ["图1 · 1只修改编号"]);
    assert.doesNotMatch(state.promptAfterDelete, /把落款日期改清晰/);
    assert.equal(state.disconnected, 0);
    assert.deepEqual(errors, []);
    console.log("PASS: connected image annotations appear in the prompt box and generation prompt, update, and clear on disconnect");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
