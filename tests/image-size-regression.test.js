import assert from "node:assert/strict";
import fs from "node:fs";

const sizeMap = {
  "1K": {
    "1:1": [1024, 1024],
    "16:9": [1536, 864],
    "9:16": [864, 1536],
    "4:3": [1024, 768],
    "3:4": [768, 1024],
    "3:2": [1536, 1024],
    "2:3": [1024, 1536],
    "1:3": [512, 1536],
    "5:4": [1280, 1024],
    "4:5": [1024, 1280],
    "21:9": [2016, 864],
  },
  "2K": {
    "1:1": [2048, 2048],
    "16:9": [2048, 1152],
    "9:16": [1152, 2048],
    "4:3": [2048, 1536],
    "3:4": [1536, 2048],
    "3:2": [2048, 1360],
    "2:3": [1360, 2048],
    "1:3": [768, 2304],
    "5:4": [2560, 2048],
    "4:5": [2048, 2560],
    "21:9": [2688, 1152],
  },
  "4K": {
    "1:1": [4096, 4096],
    "16:9": [4096, 2304],
    "9:16": [2304, 4096],
    "4:3": [4096, 3072],
    "3:4": [3072, 4096],
    "3:2": [4096, 2736],
    "2:3": [2736, 4096],
    "1:3": [1360, 4096],
    "5:4": [4096, 3280],
    "4:5": [3280, 4096],
    "21:9": [4096, 1760],
  },
};

function apiSizeFromTarget(targetSize) {
  const [width, height] = targetSize.split("x").map(Number);
  if (Math.abs(width - height) <= Math.max(width, height) * 0.08) {
    return "1024x1024";
  }
  return width > height ? "1536x1024" : "1024x1536";
}

function coverRect(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    width,
    height,
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
  };
}

let tested = 0;
for (const [resolution, ratios] of Object.entries(sizeMap)) {
  for (const [ratio, [width, height]] of Object.entries(ratios)) {
    assert.ok(width > 0 && height > 0, `${resolution} ${ratio} must be positive`);

    const [ratioWidth, ratioHeight] = ratio.split(":").map(Number);
    const expectedRatio = ratioWidth / ratioHeight;
    const actualRatio = width / height;
    assert.ok(
      Math.abs(actualRatio - expectedRatio) / expectedRatio <= 0.005,
      `${resolution} ${ratio} ratio mismatch: ${width}x${height}`,
    );

    const apiSize = apiSizeFromTarget(`${width}x${height}`);
    if (ratio === "1:1") {
      assert.equal(apiSize, "1024x1024");
    } else if (width > height) {
      assert.equal(apiSize, "1536x1024");
    } else {
      assert.equal(apiSize, "1024x1536");
    }

    const [apiWidth, apiHeight] = apiSize.split("x").map(Number);
    const rect = coverRect(apiWidth, apiHeight, width, height);
    assert.ok(rect.width >= width - 0.001, `${resolution} ${ratio} leaves horizontal padding`);
    assert.ok(rect.height >= height - 0.001, `${resolution} ${ratio} leaves vertical padding`);
    assert.ok(
      Math.abs(rect.x) <= 0.001 || Math.abs(rect.y) <= 0.001,
      `${resolution} ${ratio} must align one axis exactly`,
    );
    tested += 1;
  }
}

assert.equal(tested, 33);
const pageSource = fs.readFileSync(new URL("../app/ai-node-canvas.html", import.meta.url), "utf8");
assert.match(pageSource, /size:\s*apiSizeFromTarget\(targetSize\)/);
assert.match(pageSource, /prompt:\s*node\.type === "png" \? transparentEditPrompt : promptWithSize\(node\.prompt,\s*targetSize\)/);
assert.match(pageSource, /normalizeGeneratedImage\(rawUrl,\s*targetSize,\s*false,\s*true\)/);
assert.doesNotMatch(pageSource, /imagePayload\.targetSize\s*=\s*targetSize/);
assert.doesNotMatch(pageSource, /settleWithin\(normalizeGeneratedImage\([^)]*\),\s*18000,\s*rawUrl/);
assert.match(pageSource, /\.canvas-wrap\.is-panning[\s\S]*?visibility:\s*hidden/);
console.log(`PASS: ${tested} size combinations`);
