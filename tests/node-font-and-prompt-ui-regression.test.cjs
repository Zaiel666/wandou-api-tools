const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pagePath = path.resolve(__dirname, "../app/ai-node-canvas.html");
const source = fs.readFileSync(pagePath, "utf8");
const styles = source.slice(0, source.indexOf("</style>"));

assert.match(styles, /--wd-weight-regular:\s*400;/, "node default text must use a crisp Source Han Sans regular face");
assert.match(styles, /--wd-weight-medium:\s*600;/, "selected node text must use a restrained Source Han Sans semibold face");
assert.match(styles, /\.node,\s*\n\s*\.node \*\s*\{[^}]*font-weight:\s*var\(--wd-weight-regular\)\s*!important/s);
assert.match(styles, /\.node\.selected,[^}]*font-weight:\s*var\(--wd-weight-medium\)\s*!important/s);
assert.match(styles, /body\.dark-theme #promptLibrarySearch,[^}]*background:\s*#0d1110\s*!important/s);
assert.match(styles, /\.node\.result \.node-menu \[data-delete\][^}]*background:\s*transparent/s);
assert.match(styles, /body\.dark-theme \.node\.result \.node-menu \[data-delete\][^}]*background:\s*transparent/s);
assert.match(styles, /\.node\.result\.selected,\s*\n\s*\.node\.result\.box-selected\s*\{[^}]*outline:\s*1px solid #43d13b\s*!important[^}]*outline-offset:\s*0\s*!important[^}]*box-shadow:\s*none\s*!important/s,
  "selected result nodes should use only a one-pixel outline without a glow");
assert.match(styles, /\.preview-favorite[^}]*background:\s*transparent/s);
assert.match(styles, /\.preview-download[^}]*background:\s*transparent/s);
assert.match(styles, /\.preview-regenerate[^}]*background:\s*transparent/s);
assert.match(styles, /\.preview-favorite[^}]*border-radius:\s*50%/s);
assert.match(styles, /\.preview-regenerate[^}]*left:\s*40px/s);
assert.match(styles, /\.preview-download[^}]*left:\s*72px/s);
assert.match(styles, /\.prompt-library-item[^}]*height:\s*28px[^}]*min-height:\s*28px/s);
assert.match(styles, /\.prompt-manager-modal[^}]*height:min\(610px, 82vh\)[^}]*border-radius:\s*10px/s,
  "prompt manager should use a compact rectangular desktop dialog");
assert.match(styles, /\.prompt-manager-list \.prompt-library-item[^}]*min-height:\s*68px[^}]*border-radius:\s*6px/s,
  "prompt cards should be compact rectangles instead of tall pills");
assert.match(styles, /\.prompt-manager-main > \.prompt-search[^}]*height:\s*34px/s,
  "prompt manager search should use the compact control height");
assert.match(styles, /\.prompt-corner-button svg[^}]*stroke-width:\s*1\.35/s,
  "the three prompt action icons should use a refined thin stroke");
assert.match(source, /\[data-prompt-library\][\s\S]*togglePromptLibrary\(node\.id\)/,
  "the prompt library trigger should use toggle behavior");
assert.match(source, /function togglePromptLibrary\(nodeId\)[\s\S]*isCurrentPanelOpen[\s\S]*closePromptLibrary\(\)[\s\S]*openPromptLibrary\(nodeId\)/,
  "clicking the same prompt library button again should close its panel");

console.log("PASS: node typography uses two crisp Source Han Sans weights and prompt/result controls stay legible");
