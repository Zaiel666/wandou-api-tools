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

console.log("PASS: reference painting is stored as a separate API mask and composited only inside the selection");
