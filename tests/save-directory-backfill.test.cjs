const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app/ai-node-canvas.html'), 'utf8');
assert.match(source, /当前保存位置：\$\{directoryPath\}/, 'full native save path must be visible');
assert.match(source, /await saveUnsavedGeneratedImagesToSelectedDirectory\(\)/, 'choosing a folder must backfill existing images');
assert.match(source, /node\.type === "result"[\s\S]*!node\.autoSaved[\s\S]*autoSaveGeneratedNodeMedia\(node\)/, 'only unsaved generated images should be backfilled');
assert.match(source, /已保存到：\$\{result\.path \|\| result\.filename\}/, 'native save feedback must show the actual path');
assert.match(source, /自动保存失败：\$\{error\?\.message/, 'automatic save failures must show their reason');
console.log('PASS: selecting a folder backfills unsaved images and reports exact paths and failures');
