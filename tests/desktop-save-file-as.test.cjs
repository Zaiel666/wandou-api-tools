const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL, fileURLToPath } = require('node:url');
const desktop = process.env.WANDOU_TEST_DESKTOP_ROOT || path.resolve(__dirname, '../desktop-client');
const createSaveFileAs = require(path.join(desktop, 'save-file-as.cjs'));
const fixtures = path.resolve(__dirname, '../artifacts/image-save-as-20261027/native-fixtures');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZqkAAAAASUVORK5CYII=', 'base64');
function fixture() {
  fs.mkdirSync(fixtures, { recursive: true });
  const root = fs.mkdtempSync(path.join(fixtures, 'save-'));
  const first = path.join(root, 'one'), second = path.join(root, 'two');
  fs.mkdirSync(first); fs.mkdirSync(second);
  return { root, first, second };
}

test('each download chooses its own destination; originals and legacy destination are untouched', async () => {
  const f = fixture(), choices = [], original = path.join(f.root, 'original.data');
  const originalBytes = 'data:image/png;base64,' + png.toString('base64');
  fs.writeFileSync(original, originalBytes);
  const destinations = [path.join(f.first, 'first.png'), path.join(f.second, 'second.png')];
  const save = createSaveFileAs({ defaultDirectory: () => f.root, showSaveDialog: async options => { choices.push(options); return { filePath: destinations[choices.length - 1] }; } });
  for (const destination of destinations) {
    const result = await save({ filename: 'generated.png', bytes: png, mimeType: 'image/png' });
    assert.equal(result.success, true); assert.equal(result.path, destination);
    assert.deepEqual(fs.readFileSync(destination), png);
  }
  assert.equal(choices.length, 2);
  assert.equal(choices[0].defaultPath, path.join(f.root, 'generated.png'));
  assert.equal(choices[1].defaultPath, path.join(f.first, 'generated.png'));
  assert.ok(choices[0].properties.includes('showOverwriteConfirmation'));
  assert.deepEqual(choices[0].filters, [{ name: 'PNG 图片', extensions: ['png'] }]);
  assert.equal(fs.readFileSync(original, 'utf8'), originalBytes);
  assert.deepEqual(fs.readdirSync(f.root).sort(), ['one', 'original.data', 'two']);
});

test('cancel does not write or change the suggested directory; a later attempt still shows the dialog', async () => {
  const f = fixture(), calls = [];
  const save = createSaveFileAs({ defaultDirectory: () => f.root, showSaveDialog: async options => { calls.push(options); return { canceled: true, filePath: path.join(f.first, 'ignored.png') }; } });
  for (let count = 0; count < 2; count++) assert.deepEqual(await save({ filename: 'cancel.png', bytes: [...png], mimeType: 'image/png' }), { success: false, canceled: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].defaultPath, path.join(f.root, 'cancel.png'));
  assert.deepEqual(fs.readdirSync(f.first), []);
});

test('explicit overwrite atomically preserves exact bytes and MIME corrects the suggested extension', async () => {
  const f = fixture(), destination = path.join(f.first, 'original.png');
  fs.writeFileSync(destination, 'previous image');
  const save = createSaveFileAs({ defaultDirectory: () => f.root, showSaveDialog: async options => {
    assert.equal(path.basename(options.defaultPath), 'raw.png');
    return { filePath: destination };
  } });
  assert.equal((await save({ filename: '../raw.data', bytes: Uint8Array.from(png).buffer, mimeType: 'image/png' })).success, true);
  assert.deepEqual(fs.readFileSync(destination), png);
  assert.deepEqual(fs.readdirSync(f.first), ['original.png']);
});

test('write and rename failures leave an existing destination intact and remove only the temporary export', async () => {
  for (const failure of ['write', 'rename']) {
    const f = fixture(), destination = path.join(f.first, 'original.png');
    fs.writeFileSync(destination, 'old original');
    const fileSystem = {
      ...fsp,
      open: async (...args) => {
        const handle = await fsp.open(...args);
        return failure === 'write' ? { writeFile: async () => { await handle.writeFile('partial'); throw Error('isolated disk-full error'); }, close: () => handle.close(), sync: () => handle.sync() } : handle;
      },
      rename: failure === 'rename' ? async () => { throw Error('isolated rename error'); } : fsp.rename
    };
    const save = createSaveFileAs({ fileSystem, defaultDirectory: () => f.root, showSaveDialog: async () => ({ filePath: destination }) });
    const result = await save({ filename: 'original.png', bytes: png, mimeType: 'image/png' });
    assert.equal(result.success, false); assert.match(result.error, /isolated/);
    assert.equal(fs.readFileSync(destination, 'utf8'), 'old original');
    assert.deepEqual(fs.readdirSync(f.first), ['original.png']);
  }
});

