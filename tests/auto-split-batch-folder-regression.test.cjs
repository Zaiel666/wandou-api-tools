const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = process.env.WANDOU_TEST_APP_ROOT || path.resolve(__dirname, '../app');

for (const filename of ['ai-node-canvas.html', 'ai-node-canvas-test.html']) {
  const canvas = fs.readFileSync(path.join(app, filename), 'utf8');
  const extract = name => {
    const start = canvas.indexOf(`    function ${name}(`);
    assert.ok(start >= 0, `${filename}: ${name}`);
    const end = canvas.slice(start + 1).search(/\n    (?:async )?function /);
    return canvas.slice(start, start + 1 + end);
  };
  let saved = 0;
  const c = vm.createContext({ activeProjectName: () => '隔离批次', safeFilePart: value => value, scheduleCanvasSave: () => saved++ });
  vm.runInContext(extract('autoSplitBatchFolderName') + '\n' + extract('beginAutoSplitBatch'), c);
  const first = {}, second = {};
  const firstId = c.beginAutoSplitBatch(first), secondId = c.beginAutoSplitBatch(second);
  assert.match(firstId, /^自动拆分-/); assert.notEqual(firstId, secondId);
  assert.equal(first.autoSplitBatchFolder, firstId); assert.equal(second.autoSplitBatchFolder, secondId);
  assert.equal(saved, 2, 'new batch identifiers remain part of the saved project');
  assert.doesNotMatch(extract('beginAutoSplitBatch'), /createSaveDirectory|getDirectoryHandle|loadAutoSaveDirectoryHandle/);
  assert.doesNotMatch(canvas, /createAutoSplitBatchDirectory\(/);
  assert.match(canvas, /autoSaveBatchFolder: confirmedAutoSplitPlan\.length \? String\(node\.autoSplitBatchFolder \|\| ""\)/);
  assert.match(canvas, /autoSaveBatchFolder: String\(original\.autoSaveBatchFolder \|\| ""\)/, 'regeneration retains the original batch group');
  assert.match(canvas, /item\.autoSaveBatchFolder === node\.autoSplitBatchFolder/, 'retry candidates stay in their own batch');
}
console.log('PASS: split batches have independent saved group IDs, retries retain groups, and generation creates no export folders');
