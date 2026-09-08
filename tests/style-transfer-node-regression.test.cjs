const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const html = fs.readFileSync(path.join(__dirname, "..", "app", "ai-node-canvas.html"), "utf8");

test("style transfer node is available everywhere nodes are created", () => {
  assert.match(html, /data-add-node="style">风格迁移/);
  assert.match(html, /data-menu-node="style">新建风格迁移/);
  assert.match(html, /data-link-create="style">连接到风格迁移/);
  assert.match(html, /if \(type === "style"\) return "风格迁移"/);
});

test("style transfer keeps two explicit image roles in one node", () => {
  assert.match(html, /① 内容图/);
  assert.match(html, /② 风格参考/);
  assert.match(html, /styleRole/);
  assert.match(html, /第 1 张决定画什么，第 2 张决定怎么画/);
  assert.match(html, /references\.length !== 2/);
});

test("style transfer sends ordered references with role-specific instructions", () => {
  assert.match(html, /第 1 张是内容图：锁定主体身份/);
  assert.match(html, /第 2 张是风格参考图：只提取画风/);
  assert.match(html, /_directReferencesOnly: true, count: 1/);
  assert.match(html, /node\.type === "style" \? styleTransferPrompt\(node\)/);
});

test("style transfer supports strength, output ratio and resolution controls", () => {
  assert.match(html, /data-style-strength="\$\{item\.value\}"/);
  assert.match(html, /data-style-output/);
  assert.match(html, /跟随内容图/);
  assert.match(html, /跟随风格图/);
  assert.match(html, /data-style-resolution/);
  assert.match(html, /data-style-select-toggle/);
  assert.doesNotMatch(html, /<select data-style-(?:model|output)/);
});
