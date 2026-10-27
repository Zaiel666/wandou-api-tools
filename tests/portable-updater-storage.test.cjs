const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawn, spawnSync } = require('node:child_process');

const desktop = process.env.WANDOU_TEST_DESKTOP_ROOT || path.resolve(__dirname, '../desktop-client');
const updater = process.env.WANDOU_TEST_UPDATER_EXE || path.join(desktop, 'portable-updater.exe');
const artifacts = path.resolve(__dirname, '../artifacts/portable-storage-20261027/updater-tests');
const root = path.join(artifacts, crypto.randomUUID());
const compiler = 'C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe';
const dataName = '豌豆AI数据';
const exe = 'updater-fixture.exe';
const quote = text => "'" + text.replaceAll("'", "''") + "'";
const ps = script => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, encoding: 'utf8', timeout: 60000 });
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
let fakeApp;

test.before(() => {
  fs.mkdirSync(root, { recursive: true });
  fakeApp = path.join(root, exe);
  const source = path.join(root, 'fixture.cs');
  write(source, 'using System.Threading; internal class Fixture { static int Main() { Thread.Sleep(2500); return 0; } }');
  execFileSync(compiler, ['/nologo', '/target:winexe', '/optimize+', '/out:' + fakeApp, source], { windowsHide: true });
  assert.ok(fs.existsSync(updater), 'Test the actual compiled updater shipped in the package');
  write(path.join(root, 'binary.json'), JSON.stringify({ updater, sha256: hash(updater) }, null, 2));
});

function fixture(name, withData = true) {
  const base = path.join(root, name), install = path.join(base, '豌豆AI工具'), stage = path.join(base, 'package-source');
  for (const folder of [install, stage]) {
    write(path.join(folder, 'resources/app/VERSION.txt'), folder === install ? 'v2.0.15\n' : 'v2.0.16\n');
    fs.copyFileSync(fakeApp, path.join(folder, exe));
  }
  write(path.join(install, 'old-program.txt'), 'old program bytes');
  write(path.join(install, 'subfolder/old-library.bin'), 'old library bytes');
  write(path.join(stage, 'new-program.txt'), 'new program bytes');
  if (withData) {
    write(path.join(install, dataName, '.wandou-project-storage.json'), JSON.stringify({ format: 'wandou-project-storage', id: name }));
    write(path.join(install, dataName, 'canvas-media/original.data'), 'data:image/png;base64,aW1hZ2U=');
    write(path.join(install, dataName, 'canvas-backups/folder/project/backup.json'), '{"nodes":[{"id":"keep"}]}');
    write(path.join(install, dataName, 'local-data/中文目录/private.bin'), Buffer.from([0, 255, 3, 40, 50]));
  }
  return { base, install, stage, package: path.join(base, 'release.zip'), ready: path.join(base, 'ready.txt'), log: path.join(base, 'wandou-ai-update.log') };
}

function hashes(folder) {
  return Object.fromEntries(fs.readdirSync(folder, { recursive: true, withFileTypes: true }).filter(item => item.isFile()).map(item => {
    const file = path.join(item.parentPath, item.name); return [path.relative(folder, file), hash(file)];
  }).sort(([a], [b]) => a.localeCompare(b)));
}

function zip(f) {
  ps(`Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory(${quote(f.stage)},${quote(f.package)})`);
}

function run(f) {
  const result = spawnSync(updater, ['--install', f.install, '--package', f.package, '--exe', exe, '--ready', f.ready, '--target', '2.0.16', '--parent', '0'], { windowsHide: true, timeout: 45000, encoding: 'utf8', cwd: f.base });
  if (result.error) throw result.error;
  return result.status;
}

