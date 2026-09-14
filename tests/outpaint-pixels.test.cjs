const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.resolve(__dirname, "../app/ai-node-canvas.html")).href, {
      waitUntil: "domcontentloaded",
    });

    await page.locator('[data-add-node="outpaint"]').click();
    const outpaintNode = page.locator('.node.outpaint').last();
    assert.equal(await outpaintNode.locator('[data-outpaint-url]').count(), 0, "URL controls should be removed");
    assert.equal(await outpaintNode.locator('.workflow-empty-visual').evaluate((element) => getComputedStyle(element).textAlign), "center");
    assert.equal(await outpaintNode.locator('[data-outpaint-direction], [data-outpaint-amount], .status').count(), 0, 'old direction, amount, and footer rows should be gone');
    assert.equal(await outpaintNode.locator('[data-transparent-background-toggle]').getAttribute('aria-checked'), 'false');

    const portraitUrl = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 540;
      canvas.height = 720;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ef233c";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/png");
    });
    await page.evaluate((url) => {
      const node = nodes.filter((item) => item.type === "outpaint").at(-1);
      node.references = [{ url, mediaType: "image", width: 540, height: 720 }];
      node.mediaUrl = url;
      node.width = 540;
      node.height = 720;
      node.outpaintDirection = 'vertical';
      node.outpaintAmount = 100;
      render();
    }, portraitUrl);
    const outpaintPreview = page.locator('.node.outpaint').last().locator('.outpaint-visual-preview');
    const outpaintFrame = outpaintPreview.locator('.outpaint-preview-frame');
    const outpaintBox = await outpaintFrame.boundingBox();
    assert.ok(outpaintBox.height > outpaintBox.width, "portrait outpaint target frame should be taller than wide");
    assert.equal(await outpaintPreview.locator('[data-outpaint-upload]').count(), 1, 'upload control should sit on the preview');
    assert.equal(await outpaintNode.locator('.result-actions').count(), 0, 'outpaint should not have a separate upload row');
    assert.equal(await outpaintNode.locator('[data-outpaint-edit] .outpaint-edit-icon').count(), 1, 'canvas adjustment should have a distinctive icon');
    const adjustmentStyle = await outpaintNode.locator('[data-outpaint-edit]').evaluate((button) => ({
      background:getComputedStyle(button).backgroundColor,
      text:getComputedStyle(button).color,
    }));
    assert.notEqual(adjustmentStyle.background, 'rgba(0, 0, 0, 0)', 'adjustment control should have a visible surface');
    assert.notEqual(adjustmentStyle.text, adjustmentStyle.background, 'adjustment label should remain legible');
    const [uploadChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      outpaintPreview.locator('.outpaint-preview-upload').click(),
    ]);
    assert.ok(uploadChooser, 'preview upload control should open file selection');
    assert.equal(await page.locator('.outpaint-editor-overlay').count(), 0, 'upload click must not open the canvas editor');
    await page.locator('.node.outpaint').last().locator('[data-outpaint-edit]').click();
    const editor = page.locator('.outpaint-editor-overlay');
    assert.ok((await editor.locator('[data-outpaint-scale]').boundingBox()).width < 150, 'scale menu should stay compact');
    assert.equal(await editor.locator('[data-outpaint-prompt]').evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(36, 38, 38)');
    await editor.locator('[data-outpaint-ratio="1.777778"]').click();
    let frameState = await page.evaluate(() => {
      const node = nodes.filter((item) => item.type === 'outpaint').at(-1);
      return { frame: outpaintTargetFrame({ width:540, height:720 }, node.outpaintDirection, node.outpaintAmount, node.outpaintCustomInsets), insets:node.outpaintCustomInsets };
    });
    assert.ok(Math.abs(frameState.frame.targetWidth / frameState.frame.targetHeight - 16 / 9) < .01, "ratio preset should control actual output frame");
    const eastHandle = editor.locator('[data-edge="e"]');
    const eastBox = await eastHandle.boundingBox();
    await page.mouse.move(eastBox.x + eastBox.width / 2, eastBox.y + eastBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(eastBox.x + eastBox.width / 2 + 45, eastBox.y + eastBox.height / 2, { steps:5 });
    await page.mouse.up();
    const movedFrame = await page.evaluate(() => {
      const node = nodes.filter((item) => item.type === 'outpaint').at(-1);
      return outpaintTargetFrame({ width:540, height:720 }, node.outpaintDirection, node.outpaintAmount, node.outpaintCustomInsets);
    });
    assert.ok(movedFrame.targetWidth > frameState.frame.targetWidth, "dragging right edge should extend output width");
    assert.equal(movedFrame.x, frameState.frame.x, "dragging right edge should leave original image position unchanged");
    const sourceBox = await editor.locator('[data-outpaint-source]').boundingBox();
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(sourceBox.x + sourceBox.width / 2 - 25, sourceBox.y + sourceBox.height / 2, { steps:5 });
    await page.mouse.up();
    const shiftedFrame = await page.evaluate(() => {
      const node = nodes.filter((item) => item.type === 'outpaint').at(-1);
      return outpaintTargetFrame({ width:540, height:720 }, node.outpaintDirection, node.outpaintAmount, node.outpaintCustomInsets);
    });
    assert.equal(shiftedFrame.targetWidth, movedFrame.targetWidth, "moving the source should preserve the chosen canvas width");
    assert.ok(shiftedFrame.x < movedFrame.x, "moving the source left should create more space on the right");
    await editor.locator('[data-outpaint-scale]').selectOption('2');
    const scaledFrame = await page.evaluate(() => {
      const node = nodes.filter((item) => item.type === 'outpaint').at(-1);
      return outpaintTargetFrame({ width:540, height:720 }, node.outpaintDirection, node.outpaintAmount, node.outpaintCustomInsets);
    });
    assert.ok(Math.abs(scaledFrame.targetWidth / scaledFrame.targetHeight - shiftedFrame.targetWidth / shiftedFrame.targetHeight) < .01, 'changing scale should keep a dragged custom ratio');
    assert.ok(scaledFrame.targetWidth > shiftedFrame.targetWidth, 'larger scale should enlarge the target canvas');
    await editor.locator('[data-outpaint-close]').click();
    await page.locator('.node.outpaint').last().locator('.outpaint-visual-preview').click();
    assert.equal(await page.locator('.outpaint-editor-overlay').count(), 1, 'clicking the preview should reopen the visual editor');
    await page.locator('.outpaint-editor-overlay [data-outpaint-close]').click();
    await page.locator('.node.outpaint').last().locator('[data-transparent-background-toggle]').click();
    assert.equal(await page.locator('.node.outpaint').last().locator('[data-transparent-background-toggle]').getAttribute('aria-checked'), 'true');
    await page.evaluate(() => { const node = nodes.filter((item) => item.type === 'outpaint').at(-1); node.model = 'Nano Banana2'; render(); });
    assert.equal(await page.locator('.node.outpaint').last().locator('[data-transparent-background-toggle]').isDisabled(), true, 'non-GPT outpaint must not offer transparency');
    assert.equal(await page.evaluate(() => nodes.filter((item) => item.type === 'outpaint').at(-1).transparentBackground), false);

    await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1200; canvas.height = 650;
      const url = canvas.toDataURL('image/png');
      const node = nodes.filter((item) => item.type === 'outpaint').at(-1);
      node.references = [{ url, mediaType:'image', width:1200, height:650 }];
      node.mediaUrl = url;
      node.outpaintCustomInsets = { left:.6, right:.6, top:.15, bottom:.15 };
      node.frameWidth = 560;
      render();
    });
    await page.waitForFunction(() => {
      const frame = document.querySelector('.node.outpaint .outpaint-preview-frame');
      return frame && frame.getBoundingClientRect().width > 100;
    });
    const fitted = await page.locator('.node.outpaint').last().locator('.outpaint-visual-preview').evaluate((preview) => {
      const outer = preview.getBoundingClientRect();
      const inner = preview.querySelector('.outpaint-preview-frame').getBoundingClientRect();
      return { outer:{ left:outer.left, top:outer.top, right:outer.right, bottom:outer.bottom }, inner:{ left:inner.left, top:inner.top, right:inner.right, bottom:inner.bottom } };
    });
    assert.ok(fitted.inner.left >= fitted.outer.left + 10 && fitted.inner.right <= fitted.outer.right - 10, 'wide target frame should be fully visible horizontally');
    assert.ok(fitted.inner.top >= fitted.outer.top + 10 && fitted.inner.bottom <= fitted.outer.bottom - 10, 'wide target frame should be fully visible vertically');

    const replacement = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 100; canvas.height = 80;
      canvas.getContext('2d').fillStyle = '#ef233c';
      canvas.getContext('2d').fillRect(0, 0, 100, 80);
      const source = createNode('image', 0, 0, { references:[{ url:canvas.toDataURL('image/png'), width:100, height:80, mediaType:'image' }], _deferRender:true });
      const node = nodes.filter((item) => item.type === 'outpaint').at(-1);
      links.push({ from:source.id, to:node.id });
      node.references = [];
      node.mediaUrl = '';
      node.outpaintCustomInsets = null;
      node.outpaintDirection = 'horizontal';
      node.outpaintAmount = 50;
      node.model = 'gpt-image-2.5-1k';
      render();
      const replacementImage = document.createElement('canvas');
      replacementImage.width = 100; replacementImage.height = 80;
      const context = replacementImage.getContext('2d');
      context.fillStyle = '#13aa72'; context.fillRect(0, 0, 100, 80);
      return { source:canvas.toDataURL('image/png'), replacement:replacementImage.toDataURL('image/png') };
    });
    assert.equal(await outpaintNode.locator('.outpaint-preview-frame img').getAttribute('src'), replacement.source, 'linked source should be visible until replaced');
    await outpaintNode.locator('[data-outpaint-upload]').setInputFiles({ name:'replacement.png', mimeType:'image/png', buffer:Buffer.from(replacement.replacement.split(',')[1], 'base64') });
    await page.waitForFunction(() => document.querySelector('.node.outpaint .outpaint-preview-frame img')?.getAttribute('src')?.startsWith('data:image/'));
    assert.equal(await outpaintNode.locator('.workflow-empty-visual').count(), 0, 'large upload placeholder should disappear after upload');
    assert.equal(await outpaintNode.locator('.outpaint-preview-upload span').innerText(), '更换图片');
    const footer = await outpaintNode.locator('.outpaint-preview-footer').evaluate((element) => {
      const caption = element.querySelector('.outpaint-preview-hint').getBoundingClientRect();
      const upload = element.querySelector('.outpaint-preview-upload').getBoundingClientRect();
      return { captionRight:caption.right, captionCenter:(caption.top+caption.bottom)/2, uploadLeft:upload.left, uploadCenter:(upload.top+upload.bottom)/2 };
    });
    assert.ok(footer.captionRight < footer.uploadLeft && Math.abs(footer.captionCenter - footer.uploadCenter) < 8, 'change-image control should align beside the expansion caption');
    const chosen = await page.evaluate(() => {
      const node = nodes.filter((item) => item.type === 'outpaint').at(-1);
      return { preview:outpaintSourceReference(node)?.url, request:collectReferenceItems([node, ...getInputMediaList(node.id)])[0]?.url };
    });
    assert.equal(chosen.preview, chosen.request, 'preview, editor and generation should choose the same image');
    assert.notEqual(chosen.preview, replacement.source, 'replacement image must override the connected source');
    await outpaintNode.locator('[data-outpaint-edit]').click();
    assert.equal(await page.locator('[data-outpaint-source]').getAttribute('src'), chosen.preview, 'canvas editor should use replaced image');
    await page.locator('[data-outpaint-close]').click();

    const generatedFromReplacement = await page.evaluate(async () => {
      const node = nodes.filter((item) => item.type === 'outpaint').at(-1);
      const reference = collectReferenceItems([node, ...getInputMediaList(node.id)])[0];
      const frame = outpaintTargetFrame(reference, node.outpaintDirection, node.outpaintAmount);
      const request = await buildApiRequest({ ...node, _apiTargetSize:frame.size }, [reference]);
      const generated = document.createElement('canvas');
      generated.width = frame.targetWidth; generated.height = frame.targetHeight;
      generated.getContext('2d').fillStyle = '#277da1';
      generated.getContext('2d').fillRect(0, 0, generated.width, generated.height);
      const result = await composeOutpaintImage(generated.toDataURL('image/png'), reference, frame.size, node.outpaintDirection, node.outpaintAmount);
      return { isFormData:request.isFormData, source:reference.url, result };
    });
    assert.equal(generatedFromReplacement.isFormData, true);
    assert.equal(generatedFromReplacement.source, chosen.preview, 'edit request must use the replacement');
    const restoredPixel = await page.evaluate(async (url) => {
      const image = new Image(); image.src = url; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      return Array.from(ctx.getImageData(Math.floor(image.width / 2), Math.floor(image.height / 2), 1, 1).data);
    }, generatedFromReplacement.result);
    assert.ok(restoredPixel[1] > restoredPixel[0], 'composed output must restore the green replacement, not the red linked source');

    const request = await page.evaluate(async () => {
      const source = document.createElement("canvas");
      source.width = 120;
      source.height = 160;
      const ctx = source.getContext("2d");
      ctx.fillStyle = "#ef233c";
      ctx.fillRect(0, 0, source.width, source.height);
      const reference = { url: source.toDataURL("image/png"), width: 120, height: 160 };
      const node = {
        type: "outpaint",
        model: "gpt-image-2.5-1k",
        resolution: "2K",
        outpaintDirection: "horizontal",
        outpaintAmount: 100,
        prompt: outpaintPromptFor({ outpaintDirection: "horizontal" }, "240x160")
      };
      const built = await buildApiRequest({ ...node, _apiTargetSize: "240x160" }, [reference]);
      const transparentBuilt = await buildApiRequest({ ...node, transparentBackground:true, _apiTargetSize: "240x160" }, [reference]);
      const image = await createImageBitmap(built.body.get("image"));
      const mask = await createImageBitmap(built.body.get("mask"));
      const read = (bitmap, x, y) => {
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        context.drawImage(bitmap, 0, 0);
        return Array.from(context.getImageData(x, y, 1, 1).data);
      };
      const result = {
        isFormData: built.isFormData,
        imageSize: [image.width, image.height],
        maskSize: [mask.width, mask.height],
        left: read(image, 15, 80),
        center: read(image, 120, 80),
        right: read(image, 225, 80),
        maskLeft: read(mask, 15, 80),
        maskCenter: read(mask, 120, 80),
        maskRight: read(mask, 225, 80),
        model: built.body.get("model"),
        transparentBackground: transparentBuilt.body.get('background'),
        transparentFormat: transparentBuilt.body.get('output_format'),
      };
      image.close();
      mask.close();
      return result;
    });
    assert.equal(request.isFormData, true);
    assert.deepEqual(request.imageSize, [240, 160]);
    assert.deepEqual(request.maskSize, [240, 160]);
    assert.deepEqual(request.left, [0, 0, 0, 0]);
    assert.deepEqual(request.center, [239, 35, 60, 255]);
    assert.deepEqual(request.right, [0, 0, 0, 0]);
    assert.equal(request.maskLeft[3], 0);
    assert.equal(request.maskCenter[3], 255);
    assert.equal(request.maskRight[3], 0);
    assert.equal(request.model, "gpt-image-2.5-1k");
    assert.equal(request.transparentBackground, 'transparent');
    assert.equal(request.transparentFormat, 'png');

    const customGuide = await page.evaluate(async () => {
      const source = document.createElement('canvas');
      source.width = 100; source.height = 80;
      const context = source.getContext('2d');
      context.fillStyle = '#ef233c'; context.fillRect(0, 0, 100, 80);
      const custom = { left:1, right:0, top:.5, bottom:0 };
      const reference = { url:source.toDataURL('image/png'), width:100, height:80 };
      const frame = outpaintTargetFrame(reference, 'horizontal', 50, custom);
      const guide = await createOutpaintGuide(reference, frame.size, 'horizontal', 50, custom);
      const image = new Image(); image.src = guide.imageUrl; await image.decode();
      const mask = new Image(); mask.src = guide.maskUrl; await mask.decode();
      const canvas = document.createElement('canvas'); canvas.width = frame.targetWidth; canvas.height = frame.targetHeight;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image,0,0);
      const sourceAt = (x,y) => Array.from(ctx.getImageData(x,y,1,1).data);
      const outside = sourceAt(10,60);
      const inside = sourceAt(120,60);
      ctx.clearRect(0,0,canvas.width,canvas.height); ctx.drawImage(mask,0,0);
      const maskAt = (x,y) => Array.from(ctx.getImageData(x,y,1,1).data);
      const maskOutside = maskAt(10,60);
      const maskInside = maskAt(120,60);
      const generated = document.createElement('canvas'); generated.width = 200; generated.height = 120;
      const generatedContext = generated.getContext('2d');
      generatedContext.fillStyle = '#277da1'; generatedContext.fillRect(0,0,200,120);
      const composedUrl = await composeOutpaintImage(generated.toDataURL('image/png'), reference, frame.size, 'horizontal', 50, custom);
      const composed = new Image(); composed.src = composedUrl; await composed.decode();
      ctx.clearRect(0,0,canvas.width,canvas.height); ctx.drawImage(composed,0,0);
      const composedOutside = Array.from(ctx.getImageData(10,60,1,1).data);
      const composedInside = Array.from(ctx.getImageData(120,60,1,1).data);
      generatedContext.clearRect(0,0,200,120);
      generatedContext.fillStyle = '#13aa72'; generatedContext.fillRect(20,50,30,30);
      const alphaUrl = await composeOutpaintImage(generated.toDataURL('image/png'), reference, frame.size, 'horizontal', 50, custom);
      const alphaImage = new Image(); alphaImage.src = alphaUrl; await alphaImage.decode();
      ctx.clearRect(0,0,canvas.width,canvas.height); ctx.drawImage(alphaImage,0,0);
      return { frame, outside, inside, maskOutside, maskInside,
        composedOutside, composedInside,
        transparentOutside:Array.from(ctx.getImageData(10,10,1,1).data), extendedSubject:Array.from(ctx.getImageData(25,60,1,1).data) };
    });
    assert.deepEqual([customGuide.frame.targetWidth,customGuide.frame.targetHeight,customGuide.frame.x,customGuide.frame.y],[200,120,100,40]);
    assert.equal(customGuide.outside[3],0);
    assert.equal(customGuide.inside[3],255);
    assert.equal(customGuide.maskOutside[3],0);
    assert.equal(customGuide.maskInside[3],255);
    assert.ok(customGuide.composedOutside[2] > 100 && customGuide.composedOutside[0] < 100);
    assert.ok(customGuide.composedInside[0] > 200 && customGuide.composedInside[2] < 100);
    assert.equal(customGuide.transparentOutside[3], 0, 'transparent expansion must retain real alpha outside the new subject');
    assert.equal(customGuide.extendedSubject[3], 255, 'new content can remain opaque within an otherwise transparent extension');

    const result = await page.evaluate(async () => {
      const makeImage = (width, height, color) => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, width, height);
        return canvas.toDataURL("image/png");
      };
      const original = makeImage(100, 80, "#ef233c");
      const generated = makeImage(150, 80, "#277da1");
      const composed = await composeOutpaintImage(
        generated,
        { url: original, width: 100, height: 80 },
        "150x80",
        "horizontal",
        50,
      );
      const image = new Image();
      image.src = composed;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      const pixel = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data);
      return {
        width: canvas.width,
        height: canvas.height,
        left: pixel(5, 40),
        center: pixel(75, 40),
        right: pixel(145, 40),
      };
    });

    assert.deepEqual([result.width, result.height], [150, 80]);
    assert.ok(result.left[2] > 100 && result.left[0] < 100, "left extension should remain generated");
    assert.ok(result.center[0] > 200 && result.center[2] < 100, "center should restore original pixels");
    assert.ok(result.right[2] > 100 && result.right[0] < 100, "right extension should remain generated");
    console.log("PASS: outpaint preserves original pixels and only keeps generated extensions");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
