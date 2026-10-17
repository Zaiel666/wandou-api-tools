const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'desktop-client', 'main.js'), 'utf8');
const start = source.indexOf('async function cleanupStalePortableUpdateStages()');
const end = source.indexOf('\nfunction readClientConfig()', start);
assert.ok(start >= 0 && end > start, 'desktop stage cleanup function is present');

const tempParent = fs.realpathSync(os.tmpdir());
const root = fs.mkdtempSync(path.join(tempParent, 'wandou-stage-cleanup-test-'));
assert.equal(path.dirname(path.resolve(root)), tempParent, 'test cleanup stays inside its dedicated temp folder');
const install = path.join(root, '豌豆AI工具');
const stale = path.join(root, 'wandou-ai-stage-' + 'a'.repeat(32));
const active = path.join(root, 'wandou-ai-stage-' + 'b'.repeat(32));
const legacy = path.join(root, 'wandou-ai-stage-' + 'c'.repeat(32));
const recent = path.join(root, 'wandou-ai-stage-' + 'd'.repeat(32));
const unrelated = path.join(root, 'wandou-ai-stage-not-an-updater-guid');

(async () => {
  try {
    for (const directory of [install, stale, active, legacy, recent, unrelated]) fs.mkdirSync(directory);
    for (const directory of [stale, active, legacy, recent, unrelated]) fs.writeFileSync(path.join(directory, 'marker.txt'), directory);
    const old = new Date(Date.now() - 60 * 60 * 1000);
    const veryOld = new Date(Date.now() - 48 * 60 * 60 * 1000);
    fs.writeFileSync(path.join(stale, '.wandou-stage-cleanup-ready'), 'ready');
    fs.writeFileSync(path.join(recent, '.wandou-stage-cleanup-ready'), 'ready');
    fs.utimesSync(path.join(stale, '.wandou-stage-cleanup-ready'), old, old);
    fs.utimesSync(stale, old, old);
    fs.utimesSync(active, old, old);
    fs.utimesSync(legacy, veryOld, veryOld);
    fs.utimesSync(unrelated, old, old);

    const context = vm.createContext({
      app: { isPackaged: true },
      fs, path, Date,
      portableInstallContext: () => ({ installDirectory: install }),
      console,
    });
    vm.runInContext(source.slice(start, end), context);
    await vm.runInContext('cleanupStalePortableUpdateStages()', context);

    assert.equal(fs.existsSync(stale), false, 'stale updater stage is removed');
    assert.equal(fs.existsSync(legacy), false, 'old unmarked stage from prior versions is removed');
    assert.equal(fs.existsSync(active), true, 'unmarked stage may still be active and is preserved');
    assert.equal(fs.existsSync(recent), true, 'newly completed stage is left for the updater to clean first');
    assert.equal(fs.existsSync(unrelated), true, 'lookalike folder is preserved');
    assert.equal(fs.existsSync(install), true, 'installed application is preserved');
  } finally {
    if (path.dirname(path.resolve(root)) === tempParent) fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
