const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (_error) {
  // Run with NODE_PATH pointing to the bundled workspace runtime to enable this smoke test.
}

const appDir = path.resolve(__dirname, '..', 'app');
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browserOptions = { headless: true };
if (fs.existsSync(edgePath)) browserOptions.executablePath = edgePath;

function rgbChannels(value) {
  const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  assert.ok(match, `Expected an RGB color, got ${value}`);
  return match.slice(1).map(Number);
}

function assertNeutral(value, label) {
  const channels = rgbChannels(value);
  assert.ok(Math.max(...channels) - Math.min(...channels) <= 5, `${label} has a color cast: ${value}`);
}

test('homepage and linked asset test pages keep large surfaces neutral in both themes', { skip: !chromium }, async () => {
  const browser = await chromium.launch(browserOptions);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    await page.goto(pathToFileURL(path.join(appDir, 'homepage-test.html')).href);
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') await page.locator('[data-theme-toggle]').click();
      assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
      for (const panel of ['home', 'blog', 'notice', 'about']) {
        await page.locator(`.home-nav .home-nav-item[data-home-nav="${panel}"]`).click();
        const surfaces = await page.evaluate(() => {
          const background = (selector) => getComputedStyle(document.querySelector(selector)).backgroundColor;
          return {
            page: background('body'),
            sidebar: background('.home-test-sidebar'),
            topbar: background('.home-topbar'),
            heroFallback: background('.home-test-hero-panel'),
            card: background('.home-panel.active .info-card, .home-panel.active .blog-entry-card, #home-tools .module-card')
          };
        });
        for (const [name, color] of Object.entries(surfaces)) assertNeutral(color, `${theme}/${panel}/${name}`);
        if (panel !== 'home') assert.equal(await page.locator(`.home-panel[data-home-panel="${panel}"]`).isVisible(), true);
      }
    }
    await page.locator('.home-test-sidebar [data-home-nav="notice"]').click();
    assert.equal(await page.locator('[data-home-panel="notice"]').isVisible(), true);
    await page.locator('.home-test-sidebar [data-home-nav="blog"]').click();
    assert.equal(await page.locator('[data-home-panel="blog"]').isVisible(), true);
    await page.locator('.home-test-sidebar [data-home-nav="about"]').click();
    assert.equal(await page.locator('[data-home-panel="about"]').isVisible(), true);

    await page.goto(pathToFileURL(path.join(appDir, 'asset-library-test.html')).href);
    await page.waitForLoadState('domcontentloaded');
    assert.equal(await page.locator('body').evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(16, 17, 18)');
    await page.locator('.asset-filter[data-filter="skill"]').click();
    assert.match(await page.locator('#assetTitle').textContent(), /Skill/i);

    for (const file of ['homepage-test.html', 'asset-library-test.html']) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(pathToFileURL(path.join(appDir, file)).href);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert.ok(overflow <= 2, `${file} overflows mobile viewport by ${overflow}px`);
    }
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser.close();
  }
});

test('blog brief and mind-map follow dark theme without leaving controls blank', { skip: !chromium }, async () => {
  const browser = await chromium.launch(browserOptions);
  const page = await browser.newPage();
  await page.addInitScript(() => localStorage.setItem('ai-tools-theme', 'dark'));
  try {
    await page.goto(pathToFileURL(path.join(appDir, 'daily-news', 'index.html')).href);
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    assertNeutral(await page.locator('body').evaluate((element) => getComputedStyle(element).backgroundColor), 'daily-news/dark/body');
    await page.locator('#themeToggle').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    assert.equal(await page.evaluate(() => localStorage.getItem('ai-tools-theme')), 'light');

    // The map CDN may be unreachable in an offline desktop session. Its labels
    // should still appear immediately while the diagram library is loading.
    await page.route('https://unpkg.com/**', (route) => route.abort());
    await page.goto(pathToFileURL(path.join(appDir, 'prompt-mind-map.html')).href);
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    assertNeutral(await page.locator('body').evaluate((element) => getComputedStyle(element).backgroundColor), 'mind-map/dark/body');
    assert.ok((await page.locator('#generate-btn').textContent()).trim().length > 0);
  } finally {
    await browser.close();
  }
});
