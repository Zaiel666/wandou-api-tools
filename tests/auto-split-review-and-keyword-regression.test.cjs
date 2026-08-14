const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pagePath = path.resolve(__dirname, "../app/ai-node-canvas.html");
const source = fs.readFileSync(pagePath, "utf8");

assert.match(source, /class="auto-split-prompt-preview"/, "read-only plans must render as plain preview blocks");
assert.doesNotMatch(
  source,
  /<textarea data-auto-split-prompt="\$\{index\}" \$\{editing \? "" : "readonly"\}/,
  "read-only plans must not create a second scrollbar per item",
);
assert.match(source, /planList\?\.addEventListener\("wheel", \(event\) => event\.stopPropagation\(\)/);

const countdownStart = source.indexOf("function startAutoSplitCountdown(");
const countdownEnd = source.indexOf("function bindAutoSplitPlanControls(", countdownStart);
const countdownSource = source.slice(countdownStart, countdownEnd);
assert.match(countdownSource, /\.auto-split-countdown/);
assert.doesNotMatch(countdownSource, /refreshRenderedNode\(node\.id\)/, "countdown must not rebuild the node every second");

assert.match(source, /id="lightboxContextPrompt"[^>]*>查看关键词<\/button>/);
assert.match(source, /function activeLightboxPromptText\(\)/);
assert.match(source, /openPromptPreview\(prompt, "", ""\)/, "view keyword must open the copyable prompt preview");
assert.match(source, /links\.find\(\(link\) => link\.to === node\?\.id\)/, "legacy results should inherit their source prompt");

console.log("PASS: auto-split review scroll stays stable and result keywords are viewable/copyable");
