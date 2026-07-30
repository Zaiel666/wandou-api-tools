const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pagePath = path.resolve(__dirname, "../app/ai-node-canvas.html");
const pageSource = fs.readFileSync(pagePath, "utf8");
const syncStart = pageSource.indexOf("const syncPromptReferenceTokens = () => {");
const syncEnd = pageSource.indexOf(
  'promptField?.addEventListener("input", syncPromptReferenceTokens);',
  syncStart,
);

assert.notEqual(syncStart, -1, "prompt overlay synchronization function is missing");
assert.notEqual(syncEnd, -1, "prompt overlay synchronization boundary is missing");

const syncSource = pageSource.slice(syncStart, syncEnd);

assert.match(
  syncSource,
  /promptOverlay\.style\.height = `\$\{promptField\.offsetHeight\}px`;/,
  "prompt overlay must use the textarea's unscaled layout height",
);
assert.doesNotMatch(
  syncSource,
  /getBoundingClientRect\(\)\.height/,
  "prompt overlay must not reuse the canvas-scaled visual height",
);

console.log("PASS: prompt overlay height remains stable while the canvas is zoomed");
