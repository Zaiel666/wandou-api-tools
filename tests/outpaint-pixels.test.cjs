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
    await outpaintNode.locator('[data-outpaint-direction="vertical"]').click();
    const selectedDirection = page.locator('.node.outpaint').last().locator('[data-outpaint-direction="vertical"]');
    assert.equal(await selectedDirection.evaluate((element) => element.classList.contains("active")), true);
    const directionStyle = await selectedDirection.evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, border: style.borderColor, color: style.color, theme: document.body.className };
    });
    assert.equal(directionStyle.background, "rgb(223, 248, 216)");
    await page.locator('.node.outpaint').last().locator('[data-outpaint-amount="100"]').click();
    const selectedAmount = page.locator('.node.outpaint').last().locator('[data-outpaint-amount="100"]');
    assert.equal(await selectedAmount.evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(223, 248, 216)");

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
      render();
    }, portraitUrl);
    const outpaintPreview = page.locator('.node.outpaint').last().locator('.workflow-source-preview');
    const outpaintBox = await outpaintPreview.boundingBox();
    assert.ok(outpaintBox.height > outpaintBox.width, "portrait outpaint preview should be taller than wide");
    assert.equal(await outpaintPreview.locator('img').evaluate((element) => getComputedStyle(element).objectFit), "contain");

    await page.locator('[data-add-node="upscale"]').click();
    await page.evaluate((url) => {
      const node = nodes.filter((item) => item.type === "upscale").at(-1);
      node.references = [{ url, mediaType: "image", width: 540, height: 720 }];
      node.mediaUrl = url;
      node.width = 540;
      node.height = 720;
      render();
    }, portraitUrl);
    const upscalePreview = page.locator('.node.upscale').last().locator('.workflow-source-preview');
    const upscaleBox = await upscalePreview.boundingBox();
    assert.ok(upscaleBox.height > upscaleBox.width, "portrait upscale preview should be taller than wide");
    assert.equal(await upscalePreview.locator('img').evaluate((element) => getComputedStyle(element).objectFit), "contain");

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
