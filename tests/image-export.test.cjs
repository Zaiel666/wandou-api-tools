const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(process.env.WANDOU_TEST_APP_ROOT || path.resolve(__dirname, '../app'), 'image-export.js'), 'utf8');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
function setup(shell, extra = {}) {
  const window = { wandouShell: shell, ...extra };
  vm.runInNewContext(source, { window, fetch, Blob, Uint8Array, AbortController, setTimeout, clearTimeout,
    URL: { createObjectURL() { throw Error('Unexpected automatic browser download'); } } });
  return window;
}
test('each explicit export asks native Save As with original PNG bytes and corrected extension', async () => {
  const calls = [];
  const w = setup({ saveFileAs: async (...args) => { calls.push(args); return { success: true, filename: args[0] }; } });
  for (let i = 0; i < 2; i++) assert.equal((await w.WandouImageExport.save({ source: 'data:application/octet-stream;base64,' + png.toString('base64'), filename: '原图.data' })).success, true);
  assert.equal(calls.length, 2);
  for (const [filename, bytes, mime] of calls) { assert.equal(filename, '原图.png'); assert.equal(mime, 'image/png'); assert.deepEqual(Buffer.from(bytes), png); }
});
test('native cancel and write error do not silently download through another route', async () => {
  for (const response of [{ success: false, canceled: true }, { success: false, error: '磁盘不可写' }]) {
    let writes = 0;
    const w = setup({ saveFileAs: async () => { writes++; return response; }, writeSaveFile: () => { throw Error('Old directory used'); } });
    const result = await w.WandouImageExport.save({ blob: new Blob([png], { type: 'image/png' }), filename: 'image' });
    assert.deepEqual(result, response); assert.equal(writes, 1);
  }
});
test('indexed-media exports the stored original, and missing original fails without a Save dialog', async () => {
  const reads = [], writes = [];
  const w = setup({ readCanvasMedia: async ({ id }) => { reads.push(id); return id === 'original' ? { success: true, value: 'data:image/png;base64,' + png.toString('base64') } : { success: false }; },
    saveFileAs: async (...args) => { writes.push(args); return { success: true }; } });
  assert.equal((await w.WandouImageExport.save({ source: 'indexed-media:original', filename: 'picture.png' })).success, true);
  const missing = await w.WandouImageExport.save({ source: 'indexed-media:missing', filename: 'picture.png' });
  assert.equal(missing.success, false); assert.match(missing.error, /未找到/);
  assert.deepEqual(reads, ['original', 'missing']); assert.equal(writes.length, 1); assert.deepEqual(Buffer.from(writes[0][1]), png);
});
test('old desktop bridge reports update needed instead of reusing a saved folder', async () => {
  const w = setup({ writeSaveFile: () => { throw Error('Old directory used'); } });
  const result = await w.WandouImageExport.save({ blob: new Blob([png], { type: 'image/png' }), filename: 'image.png' });
  assert.equal(result.success, false); assert.match(result.error, /更新桌面版/);
});
test('error pages cannot be exported as image files', async () => {
  const w = setup({ saveFileAs: () => { throw Error('Unexpected write'); } });
  const result = await w.WandouImageExport.save({ blob: new Blob(['<html>Expired</html>'], { type: 'text/html' }), filename: 'image.png' });
  assert.equal(result.success, false); assert.match(result.error, /没有返回图片/);
});
test('JPEG and WebP originals retain bytes and their real extensions', async () => {
  const jpeg = new Uint8Array([255, 216, 255, 224, 0, 4, 1, 2]);
  const webp = Buffer.from('RIFF1234WEBPVP8 original');
  for (const [bytes, ext, mime] of [[jpeg, 'jpg', 'image/jpeg'], [webp, 'webp', 'image/webp']]) {
    const w = setup({ saveFileAs: async (name, output, type) => { assert.equal(name, '原图.' + ext); assert.deepEqual(Buffer.from(output), Buffer.from(bytes)); assert.equal(type, mime); return { success: true }; } });
    assert.equal((await w.WandouImageExport.save({ blob: new Blob([bytes], { type: 'application/octet-stream' }), filename: '原图.data' })).success, true);
  }
});
