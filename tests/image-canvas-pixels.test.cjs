const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

const cases = [
  { name: "square", source: [1024, 1024], target: "1024x1024" },
  { name: "landscape", source: [1536, 1024], target: "1536x864" },
  { name: "portrait", source: [1024, 1536], target: "864x1536" },
  { name: "ultra-wide", source: [1536, 1024], target: "2016x864" },
  { name: "ultra-tall", source: [1024, 1536], target: "512x1536" },
];

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  });
  try {
    const page = await browser.newPage();
    const pagePath = path.resolve(__dirname, "../app/ai-node-canvas.html");
    await page.goto(pathToFileURL(pagePath).href, { waitUntil: "domcontentloaded" });

    for (const testCase of cases) {
      const result = await page.evaluate(async ({ source, target }) => {
        const [sourceWidth, sourceHeight] = source;
        const sourceCanvas = document.createElement("canvas");
        sourceCanvas.width = sourceWidth;
        sourceCanvas.height = sourceHeight;
        const sourceContext = sourceCanvas.getContext("2d");
        sourceContext.fillStyle = "#27c93f";
        sourceContext.fillRect(0, 0, sourceWidth, sourceHeight);

        const dataUrl = await resizeImageToDataUrl(
          sourceCanvas.toDataURL("image/png"),
          target,
          false,
          true,
        );
        const image = new Image();
        image.src = dataUrl;
        await image.decode();

        const outputCanvas = document.createElement("canvas");
        outputCanvas.width = image.naturalWidth;
        outputCanvas.height = image.naturalHeight;
        const outputContext = outputCanvas.getContext("2d");
        outputContext.drawImage(image, 0, 0);
        const points = [
          [0, 0],
          [outputCanvas.width - 1, 0],
          [0, outputCanvas.height - 1],
          [outputCanvas.width - 1, outputCanvas.height - 1],
        ];
        const corners = points.map(([x, y]) => Array.from(outputContext.getImageData(x, y, 1, 1).data));
        return {
          width: outputCanvas.width,
          height: outputCanvas.height,
          corners,
        };
      }, testCase);

      const [expectedWidth, expectedHeight] = testCase.target.split("x").map(Number);
      assert.equal(result.width, expectedWidth, `${testCase.name} width`);
      assert.equal(result.height, expectedHeight, `${testCase.name} height`);
      for (const [red, green, blue, alpha] of result.corners) {
        assert.ok(green > 150 && red < 100 && blue < 120 && alpha === 255, `${testCase.name} has padding`);
      }
    }

    console.log(`PASS: ${cases.length} browser pixel crop cases`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
