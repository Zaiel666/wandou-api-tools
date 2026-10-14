const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const baseline = require('./fixtures/feature-baseline.json');
const app = path.join(__dirname, '../app');
const canvas = fs.readFileSync(path.join(app, 'ai-node-canvas.html'), 'utf8');

test('all 11 production node creation buttons remain available', () => {
  const found = [...canvas.matchAll(/<button\b[^>]*data-add-node="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual([...new Set(found)].sort(), [...baseline.nodeTypes].sort());
});

test('registered production controls and generated action hooks are retained', () => {
  for (const id of baseline.canvasEntryIds) {
    assert.ok(canvas.includes(`id="${id}"`), `Missing control ${id}`);
  }
  for (const attribute of baseline.dynamicActionAttributes) {
    assert.ok(canvas.includes(attribute), `Missing generated action ${attribute}`);
  }
});

test('production pages and separate-tab gridform navigation are retained', () => {
  for (const page of baseline.pages) assert.ok(fs.existsSync(path.join(app, page)), `Missing page ${page}`);
  assert.ok(canvas.includes('openNamedTab("./gridform.html", "网格海报工作台")'));
  const home = fs.readFileSync(path.join(app, 'index.html'), 'utf8');
  assert.match(home, /<a\b[^>]*href="\.\/gridform\.html"[^>]*target="_blank"/);
});
