const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const main = read("desktop-client/main.js");
const preload = read("desktop-client/preload.js");
const shell = read("desktop-client/shell.js");

assert.match(main, /contents\.on\("render-process-gone"/);
assert.match(main, /mainWindow\.on\("unresponsive"/);
assert.match(main, /buttons: \["继续等待", "重新载入", "立即关闭"\]/);
assert.match(main, /downloadFileWithFallback[\s\S]*fetchWithTimeout\(source[\s\S]*120000/);
assert.match(preload, /onGuestRendererGone/);
assert.match(shell, /function recoverTabView\(/);
assert.match(shell, /view\.addEventListener\("did-fail-load"/);
assert.match(shell, /view\.addEventListener\("render-process-gone"/);
assert.match(shell, /window\.wandouShell\?\.onGuestRendererGone/);

console.log("PASS: desktop renderer recovery and stalled-update timeout safeguards are present");
