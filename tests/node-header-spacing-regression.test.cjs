const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pagePath = path.resolve(__dirname, "../app/ai-node-canvas.html");
const pageSource = fs.readFileSync(pagePath, "utf8");
const styleEnd = pageSource.indexOf("</style>");
const styles = pageSource.slice(0, styleEnd);

const headerRule =
  styles.match(/(?:^|\n)\s*\.node-header\s*\{([^}]+)\}/)?.[1] || "";
assert.match(
  headerRule,
  /bottom:\s*calc\(100%\s*\+\s*2px\)/,
  "every node header must sit exactly 2px above its node body",
);
assert.match(
  headerRule,
  /align-items:\s*flex-end/,
  "node header controls must share the same bottom edge",
);
assert.doesNotMatch(
  headerRule,
  /top:\s*-\d+px/,
  "node header spacing must not depend on a fixed negative top offset",
);

const selectionRule =
  styles.match(/\.node\.selection \.node-header\s*\{([^}]+)\}/g)?.at(-1) || "";
assert.match(
  selectionRule,
  /bottom:\s*calc\(100%\s*\+\s*2px\)/,
  "selection node headers must use the same 2px spacing",
);

console.log("PASS: all node headers remain 2px above their node bodies");
