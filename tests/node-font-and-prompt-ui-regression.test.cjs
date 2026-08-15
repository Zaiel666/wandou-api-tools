const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pagePath = path.resolve(__dirname, "../app/ai-node-canvas.html");
const source = fs.readFileSync(pagePath, "utf8");
const styles = source.slice(0, source.indexOf("</style>"));

assert.match(styles, /--wd-weight-regular:\s*300;/, "node default text must use Source Han Sans Light");
assert.match(styles, /--wd-weight-medium:\s*700;/, "selected node text must use Source Han Sans Bold");
assert.match(styles, /\.node,\s*\n\s*\.node \*\s*\{[^}]*font-weight:\s*var\(--wd-weight-regular\)\s*!important/s);
assert.match(styles, /\.node\.selected,[^}]*font-weight:\s*var\(--wd-weight-medium\)\s*!important/s);
assert.match(styles, /body\.dark-theme #promptLibrarySearch,[^}]*background:\s*#0d1110\s*!important/s);
assert.match(styles, /\.node\.result \.node-menu \[data-delete\][^}]*background:\s*transparent/s);
assert.match(styles, /body\.dark-theme \.node\.result \.node-menu \[data-delete\][^}]*background:\s*transparent/s);
assert.match(styles, /\.preview-favorite[^}]*background:\s*transparent/s);
assert.match(styles, /\.preview-download[^}]*background:\s*transparent/s);
assert.match(styles, /\.preview-regenerate[^}]*background:\s*transparent/s);
assert.match(styles, /\.preview-favorite[^}]*border-radius:\s*50%/s);
assert.match(styles, /\.preview-regenerate[^}]*left:\s*40px/s);
assert.match(styles, /\.preview-download[^}]*left:\s*72px/s);
assert.match(styles, /\.prompt-library-item[^}]*height:\s*28px[^}]*min-height:\s*28px/s);

console.log("PASS: node typography uses two Source Han Sans weights and prompt/result controls stay legible");
