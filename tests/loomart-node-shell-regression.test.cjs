const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(path.join(__dirname, "..", "desktop-client", "node_modules", "playwright"));

const pageUrl = pathToFileURL(path.join(__dirname, "..", "app", "ai-node-canvas.html")).href;

test("节点连接、紧凑工具栏、项目合集和右侧对话面板保持统一", async (t) => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pageUrl);
  await page.waitForFunction(() => document.body.dataset.canvasReady === "true");

  const shell = await page.evaluate(() => {
    const sidebar = document.querySelector(".sidebar");
    const hub = document.querySelector("#projectHub");
    const createGroup = document.querySelector('[data-add-node="image"]').closest(".tool-group");
    const panel = document.querySelector("#assistantPanel");
    const main = document.querySelector(".canvas-wrap");
    const toolbar = document.querySelector(".topbar-actions");
    const buttons = [...toolbar.querySelectorAll("button")].map((button) => {
      const rect = button.getBoundingClientRect();
      return { id: button.id, height: rect.height, left: rect.left, right: rect.right };
    }).filter((item) => item.right > item.left);
    return {
      hubParent: hub.parentElement === sidebar,
      hubBeforeCreate: Boolean(hub.compareDocumentPosition(createGroup) & Node.DOCUMENT_POSITION_FOLLOWING),
      hubOpen: hub.classList.contains("open"),
      panelWidth: panel.getBoundingClientRect().width,
      panelHeight: panel.getBoundingClientRect().height,
      panelPosition: { left: panel.getBoundingClientRect().left, top: panel.getBoundingClientRect().top, right: panel.getBoundingClientRect().right, bottom: panel.getBoundingClientRect().bottom },
      panelVisible: getComputedStyle(panel).opacity,
      appColumns: getComputedStyle(document.querySelector(".app")).gridTemplateColumns,
      sidebarHandleCenter: document.querySelector("#collapseSidebarButton").getBoundingClientRect().top
        + document.querySelector("#collapseSidebarButton").getBoundingClientRect().height / 2,
      toolbarRightGap: main.getBoundingClientRect().right - toolbar.getBoundingClientRect().right,
      buttonHeights: buttons.map((item) => item.height),
      buttonOrder: buttons.map((item) => item.left),
    };
  });
  assert.equal(shell.hubParent, true);
  assert.equal(shell.hubBeforeCreate, true);
  assert.equal(shell.hubOpen, false);
  assert.ok(shell.panelWidth >= 390 && shell.panelWidth <= 420, JSON.stringify(shell));
  assert.ok(shell.panelHeight >= 640, JSON.stringify(shell));
  assert.ok(shell.panelPosition.left >= 0 && shell.panelPosition.top >= 0 && shell.panelPosition.right <= 1440 && shell.panelPosition.bottom <= 960, JSON.stringify(shell));
  assert.equal(shell.appColumns.split(" ").length, 2, shell.appColumns);
  assert.equal(shell.panelVisible, "1");
  assert.ok(Math.abs(shell.sidebarHandleCenter - 480) < 1, JSON.stringify(shell));
  assert.ok(shell.toolbarRightGap >= 7 && shell.toolbarRightGap <= 9, JSON.stringify(shell));
  assert.ok(shell.buttonHeights.every((height) => height <= 24.1), JSON.stringify(shell.buttonHeights));
  assert.deepEqual(shell.buttonOrder, [...shell.buttonOrder].sort((a, b) => a - b));
  assert.equal(await page.locator("#undoButton, #redoButton").count(), 0);
  assert.equal(await page.locator("#collapseSidebarButton").isVisible(), true);
  assert.equal(await page.locator("#expandSidebarButton").isVisible(), false);

  await page.locator("#contextMenu").evaluate((menu) => {
    document.body.classList.add("dark-theme");
    menu.classList.add("open");
  });
  const contextVisual = await page.locator("#contextMenu").evaluate((menu) => {
    const menuStyle = getComputedStyle(menu);
    const buttonStyle = getComputedStyle(menu.querySelector("button"));
    return {
      width: menuStyle.width,
      radius: menuStyle.borderRadius,
      background: menuStyle.backgroundColor,
      buttonHeight: buttonStyle.height,
      buttonRadius: buttonStyle.borderRadius,
    };
  });
  assert.deepEqual(contextVisual, {
    width: "184px",
    radius: "8px",
    background: "rgb(36, 39, 37)",
    buttonHeight: "36px",
    buttonRadius: "6px",
  });
  await page.locator("#contextMenu button").first().hover();
  assert.equal(await page.locator("#contextMenu button").first().evaluate((button) => getComputedStyle(button).backgroundColor), "rgb(19, 170, 114)");
  await page.locator("#contextMenu").evaluate((menu) => menu.classList.remove("open"));
  const lightboxContextVisual = await page.evaluate(() => {
    openLightbox("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='400'%3E%3Crect width='600' height='400' fill='green'/%3E%3C/svg%3E", { mode: "image" });
    lightboxImage.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 520, clientY: 360 }));
    const menu = document.querySelector("#lightboxImageMenu");
    const button = menu.querySelector("button:not([hidden])");
    return {
      open: menu.classList.contains("open"),
      width: getComputedStyle(menu).width,
      radius: getComputedStyle(menu).borderRadius,
      background: getComputedStyle(menu).backgroundColor,
      buttonHeight: getComputedStyle(button).height,
      buttonRadius: getComputedStyle(button).borderRadius,
      buttonBackground: getComputedStyle(button).backgroundColor,
      buttonClass: button.className,
    };
  });
  assert.deepEqual(lightboxContextVisual, {
    open: true,
    width: "176px",
    radius: "8px",
    background: "rgb(36, 39, 37)",
    buttonHeight: "36px",
    buttonRadius: "6px",
    buttonBackground: "rgb(19, 170, 114)",
    buttonClass: "ghost is-hot",
  });
  await page.evaluate(() => closeLightbox());
  await page.evaluate(() => {
    document.querySelector("#promptManagerBackdrop").classList.add("open");
    document.querySelector("#promptManagerList").innerHTML = '<button class="prompt-library-item" type="button"><b>测试</b><span>测试提示词</span></button>';
  });
  assert.equal(await page.locator("#promptManagerList .prompt-library-item").evaluate((button) => getComputedStyle(button).borderRadius), "8px");
  await page.locator("#promptManagerBackdrop").evaluate((backdrop) => backdrop.classList.remove("open"));

  const assistantStarterState = await page.evaluate(() => {
    assistantMessages = [];
    assistantSending = false;
    renderAssistantConversation();
    const before = { hidden: assistantStarterCards.hidden, display: getComputedStyle(assistantStarterCards).display };
    assistantMessages = [{ role: "user", text: "测试消息" }];
    renderAssistantConversation();
    const after = { hidden: assistantStarterCards.hidden, display: getComputedStyle(assistantStarterCards).display };
    assistantMessages = [];
    renderAssistantConversation();
    return { before, after };
  });
  assert.deepEqual(assistantStarterState, {
    before: { hidden: false, display: "grid" },
    after: { hidden: true, display: "none" },
  });

  const promptField = page.locator(".node.generator .prompt-textarea").first();
  await promptField.fill(`${await promptField.inputValue()} 测试优化入口`);
  await page.waitForTimeout(800);
  assert.equal(await page.locator(".node.generator [data-prompt-optimize-nudge]").count(), 0, "the redundant prompt optimization nudge should stay removed");

  await page.locator("#collapseSidebarButton").click();
  assert.equal(await page.locator("#collapseSidebarButton").isVisible(), false);
  assert.equal(await page.locator("#expandSidebarButton").isVisible(), true);
  const expandAlignment = await page.locator("#expandSidebarButton").evaluate((button) => {
    const buttonRect = button.getBoundingClientRect();
    const iconRect = button.querySelector("svg").getBoundingClientRect();
    return {
      x: Math.abs((buttonRect.left + buttonRect.width / 2) - (iconRect.left + iconRect.width / 2)),
      y: Math.abs((buttonRect.top + buttonRect.height / 2) - (iconRect.top + iconRect.height / 2)),
    };
  });
  assert.ok(expandAlignment.x < 0.6 && expandAlignment.y < 0.6, JSON.stringify(expandAlignment));
  await page.locator("#expandSidebarButton").click();
  assert.equal(await page.locator("#collapseSidebarButton").isVisible(), true);
  assert.equal(await page.locator("#expandSidebarButton").isVisible(), false);

  const link = page.locator(".line-path").first();
  const connection = await link.evaluate((element) => ({
    d: element.getAttribute("d"),
    dash: getComputedStyle(element).strokeDasharray,
    width: getComputedStyle(element).strokeWidth,
  }));
  assert.match(connection.d, / C /, "connection should use a continuous Bézier curve");
  assert.ok(connection.dash === "none" || connection.dash === "0px", JSON.stringify(connection));
  assert.ok(parseFloat(connection.width) <= 1.5, JSON.stringify(connection));
  const portColors = await page.locator(".port.connected").evaluateAll((ports) => ports.map((port) => getComputedStyle(port).backgroundColor));
  assert.ok(portColors.length >= 2);
  assert.ok(portColors.every((color) => color === "rgb(255, 255, 255)"), JSON.stringify(portColors));
  const resultMetaStyle = await page.locator(".node.result .result-meta-line span").first().evaluate((element) => {
    const style = getComputedStyle(element);
    return { height: style.height, fontSize: style.fontSize, paddingLeft: style.paddingLeft, background: style.backgroundColor };
  });
  assert.equal(resultMetaStyle.height, "16px");
  assert.equal(resultMetaStyle.fontSize, "7.5px");
  const providerIconSources = await page.locator(".node.generator .model-provider-icon img").evaluateAll((images) => [...new Set(images.map((image) => image.getAttribute("src")))]);
  assert.ok(providerIconSources.includes("./assets/brands/openai.svg"), JSON.stringify(providerIconSources));
  assert.ok(providerIconSources.includes("./assets/brands/xai.svg"), JSON.stringify(providerIconSources));
  assert.ok(providerIconSources.includes("./assets/brands/gemini-color.svg"), JSON.stringify(providerIconSources));
  const resultSelectionStyle = await page.locator(".node.result").first().evaluate((element) => {
    element.classList.add("selected");
    const nodeStyle = getComputedStyle(element);
    const previewStyle = getComputedStyle(element.querySelector(".preview"));
    return { outline: nodeStyle.outlineStyle, nodeShadow: nodeStyle.boxShadow, previewShadow: previewStyle.boxShadow };
  });
  assert.equal(resultSelectionStyle.outline, "none");
  assert.equal(resultSelectionStyle.nodeShadow, "none");
  assert.match(resultSelectionStyle.previewShadow, /rgb\(199, 255, 225\) 0px 0px 0px 1px inset/);
  assert.equal(resultMetaStyle.paddingLeft, "4px");
  const metaAlpha = Number(resultMetaStyle.background.match(/[\d.]+\)$/)?.[0]?.slice(0, -1));
  assert.ok(metaAlpha <= 0.16, JSON.stringify(resultMetaStyle));
  const loadingLayout = await page.evaluate(() => {
    const pending = createNode("result", 1040, 120, {
      pending: true,
      width: 1080,
      height: 1920,
      frameWidth: 220
    });
    const root = document.querySelector(`[data-id="${pending.id}"]`);
    const spinner = root.querySelector(".spinner").getBoundingClientRect();
    const label = root.querySelector(".loading-state strong").getBoundingClientRect();
    return {
      gap: label.top - spinner.bottom,
      spinnerWidth: getComputedStyle(root.querySelector(".spinner")).width,
      direction: label.top > spinner.top
    };
  });
  assert.ok(loadingLayout.gap >= 5 && loadingLayout.gap <= 7, JSON.stringify(loadingLayout));
  assert.equal(loadingLayout.spinnerWidth, "32px");
  assert.equal(loadingLayout.direction, true);
  const referenceLayout = await page.evaluate(() => {
    const node = nodes.find((item) => item.type === "image");
    const urls = [
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='2' height='2'%3E%3Crect width='2' height='2' fill='white'/%3E%3C/svg%3E",
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='3' height='3'%3E%3Crect width='3' height='3' fill='black'/%3E%3C/svg%3E"
    ];
    node.references = urls.map((url) => ({ url, width: 1024, height: 1024 }));
    node.mediaUrl = urls[0];
    render();
    const preview = document.querySelector(`[data-id="${node.id}"] .preview`);
    const uploadBox = preview.querySelector(".upload-box");
    const thumb = uploadBox.querySelector(".thumb");
    return {
      nodeId: node.id,
      gap: getComputedStyle(uploadBox).gap,
      marginTop: getComputedStyle(uploadBox).marginTop,
      padding: getComputedStyle(preview).padding,
      frameWidth: getComputedStyle(preview).width,
      frameHeight: getComputedStyle(preview).height,
      frameBackground: getComputedStyle(preview).backgroundColor,
      frameBorder: getComputedStyle(preview).borderTopColor,
      thumbWidth: getComputedStyle(thumb).width,
      scrollbarWidth: getComputedStyle(uploadBox).scrollbarWidth,
      clientWidth: uploadBox.clientWidth,
      scrollWidth: uploadBox.scrollWidth,
      thumbCount: uploadBox.querySelectorAll(".thumb").length,
      addButtonCount: uploadBox.querySelectorAll("[data-reference-upload-trigger]").length,
    };
  });
  assert.equal(referenceLayout.gap, "2px");
  assert.equal(referenceLayout.marginTop, "0px");
  assert.equal(referenceLayout.padding, "0px");
  assert.equal(referenceLayout.frameWidth, "720px");
  assert.equal(referenceLayout.frameHeight, "720px");
  assert.notEqual(referenceLayout.frameBackground, "rgba(0, 0, 0, 0)");
  assert.notEqual(referenceLayout.frameBorder, "rgba(0, 0, 0, 0)");
  assert.ok(parseFloat(referenceLayout.thumbWidth) >= 230, referenceLayout.thumbWidth);
  assert.equal(referenceLayout.scrollbarWidth, "none");
  assert.ok(referenceLayout.scrollWidth <= referenceLayout.clientWidth, JSON.stringify(referenceLayout));
  assert.equal(referenceLayout.thumbCount, 2);
  assert.equal(referenceLayout.addButtonCount, 1);
  assert.equal(await page.locator(`[data-id="${referenceLayout.nodeId}"] .node-note`).count(), 0, "reference nodes should not render the redundant footer note");
  assert.equal(await page.locator(`[data-id="${referenceLayout.nodeId}"] [data-resize-corner]`).count(), 4);
  assert.deepEqual(await page.locator(`[data-id="${referenceLayout.nodeId}"] [data-resize-corner]`).evaluateAll((handles) => handles.map((handle) => [handle.dataset.resizeCorner, getComputedStyle(handle).cursor])), [
    ["nw", "nwse-resize"], ["ne", "nesw-resize"], ["sw", "nesw-resize"], ["se", "nwse-resize"]
  ]);
  const cornerInsets = await page.locator(`[data-id="${referenceLayout.nodeId}"]`).evaluate((nodeElement) => {
    const nodeRect = nodeElement.getBoundingClientRect();
    return [...nodeElement.querySelectorAll("[data-resize-corner]")].map((handle) => {
      const rect = handle.getBoundingClientRect();
      return {
        corner: handle.dataset.resizeCorner,
        left: rect.left - nodeRect.left,
        top: rect.top - nodeRect.top,
        right: nodeRect.right - rect.right,
        bottom: nodeRect.bottom - rect.bottom,
      };
    });
  });
  assert.ok(cornerInsets.every((item) => {
    const horizontalInset = item.corner.includes("w") ? item.left : item.right;
    const verticalInset = item.corner.includes("n") ? item.top : item.bottom;
    return horizontalInset >= 5.25 && verticalInset >= 5.25;
  }), JSON.stringify(cornerInsets));
  assert.ok(cornerInsets.filter((item) => item.corner.includes("s")).every((item) => item.bottom >= 14.25), JSON.stringify(cornerInsets));
  const cornerArcStyles = await page.locator(`[data-id="${referenceLayout.nodeId}"] [data-resize-corner]`).evaluateAll((handles) => handles.map((handle) => {
    const style = getComputedStyle(handle, "::after");
    return { width: style.width, height: style.height, radius: style.borderRadius };
  }));
  assert.ok(cornerArcStyles.every((style) => style.width === "16px" && style.height === "16px" && style.radius.includes("16px")), JSON.stringify(cornerArcStyles));
  await page.evaluate((nodeId) => {
    view.x = 0;
    view.y = 0;
    view.zoom = 1;
    applyCanvasTransform();
    const node = nodes.find((item) => item.id === nodeId);
    node.x = 0;
    node.y = 80;
    render();
    document.querySelector(`[data-id="${nodeId}"]`).style.zIndex = "1000";
  }, referenceLayout.nodeId);
  await page.waitForTimeout(260);
  const resizeHandleLocator = page.locator(`[data-id="${referenceLayout.nodeId}"] [data-resize-corner="se"]`);
  await resizeHandleLocator.hover();
  const resizeHandle = await resizeHandleLocator.boundingBox();
  assert.ok(resizeHandle, "reference node southeast resize handle should be visible");
  await page.mouse.down();
  assert.equal(await page.evaluate(() => resizeState?.corner), "se");
  await page.mouse.move(resizeHandle.x + resizeHandle.width / 2 + 36, resizeHandle.y + resizeHandle.height / 2 + 28, { steps: 8 });
  await page.mouse.up();
  const resizedReference = await page.evaluate((nodeId) => {
    const node = nodes.find((item) => item.id === nodeId);
    return { width: node.frameWidth, height: node.frameHeight };
  }, referenceLayout.nodeId);
  assert.ok(resizedReference.width >= 754 && resizedReference.height >= 746, JSON.stringify(resizedReference));
  const resizedTileWidth = await page.locator(`[data-id="${referenceLayout.nodeId}"] .thumb`).first().evaluate((thumb) => getComputedStyle(thumb).width);
  assert.ok(parseFloat(resizedTileWidth) > parseFloat(referenceLayout.thumbWidth), `${referenceLayout.thumbWidth} -> ${resizedTileWidth}`);

  const blankDragBefore = await page.evaluate((nodeId) => {
    const node = nodes.find((item) => item.id === nodeId);
    return { x: node.x, y: node.y };
  }, referenceLayout.nodeId);
  const referenceFrame = await page.locator(`[data-id="${referenceLayout.nodeId}"] .preview`).boundingBox();
  await page.mouse.move(referenceFrame.x + referenceFrame.width / 2, referenceFrame.y + referenceFrame.height - 70);
  await page.mouse.down();
  await page.mouse.move(referenceFrame.x + referenceFrame.width + 26, referenceFrame.y + referenceFrame.height + 6, { steps: 8 });
  await page.mouse.up();
  const blankDragAfter = await page.evaluate((nodeId) => {
    const node = nodes.find((item) => item.id === nodeId);
    return { x: node.x, y: node.y };
  }, referenceLayout.nodeId);
  assert.ok(blankDragAfter.x > blankDragBefore.x + 50 && blankDragAfter.y > blankDragBefore.y + 30, JSON.stringify({ blankDragBefore, blankDragAfter }));
  await page.evaluate((nodeId) => {
    const node = nodes.find((item) => item.id === nodeId);
    node.x = 0;
    node.y = 80;
    render();
  }, referenceLayout.nodeId);
  const referenceSync = await page.evaluate(() => {
    const source = createNode("image", 1120, 900, {
      references: [
        { url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='21' height='11'%3E%3C/svg%3E", width: 21, height: 11 },
        { url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='31' height='12'%3E%3C/svg%3E", width: 31, height: 12 }
      ]
    });
    const target = createNode("generator", 1460, 900);
    connectNodes(source.id, target.id);
    const targetSelector = `[data-id="${target.id}"] [data-generator-ref-index="0"] img`;
    const before = document.querySelector(targetSelector)?.getAttribute("src") || "";
    reorderReference(source, 0, 1);
    const afterMove = document.querySelector(targetSelector)?.getAttribute("src") || "";
    removeReference(source, 0);
    const afterRemoveCount = document.querySelectorAll(`[data-id="${target.id}"] [data-generator-ref-index]`).length;
    return { before, afterMove, afterRemoveCount };
  });
  assert.match(referenceSync.before, /width='21'/);
  assert.match(referenceSync.afterMove, /width='31'/);
  assert.equal(referenceSync.afterRemoveCount, 1);
  await page.locator(`[data-id="${referenceLayout.nodeId}"] .thumb`).nth(1).locator('[data-ref-move="-1"]').click();
  assert.equal(await page.evaluate((nodeId) => nodes.find((item) => item.id === nodeId).references[0].url.includes("width='3'"), referenceLayout.nodeId), true);
  await page.locator(`[data-id="${referenceLayout.nodeId}"] .thumb`).nth(1).locator("[data-remove-ref]").click();
  assert.equal(await page.locator(`[data-id="${referenceLayout.nodeId}"] .thumb`).count(), 1);

  const dragPair = await page.evaluate(() => {
    view.x = 0;
    view.y = 0;
    view.zoom = 1;
    applyCanvasTransform();
    const source = createNode("image", -100, 250);
    const target = createNode("result", 750, 280);
    selectedNodeId = source.id;
    render();
    return { source: source.id, target: target.id };
  });
  const sourcePort = await page.locator(`[data-id="${dragPair.source}"] .port.out`).boundingBox();
  const targetPort = await page.locator(`[data-id="${dragPair.target}"] .port.in`).boundingBox();
  assert.ok(sourcePort && targetPort, JSON.stringify({ sourcePort, targetPort }));
  const enlargedHitAreaWorks = await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest?.(".port.out")), {
    x: sourcePort.x + sourcePort.width / 2 + 12,
    y: sourcePort.y + sourcePort.height / 2,
  });
  assert.equal(enlargedHitAreaWorks, true, "the invisible port hit area should accept a pointer 12px away from the 6px dot");
  await page.mouse.move(sourcePort.x + sourcePort.width / 2 + 12, sourcePort.y + sourcePort.height / 2);
  await page.waitForTimeout(140);
  const hoverFeedback = await page.locator(`[data-id="${dragPair.source}"] .port.out`).evaluate((port) => ({
    hovered: port.matches(":hover"),
    transform: getComputedStyle(port).transform,
    boxShadow: getComputedStyle(port).boxShadow,
  }));
  assert.equal(hoverFeedback.hovered, true);
  assert.notEqual(hoverFeedback.transform, "none");
  assert.notEqual(hoverFeedback.boxShadow, "none");
  await page.mouse.move(sourcePort.x + sourcePort.width / 2, sourcePort.y + sourcePort.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetPort.x + targetPort.width / 2, targetPort.y + targetPort.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(({ source, target }) => links.some((link) => link.from === source && link.to === target), dragPair);
  assert.equal(await page.evaluate(() => Boolean(linkingFrom || linkingTo || portDragState)), false, "drag completion must not leave a pending connection");
  const incomingLinks = await page.evaluate(() => {
    const target = nodes.find((node) => node.type === "generator");
    const second = createNode("image", target.x - 260, target.y + 300);
    connectNodes(second.id, target.id);
    return links.filter((link) => link.to === target.id).length;
  });
  assert.equal(incomingLinks, 2, "generator should keep both reference inputs");
  const nodeCountBeforeUndo = await page.evaluate(() => nodes.length);
  await page.evaluate(() => createNode("image", 1400, 900));
  await page.locator(".canvas-wrap").click({ position: { x: 12, y: 900 } });
  await page.keyboard.press("Control+z");
  await page.waitForFunction((count) => nodes.length === count, nodeCountBeforeUndo);

  await page.locator("#projectHubButton").click();
  assert.equal(await page.locator("#projectHubButton").getAttribute("aria-expanded"), "true");
  assert.deepEqual(await page.locator(".project-menu-actions .project-transfer-actions button, #newProjectButton").allTextContents(), ["导出项目", "导入项目", "新建项目 1/10"]);
  await page.evaluate(() => {
    const base = projects[0];
    projects = Array.from({ length: 10 }, (_item, index) => ({ ...base, id: `limit-${index}`, name: `项目${index + 1}` }));
    activeProjectId = projects[0].id;
    renderProjects();
  });
  assert.equal(await page.locator("#projectCountHint").innerText(), "10/10");
  assert.equal(await page.locator("#newProjectButton").isDisabled(), true);

  assert.equal(await page.locator("#assistantRailButton").isVisible(), true);
  const openRailGap = await page.evaluate(() => Math.abs(document.querySelector("#assistantRailButton").getBoundingClientRect().right - document.querySelector("#assistantPanel").getBoundingClientRect().left));
  assert.ok(openRailGap < 1, String(openRailGap));
  await page.locator("#assistantRailButton").click();
  await page.waitForTimeout(220);
  assert.equal(await page.locator(".app").evaluate((element) => element.classList.contains("assistant-open")), false);
  assert.equal(await page.locator("#assistantToggleButton").count(), 0);
  assert.equal(await page.locator("#assistantRailButton").isVisible(), true);
  await page.locator("#assistantRailButton").click();
  assert.equal(await page.locator(".app").evaluate((element) => element.classList.contains("assistant-open")), true);
  assert.equal(await page.locator("#assistantRailButton").getAttribute("aria-expanded"), "true");
  assert.equal(await page.locator(".assistant-title strong").innerText(), "对话模式");
  assert.deepEqual(await page.locator(".assistant-select-field > span").allTextContents(), ["Skill", "创作技能", "模型"]);
  const railBox = await page.locator("#assistantRailButton").boundingBox();
  assert.ok(railBox.width >= 54 && railBox.height >= 196, JSON.stringify(railBox));
  assert.equal(await page.locator("#assistantRailButton [data-assistant-rail-copy]").innerText(), "对话模式");
  assert.equal(await page.locator("#assistantRailButton .assistant-rail-arrow svg").count(), 1);
  assert.ok(await page.locator("#assistantSkillSelect option").count() > 1);
  assert.equal(await page.locator("#assistantCreativeSkillSelect option").count(), 17);
  assert.equal(await page.locator("[data-assistant-resize]").count(), 8);
  assert.deepEqual(await page.locator("[data-assistant-resize]").evaluateAll((handles) => Object.fromEntries(handles.map((handle) => [handle.dataset.assistantResize, getComputedStyle(handle).cursor]))), {
    nw: "nwse-resize",
    ne: "nesw-resize",
    sw: "nesw-resize",
    se: "nwse-resize",
    n: "ns-resize",
    e: "ew-resize",
    s: "ns-resize",
    w: "ew-resize",
  });
  await page.locator('[data-assistant-resize="e"]').hover({ force: true });
  await page.waitForTimeout(180);
  assert.equal(await page.locator("#assistantPanel").evaluate((panel) => panel.classList.contains("resize-ready")), true);
  const edgeCue = await page.locator('[data-assistant-resize="e"]').evaluate((handle) => getComputedStyle(handle, "::after").backgroundColor);
  assert.equal(edgeCue, "rgb(19, 170, 114)");
  assert.equal(await page.locator('[data-assistant-resize="se"]').evaluate((handle) => getComputedStyle(handle, "::after").borderBottomRightRadius), "12px");

  const panelBeforeMove = await page.locator("#assistantPanel").boundingBox();
  const header = await page.locator("[data-assistant-drag-handle]").boundingBox();
  await page.mouse.move(header.x + header.width * 0.65, header.y + header.height / 2);
  await page.mouse.down();
  await page.mouse.move(header.x + header.width * 0.65 - 90, header.y + header.height / 2 + 30, { steps: 8 });
  await page.mouse.up();
  const panelAfterMove = await page.locator("#assistantPanel").boundingBox();
  assert.ok(panelAfterMove.x < panelBeforeMove.x - 70, JSON.stringify({ panelBeforeMove, panelAfterMove }));
  assert.ok(panelAfterMove.y > panelBeforeMove.y + 20, JSON.stringify({ panelBeforeMove, panelAfterMove }));

  const southeastHandle = await page.locator('[data-assistant-resize="se"]').boundingBox();
  await page.mouse.move(southeastHandle.x + southeastHandle.width / 2, southeastHandle.y + southeastHandle.height / 2);
  await page.mouse.down();
  await page.mouse.move(southeastHandle.x + southeastHandle.width / 2 + 55, southeastHandle.y + southeastHandle.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  const panelAfterResize = await page.locator("#assistantPanel").boundingBox();
  assert.ok(panelAfterResize.width > panelAfterMove.width + 40, JSON.stringify({ panelAfterMove, panelAfterResize }));
  assert.ok(panelAfterResize.height > panelAfterMove.height + 30, JSON.stringify({ panelAfterMove, panelAfterResize }));
  assert.ok(JSON.parse(await page.evaluate(() => localStorage.getItem("aiCanvasAssistantPanelGeometryV1"))).width > panelAfterMove.width);
  await page.evaluate(() => {
    if (!document.body.classList.contains("dark-theme")) themeToggleButton.click();
  });
  await page.waitForTimeout(250);
  const composerColors = await page.evaluate(() => {
    const trigger = document.querySelector(".assistant-select-field.model [data-assistant-picker-trigger]");
    const style = getComputedStyle(trigger);
    return { background: style.backgroundColor, color: style.color };
  });
  assert.equal(composerColors.background, "rgb(32, 37, 34)", JSON.stringify(composerColors));
  assert.equal(composerColors.color, "rgb(220, 227, 223)");
  await page.evaluate(() => applySyncedAssistantModels(["chat-a", "chat-b", "gpt-image-2"]));
  assert.deepEqual(await page.locator("#assistantModelSelect option").allTextContents(), ["自动选择模型", "chat-a", "chat-b", "gpt-image-2"]);
  await page.locator(".assistant-select-field.model [data-assistant-picker-trigger]").click();
  assert.equal(await page.locator(".assistant-select-field.model").evaluate((field) => field.classList.contains("open")), true);
  assert.deepEqual(await page.locator(".assistant-select-field.model .assistant-picker-option").allTextContents(), ["自动选择模型", "chat-a", "chat-b", "gpt-image-2"]);
  assert.equal(await page.locator(".assistant-select-field.model .assistant-picker-menu").evaluate((menu) => getComputedStyle(menu).backgroundColor), "rgb(26, 31, 28)");
  await page.locator('.assistant-select-field.model [data-assistant-picker-option="chat-a"]').click();
  assert.equal(await page.locator("#assistantModelSelect").inputValue(), "chat-a");
  assert.equal(await page.locator(".assistant-select-field.model [data-assistant-picker-value]").textContent(), "chat-a");
  assert.equal(await page.locator(".assistant-select-field.model").evaluate((field) => field.classList.contains("open")), false);
  await page.locator(".assistant-select-field").nth(1).locator("[data-assistant-picker-trigger]").click();
  await page.locator(".assistant-select-field").nth(1).locator('[data-assistant-picker-option="poster"]').click();
  await page.locator("[data-chat-starter]").first().click();
  assert.match(await page.locator("#assistantInput").inputValue(), /提示词/);
  let chatRequest = null;
  await page.route("**/v1/chat/completions", async (route) => {
    chatRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ choices: [{ message: { content: "这是测试回复。" } }] }),
    });
  });
  await page.evaluate(() => { apiKeyInput.value = "test-key"; });
  await page.locator("#assistantImageInput").setInputFiles(path.join(__dirname, "..", "app", "logo.png"));
  await page.waitForFunction(() => assistantAttachments.length === 1);
  assert.equal(await page.locator(".assistant-attachment").count(), 1);
  await page.locator("#assistantInput").press("Enter");
  await page.locator(".assistant-message.assistant", { hasText: "这是测试回复。" }).waitFor();
  assert.equal(chatRequest?.model, "chat-a");
  assert.match(chatRequest?.messages?.[0]?.content || "", /创作技能：.*海报设计/s);
  assert.ok(chatRequest?.messages?.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === "image_url")), JSON.stringify(chatRequest));
  assert.deepEqual(errors, []);
});
