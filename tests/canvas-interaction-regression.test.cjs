const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const source = fs.readFileSync(path.join(__dirname, "..", "app", "ai-node-canvas.html"), "utf8");

assert.match(source, /function autoLayout\(\)[\s\S]*?arrangeWorkflowSelection\(layoutNodes\)[\s\S]*?fitCanvasToContent\(false\)/);
assert.doesNotMatch(source, /function autoLayout\(\)[\s\S]{0,500}?const columns = \[60, 430, 1010, 1400\]/);
assert.match(source, /function resultMetaText\(node\)/);
assert.match(source, /galleryOverlay\.classList\.add\("open"\);[\s\S]{0,180}?renderGallery\(\)/);
assert.match(source, /const selectedGroupDrag = boxSelectedIds\.includes\(node\.id\)/);
assert.match(source, /event\.key === "Delete" && boxSelectedIds\.length/);
assert.match(source, /function isGroupDragBlockedTarget\(target\)/);
assert.match(source, /\.node\.box-selected\s*\{[\s\S]*?outline:\s*2px solid #43e75b/);
assert.match(source, /\.node\.box-selected::after[\s\S]*?content:\s*attr\(data-selection-index\)/);
assert.match(source, /nodeEl\.dataset\.selectionIndex = String\(index \+ 1\)/);

console.log("PASS: auto layout, gallery opening, and box-selection group actions remain operational");
