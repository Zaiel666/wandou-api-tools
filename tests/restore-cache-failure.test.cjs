const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app/ai-node-canvas.html'), 'utf8');
const code = source.slice(source.indexOf('async function loadCanvasState()'), source.indexOf('function projectHasStoredCanvasEvidence('));
const saved = {nodes: [{id: 1, type: 'image', mediaUrl: 'indexed-media:test'}], links: [], nodeId: 2};
const sandbox = {
  localStorage: {getItem: () => null}, projectCanvasStorageKey: () => 'p', folderCanvasStorageKey: () => 'f', canvasStorageKey: 'c', activeProjectId: 'p', projects: [{id: 'p'}],
  readCanvasStateBackup: async () => { throw new Error('database closed'); },
  readDesktopCanvasBackups: async () => [saved],
  mergeCanvasRecoveryState: () => null, chooseCanvasRecoveryState: states => states.find(Boolean),
  removeDeprecatedSelectionNodes() {}, cleanLoadedNode: async node => { node.mediaUrl = 'data:image/png;base64,recovered'; },
  pruneBrokenLinks() {}, view: {}, document: {body: {classList: {toggle() {}}}, querySelector: () => ({classList: {toggle() {}}})},
  readGlobalTheme: () => 'dark', updateThemeLabel() {}, render() {}, syncDeletedResultsWithCanvas() {}, showToast() {}, console: {warn() {}}
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
sandbox.loadCanvasState().then(result => {
  assert.equal(result, true);
  assert.equal(sandbox.nodes.length, 1);
  assert.match(sandbox.nodes[0].mediaUrl, /^data:image/);
  assert.equal(sandbox.canvasRecoveryBlocked, false);
  console.log('PASS: desktop nodes and reference restore despite browser database failure');
}).catch(error => { console.error(error); process.exitCode = 1; });
