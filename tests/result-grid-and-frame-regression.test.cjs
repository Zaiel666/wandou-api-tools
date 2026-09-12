const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pagePath = path.resolve(__dirname, "../app/ai-node-canvas.html");
const source = fs.readFileSync(pagePath, "utf8");

assert.match(
  source,
  /const gapX = resultWidth \+ resultGap;/,
  "result columns must use the same exact 2px gap as result rows",
);
assert.match(
  source,
  /const resultBodyHeight = resultWidth \* parsed\.height \/ Math\.max\(1, parsed\.width\);/,
  "result row height must match the visible image height without an extra metadata allowance",
);
assert.match(source, /\.node\.result \{[^}]*min-height: 0;/s, "result nodes must not add an invisible minimum height");
assert.doesNotMatch(source, /resultMetaHeight/, "overlay metadata must not add space between result rows");
assert.match(
  source,
  /columnX \+= nodeWidth\(item\) \+ gap;/,
  "completed result cards must be reflowed with an exact 2px horizontal gap",
);
assert.match(
  source,
  /rowY \+= rowHeight \+ gap;/,
  "completed result cards must be reflowed with an exact 2px vertical gap",
);
assert.match(source, /if \(total <= 48\) return 6;\s*return 9;/, "large automatic splits must fit up to 99 results on the canvas");
assert.doesNotMatch(
  source,
  /normalizeGeneratedImage\(rawUrl, targetSize, false, true\)/,
  "generated images must never be fill-cropped to a different target aspect ratio",
);
assert.match(
  source,
  /getImageDimensions\(url\)/,
  "result cards must use the API image's real dimensions after preserving the full frame",
);

console.log("PASS: result grid uses 2px gaps and generated frames are preserved without cropping");
