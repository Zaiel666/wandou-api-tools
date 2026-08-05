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
assert.match(
  shellSource,
  /保存超过 300 秒[\s\S]*300000/,
  "large first-time saves need a five-minute safety window",
);

console.log("PASS: close backups use compact media state without false 120-second failures");
