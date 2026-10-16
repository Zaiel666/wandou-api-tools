const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appDir = path.resolve(__dirname, '..', 'app');
const html = fs.readFileSync(path.join(appDir, 'homepage-test.html'), 'utf8');
const css = fs.readFileSync(path.join(appDir, 'homepage-test.css'), 'utf8');

function cardAnchors(section) {
  return [...section.matchAll(/<a class="tool-card module-card [^"]+" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
    .map((match) => ({ href: match[1], label: match[2].match(/class="tool-label"[^>]*>([\s\S]*?)<\/span>/)?.[1].replace(/<br\s*\/?\s*>/g, '').trim() }));
}

test('homepage test version has the requested primary-card order', () => {
  const primary = html.split('id="home-tools"')[1].split('id="image-tools"')[0];
  const cards = cardAnchors(primary);
  assert.deepEqual(cards.map((card) => card.label), [
    '节点无线画布',
    '网格海报工作台',
    '录音转文字'
  ]);
  assert.deepEqual(cards.map((card) => card.href), [
    './project-hub.html',
    './gridform.html',
    'https://wandou-video-workbench.netlify.app/'
  ]);
});

test('AI workbench is moved below and prior tool entries remain', () => {
  const secondary = html.split('id="image-tools"')[1].split('data-home-panel="market"')[0];
  const cards = cardAnchors(secondary);
  assert.equal(cards[0].label, 'AI 工作台');
  assert.deepEqual(cards.map((card) => card.href), [
    './image-workbench/index.html',
    './type-motion.html',
    './png-workflow.html',
    './watermark-remove.html',
    './keyword-reverse.html',
    './plain-to-pro.html',
    './video-prompt-pro.html',
    'https://wandou-video-workbench.netlify.app/',
    './prompt-mind-map.html'
  ]);
  for (const card of cards) {
    if (!card.href.startsWith('./')) continue;
    assert.ok(fs.existsSync(path.resolve(appDir, card.href)), `${card.href} should exist`);
  }
});

test('settings, panels, logo, CSS and hero asset are present', () => {
  for (const token of ['data-api-open', 'data-api-modal', 'data-theme-toggle', 'data-home-nav="notice"', 'data-home-nav="about"', 'data-home-nav="blog"']) {
    assert.ok(html.includes(token), `${token} should remain`);
  }
  for (const asset of ['logo.png', 'homepage-test.css', 'assets/wandou-home-hero-test.jpg']) {
    assert.ok(fs.existsSync(path.join(appDir, asset)), `${asset} should exist`);
  }
});

test('secondary pages and Chinese sidebar hierarchy stay reachable in the test version', () => {
  for (const label of ['工作空间', '创作空间', '内容与帮助']) {
    assert.ok(new RegExp(`class="home-test-side-label">[\\s\\S]*?</svg>${label}</div>`).test(html), `${label} grouping should remain with its icon`);
  }
  assert.ok(!html.includes('>WORKSPACE<'));
  assert.ok(!html.includes('>EXPLORE<'));
  assert.equal((html.match(/href="\.\/asset-library-test\.html"/g) || []).length, 2);
  assert.ok(fs.existsSync(path.join(appDir, 'asset-library-test.html')));
  assert.ok(fs.existsSync(path.join(appDir, 'asset-library-test.css')));
  for (const panel of ['blog', 'notice', 'about']) {
    assert.ok(html.includes(`data-home-panel="${panel}"`), `${panel} panel should remain`);
  }
});

test('test homepage uses neutral page and card surfaces in both themes', () => {
  for (const token of ['--test-page: #f7f7f8', '--test-page: #101112', '--test-surface: #1c1d1f']) {
    assert.ok(css.includes(token), `${token} should remain neutral`);
  }
  assert.ok(!css.includes('background: #253a29'), 'dark feature card must not have a green fill');
  assert.ok(!css.includes('background: #edf7e5'), 'light feature card must not have a green fill');
  assert.ok(css.includes('body.home-test-page .info-card'), 'secondary panels should share the neutral card treatment');
});
