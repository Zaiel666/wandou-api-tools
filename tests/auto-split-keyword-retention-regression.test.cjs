const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "app", "ai-node-canvas.html"), "utf8");
const confirmStart = source.indexOf("async function confirmAutoSplitGeneration(node)");
const confirmEnd = source.indexOf("function normalizeAutoSplitPlan(items)", confirmStart);
const confirmSource = source.slice(confirmStart, confirmEnd);

assert.ok(confirmStart >= 0 && confirmEnd > confirmStart, "confirmation flow must exist");
assert.match(confirmSource, /node\.autoSplitReviewOpen = true;/, "keyword plan must remain open after confirmation");
assert.doesNotMatch(confirmSource, /node\.autoSplitReviewOpen = false;/, "confirmation must not close the keyword plan");
assert.match(confirmSource, /node\.autoSplitPlanConfirmed = true;/, "confirmed plans must be persisted as confirmed");
assert.match(confirmSource, /node\.autoSplitGenerating = true;/, "the plan must expose generation state");
assert.match(confirmSource, /finally\s*\{[\s\S]*node\.autoSplitGenerating = false;[\s\S]*node\.autoSplitReviewOpen = true;/, "the plan must remain open after success or failure");
assert.match(source, /生成失败/);
assert.match(source, /关键词仍保留/);
assert.match(source, /data-auto-split-copy/);

console.log("PASS: automatic split keywords remain visible and mapped after generation failures");
