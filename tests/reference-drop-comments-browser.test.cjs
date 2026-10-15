const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless:true, executablePath:"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" });
  try {
    const page = await browser.newPage({ viewport:{ width:1400, height:1000 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(pathToFileURL(path.resolve(__dirname, "../app/ai-node-canvas.html")).href, {waitUntil:"domcontentloaded"});
    await page.waitForFunction(() => document.body.dataset.canvasReady === "true");
    await page.evaluate(() => {
      nodes = []; links = []; nodeId = 1; render();
      const source = document.createElement("canvas");
      source.width = 100; source.height = 160;
      source.getContext("2d").fillRect(0, 0, 100, 160);
      const data = atob(source.toDataURL("image/png").split(",")[1]);
      const bytes = Uint8Array.from(data, (character) => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], "dropped.png", {type:"image/png"}));
      const rect = canvasWrap.getBoundingClientRect();
      canvasWrap.dispatchEvent(new DragEvent("dragover", {bubbles:true, cancelable:true, dataTransfer:transfer, clientX:rect.left+420, clientY:rect.top+300}));
      canvasWrap.dispatchEvent(new DragEvent("drop", {bubbles:true, cancelable:true, dataTransfer:transfer, clientX:rect.left+420, clientY:rect.top+300}));
    });
    await page.waitForFunction(() => nodes.length === 1 && nodes[0].references.length === 1);
    assert.equal(await page.evaluate(() => nodes[0].autoFitReference), true);
    assert.ok(await page.evaluate(() => Math.abs(nodes[0].frameWidth / nodes[0].frameHeight - 100 / 160) < .02));
    assert.match(await page.locator(".node.image .node-title").innerText(), /参考图 1/);
    assert.equal(await page.locator(".node.image .thumb-index").innerText(), "1");
    const imageThumb = await page.locator(".node.image .thumb img").boundingBox();
    const originalX = await page.evaluate(() => nodes[0].x);
    await page.mouse.move(imageThumb.x + imageThumb.width / 2, imageThumb.y + imageThumb.height / 2);
    await page.mouse.down();
    await page.mouse.move(imageThumb.x + imageThumb.width / 2 + 48, imageThumb.y + imageThumb.height / 2 + 25, {steps:4});
    await page.mouse.up();
    assert.ok(await page.evaluate((x) => nodes[0].x > x + 20, originalX), "dragging the reference image should move its node");
    assert.equal(await page.evaluate(() => paintReady), false, "dragging must not open the image editor");
    await page.locator(".node.image .thumb").click();
    await page.waitForFunction(() => paintReady);
    await page.locator("#paintDoodle").click();
    const box = await page.locator("#paintCanvas").boundingBox();
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.35);
    assert.equal(await page.evaluate(() => paintDoodleCanvas.getContext("2d").getImageData(30, 56, 1, 1).data[3] > 0), true);
    await page.locator("#paintComment").click();
    assert.match(await page.locator("#paintComment").innerText(), /批注模式/);
    assert.equal(await page.locator("#paintComment svg").count(), 1);
    assert.equal(await page.locator("#paintSizeValue").innerText(), "24 px");
    await page.locator("#paintSize").fill("48");
    assert.equal(await page.locator("#paintSizeValue").innerText(), "48 px");
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.5);
    await page.mouse.up();
    assert.equal(await page.locator(".image-comment-marker.pending").count(), 1, "the selected region must be visible before saving");
    assert.ok(await page.locator(".image-comment-marker.pending").evaluate((region) => region.getBoundingClientRect().width >= 20));
    assert.equal(await page.evaluate(() => pendingImageComment.shape), "rect");
    await page.mouse.click(box.x + box.width * .8, box.y + box.height * .8);
    assert.equal(await page.evaluate(() => pendingImageComment.shape), "rect", "another click must not replace an unconfirmed annotation");
    assert.equal(await page.evaluate(() => nodes[0].references[0].comments?.length || 0), 0);
    await page.locator("#imageCommentText").fill("   ");
    await page.locator("#imageCommentForm button[type=submit]").click();
    assert.equal(await page.evaluate(() => nodes[0].references[0].comments?.length || 0), 0, "blank annotations must not be saved");
    await page.locator("#imageCommentText").fill("只调整这里的标题颜色");
    await page.locator("#imageCommentForm button[type=submit]").click();
    assert.equal(await page.evaluate(() => nodes[0].references[0].comments.length), 1);
    assert.equal(await page.evaluate(() => nodes[0].references[0].comments[0].shape), "rect");
    assert.equal(await page.locator(".image-comment-marker").count(), 1);
    await page.mouse.click(box.x + box.width * .75, box.y + box.height * .78);
    assert.equal(await page.evaluate(() => pendingImageComment.shape), "point");
    await page.locator("#imageCommentText").fill("这里只修改小图标");
    await page.locator("#imageCommentForm button[type=submit]").click();
    assert.equal(await page.locator(".image-comment-marker.point").count(), 1);
    await page.locator(".image-comment-marker:not(.pending)").first().click();
    assert.equal(await page.locator("#imageCommentText").inputValue(), "只调整这里的标题颜色");
    await page.locator("#imageCommentText").fill("标题改成深蓝色");
    await page.locator("#imageCommentForm button[type=submit]").click();
    assert.deepEqual(await page.evaluate(() => nodes[0].references[0].comments.map((item) => item.text)), ["标题改成深蓝色", "这里只修改小图标"]);
    await page.locator(".image-comment-content").last().click();
    await page.locator("#imageCommentText").fill("取消后不应保存");
    await page.locator("#imageCommentCancel").click();
    assert.deepEqual(await page.evaluate(() => nodes[0].references[0].comments.map((item) => item.text)), ["标题改成深蓝色", "这里只修改小图标"]);
    if (process.env.WANDOU_SCREENSHOT) await page.screenshot({path:process.env.WANDOU_SCREENSHOT});
    await page.locator("#paintSave").click();
    assert.equal(await page.evaluate(() => Boolean(nodes[0].references[0].doodleUrl)), true);
    assert.equal(await page.locator(".node.image .reference-comment-marker").count(), 2);
    await page.locator(".node.image .thumb").click();
    await page.waitForFunction(() => paintReady);
    assert.equal(await page.locator(".image-comment-marker").count(), 2);
    await page.locator("#lightboxClose").click();
    const saved = await page.evaluate(() => saveCanvasStateNow(createCanvasSaveContext(), {skipDesktopBackup:true}));
    assert.equal(saved, true, "canvas backup should save before reload");
    await page.reload({waitUntil:"domcontentloaded"});
    await page.waitForFunction(() => document.body.dataset.canvasReady === "true" && nodes.some((node) => node.type === "image" && node.references?.length), null, {timeout:5000}).catch(async () => {
      throw new Error(`saved references missing: ${JSON.stringify(await page.evaluate(() => nodes.map((node) => ({type:node.type, references:node.references?.length}))))}`);
    });
    assert.equal(await page.evaluate(() => Boolean(nodes.find((node) => node.type === "image").references[0].doodleUrl)), true);
    assert.deepEqual(await page.evaluate(() => nodes.find((node) => node.type === "image").references[0].comments.map((comment) => comment.shape)), ["rect", "point"]);
    if (process.env.WANDOU_SCREENSHOT) {
      await page.evaluate(() => document.body.classList.add("dark-theme"));
      await page.screenshot({path:process.env.WANDOU_SCREENSHOT.replace(/\.png$/i, "-canvas.png")});
    }
    await page.evaluate(() => {
      const original = nodes.find((node) => node.type === "image");
      createNode("image", original.x + 540, original.y);
    });
    assert.ok((await page.locator(".node.image .node-title").allInnerTexts()).some((title) => /参考图 2/.test(title)));
    await page.evaluate(() => deleteNode(nodes.find((node) => node.type === "image").id));
    assert.equal((await page.locator(".node.image .node-title").allInnerTexts())[0].trim(), "参考图 1");
    const pastePoint = await page.evaluate(() => {
      const rect = canvasWrap.getBoundingClientRect();
      for (let y = rect.top + 100; y < rect.bottom - 30; y += 75) for (let x = rect.left + 100; x < rect.right - 30; x += 75) {
        const hit = document.elementFromPoint(x, y);
        if (hit && canvasWrap.contains(hit) && !hit.closest(".node, .topbar, .project-hub, .context-menu")) return {x,y};
      }
      throw new Error("no empty canvas point available");
    });
    await page.mouse.move(pastePoint.x, pastePoint.y);
    const pasted = await page.evaluate(({x,y}) => {
      const source = document.createElement("canvas");
      source.width = 120; source.height = 80;
      source.getContext("2d").fillRect(0, 0, 120, 80);
      const bytes = Uint8Array.from(atob(source.toDataURL("image/png").split(",")[1]), (character) => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], "clipboard.png", {type:"image/png"}));
      const expected = screenToWorld(x, y);
      const previousCount = nodes.length;
      window.dispatchEvent(new ClipboardEvent("paste", {bubbles:true, cancelable:true, clipboardData:transfer}));
      return { expected, previousCount };
    }, pastePoint);
    await page.waitForFunction((count) => nodes.length === count + 1, pasted.previousCount);
    assert.ok(await page.evaluate(({x,y}) => {
      const node = nodes.at(-1);
      return Math.abs(node.x - x) < 2 && Math.abs(node.y - y) < 2 && node.references?.length === 1;
    }, pasted.expected), "clipboard image should become a reference node at the pointer");
    const copyCount = await page.evaluate(() => {
      selectedNodeId = nodes.at(-1).id;
      window.dispatchEvent(new KeyboardEvent("keydown", {key:"c", ctrlKey:true, bubbles:true, cancelable:true}));
      return nodes.length;
    });
    assert.ok(await page.evaluate(() => copiedCanvasImageUrl), "Ctrl+C should remember the selected reference image");
    const emptyPoint = await page.evaluate(() => {
      const rect = canvasWrap.getBoundingClientRect();
      for (let y = rect.top + 100; y < rect.bottom - 30; y += 75) for (let x = rect.left + 100; x < rect.right - 30; x += 75) {
        const hit = document.elementFromPoint(x, y);
        if (hit && canvasWrap.contains(hit) && !hit.closest(".node, .topbar, .project-hub, .context-menu")) return {x,y};
      }
      throw new Error("no empty canvas point available");
    });
    await page.mouse.move(emptyPoint.x, emptyPoint.y);
    await page.evaluate(() => window.dispatchEvent(new ClipboardEvent("paste", {bubbles:true, cancelable:true, clipboardData:new DataTransfer()})));
    await page.waitForFunction((count) => nodes.length === count + 1, copyCount);
    assert.equal(await page.evaluate(() => nodes.at(-1).references.length), 1, "Ctrl+C and Ctrl+V should copy a selected reference image into a new node");
    const tintedNodeIcons = await page.evaluate(() => {
      for (const type of ["generator", "style", "video", "png", "outpaint", "psd", "vector", "audio"]) createNode(type, 50, 50, {_deferRender:true});
      render();
      return [...document.querySelectorAll(".node button svg, .node label svg, .node .model-provider-icon, .node .reference-upload-plus, .node .style-transfer-plus")]
        .filter((element) => !element.closest(".danger, [data-remove-ref], .thumb-remove"))
        .map((element) => ({element, color:getComputedStyle(element).color}))
        .filter(({color}) => {
          const [r,g,b] = (color.match(/\d+/g) || []).map(Number);
          return g > r * 1.13 && g > b * 1.08;
        })
        .map(({element,color}) => `${element.closest(".node")?.className}: ${element.className?.baseVal || element.className} ${color}`);
    });
    assert.deepEqual(tintedNodeIcons, [], "node action icons should use neutral colors");
    assert.equal(errors.length, 0, errors.join("\n"));
    console.log("PASS: external image drop, numbering, doodle and positioned comments");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