test('GIF, WebP, SVG, JPEG, video and audio exports retain bytes and file filters', async () => {
  const f = fixture();
  for (const [mime, ext, bytes] of [
    ['image/gif', 'gif', Buffer.from('GIF89a-animation-payload')],
    ['image/webp', 'webp', Buffer.from('RIFF-webp-payload')],
    ['image/svg+xml', 'svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['image/jpeg', 'jpeg', Buffer.from([255, 216, 255, 217])],
    ['video/mp4', 'mp4', Buffer.from('video-payload')],
    ['audio/mpeg', 'mp3', Buffer.from('audio-payload')]
  ]) {
    const destination = path.join(f.first, `image.${ext}`);
    const save = createSaveFileAs({ defaultDirectory: () => f.root, showSaveDialog: async options => { assert.ok(options.filters[0].extensions.includes(ext)); return { filePath: destination }; } });
    assert.equal((await save({ filename: `image.${ext}`, bytes, mimeType: mime })).success, true);
    assert.deepEqual(fs.readFileSync(destination), bytes);
  }
});

test('bad payloads never open a dialog; mismatched extensions do not overwrite another file', async () => {
  const f = fixture(); let calls = 0;
  const destination = path.join(f.first, 'existing.jpg'); fs.writeFileSync(destination, 'keep');
  const save = createSaveFileAs({ defaultDirectory: () => f.root, showSaveDialog: async () => { calls++; return { filePath: destination }; } });
  for (const bytes of [null, [], {}, 'not bytes', [1, -1], [256], [1.5], new Uint16Array([2])]) {
    assert.equal((await save({ filename: 'image.png', bytes, mimeType: 'image/png' })).success, false);
  }
  assert.equal(calls, 0);
  const result = await save({ filename: 'image.png', bytes: png, mimeType: 'image/png' });
  assert.equal(result.success, false); assert.match(result.error, /\.png/);
  assert.equal(fs.readFileSync(destination, 'utf8'), 'keep');
  assert.deepEqual(fs.readdirSync(f.first), ['existing.jpg']);
});

test('a pending dialog prevents a second prompt and releases the lock on cancellation', async () => {
  const f = fixture(); let cancel; let calls = 0;
  const save = createSaveFileAs({ defaultDirectory: () => f.root, showSaveDialog: () => { calls++; return new Promise(resolve => { cancel = () => resolve({ canceled: true }); }); } });
  const first = save({ filename: 'one.png', bytes: png, mimeType: 'image/png' });
  const second = await save({ filename: 'two.png', bytes: png, mimeType: 'image/png' });
  assert.equal(second.success, false); assert.equal(calls, 1);
  cancel(); assert.equal((await first).canceled, true);
  const third = save({ filename: 'three.png', bytes: png, mimeType: 'image/png' });
  assert.equal(calls, 2); cancel(); assert.equal((await third).canceled, true);
});

test('IPC only accepts local main frames and preload forwards a single explicit export request', async () => {
  const source = fs.readFileSync(path.join(desktop, 'main.js'), 'utf8'), handlers = new Map(), calls = [];
  const appRoot = path.resolve(desktop, '../app');
  const env = { URL, path, fileURLToPath, getAppRoot: () => appRoot, dialog: {}, mainWindow: {}, app: {}, ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, require: () => () => payload => { calls.push(payload); return { success: true }; } };
  const localStart = source.indexOf('function isLocalAppPage('), localEnd = source.indexOf('\nfunction ', localStart + 1);
  const start = source.indexOf("const saveFileAs = require("), end = source.indexOf('ipcMain.handle("desktop:copy-image"', start);
  assert.ok(start > 0 && end > start);
  vm.runInNewContext(source.slice(localStart, localEnd) + '\n' + source.slice(start, end), env);
  const handler = handlers.get('desktop:save-file-as'); assert.equal(typeof handler, 'function');
  for (const url of ['https://example.invalid/assets.html', pathToFileURL(path.join(fixtures, 'outside.html')).href]) {
    const frame = { url }; assert.equal((await handler({ senderFrame: frame, sender: { mainFrame: frame } }, { bytes: png })).success, false);
  }
  const frame = { url: pathToFileURL(path.join(appRoot, 'asset-library.html')).href };
  assert.equal((await handler({ senderFrame: frame, sender: { mainFrame: { ...frame } } }, { bytes: png })).success, false);
  assert.equal((await handler({ senderFrame: frame, sender: { mainFrame: frame } }, { bytes: png })).success, true);
  assert.equal(calls.length, 1);
  const exposed = {}, invocations = [];
  vm.runInNewContext(fs.readFileSync(path.join(desktop, 'preload.js'), 'utf8'), { require: () => ({ contextBridge: { exposeInMainWorld: (key, value) => { exposed[key] = value; } }, ipcRenderer: { invoke: (...args) => invocations.push(args) }, webUtils: {} }) });
  exposed.wandouShell.saveFileAs('image.png', [1, 2, 3], 'image/png');
  assert.deepEqual(JSON.parse(JSON.stringify(invocations)), [['desktop:save-file-as', { filename: 'image.png', bytes: [1, 2, 3], mimeType: 'image/png' }]]);
  assert.equal(typeof exposed.wandouShell.writeSaveFile, 'function');
});
