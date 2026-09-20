const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("../desktop-client/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const gridformUrl = pathToFileURL(path.join(root, "app", "gridform.html")).href;
const canvasUrl = pathToFileURL(path.join(root, "app", "ai-node-canvas.html")).href;

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

  assert.equal(await page.locator("#layoutGallery .layout-card").count(), 18, "应展示 18 种构图");
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

  await page.locator("#layoutGallery .layout-card").nth(5).click();
  assert.equal(await page.evaluate(() => window.Gridform.state.layout), "spine", "构图卡应可选择");
  await page.locator("#generate").click();
  assert.notEqual(await page.evaluate(() => window.Gridform.state.layout), "spine", "随机生成应切换构图");

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
  await nav.locator("#openGridformButton").click();
  await nav.waitForURL(/gridform\.html$/);
  assert.equal(await nav.title(), "GRIDFORM — 网格海报工作台");

  await browser.close();
  console.log("GRIDFORM_WORKBENCH_PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
