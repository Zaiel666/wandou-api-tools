const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../app/ai-node-canvas.html"), "utf8");

assert.match(source, /width:\s*16px;[\s\S]*?height:\s*16px;/, "reference corner controls should be smaller");
assert.match(source, /绿色区域允许修改/);
assert.match(source, /保存遮罩/);
assert.match(source, /let paintOriginalCanvas = document\.createElement\("canvas"\)/);
assert.match(source, /let paintSelectionCanvas = document\.createElement\("canvas"\)/);
assert.match(source, /reference\.maskUrl = createApiMaskDataUrl/);
assert.match(source, /reference\.maskSelectionUrl = paintSelectionCanvas\.toDataURL/);
assert.doesNotMatch(source, /refs\[activeLightbox\.refIndex\]\.url = paintCanvas\.toDataURL/, "mask painting must not overwrite the original reference");
assert.match(source, /form\.append\("mask", maskFile, "mask\.png"\)/);
assert.match(source, /referenceToPngFile\(reference, index, maskedReference\.maskWidth, maskedReference\.maskHeight\)/);
assert.doesNotMatch(source, /input_fidelity\s*=/);
assert.match(source, /只允许修改遮罩透明区域/);
assert.match(source, /composeMaskedEditImage\(rawUrl, maskedReference, targetSize\)/);
assert.match(source, /const mix = selectionData\.data\[index \+ 3\] \/ 255/);
assert.match(source, /maskUrl: await persistMediaValue\(item\.maskUrl\)/);
assert.match(source, /maskSelectionUrl: await getLocalMedia\(item\.maskSelectionUrl\)/);
assert.match(source, /touch-action:\s*none/, "touch gestures must not interrupt mask painting");
assert.match(source, /id="paintBrush"[\s\S]*?>画笔<\/button>/, "brush should have its own tool button");
assert.match(source, /id="paintErase"[\s\S]*?>橡皮擦<\/button>/, "eraser should have its own tool button");
assert.match(source, /paintBrush\.addEventListener\("click"[\s\S]*?setPaintEraseMode\(false\)/, "brush button should explicitly select paint mode");
assert.match(source, /paintErase\.addEventListener\("click"[\s\S]*?setPaintEraseMode\(true\)/, "eraser button should explicitly select erase mode");
assert.match(source, /id="paintSize"[^>]*max="160"[^>]*value="24"/, "brush slider should support a visibly larger brush");
assert.match(source, /\.lightbox-tools button[\s\S]*?white-space:\s*nowrap/, "toolbar labels should stay horizontal");
assert.match(source, /function drawPaintDot\(point\)/, "a tap must create or erase a visible dot");
assert.match(source, /paintCanvas\.addEventListener\("lostpointercapture", finishPaintStroke\)/, "interrupted pointers must finish cleanly");
assert.match(source, /const loadToken = \+\+paintLoadToken/, "stale asynchronous image loads must not replace the active reference");

console.log("PASS: reference painting is stored as a separate API mask and composited only inside the selection");
