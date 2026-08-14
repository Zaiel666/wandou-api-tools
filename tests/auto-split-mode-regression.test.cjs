const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync("app/ai-node-canvas.html", "utf8");

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, `${name} must exist`);
  const brace = html.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < html.length; index += 1) {
    if (html[index] === "{") depth += 1;
    if (html[index] === "}") depth -= 1;
    if (depth === 0) return html.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

const context = vm.createContext({ autoSplitMaximum: 99 });
vm.runInContext(`${extractFunction("chineseNumberValue")}\n${extractFunction("localAutoSplitFallback")}`, context);

const sixDay = context.localAutoSplitFallback("制作六天旅游攻略，统一高级杂志插画风格和版式");
assert.equal(sixDay.length, 6, "six-day travel plans must produce six independent prompts");
sixDay.forEach((item, index) => {
  assert.match(item.prompt, new RegExp(`第${index + 1}天`));
  assert.match(item.prompt, /不要拼图、分栏、多宫格或画中画/);
  assert.doesNotMatch(item.prompt, /六天旅游攻略/);
});

const poster = context.localAutoSplitFallback("把海报元素分别拆分成白底图：相机、行李箱、太阳镜");
assert.equal(poster.length, 3, "three named poster elements must produce three prompts");
poster.forEach((item) => {
  assert.match(item.prompt, /纯白背景/);
  assert.match(item.prompt, /不要拼图、分栏、多宫格或画中画/);
});
assert.match(poster[0].prompt, /“相机”/);
assert.match(poster[1].prompt, /“行李箱”/);
assert.match(poster[2].prompt, /“太阳镜”/);

const twentyDay = context.localAutoSplitFallback("制作二十天旅游攻略，统一高级杂志插画风格和版式");
assert.equal(twentyDay.length, 20, "auto split must support plans up to twenty images");

assert.match(html, /const autoSplitMaximum = 99/);
assert.match(html, /AI按内容决定1–99张/);
assert.match(html, /node\.autoSplitProgress = 1/);
assert.match(html, /分析并自动拆分 \$\{Math\.max\(1, Math\.min\(99,/);
assert.match(html, /createAutoSplitBatchDirectory\(node\)/);
assert.match(html, /autoSaveBatchFolder: confirmedAutoSplitPlan\.length/);
assert.match(html, /const autoSplitCountdownSeconds = 45/);
assert.match(html, /已暂停（剩余/);
assert.doesNotMatch(html, /node\.autoSplitSeconds = 0;\s*\n\s*render\(\);\s*\n\s*canvas\.querySelector/);
assert.match(html, /data-auto-split-toggle/);
assert.match(html, /node\.autoSplit \? "disabled"/);
assert.match(html, /postPromptModelWithFallback/);
assert.match(html, /const promptModificationModels = \["GPT", "Claude"\]/);
assert.doesNotMatch(html, /class="prompt-refine-models"/);
assert.doesNotMatch(html, /修改时默认使用 GPT/);
assert.match(html, /const resultGap = 2/);
assert.doesNotMatch(html, /resultHeaderHeight/);
assert.match(html, /\.node\.result \.node-menu \[data-delete\]:hover/);
assert.match(html, /body\.dark-theme \.prompt-manager-main > \.prompt-search \{[^}]*background:#111513 !important/s);

console.log("PASS: auto split creates independent poster elements and six-day travel prompts");
