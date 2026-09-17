const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(path.join(__dirname, "..", "desktop-client", "node_modules", "playwright"));

test("浅色主题按钮保持可读底色、边框和对比度", async (t) => {
  const browser = await chromium.launch({ headless:true, executablePath:"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport:{ width:1600, height:1100 } });
  await page.addInitScript(() => {
    localStorage.setItem("wd-theme", "light");
    localStorage.setItem("ai-tools-theme", "light");
    localStorage.setItem("aiCanvasAssistantOpenV1", "0");
  });
  await page.goto(pathToFileURL(path.resolve(__dirname, "../app/ai-node-canvas.html")).href);
  await page.waitForFunction(() => document.body.dataset.canvasReady === "true");
  await page.locator('[data-add-node="audio"]').click();
  await page.locator('[data-add-node="outpaint"]').click();
  await page.locator("#settingsButton").click();

  const audit = await page.evaluate(() => {
    const parse = (value) => {
      const match = String(value).match(/[\d.]+/g) || [];
      return { r:+match[0] || 0, g:+match[1] || 0, b:+match[2] || 0, a:match[3] === undefined ? 1 : +match[3] };
    };
    const blend = (front, back) => ({
      r:front.r * front.a + back.r * (1 - front.a),
      g:front.g * front.a + back.g * (1 - front.a),
      b:front.b * front.a + back.b * (1 - front.a),
      a:1,
    });
    const background = (element) => {
      const chain = [];
      for (let current = element; current; current = current.parentElement) chain.unshift(current);
      return chain.reduce((value, current) => blend(parse(getComputedStyle(current).backgroundColor), value), { r:255, g:255, b:255, a:1 });
    };
    const luminance = (color) => {
      const channel = (value) => {
        const normalized = value / 255;
        return normalized <= .03928 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
      };
      return .2126 * channel(color.r) + .7152 * channel(color.g) + .0722 * channel(color.b);
    };
    const contrast = (foreground, backgroundColor) => {
      const light = Math.max(luminance(foreground), luminance(backgroundColor));
      const dark = Math.min(luminance(foreground), luminance(backgroundColor));
      return (light + .05) / (dark + .05);
    };
    const selectors = [
      ".button-grid button",
      ".node.audio button",
      ".node.audio label",
      ".node.outpaint button",
      ".settings-popover button",
      ".topbar-actions button",
    ].join(",");
    return [...document.querySelectorAll(selectors)].filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && !element.disabled;
    }).map((element) => {
      const style = getComputedStyle(element);
      const bg = background(element);
      const fg = blend(parse(style.color), bg);
      return {
        label:element.getAttribute("aria-label") || element.title || element.textContent.trim().replace(/\s+/g, " ").slice(0, 50) || element.className,
        ratio:contrast(fg, bg),
        color:style.color,
        background:style.backgroundColor,
        border:style.borderColor,
      };
    });
  });
  const failures = audit.filter((item) => item.ratio < 3);
  assert.deepEqual(failures, [], JSON.stringify(failures, null, 2));
  const themedSurfaces = await page.evaluate(() => ({
    dark:document.body.classList.contains("dark-theme"),
    zoom:getComputedStyle(document.querySelector("#zoomValue")).backgroundColor,
    theme:getComputedStyle(document.querySelector("#themeToggleButton")).backgroundColor,
    settings:getComputedStyle(document.querySelector("#settingsButton")).backgroundColor,
    outpaintGenerate:getComputedStyle(document.querySelector(".node.outpaint [data-generate]")).backgroundColor,
  }));
  assert.equal(themedSurfaces.dark, false);
  for (const value of [themedSurfaces.zoom, themedSurfaces.theme, themedSurfaces.settings, themedSurfaces.outpaintGenerate]) {
    assert.doesNotMatch(value, /rgb\((?:2\d|3\d),\s*(?:2\d|3\d),\s*(?:2\d|3\d)\)/, JSON.stringify(themedSurfaces));
  }
});
