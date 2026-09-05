const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app/ai-node-canvas.html'), 'utf8');
const start = source.indexOf('const volatileDownloadSequences = new Map()');
const end = source.indexOf('async function uniqueAutoSaveFileName', start);
assert.ok(start > 0 && end > start, 'download filename functions are missing');
const sandbox = {
  Map, Date,
  canvasStorageKey: 'aiCanvasStateV1', currentFolderId: 'folder', activeProjectId: 'project',
  localStorage: {getItem: () => '7', setItem: () => { throw new Error('exceeded the quota'); }},
  warnCanvasStorageSkipped() {}, projects: [{id: 'project', name: '项目01'}]
};
vm.createContext(sandbox);
vm.runInContext(source.slice(source.indexOf('function activeProjectName()'), end), sandbox);
const first = sandbox.downloadFileName({mediaType: 'image'}, 'png');
const second = sandbox.downloadFileName({mediaType: 'image'}, 'png');
assert.match(first, /图片-008\.png$/);
assert.match(second, /图片-009\.png$/);
console.log('PASS: storage quota failure cannot block download filenames');
