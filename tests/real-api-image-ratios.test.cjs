const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const apiKey = String(process.env.WANDOU_API_KEY || "").trim();
const apiBase = String(process.env.WANDOU_API_BASE || "https://www.zayapi.top").replace(/\/+$/, "");
const outputDir = path.resolve(__dirname, "../build-output/ratio-validation");

const sizes = {
  "1K": {
    "1:1": [1024, 1024], "16:9": [1536, 864], "9:16": [864, 1536],
    "4:3": [1024, 768], "3:4": [768, 1024], "3:2": [1536, 1024],
    "2:3": [1024, 1536], "1:3": [512, 1536], "5:4": [1280, 1024],
    "4:5": [1024, 1280], "21:9": [2016, 864],
  },
  "2K": {
    "1:1": [2048, 2048], "16:9": [2048, 1152], "9:16": [1152, 2048],
    "4:3": [2048, 1536], "3:4": [1536, 2048], "3:2": [2048, 1360],
    "2:3": [1360, 2048], "1:3": [768, 2304], "5:4": [2560, 2048],
    "4:5": [2048, 2560], "21:9": [2688, 1152],
  },
  "4K": {
    "1:1": [4096, 4096], "16:9": [4096, 2304], "9:16": [2304, 4096],
    "4:3": [4096, 3072], "3:4": [3072, 4096], "3:2": [4096, 2736],
    "2:3": [2736, 4096], "1:3": [1360, 4096], "5:4": [4096, 3280],
    "4:5": [3280, 4096], "21:9": [4096, 1760],
  },
};

const nativeCases = [
  { name: "square", size: "1024x1024", ratio: "1:1" },
  { name: "landscape", size: "1536x1024", ratio: "3:2" },
  { name: "portrait", size: "1024x1536", ratio: "2:3" },
];

function imageValueFromResponse(data) {
  const candidates = [
    ...(Array.isArray(data?.data) ? data.data : []),
    ...(Array.isArray(data?.images) ? data.images : []),
    data?.image,
    data?.result,
    data?.output,
  ].filter(Boolean);
  for (const item of candidates) {
    if (typeof item === "string") return item;
    if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`;
    if (item?.url) return item.url;
    if (item?.image_url) return item.image_url;
    if (item?.base64) return `data:image/png;base64,${item.base64}`;
  }
  return "";
}

async function imageBufferFromValue(value) {
  if (/^data:image\//i.test(value)) {
    return Buffer.from(value.slice(value.indexOf(",") + 1), "base64");
  }
  if (/^https?:\/\//i.test(value)) {
    const response = await fetch(value);
    if (!response.ok) throw new Error(`image download failed: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  throw new Error("API response did not contain a supported image value");
}

async function generateNative(testCase) {
  const response = await fetch(`${apiBase}/v1/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-image-2",
      prompt: `一颗完整的绿色豌豆荚，白灰背景，主体完整居中。画布比例 ${testCase.ratio}，按该比例直接构图，不要添加白边、黑边、留白边框或画中画。`,
      n: 1,
      size: testCase.size,
      quality: "high",
      resolution: "1k",
      output_format: "png",
      response_format: "b64_json",
    }),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`generation failed: HTTP ${response.status}: ${raw.slice(0, 240)}`);
  const data = JSON.parse(raw);
  return imageBufferFromValue(imageValueFromResponse(data));
}

function sourceFor(width, height, nativeImages) {
  if (Math.abs(width - height) <= Math.max(width, height) * 0.08) return nativeImages.square;
  return width > height ? nativeImages.landscape : nativeImages.portrait;
}

(async () => {
  assert.ok(apiKey, "WANDOU_API_KEY is required");
  fs.mkdirSync(outputDir, { recursive: true });

  const nativeImages = {};
  for (const testCase of nativeCases) {
    const buffer = await generateNative(testCase);
    const metadata = await sharp(buffer).metadata();
    const [expectedWidth, expectedHeight] = testCase.size.split("x").map(Number);
    assert.equal(metadata.width, expectedWidth, `${testCase.name} API width`);
    assert.equal(metadata.height, expectedHeight, `${testCase.name} API height`);
    nativeImages[testCase.name] = buffer;
    fs.writeFileSync(path.join(outputDir, `api-${testCase.name}.png`), buffer);
  }

  let tested = 0;
  for (const [resolution, ratios] of Object.entries(sizes)) {
    for (const [ratio, [width, height]] of Object.entries(ratios)) {
      const source = sourceFor(width, height, nativeImages);
      const output = await sharp(source)
        .resize(width, height, { fit: "cover", position: "centre", withoutEnlargement: false })
        .png()
        .toBuffer();
      const metadata = await sharp(output).metadata();
      assert.equal(metadata.width, width, `${resolution} ${ratio} width`);
      assert.equal(metadata.height, height, `${resolution} ${ratio} height`);
      tested += 1;
      if (resolution === "1K") {
        fs.writeFileSync(path.join(outputDir, `${resolution}-${ratio.replace(":", "x")}.png`), output);
      }
    }
  }

  assert.equal(tested, 33);
  console.log(`PASS: 3 real API sources and ${tested} final ratio outputs`);
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
