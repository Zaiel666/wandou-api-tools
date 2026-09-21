const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("../desktop-client/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const gridformUrl = pathToFileURL(path.join(root, "app", "gridform.html")).href;
const canvasUrl = pathToFileURL(path.join(root, "app", "ai-node-canvas.html")).href;
const homeUrl = pathToFileURL(path.join(root, "app", "index.html")).href;

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(gridformUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.gridformLocalReady === true, null, { timeout: 20000 });

  assert.equal(await page.locator("#layoutGallery .layout-card").count(), 30, "应展示 30 种构图");
  assert.equal(await page.evaluate(() => window.PosterLayouts.length), 30, "构图数据应扩展到 30 种");
  const compositionPosition = await page.evaluate(() => {
    const studio = document.querySelector(".studio").getBoundingClientRect();
    const dock = document.querySelector(".composition-dock").getBoundingClientRect();
    const gallery = document.querySelector("#layoutGallery");
    return {
      studioRight: studio.right,
      dockLeft: dock.left,
      dockHeight: dock.height,
      galleryScrollsVertically: gallery.scrollHeight > gallery.clientHeight
    };
  });
  assert.ok(Math.abs(compositionPosition.studioRight - compositionPosition.dockLeft) <= 2, "构图面板应紧贴画布右侧");
  assert.ok(compositionPosition.dockHeight > 800, "构图面板应占据工作区完整高度");
  assert.equal(compositionPosition.galleryScrollsVertically, true, "30 种构图应在右侧面板内纵向滚动");
  assert.ok(await page.locator("#poster").evaluate((canvas) => canvas.width > 0 && canvas.height > 0), "海报画布应完成渲染");
  assert.equal((await page.locator("#export").innerText()).replace(/\s+/g, ""), "↗导出PNG", "本地导出按钮不应显示积分");
  assert.equal((await page.locator(".wandou-brand-name").innerText()).trim(), "豌豆 AI", "页头应使用豌豆 AI 品牌名称");
  assert.match(await page.locator("[data-gridform-logo]").getAttribute("src"), /wandou-logo-latest\.png$/, "页头应使用项目现有豌豆 Logo");
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--fld-accent").trim()), "#2f86ff", "交互强调色应统一为豌豆蓝");

  const titleField = page.locator("#textFields textarea").first();
  await titleField.fill("网格测试标题\n自由发生");
  await page.waitForFunction(() => window.Gridform.state.elements.some((item) => item.type === "text" && item.text.includes("网格测试标题")));

  await page.getByRole("button", { name: "素材", exact: true }).click();
  assert.ok(await page.locator("#tab-assets").evaluate((el) => el.classList.contains("active")), "素材二级面板应可切换");
  await page.getByRole("button", { name: "画布", exact: true }).click();
  await page.locator('[data-ratio="1:1"]').click();
  assert.equal(await page.evaluate(() => window.Gridform.state.config.ratio), "1:1", "画布比例应可调整");

  const layoutIds = await page.evaluate(() => window.PosterLayouts.map((layout) => layout.id));
  for (let index = 0; index < layoutIds.length; index += 1) {
    await page.locator("#layoutGallery .layout-card").nth(index).click();
    assert.equal(await page.evaluate(() => window.Gridform.state.layout), layoutIds[index], `第 ${index + 1} 种构图应可正常应用`);
  }

  await page.locator("#layoutGallery .layout-card").nth(5).click();
  assert.equal(await page.evaluate(() => window.Gridform.state.layout), "spine", "构图卡应可选择");
  await page.locator("#layoutGallery .layout-card").nth(29).click();
  assert.equal(await page.evaluate(() => window.Gridform.state.layout), "catalog", "新增构图卡应可正常应用");
  await page.locator("#generate").click();
  assert.notEqual(await page.evaluate(() => window.Gridform.state.layout), "catalog", "随机生成应切换构图");

  await page.locator("#saveDraft").click();
  await page.waitForFunction(() => document.querySelector("#saveStatus").textContent.includes("草稿已保存"));

  const pngDownload = page.waitForEvent("download");
  await page.locator("#export").click();
  const png = await pngDownload;
  assert.match(png.suggestedFilename(), /GRIDFORM-.*-2x\.png$/);
  const pngBytes = fs.readFileSync(await png.path());
  assert.equal(pngBytes.subarray(1, 4).toString("ascii"), "PNG", "PNG 下载内容应有效");

  await page.locator("#exportFormat").selectOption("psd");
  const psdDownload = page.waitForEvent("download", { timeout: 30000 });
  await page.locator("#export").click();
  const psd = await psdDownload;
  assert.match(psd.suggestedFilename(), /GRIDFORM-.*-layers-2x\.psd$/);
  const psdBytes = fs.readFileSync(await psd.path());
  assert.equal(psdBytes.subarray(0, 4).toString("ascii"), "8BPS", "PSD 下载内容应有效");
  assert.ok(psdBytes.length > 10000, "PSD 不应为空壳文件");

  assert.deepEqual(pageErrors, [], `页面不应出现脚本错误：${pageErrors.join(" | ")}`);
  await page.screenshot({ path: path.join(root, "artifacts", "gridform-workbench.png"), fullPage: true });

  const nav = await context.newPage();
  await nav.goto(canvasUrl, { waitUntil: "domcontentloaded" });
  const originalCanvasUrl = nav.url();
  const canvasPopupPromise = nav.waitForEvent("popup");
  await nav.locator("#openGridformButton").click();
  const canvasPopup = await canvasPopupPromise;
  await canvasPopup.waitForLoadState("domcontentloaded");
  assert.match(canvasPopup.url(), /gridform\.html$/);
  assert.equal(await canvasPopup.title(), "GRIDFORM — 网格海报工作台");
  assert.equal(nav.url(), originalCanvasUrl, "从节点画布打开时不应替换当前画布标签页");

  const home = await context.newPage();
  await home.goto(homeUrl, { waitUntil: "domcontentloaded" });
  const homeCard = home.locator('a.module-gridform[data-tab-title="网格海报工作台"]');
  assert.equal(await homeCard.count(), 1, "首页应提供网格海报工作台卡片入口");
  const homePopupPromise = home.waitForEvent("popup");
  await homeCard.click();
  const homePopup = await homePopupPromise;
  await homePopup.waitForLoadState("domcontentloaded");
  assert.match(homePopup.url(), /gridform\.html$/);
  assert.match(home.url(), /index\.html$/, "首页卡片应在新标签页打开工作台");

  await browser.close();
  console.log("GRIDFORM_WORKBENCH_PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
