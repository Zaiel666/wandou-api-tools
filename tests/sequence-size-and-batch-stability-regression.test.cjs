const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const pagePath = path.resolve(__dirname, "../app/ai-node-canvas.html");
const source = fs.readFileSync(pagePath, "utf8");

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} must exist`);
  const brace = source.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

const context = vm.createContext({ normalizePromptSizeText: (value) => String(value).replace(/×/g, "x") });
vm.runInContext(extractFunction("extractPromptPixelSize"), context);
assert.deepEqual(
  JSON.parse(JSON.stringify(context.extractPromptPixelSize("尺寸是 1139×640 像素"))),
  { width: 1139, height: 640 },
  "requested text dimensions must remain exact instead of becoming an API preset",
);

assert.match(source, /if \(promptPixels\) return `\$\{promptPixels\.width\}x\$\{promptPixels\.height\}`/);
assert.match(source, /_lockOutputSize: true/);
assert.match(source, /normalizeGeneratedImage\(rawUrl, targetSize, false, false\)/, "API output must be normalized to the exact requested final canvas");

assert.match(source, /const deferRender = Boolean\(extra\?\._deferRender\)/);
assert.match(source, /if \(!deferRender\) render\(\)/, "large batches must not render once per placeholder");
assert.match(source, /_deferCanvasSave: true/);
assert.match(source, /pendingNodes\.length >= 10 \? 2 : 3/, "12-image batches must use a bounded two-request queue");
assert.match(source, /batch\.forEach\(\(pending\) => refreshRenderedNode\(pending\.id\)\)/);

assert.match(source, /第 1 张是紧邻上一帧（主要编辑底图），第 2 张如存在则是固定母图/);
assert.match(source, /动作只允许向前推进，禁止回退、重复上一幅度或跳过阶段/);
assert.match(source, /previousFrameReference/);
assert.match(source, /imagesAreNearDuplicate/);
assert.match(source, /与上一帧过于相似，正在强化动作进度后重试/);
assert.doesNotMatch(source, /input_fidelity\s*=/);

console.log("PASS: exact requested sizes, monotonic frame references, and large-batch stability are protected");
