const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");
const canvas = read("app/ai-node-canvas.html");
const projectHub = read("app/project-hub.html");
const shell = read("desktop-client/shell.js");
const main = read("desktop-client/main.js");
const preload = read("desktop-client/preload.js");

assert.match(canvas, /const desktopBackupIntervalMs = 30000/);
assert.match(canvas, /context\.state\s*=\s*storedState[\s\S]*queueDesktopCanvasBackup\(context\)/);
assert.match(canvas, /hasCanvasMedia[\s\S]*writeCanvasMedia[\s\S]*persistedLocalMediaIds\.add\(id\)/);
assert.match(canvas, /copy\.sourceUrl = await persistMediaValue\(copy\.sourceUrl\)/);
assert.match(canvas, /copy\.outpaintSourceUrl = await persistMediaValue\(copy\.outpaintSourceUrl\)/);
assert.match(canvas, /desktopMediaRequired \? storedOnDesktop : storedInBrowser/);
assert.match(canvas, /const browserWriteTask[\s\S]*desktopMediaRequired[\s\S]*void browserWriteTask\.catch/);
assert.match(canvas, /async function getLocalMedia[\s\S]*readCanvasMedia[\s\S]*const db = await openLocalMediaDb/);
assert.doesNotMatch(
  canvas,
  /async function putLocalMedia\(value\)\s*\{\s*const db = await openLocalMediaDb\(\);\s*if \(!db\) return value/,
  "desktop disk persistence must still run when IndexedDB is unavailable",
);
assert.match(canvas, /if \(!db\) openLocalMediaDb\.promise = null/);
assert.match(canvas, /node\.sourceUrl = await getLocalMedia\(node\.sourceUrl\)/);
assert.match(canvas, /wandouPrepareTabSuspend[\s\S]*nodes\.some\(\(node\) => node\.pending\)/);

assert.match(shell, /inactiveCanvasSuspendDelayMs = 120000/);
assert.match(shell, /wandouPrepareTabSuspend[\s\S]*if \(!result\?\.safe/);
assert.match(shell, /tab\.suspended[\s\S]*tab\.view\.src = "about:blank"/);

assert.match(main, /containsEmbeddedCanvasMedia\(state\)/);
assert.match(main, /compactEmbeddedCanvasMedia[\s\S]*writeCanvasMedia[\s\S]*indexed-media:/);
assert.match(main, /state = await compactEmbeddedCanvasMedia\(state\)/);
assert.match(main, /canvasBackupFingerprint[\s\S]*deduplicated: true/);
assert.match(main, /function writeCanvasMedia[\s\S]*canvasMediaRootDirectory/);
assert.match(preload, /desktop:has-canvas-media/);
assert.match(preload, /desktop:write-canvas-media/);
assert.match(preload, /desktop:read-canvas-media/);

assert.match(projectHub, /projectResultPreviewSources/);
assert.match(projectHub, /node\?\.type === "result"/);
assert.match(projectHub, /hydrateProjectCovers/);
assert.match(projectHub, /cover-media-grid/);

console.log("PASS: compact desktop storage, safe tab suspension, and real project covers");
