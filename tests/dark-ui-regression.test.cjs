const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const css = fs.readFileSync(path.join(__dirname, "..", "app", "styles.css"), "utf8");

test("dark announcement dialog uses a dark readable surface", () => {
  assert.match(css, /\[data-theme="dark"\] \.notice-dialog-card,[\s\S]*?background:\s*#10170e;/);
  assert.match(css, /\[data-theme="dark"\] \.notice-dialog-card,[\s\S]*?color:\s*#f5f8ef;/);
});

test("service cards do not draw a white inset highlight", () => {
  const rule = css.match(/\.service-card::after\s*\{([\s\S]*?)\}/);
  assert.ok(rule, "service card pseudo-element rule should exist");
  assert.match(rule[1], /content:\s*none;/);
  assert.doesNotMatch(rule[1], /box-shadow/);
});
