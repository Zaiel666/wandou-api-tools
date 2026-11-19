'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { chromium } = require('../desktop-client/node_modules/playwright');

const appDir = path.resolve(process.env.WANDOU_TEST_APP_ROOT || path.join(__dirname, '../app'));
const reportFile = process.env.WANDOU_HOME_UI_REPORT && path.resolve(process.env.WANDOU_HOME_UI_REPORT);
const report = { startedAt: new Date().toISOString(), appDir, checks: [], networkBlocked: [], pageErrors: [], screenshots: [], chromiumSandbox: true, productionDataAccessed: false, paidRequestsSent: 0 };
const ownedFiles = ['homepage-test.html', 'index.html', 'homepage-test.css', 'styles.css', 'workflow.js'];
const hashes = () => Object.fromEntries(ownedFiles.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(appDir, file))).digest('hex')]));
let server, browser, origin;

test.before(async () => {
  if (reportFile) assert.ok(!fs.existsSync(reportFile), 'Use a new evidence filename; never replace a failed report');
  report.sourceHashes = hashes();
  report.testSha256 = crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
  server = http.createServer((request, response) => {
    try {
      const file = path.resolve(appDir, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
      assert.ok(file.startsWith(appDir + path.sep));
      const content = fs.readFileSync(file);
      response.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' })[path.extname(file)] || 'application/octet-stream');
      response.end(content);
    } catch (_) { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ headless: true, chromiumSandbox: true, ...(fs.existsSync(edge) ? { executablePath: edge } : {}) });
});

test.after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  report.finishedAt = new Date().toISOString();
  report.sourceUnchanged = JSON.stringify(report.sourceHashes) === JSON.stringify(hashes());
  report.success = report.checks.length === 18 && report.checks.every(check => check.success) && !report.pageErrors.length && report.sourceUnchanged;
  if (reportFile) fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), { flag: 'wx' });
});

async function withPage(name, width, theme, file, action) {
  const evidence = { name, width, theme, file };
  const context = await browser.newContext({ viewport: { width, height: 800 }, reducedMotion: 'reduce' });
  await context.route('**/*', route => {
    const request = route.request();
    if (request.url().startsWith(origin + '/') || /^(data|blob):/.test(request.url())) return route.continue();
    report.networkBlocked.push({ test: name, method: request.method(), origin: new URL(request.url()).origin });
    return route.abort();
  });
  await context.addInitScript(theme => { localStorage.setItem('ai-tools-theme', theme); }, theme);
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(origin + '/' + file);
    await page.evaluate(() => document.fonts.ready);
    await action(page, evidence);
    assert.deepEqual(errors, [], 'No browser exceptions');
    evidence.success = true;
  } catch (error) {
    evidence.success = false;
    evidence.error = error.message;
    throw error;
  } finally {
    if (reportFile) {
      const filename = path.basename(reportFile, '.json') + '-' + name + '.png';
      await page.screenshot({ path: path.join(path.dirname(reportFile), filename), animations: 'disabled' });
      report.screenshots.push(filename);
    }
    report.pageErrors.push(...errors.map(message => ({ test: name, message })));
    report.checks.push(evidence);
    await context.close();
  }
}

async function visibleIcon(page) {
  return page.locator('[data-theme-toggle]').evaluate(button => [...button.querySelectorAll('svg')]
    .filter(svg => svg.getClientRects().length && getComputedStyle(svg).visibility !== 'hidden')
    .map(svg => ({ svg: svg.innerHTML, hasSun: !!svg.querySelector('circle'), width: svg.getBoundingClientRect().width, height: svg.getBoundingClientRect().height })));
}

function neutral(color, label) {
  const channels = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)?.slice(1).map(Number);
  assert.ok(channels && Math.max(...channels) - Math.min(...channels) <= 5, `${label} must be neutral: ${color}`);
}

