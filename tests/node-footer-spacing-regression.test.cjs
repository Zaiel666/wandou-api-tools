const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pagePath = path.resolve(__dirname, "../app/ai-node-canvas.html");
const pageSource = fs.readFileSync(pagePath, "utf8");
const styleEnd = pageSource.indexOf("</style>");
const styles = pageSource.slice(0, styleEnd);

const statusRule =
  styles.match(/(?:^|\n)\s*\.status\s*\{([^}]+)\}/)?.[1] || "";
assert.match(
  statusRule,
  /margin-top:\s*2px/,
  "node status text must sit exactly 2px below its content",
);

const resultMetaRule =
  styles.match(/(?:^|\n)\s*\.result-meta-line\s*\{([^}]+)\}/)?.[1] || "";
assert.match(
  resultMetaRule,
  /margin-top:\s*2px/,
  "result dimensions and elapsed time must sit exactly 2px below the image",
);

console.log("PASS: node footer text remains 2px below node media");
