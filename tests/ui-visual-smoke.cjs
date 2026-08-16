const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const app = path.resolve(__dirname, "../app");
  const output = path.join(os.tmpdir(), "wandou-ui-calibration");
  fs.mkdirSync(output, { recursive: true });

  await page.goto(pathToFileURL(path.join(app, "index.html")).href, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await page.screenshot({ path: path.join(output, "home-light.png"), fullPage: true });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.screenshot({ path: path.join(output, "home-dark.png"), fullPage: true });

  await page.goto(pathToFileURL(path.join(app, "project-hub.html")).href, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    document.body.classList.remove("dark-theme");
    document.body.classList.add("light-theme");
  });
  await page.screenshot({ path: path.join(output, "projects-light.png"), fullPage: true });
  await page.evaluate(() => {
    document.body.classList.remove("light-theme");
    document.body.classList.add("dark-theme");
  });
  await page.waitForTimeout(350);
  const projectComputed = await page.evaluate(() => {
    const search = document.querySelector(".search");
    const toolbar = document.querySelector(".toolbar");
    return {
      bodyClass: document.body.className,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      searchBackground: getComputedStyle(search).backgroundColor,
      searchColor: getComputedStyle(search).color,
      darkSelectorMatches: search.matches("body.project-hub-page.dark-theme :is(.button, .icon-button, .search, select)"),
      neutralSurface2: getComputedStyle(document.body).getPropertyValue("--wd-neutral-surface-2").trim(),
      toolbarBackground: getComputedStyle(toolbar).backgroundColor,
    };
  });
  console.log(JSON.stringify(projectComputed));
  await page.screenshot({ path: path.join(output, "projects-dark.png"), fullPage: true });

  await page.goto(`${pathToFileURL(path.join(app, "ai-node-canvas.html")).href}?project=ui-calibration-preview`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => document.body.classList.remove("dark-theme"));
  await page.screenshot({ path: path.join(output, "canvas-light.png") });
  await page.evaluate(() => document.body.classList.add("dark-theme"));
  await page.screenshot({ path: path.join(output, "canvas-dark.png") });

  await browser.close();
  console.log(output);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
