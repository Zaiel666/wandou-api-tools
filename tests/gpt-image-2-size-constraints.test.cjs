const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../app/ai-node-canvas.html"), "utf8");

function functionSource(name, nextName) {
  const pattern = new RegExp(`    function ${name}\\([\\s\\S]*?\\n    }\\r?\\n\\r?\\n    function ${nextName}\\(`);
  const match = source.match(pattern);
  assert.ok(match, `${name} should be present`);
  return match[0].replace(new RegExp(`\\r?\\n\\r?\\n    function ${nextName}\\($`), "");
}

const context = {};
vm.createContext(context);
vm.runInContext([
  functionSource("roundToMultiple", "apiSizeFromTarget"),
  functionSource("apiSafeGenerationSize", "ratioKey"),
  functionSource("parseSize", "drawImageAspectSafe"),
].join("\n"), context);

const cases = new Map([
  ["1024x1024", "1024x1024"],
  ["2048x2048", "2048x2048"],
  ["2048x1152", "2048x1152"],
  ["4096x2304", "3840x2160"],
  ["2304x4096", "2160x3840"],
  ["4096x4096", "2880x2880"],
]);

for (const [requested, expected] of cases) {
  assert.equal(context.apiSafeGenerationSize(requested), expected, requested);
}

for (const requested of ["5120x1024", "640x640", "3000x2000", "1800x3200"]) {
  const [width, height] = context.apiSafeGenerationSize(requested).split("x").map(Number);
  assert.ok(width <= 3840 && height <= 3840, `${requested}: maximum edge`);
  assert.equal(width % 16, 0, `${requested}: width multiple`);
  assert.equal(height % 16, 0, `${requested}: height multiple`);
  assert.ok(Math.max(width / height, height / width) <= 3, `${requested}: aspect ratio`);
  assert.ok(width * height >= 655360 && width * height <= 8294400, `${requested}: pixel count`);
}

console.log("PASS: GPT Image 2 requests obey the official flexible-size constraints through 4K");