test('compiled updater preserves every embedded-data byte and retained-data backups while replacing only program files', () => {
  const f = fixture('success'), before = hashes(path.join(f.install, dataName));
  const retained = f.install + '.previous-has-data', migrating = f.install + '.previous-migrating', obsolete = f.install + '.previous-obsolete';
  write(path.join(retained, dataName, 'canvas-media/old.data'), 'old recoverable original');
  write(path.join(migrating, '.wandou-project-migration-fixture/partial.data'), 'partial recovery');
  const exportBackup = f.install + '.previous-export-only', hubBackup = f.install + '.previous-hub-only', manifestBackup = f.install + '.previous-manifest-only';
  write(path.join(exportBackup, 'export-artifacts/original.png'), 'export recovery');
  write(path.join(hubBackup, 'project-hub-state.json'), '{"projects":["keep"]}');
  write(path.join(manifestBackup, '.wandou-migration-manifest.json'), '{"files":["keep"]}');
  write(path.join(obsolete, 'old-program.txt'), 'safe to remove');
  zip(f); assert.equal(run(f), 0);
  assert.deepEqual(hashes(path.join(f.install, dataName)), before);
  assert.equal(fs.readFileSync(path.join(f.install, 'resources/app/VERSION.txt'), 'utf8').trim(), 'v2.0.16');
  assert.equal(fs.readFileSync(path.join(f.install, 'new-program.txt'), 'utf8'), 'new program bytes');
  assert.equal(fs.existsSync(path.join(f.install, 'old-program.txt')), false);
  assert.equal(fs.readFileSync(path.join(retained, dataName, 'canvas-media/old.data'), 'utf8'), 'old recoverable original');
  assert.equal(fs.readFileSync(path.join(migrating, '.wandou-project-migration-fixture/partial.data'), 'utf8'), 'partial recovery');
  assert.equal(fs.existsSync(obsolete), false);
  assert.equal(fs.readFileSync(path.join(exportBackup, 'export-artifacts/original.png'), 'utf8'), 'export recovery');
  assert.equal(fs.readFileSync(path.join(hubBackup, 'project-hub-state.json'), 'utf8'), '{"projects":["keep"]}');
  assert.equal(fs.readFileSync(path.join(manifestBackup, '.wandou-migration-manifest.json'), 'utf8'), '{"files":["keep"]}');
  assert.match(fs.readFileSync(f.log, 'utf8'), /Preserving embedded project data; replacing program files only/);
  assert.equal(fs.readdirSync(f.base).some(name => name.startsWith('wandou-ai-stage-')), false);
});

test('compiled updater rolls back a partially moved program when a file is locked, without changing project data', async () => {
  const f = fixture('locked-failure');
  write(path.join(f.install, '.wandou-project-migration-fixture/partial.data'), 'pending recovery data');
  const lockedFile = path.join(f.install, 'subfolder/old-library.bin');
  const before = hashes(f.install), lockReady = path.join(f.base, 'lock-ready'), release = path.join(f.base, 'release-lock');
  const script = `$stream=[IO.File]::Open(${quote(lockedFile)},[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read); try { [IO.File]::WriteAllText(${quote(lockReady)},'ready'); $until=[DateTime]::UtcNow.AddSeconds(40); while(-not [IO.File]::Exists(${quote(release)}) -and [DateTime]::UtcNow -lt $until){Start-Sleep -Milliseconds 100} } finally {$stream.Dispose()}`;
  const locker = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: 'ignore' });
  const closed = new Promise((resolve, reject) => { locker.once('exit', resolve); locker.once('error', reject); });
  try {
    for (let count = 0; count < 100 && !fs.existsSync(lockReady); count++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(fs.existsSync(lockReady), 'Fixture file lock must be held before running updater');
    zip(f); assert.equal(run(f), 1);
    const after = hashes(f.install); delete after['wandou-ai-update.log'];
    assert.deepEqual(after, before, 'Rollback must restore the full old program and leave original data unchanged');
    assert.match(fs.readFileSync(f.log, 'utf8'), /File replacements rolled back after failure/);
  } finally { write(release, 'release'); await closed; }
});

test('compiled transaction verifies the installed version before committing and rolls back failed verification', () => {
  const f = fixture('verification-failure'), before = hashes(f.install), previous = f.install + '.previous-fixture';
  const script = `$assembly=[Reflection.Assembly]::LoadFile(${quote(updater)}); $method=$assembly.GetType('PortableUpdater').GetMethod('ReplaceFilesWithRollback',[Reflection.BindingFlags]'NonPublic,Static'); try {$method.Invoke($null,[object[]]@(${quote(f.stage)},${quote(f.install)},${quote(previous)},${quote(f.log)},${quote(exe)},'wrong-version')); throw 'Expected verification failure'} catch {if($_.Exception.ToString() -notmatch 'version verification failed'){throw}}; exit 0`;
  ps(script);
  assert.deepEqual(hashes(f.install), before);
  assert.match(fs.readFileSync(f.log, 'utf8'), /File replacements rolled back after failure/);
});

