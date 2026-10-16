const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'app', 'ai-node-canvas.html'), 'utf8');
const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join('\n');

test('large canvas and shell surfaces use neutral grayscale', () => {
  assert.match(styles, /body\.dark-theme\s*\{\s*background:#111;/);
  assert.match(styles, /\.canvas-wrap\s*\{[\s\S]*?rgba\(65, 65, 65, 0\.19\)[\s\S]*?#f2f2f2;/);
  assert.match(styles, /body\.dark-theme \.canvas-wrap\s*\{[\s\S]*?rgba\(190, 190, 190, 0\.12\)[\s\S]*?#111;/);
  assert.match(styles, /body\.node-canvas-page \.sidebar,[\s\S]*?\.assistant-panel,[\s\S]*?\.settings-popover,[\s\S]*?background:var\(--wd-surface-1\) !important;/);
  assert.match(styles, /body\.node-canvas-page \.assistant-message\.user,[\s\S]*?background:var\(--wd-control\) !important;/);
});

test('large action states no longer use green fills', () => {
  assert.match(styles, /button,\s*\.button-like\s*\{[\s\S]*?background:#303030;/);
  assert.match(styles, /button\.wide-button\[data-generate\]\.generating[\s\S]*?background:#383838 !important;/);
  assert.match(styles, /\.sidebar-collapse-tab:hover\s*\{[\s\S]*?background:#303030;/);
  assert.match(styles, /\.node\.outpaint button\.outpaint-edit-button\s*\{[\s\S]*?background-color:#303030 !important;/);
});

test('audio, export and editing surfaces use theme-neutral colors', () => {
  assert.match(styles, /body\.node-canvas-page\s*\{[^}]*--audio-panel-soft:var\(--wd-surface-2\);/);
  assert.match(styles, /body\.node-canvas-page\.dark-theme\s*\{[^}]*--audio-stage:#2a2a2a;/);
  assert.match(styles, /body\.node-canvas-page \.psd-source-upload,[\s\S]*?\.outpaint-editor-prompt\s*\{[^}]*background:var\(--wd-control\) !important;/);
  assert.match(styles, /body\.node-canvas-page \.prompt-refine-output,[\s\S]*?\.prompt-refine-actions \[data-prompt-refine-run\]\s*\{[^}]*background:var\(--wd-surface-2\) !important;/);
});

test('canvas and audio aliases have one theme-aware source of truth', () => {
  assert.match(styles, /--wd-surface-1:var\(--wd-neutral-surface\);/);
  assert.match(styles, /--fg-surface-solid:var\(--wd-surface-1\);/);
  assert.match(styles, /--fg-mint-soft:var\(--wd-surface-2\);/);
  assert.equal((styles.match(/--audio-panel-soft:/g) || []).length, 1);
  assert.equal((styles.match(/--fg-surface-solid:/g) || []).length, 1);
  assert.doesNotMatch(styles, /--audio-(?:panel|panel-soft|stage|border|text|muted|control):#(?:f7f6f4|1b1f1d|151917|a4b0aa)/i);
});
