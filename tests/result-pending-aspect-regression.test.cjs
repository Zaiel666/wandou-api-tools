const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const html = fs.readFileSync(path.join(__dirname, "..", "app", "ai-node-canvas.html"), "utf8");

test("pending result previews use their known output dimensions", () => {
  assert.match(html, /const resultWidth = node\.type === "result" \? Number\(node\.width\) : 0;/);
  assert.match(html, /const resultHeight = node\.type === "result" \? Number\(node\.height\) : 0;/);
  assert.match(
    html,
    /const previewRatio = resultWidth > 0 && resultHeight > 0\s*\? `\$\{resultWidth\} \/ \$\{resultHeight\}`/,
    "known result dimensions must take priority over Auto or fallback ratios",
  );
});

test("pending result nodes receive target dimensions before their media exists", () => {
  assert.match(
    html,
    /createNode\("result",[\s\S]*?width: parsed\.width,[\s\S]*?height: parsed\.height,[\s\S]*?pending: true/,
  );
});
