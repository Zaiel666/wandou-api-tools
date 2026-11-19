'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

test('the actual portable guide writer explains selected data storage and retained Windows configuration', () => {
  const build = fs.readFileSync(path.resolve(__dirname, '../scripts/build-portable-package.ps1'), 'utf8');
  const writers = [...build.matchAll(/@"\r?\n豌豆AI工具 v\$Version[\s\S]*?"@ \| Set-Content -LiteralPath \$guide -Encoding UTF8/g)];
  assert.equal(writers.length, 1, 'Use the unique real guide writer without executing packaging');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wandou-guide-v230-'));
  const guide = path.join(directory, '使用说明.txt');
  const literal = value => "'" + value.replaceAll("'", "''") + "'";
  const script = "$ErrorActionPreference='Stop'\n$Version='2.0.30'\n$guide=" + literal(guide) + '\n' + writers[0][0];
  const result = spawnSync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const text = fs.readFileSync(guide, 'utf8');
  assert.ok(text.startsWith('豌豆AI工具 v2.0.30'));
  assert.ok(text.includes('API 设置的磁盘副本（local-data）和工作台浏览器存储（browser-session）跟随所选数据目录保存'));
  assert.ok(text.includes('少量程序主配置、GPU 缓存及旧版兼容副本仍可能保留在 Windows 用户配置目录（通常为 %APPDATA%\\豌豆AI）'));
  assert.ok(text.includes('已有自定义目录继续使用原位置；旧目录迁移成功后仍保留备份。'));
  assert.ok(text.includes('存储设置中可查看实际路径与分类占用。'));
  assert.ok(!text.includes('API 配置和工作台浏览器存储仍保留在 Windows 用户配置目录'));
});
