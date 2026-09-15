const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(path.join(__dirname, "..", "desktop-client", "node_modules", "playwright"));

const pageUrl = pathToFileURL(path.join(__dirname, "..", "app", "ai-node-canvas.html")).href;

test("提示词编辑器合并参考区并保留三项工具逻辑", async (t) => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  let serveRemoteSources = true;
  let remoteRequests = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://raw.githubusercontent.com/**", async (route) => {
    if (!serveRemoteSources) return route.abort("internetdisconnected");
    remoteRequests += 1;
    const sourceId = route.request().url().split("/").pop().replace(/\.json$/, "");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([{
        id: `${sourceId}:test`,
        title: `公开测试海报 ${sourceId}`,
        prompt: `使用 ${sourceId} 的开源测试提示词`,
        coverUrl: "https://example.com/prompt-cover.jpg",
        tags: ["海报", "测试"],
      }]),
    });
  });
  await page.goto(pageUrl);
  await page.waitForFunction(() => document.body.dataset.canvasReady === "true");

  const node = page.locator(".node.generator").first();
  const prompt = node.locator(".prompt-textarea");
  assert.equal(await node.locator(".prompt-reference-head").count(), 0);
  const toolStyles = await node.locator(".prompt-composer-footer .prompt-corner-button").evaluateAll((buttons) => buttons.map((button) => {
    const style = getComputedStyle(button);
    return { borderColor: style.borderTopColor, borderRadius: style.borderRadius, color: style.color };
  }));
  assert.equal(toolStyles.length, 3);
  toolStyles.forEach((style) => {
    assert.equal(style.borderColor, "rgb(255, 255, 255)");
    assert.equal(style.borderRadius, "50%");
    assert.equal(style.color, "rgb(255, 255, 255)");
  });
  const original = await prompt.inputValue();
  await prompt.fill(`${original} 编辑器输入测试`);
  assert.match(await prompt.inputValue(), /编辑器输入测试$/);

  await node.locator(".prompt-composer-footer [data-prompt-library]").click();
  assert.equal(await page.locator("#promptManagerBackdrop").evaluate((panel) => panel.classList.contains("open")), true);
  await page.waitForFunction(() => document.querySelectorAll("#promptSourceList .prompt-source-button").length >= 9);
  await page.waitForFunction(() => promptSourcesLoaded === true);
  assert.equal(await page.locator("#promptManagerCount").textContent(), "1752 条");
  const listMetrics = await page.locator("#promptManagerList").evaluate((list) => ({
    overflowY: getComputedStyle(list).overflowY,
    clientHeight: list.clientHeight,
    scrollHeight: list.scrollHeight,
    scrollTop: list.scrollTop,
  }));
  assert.equal(listMetrics.overflowY, "auto");
  assert.ok(listMetrics.clientHeight > 0);
  assert.ok(listMetrics.scrollHeight > listMetrics.clientHeight);
  await page.locator("#promptManagerList").hover();
  await page.mouse.wheel(0, 720);
  await page.waitForFunction(() => document.querySelector("#promptManagerList").scrollTop > 0);
  assert.ok(await page.locator("#promptManagerList").evaluate((list) => list.scrollTop) > listMetrics.scrollTop);
  for (let attempt = 0; attempt < 100 && remoteRequests < 7; attempt += 1) await page.waitForTimeout(20);
  assert.equal(remoteRequests, 7);
  await page.locator("#closePromptManagerButton").click();
  assert.equal(await page.locator("#promptManagerBackdrop").evaluate((panel) => panel.classList.contains("open")), false);

  await node.locator(".prompt-composer-footer [data-prompt-refine-open]").click();
  assert.equal(await node.locator("[data-prompt-refine-panel]").count(), 1);
  await node.locator("[data-prompt-refine-close]").click();
  assert.equal(await node.locator("[data-prompt-refine-panel]").count(), 0);

  await node.locator(".prompt-composer-footer [data-skill-picker-toggle]").click();
  assert.equal(await node.locator("[data-generator-skill-popover]").evaluate((panel) => panel.classList.contains("open")), true);

  serveRemoteSources = false;
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.canvasReady === "true");
  await page.locator(".node.generator").first().locator(".prompt-composer-footer [data-prompt-library]").click();
  await page.waitForFunction(() => promptSourcesLoaded === true);
  assert.equal(await page.locator("#promptManagerCount").textContent(), "17 条");
  assert.match(await page.locator("#promptManagerStatus").textContent(), /数据已缓存在本机/);
  await page.locator("#promptManagerSearch").fill("公开测试海报 banana");
  assert.equal(await page.locator("#promptManagerList .prompt-library-item").count(), 1);
  await page.locator("#promptManagerList .prompt-library-item").click();
  assert.match(await page.locator(".node.generator").first().locator(".prompt-textarea").inputValue(), /开源测试提示词/);
  assert.deepEqual(errors, []);
});
