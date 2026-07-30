const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pagePath = path.resolve(__dirname, "../app/ai-node-canvas.html");
const pageSource = fs.readFileSync(pagePath, "utf8");
const styleEnd = pageSource.indexOf("</style>");
const styles = pageSource.slice(0, styleEnd);
const syncStart = pageSource.indexOf("const syncPromptReferenceTokens = () => {");
const syncEnd = pageSource.indexOf(
  'promptField?.addEventListener("input", syncPromptReferenceTokens);',
  syncStart,
);

assert.notEqual(syncStart, -1, "prompt overlay synchronization function is missing");
assert.notEqual(syncEnd, -1, "prompt overlay synchronization boundary is missing");

const syncSource = pageSource.slice(syncStart, syncEnd);
const overlayRule =
  styles.match(/\.prompt-token-overlay\s*\{([^}]+)\}/)?.[1] || "";

assert.match(
  overlayRule,
  /inset:\s*0/,
  "prompt overlay must fill its textarea wrapper through CSS",
);
assert.doesNotMatch(
  syncSource,
  /promptOverlay\.style\.height/,
  "prompt overlay height must not be measured before the node is mounted",
);

console.log("PASS: prompt overlay fills its mounted wrapper without early height measurement");
