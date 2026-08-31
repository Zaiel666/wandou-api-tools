const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "app", "ai-node-canvas.html"), "utf8");

assert.match(source, /imagePayload\.output_format = "png";/, "GPT Image requests must ask for PNG output");
assert.match(source, /imagePayload\.background = "transparent";/, "transparent-image requests must ask the API for transparency");
assert.match(source, /const extension = node\.mediaType === "video" \? "mp4" : "png";/, "all downloaded images must use a PNG filename");
assert.match(source, /if \(node\.mediaType === "image"\) \{\s*objectUrl = await imageToSizedBlobUrl\(downloadUrl, node\.width, node\.height, Boolean\(node\.transparent\)\);/, "every downloaded image must be transcoded to a real PNG");
assert.match(source, /objectUrl = await imageToSizedBlobUrl\(src, node\.width, node\.height, Boolean\(node\.transparent\)\);\s*blob = await sourceToBlob\(objectUrl \|\| src, "image\/png"\);/, "automatic image saves must also be encoded as PNG");
assert.match(source, /async function imageToSizedBlobUrl\(src, width, height, keepTransparent = false\)/, "PNG conversion must accept an alpha-preservation flag");
assert.match(source, /drawImageAspectSafe\(ctx, img, outputWidth, outputHeight, keepTransparent\);/, "transparent downloads must retain their alpha channel");
assert.match(source, /canvas\.toBlob\([\s\S]*?"image\/png"\);/, "the exported blob must be encoded as PNG");

console.log("PASS: image downloads are real PNG files and transparent results preserve alpha");