function hexRgb(value) {
  assert.match(value.trim(), /^#[\da-f]{6}$/i, 'Expected a declared workspace palette token');
  return 'rgb(' + value.trim().slice(1).match(/../g).map(part => parseInt(part, 16)).join(', ') + ')';
}

for (const width of [1440, 1024]) for (const theme of ['light', 'dark']) {
  const suffix = width + '-' + theme;
  test('category navigation returns from every secondary panel: ' + suffix, () => withPage('category-' + suffix, width, theme, 'homepage-test.html', async (page, evidence) => {
    evidence.transitions = [];
    for (const panel of ['about', 'blog', 'notice']) for (const anchor of ['image-tools', 'copy-tools']) {
      await page.locator('.home-test-sidebar [data-home-nav="' + panel + '"]').click();
      assert.equal(await page.locator('[data-home-panel="' + panel + '"]').isVisible(), true);
      await page.locator('.home-test-sidebar a[href="#' + anchor + '"]').click();
      const state = await page.evaluate(anchor => {
        const card = document.querySelector('#' + anchor + ' .module-card');
        return { anchorVisible: !!card?.getClientRects().length, activePanels: document.querySelectorAll('[data-home-panel].active').length, homeHidden: [...document.querySelectorAll('[data-home-section]')].filter(section => section.hidden).length, viewportTop: card?.getBoundingClientRect().top };
      }, anchor);
      evidence.transitions.push({ panel, anchor, ...state });
      assert.equal(state.anchorVisible, true, panel + ' → ' + anchor + ' must reveal its section');
      assert.equal(state.activePanels, 0, 'The old panel must close');
      assert.equal(state.homeHidden, 0, 'All home sections must be restored');
      assert.ok(state.viewportTop >= 0 && state.viewportTop < 800, 'The requested category must be scrolled into view');
    }
  }));

  test('visible theme icon follows actual theme: ' + suffix, () => withPage('theme-' + suffix, width, theme, 'homepage-test.html', verifyTheme));

  test('API dialog uses homepage neutrals and visible input focus: ' + suffix, () => withPage('api-style-' + suffix, width, theme, 'homepage-test.html', async (page, evidence) => {
    await page.locator('[data-api-open]').click();
    await page.locator('[data-api-key]').focus();
    evidence.colors = await page.evaluate(() => {
      const style = selector => { const s = getComputedStyle(document.querySelector(selector)); return { background: s.backgroundColor, image: s.backgroundImage, color: s.color, outlineWidth: s.outlineWidth, outlineStyle: s.outlineStyle }; };
      return { dialog: style('.api-dialog'), input: style('[data-api-key]'), primary: style('.api-dialog .primary'), secondary: style('.api-dialog .secondary'), caption: style('.api-dialog .eyebrow') };
    });
    evidence.mutedToken = await page.locator('body').evaluate(element => getComputedStyle(element).getPropertyValue('--test-muted'));
    for (const [name, value] of Object.entries(evidence.colors)) {
      neutral(value.background, name + ' background');
      if (name === 'caption') assert.equal(value.color, hexRgb(evidence.mutedToken), 'Caption must use the existing workspace muted text token');
      else neutral(value.color, name + ' text');
      assert.equal(value.image, 'none', name + ' must not retain green gradients');
    }
    assert.ok(parseFloat(evidence.colors.input.outlineWidth) >= 2 && evidence.colors.input.outlineStyle !== 'none', 'Keyboard input focus must remain visible');
    const rect = await page.locator('.api-dialog').boundingBox();
    assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width && rect.y + rect.height <= 800, 'API form must fit the window');
    await page.locator('[data-api-close]').hover();
    evidence.closeHover = await page.locator('[data-api-close]').evaluate(element => ({ color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }));
    neutral(evidence.closeHover.color, 'Close hover text');
    neutral(evidence.closeHover.background, 'Close hover background');
  }));

  test('guide contains keyboard focus and restores trigger on close: ' + suffix, () => withPage('guide-' + suffix, width, theme, 'homepage-test.html', async (page, evidence) => {
    await page.locator('.home-test-sidebar [data-home-nav="about"]').click();
    const trigger = page.locator('[data-guide-open]');
    await trigger.click();
    await page.locator('[data-guide-modal]').waitFor({ state: 'visible' });
    evidence.focusSteps = [];
    for (const key of ['Shift+Tab', 'Tab', 'Tab', 'Shift+Tab']) {
      await page.keyboard.press(key);
      const state = await page.evaluate(() => {
        const active = document.activeElement;
        return { tag: active?.tagName, id: active?.id, hasFocus: document.hasFocus(), contained: !!active?.closest('[data-guide-modal]'), backgroundControl: !!active?.closest('a,button,input,select,textarea,[tabindex]') && !active?.closest('[data-guide-modal]') };
      });
      evidence.focusSteps.push({ key, ...state });
      assert.equal(state.backgroundControl, false, key + ' must not focus a background control');
    }
    const backgroundFocusBlocked = await page.locator('.home-test-sidebar [data-home-nav="about"]').evaluate(element => { element.focus(); return document.activeElement !== element; });
    evidence.backgroundFocusBlocked = backgroundFocusBlocked;
    assert.equal(backgroundFocusBlocked, true, 'Native modal must prevent programmatic focus on background content');
    await page.keyboard.press('Escape');
    await page.locator('[data-guide-modal]').waitFor({ state: 'hidden' });
    assert.equal(await trigger.evaluate(element => document.activeElement === element), true, 'Escape must restore the original trigger');
    await page.keyboard.press('Enter');
    await page.locator('[data-guide-modal]').waitFor({ state: 'visible' });
    await page.locator('[data-guide-close]').click();
    await page.locator('[data-guide-modal]').waitFor({ state: 'hidden' });
    assert.equal(await trigger.evaluate(element => document.activeElement === element), true, 'Close button must restore the original trigger');
    await page.keyboard.press('Space');
    await page.locator('[data-guide-modal]').waitFor({ state: 'visible' });
    const rect = await page.locator('.guide-dialog').boundingBox();
    assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width && rect.y + rect.height <= 800, 'Guide must fit the window');
    evidence.colors = await page.locator('.guide-dialog').evaluate(element => ({ background: getComputedStyle(element).backgroundColor, text: getComputedStyle(element).color }));
    neutral(evidence.colors.background, 'Guide background');
    neutral(evidence.colors.text, 'Guide text');
    await page.mouse.click(8, 8);
    await page.locator('[data-guide-modal]').waitFor({ state: 'hidden' });
    assert.equal(await trigger.evaluate(element => document.activeElement === element), true, 'Backdrop close must restore the trigger');
    await trigger.click();
  }));
}

