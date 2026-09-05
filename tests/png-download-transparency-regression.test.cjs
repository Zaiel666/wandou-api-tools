const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "app", "ai-node-canvas.html"), "utf8");

assert.match(source, /imagePayload\.output_format = "png";/, "GPT Image requests must ask for PNG output");
assert.match(source, /imagePayload\.background = "transparent";/, "transparent-image requests must ask the API for transparency");
assert.match(source, /const extension = node\.mediaType === "video" \? "mp4" : "png";/, "all downloaded images must use a PNG filename");
assert.match(source, /objectUrl = await sourceToLosslessPngUrl\(downloadUrl, node\.width, node\.height\);/, "downloads must use the lossless PNG path");
assert.match(source, /const blob = await sourceToLosslessPngBlob\(src, node\.width, node\.height\);/, "automatic saves must use the lossless PNG path");
assert.match(source, /if \(await blobIsPng\(original\)\) return original;/, "an existing PNG must be saved without canvas recomposition");
assert.match(source, /imageToSizedBlobUrl\(src, width, height, true\)/, "non-PNG conversion must preserve alpha");
assert.match(source, /sourceNode\.type === "png" \|\| await settleWithin\([\s\S]*imageHasTransparentPixels\(url\)/, "API alpha must be detected even for ordinary generator nodes");
assert.match(source, /async function imageToSizedBlobUrl\(src, width, height, keepTransparent = false\)/, "PNG conversion must accept an alpha-preservation flag");
assert.match(source, /drawImageAspectSafe\(ctx, img, outputWidth, outputHeight, keepTransparent\);/, "transparent downloads must retain their alpha channel");
assert.match(source, /canvas\.toBlob\([\s\S]*?"image\/png"\);/, "the exported blob must be encoded as PNG");

console.log("PASS: image downloads are real PNG files and transparent results preserve alpha");
