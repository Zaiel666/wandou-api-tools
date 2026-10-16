const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const file = path.join(root, 'app', 'ui-v2-lab.html');
const source = fs.readFileSync(file, 'utf8');

test('UI v2 lab is isolated from the production canvas', () => {
  assert.match(source, /豌豆 UI v2 · 音频节点母版/);
  assert.match(source, /独立视觉实验页，不影响正式画布/);
  assert.doesNotMatch(source, /<script[^>]+src=/i);
  assert.doesNotMatch(source, /<link[^>]+stylesheet/i);
});

test('UI v2 lab contains three-layer tokens and theme semantics', () => {
  assert.match(source, /Primitive tokens/);
  assert.match(source, /Semantic tokens/);
  assert.match(source, /Component tokens/);
  assert.match(source, /--color-selection:/);
  assert.match(source, /--color-brand:/);
  assert.match(source, /body\[data-theme="dark"\]/);
  assert.match(source, /prefers-reduced-motion/);
});

test('UI v2 lab provides the required node interaction structure', () => {
  assert.match(source, /id="audioNode"/);
  assert.match(source, /id="contextToolbar"/);
  assert.match(source, /id="inspector"/);
  assert.match(source, /id="settingsPopover"/);
  assert.match(source, /id="modelMenu"/);
  assert.match(source, /workspace\.addEventListener\('click'/);
  assert.match(source, /setSelected\(false\)/);
});

test('UI v2 lab exposes complete preview states and accessible controls', () => {
  for (const state of ['idle', 'running', 'success', 'error']) {
    assert.match(source, new RegExp(`data-preview-state="${state}"`));
  }
  assert.match(source, /aria-haspopup="listbox"/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /role="status" aria-live="polite"/);
  assert.match(source, /:focus-visible/);
});

test('inline prototype script parses', () => {
  const script = source.match(/<script>([\s\S]*?)<\/script>/i);
  assert.ok(script, 'expected one inline prototype script');
  assert.doesNotThrow(() => new Function(script[1]));
});
