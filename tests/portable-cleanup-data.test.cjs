const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const desktop = process.env.WANDOU_TEST_DESKTOP_ROOT || path.resolve(__dirname, '../desktop-client');
const source = fs.readFileSync(path.join(desktop, 'main.js'), 'utf8');
const start = source.indexOf('async function hasProtectedPortableData(');
const end = source.indexOf('\nfunction readClientConfig(', start);
assert.ok(start >= 0 && end > start);
function fixture() {
  const root = path.resolve(__dirname, '../artifacts/portable-storage-20261027/cleanup-tests');
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'case-'));
  const c = vm.createContext({ fs, path, app: { isPackaged: true }, portableInstallContext: () => ({ installDirectory: path.join(directory, 'software') }), Date, console });
  vm.runInContext(source.slice(start, end), c);
  return { directory, c };
}
test('old program backup cleanup retains every managed data layout and migration stage', async () => {
  const { directory, c } = fixture();
  const protectedNames = ['豌豆AI数据', '.wandou-project-storage.json', 'canvas-media', 'canvas-backups', 'local-data', 'export-artifacts', 'project-hub-state.json', '.wandou-project-migration-test'];
  for (const [i, name] of protectedNames.entries()) {
    const candidate = path.join(directory, `software.previous-${i}`);
    fs.mkdirSync(candidate); fs.mkdirSync(path.join(candidate, name)); fs.writeFileSync(path.join(candidate, name, 'original.txt'), 'keep');
  }
  const safe = path.join(directory, 'software.previous-program-only'); fs.mkdirSync(safe); fs.writeFileSync(path.join(safe, 'program.txt'), 'old program');
  await c.cleanupStalePortableInstallBackups();
  assert.equal(fs.existsSync(safe), false);
  protectedNames.forEach((name, i) => assert.equal(fs.readFileSync(path.join(directory, `software.previous-${i}`, name, 'original.txt'), 'utf8'), 'keep'));
});
test('completed updater stages containing project media are not removed', async () => {
  const { directory, c } = fixture();
  const protectedStage = path.join(directory, 'wandou-ai-stage-' + 'a'.repeat(32));
  const cleanStage = path.join(directory, 'wandou-ai-stage-' + 'b'.repeat(32));
  for (const stage of [protectedStage, cleanStage]) { fs.mkdirSync(stage); fs.writeFileSync(path.join(stage, '.wandou-stage-cleanup-ready'), 'ready'); fs.utimesSync(path.join(stage, '.wandou-stage-cleanup-ready'), new Date(0), new Date(0)); }
  fs.mkdirSync(path.join(protectedStage, '豌豆AI数据')); fs.writeFileSync(path.join(protectedStage, '豌豆AI数据', 'original.data'), 'keep');
  await c.cleanupStalePortableUpdateStages();
  assert.equal(fs.existsSync(cleanStage), false); assert.equal(fs.readFileSync(path.join(protectedStage, '豌豆AI数据', 'original.data'), 'utf8'), 'keep');
});
test('unexpected directory and missing path cannot be treated as disposable', async () => {
  const { directory, c } = fixture();
  assert.equal(await c.hasProtectedPortableData(path.join(directory, 'absent')), true);
  const file = path.join(directory, 'file'); fs.writeFileSync(file, 'keep');
  assert.equal(await c.hasProtectedPortableData(file), true);
});
