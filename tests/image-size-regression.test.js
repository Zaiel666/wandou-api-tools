import assert from "node:assert/strict";
import fs from "node:fs";

const sizeMap = {
  "1K": {
    "1:1": [1024, 1024],
    "16:9": [1820, 1024],
    "9:16": [1024, 1820],
    "4:3": [1365, 1024],
    "3:4": [1024, 1365],
    "3:2": [1536, 1024],
    "2:3": [1024, 1536],
    "3:1": [3072, 1024],
    "1:3": [1024, 3072],
    "5:4": [1280, 1024],
    "4:5": [1024, 1280],
    "21:9": [2389, 1024],
  },
  "2K": {
    "1:1": [1920, 1920],
    "16:9": [1920, 1080],
    "9:16": [1080, 1920],
    "4:3": [1920, 1440],
    "3:4": [1440, 1920],
    "3:2": [1920, 1280],
    "2:3": [1280, 1920],
    "3:1": [1920, 640],
    "1:3": [640, 1920],
    "5:4": [1920, 1536],
    "4:5": [1536, 1920],
    "21:9": [1920, 823],
  },
  "4K": {
    "1:1": [3840, 3840],
    "16:9": [3840, 2160],
    "9:16": [2160, 3840],
    "4:3": [3840, 2880],
    "3:4": [2880, 3840],
    "3:2": [3840, 2560],
    "2:3": [2560, 3840],
    "3:1": [3840, 1280],
    "1:3": [1280, 3840],
    "5:4": [3840, 3072],
    "4:5": [3072, 3840],
    "21:9": [3840, 1646],
  },
};

function apiSizeFromTarget(targetSize) {
  const [width, height] = targetSize.split("x").map(Number);
  if (Math.abs(width - height) <= Math.max(width, height) * 0.08) {
    return "1024x1024";
  }
  return width > height ? "1536x1024" : "1024x1536";
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

    tested += 1;
  }
}

assert.equal(tested, 36);
const pageSource = fs.readFileSync(new URL("../app/ai-node-canvas.html", import.meta.url), "utf8");
assert.match(pageSource, /size:\s*node\._forceStandardApiSize[\s\S]*?isGptImageModel\(imageModel\)[\s\S]*?apiSafeGenerationSize\(targetSize\)[\s\S]*?apiSizeFromTarget\(targetSize\)/);
assert.match(pageSource, /prompt:\s*promptWithSize\(imagePrompt, targetSize\)/);
assert.doesNotMatch(pageSource, /normalizeGeneratedImage\(rawUrl,\s*targetSize,\s*false,\s*true\)/);
assert.match(pageSource, /getImageDimensions\(url\)/);
assert.doesNotMatch(pageSource, /imagePayload\.targetSize\s*=\s*targetSize/);
assert.match(pageSource, /sourceNode\._lockOutputSize[\s\S]*?normalizeGeneratedImage\(rawUrl, targetSize, false, false\)/);
assert.match(pageSource, /\.canvas-wrap\.is-panning[\s\S]*?visibility:\s*hidden/);
console.log(`PASS: ${tested} size combinations`);
