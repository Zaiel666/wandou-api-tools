const assert = require("node:assert/strict");
const fs = require("node:fs");

const preload = fs.readFileSync("desktop-client/preload.js", "utf8");
const main = fs.readFileSync("desktop-client/main.js", "utf8");
const canvas = fs.readFileSync("app/ai-node-canvas.html", "utf8");

assert.match(preload, /createSaveDirectory:\s*\(folderName\).*desktop:create-save-directory/);
assert.match(preload, /writeSaveFile:\s*\(filename, bytes, folderName = ""\)/);
assert.match(main, /ipcMain\.handle\("desktop:create-save-directory"/);
assert.match(main, /const directory = folderName \? path\.join\(rootDirectory, folderName\) : rootDirectory/);
assert.match(canvas, /function autoSplitBatchFolderName\(\)/);
assert.match(canvas, /`自动拆分-\$\{stamp\}-\$\{suffix\}-\$\{activeProjectName\(\)\}`/);
assert.match(canvas, /node\.autoSplitBatchFolder = folderName/);
assert.match(canvas, /writeBlobToAutoSaveBatchDirectory\(blob, filename, node\.autoSaveBatchFolder \|\| ""\)/);

console.log("PASS: every automatic split run creates and uses its own save folder");