async function verifyTheme(page, evidence) {
  const startTheme = await page.locator('html').getAttribute('data-theme');
  const initial = await visibleIcon(page);
  evidence.initial = initial;
  await page.locator('[data-theme-toggle]').click();
  const changed = await visibleIcon(page);
  evidence.changed = changed;
  assert.equal(initial.length, 1, 'Exactly one theme SVG must be visible');
  assert.equal(changed.length, 1, 'Exactly one theme SVG must be visible after toggle');
  assert.notEqual(initial[0].svg, changed[0].svg, 'The visible theme icon must change, not a hidden duplicate');
  assert.equal(initial[0].hasSun, startTheme === 'dark', 'The icon must indicate the available theme action');
  assert.equal(changed[0].hasSun, startTheme === 'light');
  assert.ok(changed[0].width >= 20 && changed[0].height >= 20);
  await page.locator('[data-theme-toggle]').click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), startTheme, 'Second click must restore the theme');
  const restored = await visibleIcon(page);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].svg, initial[0].svg, 'Second toggle must restore the identical visible icon');
  assert.equal(restored[0].hasSun, initial[0].hasSun);
  assert.ok(restored[0].width >= 20 && restored[0].width <= 24 && restored[0].height >= 20 && restored[0].height <= 24, 'Icon geometry must remain within the existing 22px control slot');
}

for (const theme of ['light', 'dark']) test('legacy homepage visible theme icon: ' + theme, () => withPage('legacy-theme-' + theme, 1024, theme, 'index.html', verifyTheme));
