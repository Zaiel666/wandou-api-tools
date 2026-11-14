const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = process.env.WANDOU_TEST_APP_ROOT || path.resolve(__dirname, '../app');

(async () => {
  for (const filename of ['ai-node-canvas.html', 'ai-node-canvas-test.html']) {
    const source = fs.readFileSync(path.join(app, filename), 'utf8');
    const extract = name => {
      const start = source.indexOf(`    async function ${name}(`);
      assert.ok(start >= 0, name);
      const end = source.slice(start + 1).search(/\n    (?:async )?function /);
      return source.slice(start, start + 1 + end);
    };
    const selected = { name: 'manual', directory: 'X:/isolated-manual' };
    let picks = 0, writes = 0, backfills = 0;
    const c = vm.createContext({
      window: { wandouShell: { chooseSaveDirectory: async () => { picks++; return selected; } } },
      nativeAutoSaveDirectory: null, autoSaveDirectoryHandle: null,
      autoSaveSupported: () => true, updateAutoSaveDirectoryButton: () => {}, showToast: () => {},
      saveUnsavedGeneratedImagesToSelectedDirectory: async () => backfills++,
      sourceToBlob: async () => new Blob(['offline-image']),
      writeBlobToAutoSaveDirectory: async () => { writes++; return true; }
    });
    vm.runInContext(extract('chooseAutoSaveDirectory') + '\n' + extract('triggerDownload'), c);
    await c.chooseAutoSaveDirectory();
    assert.equal(picks, 1); assert.equal(c.nativeAutoSaveDirectory, selected);
    assert.equal(backfills, 0, 'choosing a directory must not export existing project images');
    assert.equal(writes, 0, 'choosing a directory writes no files');
    assert.equal(await c.triggerDownload('data:image/png;base64,AA==', 'manual.png', 'image/png'), true);
    assert.equal(writes, 1, 'explicit download writes the chosen output file');
    assert.match(source, /下载目录：\$\{directoryPath\}/, 'full native download path remains visible');
    assert.match(source, /已保存到：\$\{result\.path \|\| result\.filename\}/, 'manual export feedback shows actual path');
    assert.doesNotMatch(source, /function saveUnsavedGeneratedImagesToSelectedDirectory\(/);
  }
  console.log('PASS: selecting a download directory does not backfill; explicit download exports and shows the actual path');
})().catch(error => { console.error(error); process.exitCode = 1; });
