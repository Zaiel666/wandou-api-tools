const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const html = fs.readFileSync(path.join(__dirname, "..", "app", "ai-node-canvas.html"), "utf8");

test("outpaint node is available from the toolbar and both context menus", () => {
  assert.match(html, /data-add-node="outpaint"/);
  assert.match(html, /data-menu-node="outpaint"/);
  assert.match(html, /data-link-create="outpaint"/);
});

test("outpaint exposes horizontal, vertical and all-side expansion", () => {
  assert.match(html, /value:\s*"horizontal",\s*label:\s*"左右扩图"/);
  assert.match(html, /value:\s*"vertical",\s*label:\s*"上下扩图"/);
  assert.match(html, /value:\s*"all",\s*label:\s*"四周扩图"/);
  assert.match(html, /function renderOutpaintBody\(node\)/);
});

test("outpaint restores the source image over the generated canvas", () => {
  assert.match(html, /function composeOutpaintImage\(/);
  assert.match(html, /ctx\.drawImage\(\s*original\.image,/);
  assert.match(html, /sourceNode\.type === "outpaint"/);
  assert.match(html, /outpaintPromptFor\(node, targetSize/);
});

test("pending elapsed time is kept in metadata and not duplicated in the center", () => {
  const pendingMarkup = html.match(/const media = node\.pending[\s\S]*?: node\.type === "image"/);
  assert.ok(pendingMarkup, "pending media markup should exist");
  assert.doesNotMatch(pendingMarkup[0], /data-elapsed/);
  assert.match(html, /node\.pending[\s\S]*?`用时 \$\{Number\(node\.elapsed\) \|\| 0\}秒`/);
});
