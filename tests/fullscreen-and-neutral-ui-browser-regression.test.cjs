const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  });
  try {
    const context = await browser.newContext({ viewport: { width: 3840, height: 2160 } });
    const projectPage = await context.newPage();
    await projectPage.goto(pathToFileURL(path.resolve(__dirname, "../app/project-hub.html")).href);
    const projectLayout = await projectPage.locator(".shell").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: innerWidth - rect.right, width: rect.width, viewport: innerWidth };
    });
    assert.ok(projectLayout.width >= projectLayout.viewport * 0.98, JSON.stringify(projectLayout));
    assert.ok(projectLayout.left <= 2 && projectLayout.right <= 2, JSON.stringify(projectLayout));

    const assetPage = await context.newPage();
    await assetPage.goto(pathToFileURL(path.resolve(__dirname, "../app/asset-library.html")).href);
    const assetLayout = await assetPage.locator(".asset-shell").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: innerWidth - rect.right, width: rect.width, viewport: innerWidth };
    });
    assert.ok(assetLayout.width >= assetLayout.viewport * 0.98, JSON.stringify(assetLayout));
    assert.ok(assetLayout.left <= 2 && assetLayout.right <= 2, JSON.stringify(assetLayout));

    const homePage = await context.newPage();
    await homePage.goto(pathToFileURL(path.resolve(__dirname, "../app/index.html")).href);
    const neutralUi = await homePage.evaluate(() => {
      const modal = document.querySelector(".api-modal");
      modal.hidden = false;
      const service = document.querySelector(".service-dialog");
      service.setAttribute("open", "");
      const rgb = (selector, property = "backgroundColor") =>
        getComputedStyle(document.querySelector(selector))[property];
      return {
        apiSurface: rgb(".api-dialog"),
        serviceSurface: rgb(".service-dialog-card"),
        announcementSurface: rgb(".announcement-intro-card"),
        cacheButtonCount: document.querySelectorAll("[data-cache-clear]").length,
        contactText: document.querySelector(".contact-card")?.innerText || "",
        contactAlignment: getComputedStyle(document.querySelector(".contact-card")).textAlign,
        contactJustification: getComputedStyle(document.querySelector(".contact-card")).justifyItems,
        contactWidth: document.querySelector(".contact-card").getBoundingClientRect().width,
        qrWidth: document.querySelector(".qr-placeholder").getBoundingClientRect().width,
      };
    });
    assert.equal(neutralUi.cacheButtonCount, 0);
    assert.notEqual(neutralUi.apiSurface, "rgba(0, 0, 0, 0)");
    assert.notEqual(neutralUi.serviceSurface, "rgba(0, 0, 0, 0)");
    assert.notEqual(neutralUi.announcementSurface, "rgba(0, 0, 0, 0)");
    assert.match(neutralUi.contactText, /微信：peafour1111/);
    assert.doesNotMatch(neutralUi.contactText, /邮箱|充值请联系我/);
    assert.equal(neutralUi.contactAlignment, "center");
    assert.equal(neutralUi.contactJustification, "center");
    assert.equal(neutralUi.contactWidth, 204);
    assert.equal(neutralUi.qrWidth, 108);
    for (const value of [neutralUi.apiSurface, neutralUi.serviceSurface, neutralUi.announcementSurface]) {
      assert.doesNotMatch(value, /rgb\(0,\s*(?:[7-9]\d|1\d\d),\s*0\)/);
    }
    console.log("PASS: fullscreen project/assets and neutral opaque common dialogs");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
