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

const context = vm.createContext({});
vm.runInContext(extractFunction("autoSplitGenerationPrompt"), context);

const node = {
  prompt: "六天攻略",
  autoSplitLockedSize: "1136x640",
  autoSplitSeriesSpec: "统一墨绿色与金色，固定杂志版式",
  autoSplitConsistency: "series",
};
const item = { prompt: "第二天：湖边自驾" };
const motherPrompt = context.autoSplitGenerationPrompt(node, item, 0, 6, false);
assert.match(motherPrompt, /系列母图/);
assert.match(motherPrompt, /1136x640/);
assert.match(motherPrompt, /统一墨绿色与金色/);

const seriesPrompt = context.autoSplitGenerationPrompt(node, item, 1, 6, true);
assert.match(seriesPrompt, /第一张输入参考图是本批次系列母图/);
assert.match(seriesPrompt, /不可重新设计的版式模板/);
assert.match(seriesPrompt, /字号层级、字体粗细、字距、行距和边距/);

node.autoSplitConsistency = "frame";
const framePrompt = context.autoSplitGenerationPrompt(node, item, 1, 6, true);
assert.match(framePrompt, /高保真局部编辑/);
assert.match(framePrompt, /动作总进度必须是 20%/);
assert.match(framePrompt, /紧邻上一帧/);
assert.match(framePrompt, /未明确要求变化的像素区域尽量保持不动/);

assert.match(html, /data-auto-split-consistency="series"/);
assert.match(html, /data-auto-split-consistency="frame"/);
assert.match(html, /const generationConcurrency = consistencyMode === "frame" \? 1 : pendingNodes\.length >= 10 \? 2 : 3/);
assert.match(html, /const activeConcurrency = confirmedAutoSplitPlan\.length && !motherReference \? 1 : generationConcurrency/);
assert.match(html, /motherReference = \{/);
assert.match(html, /previousFrameReference = \{/);
assert.match(html, /references: referenceList/);
assert.match(html, /_directReferencesOnly: true/);
assert.match(html, /_lockOutputSize: true/);
assert.match(html, /node\.autoSplitLockedSize = targetSize/);
assert.match(html, /imageModel === "gpt-image-2"[\s\S]*?apiSafeGenerationSize\(targetSize\)/);
assert.doesNotMatch(html, /input_fidelity\s*=/);
assert.match(html, /_forceStandardApiSize/);

console.log("PASS: auto split locks dimensions and uses mother-image consistency modes");
