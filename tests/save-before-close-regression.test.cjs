const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pageSource = fs.readFileSync(
  path.resolve(__dirname, "../app/ai-node-canvas.html"),
  "utf8",
);
const shellSource = fs.readFileSync(
  path.resolve(__dirname, "../desktop-client/shell.js"),
  "utf8",
);

const saveStart = pageSource.indexOf("async function saveCanvasStateNow");
const saveEnd = pageSource.indexOf("function saveCanvasState()", saveStart);
const saveSource = pageSource.slice(saveStart, saveEnd);

assert.notEqual(saveStart, -1, "saveCanvasStateNow is missing");
assert.match(
  saveSource,
  /context\.state\s*=\s*storedState[\s\S]*queueDesktopCanvasBackup\(context\)/,
  "desktop backups must receive the compact indexed-media state",
);
assert.match(
  pageSource,
  /pendingLocalMediaWrites\.has\(id\)/,
  "duplicate media persistence must share one in-flight write",
);
assert.doesNotMatch(shellSource, /保存超过 300 秒|300000/, 'local saves must not fail on a fixed five-minute timer');
assert.match(shellSource, /await saveTask/, 'close must wait for the actual save result');
assert.match(shellSource, /attempt !== closeAttempt/, 'cancelled close attempts must ignore late save results');

console.log("PASS: close backups use compact media state without false 120-second failures");