test('compiled updater rejects packages that include project data before accepting or modifying the install', () => {
  const f = fixture('reserved-archive'), before = hashes(f.install);
  write(path.join(f.stage, dataName, 'canvas-media/original.data'), 'must never replace user data');
  zip(f); assert.equal(run(f), 1);
  assert.deepEqual(hashes(f.install), before);
  assert.equal(fs.existsSync(f.ready), false);
  assert.match(fs.readFileSync(f.log, 'utf8'), /must not contain project data/);
});

for (const withData of [false, true]) test('compiled updater preserves a retained migration in place without blocking an update; completed data child: ' + withData, () => {
  const f = fixture('retained-migration-' + withData, withData);
  const migration = path.join(f.install, '.wandou-project-migration-fixture');
  write(path.join(migration, '.wandou-project-storage.json'), '{"id":"keep"}');
  write(path.join(migration, 'canvas-media/partial.data'), 'pending data');
  write(path.join(migration, '.wandou-migration-manifest.json'), '{"files":["keep"]}');
  const before = hashes(migration), originalData = withData ? hashes(path.join(f.install, dataName)) : null;
  zip(f); assert.equal(run(f), 0);
  assert.deepEqual(hashes(migration), before, 'No recovery copy may be moved, modified, or deleted');
  if (withData) assert.deepEqual(hashes(path.join(f.install, dataName)), originalData);
  assert.equal(fs.readFileSync(path.join(f.install, 'resources/app/VERSION.txt'), 'utf8').trim(), 'v2.0.16');
  assert.equal(fs.existsSync(path.join(f.install, 'old-program.txt')), false);
  assert.match(fs.readFileSync(f.log, 'utf8'), /Preserving embedded project data; replacing program files only/);
});

test('PowerShell updater preserves existing data and retained migration stages in place', () => {
  const f = fixture('powershell-retained-stage'), migration = path.join(f.install, '.wandou-project-migration-fixture');
  write(path.join(migration, 'canvas-media/partial.data'), 'recovery bytes');
  const before = hashes(path.join(f.install, dataName)), stageBefore = hashes(migration);
  zip(f);
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(desktop, 'portable-updater.ps1'),
    '-InstallDirectory', f.install, '-PackagePath', f.package, '-ExecutableName', exe, '-TargetVersion', '2.0.16', '-SkipRestart'], { windowsHide: true, timeout: 20000 });
  assert.deepEqual(hashes(path.join(f.install, dataName)), before);
  assert.deepEqual(hashes(migration), stageBefore);
  assert.equal(fs.readFileSync(path.join(f.install, 'resources/app/VERSION.txt'), 'utf8').trim(), 'v2.0.16');
});

test('PowerShell 5 updater rejects a Chinese-named embedded data directory supplied by an archive', () => {
  const f = fixture('powershell-reserved-archive'), before = hashes(path.join(f.install, dataName));
  write(path.join(f.stage, dataName, 'canvas-media/original.data'), 'must not replace original');
  zip(f);
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(desktop, 'portable-updater.ps1'),
    '-InstallDirectory', f.install, '-PackagePath', f.package, '-ExecutableName', exe, '-TargetVersion', '2.0.16', '-SkipRestart'], { windowsHide: true, timeout: 20000 });
  if (result.error) throw result.error;
  assert.equal(result.status, 1);
  assert.deepEqual(hashes(path.join(f.install, dataName)), before);
  assert.equal(fs.readFileSync(path.join(f.install, 'resources/app/VERSION.txt'), 'utf8').trim(), 'v2.0.15');
  assert.match(fs.readFileSync(path.join(f.install, 'wandou-ai-update.log'), 'utf8'), /must not contain project data/);
});
