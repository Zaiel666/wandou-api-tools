const params = new URLSearchParams(location.search);
const homeUrl = params.get("home");
const version = params.get("version") || "";
const preloadUrl = new URL("./preload.js", location.href).href;

const $ = (id) => document.getElementById(id);
const tabList = $("tabList");
const views = $("views");
const brandButton = $("brandButton");
const brandLogo = $("brandLogo");
const brandText = $("brandText");
const backButton = $("backButton");
const forwardButton = $("forwardButton");
const noticeButton = $("noticeButton");
const noticeDot = noticeButton.querySelector(".notice-dot");
const updateBadge = $("updateBadge");
const versionText = $("versionText");
const dialogOverlay = $("dialogOverlay");
const dialogVersion = $("dialogVersion");
const dialogNotes = $("dialogNotes");
const dialogCancel = $("dialogCancel");
const dialogDownload = $("dialogDownload");
const closeDialogOverlay = $("closeDialogOverlay");
const closeDialogStatus = $("closeDialogStatus");
const closeDialogLocation = $("closeDialogLocation");
const closeDialogCancel = $("closeDialogCancel");
const closeDialogConfirm = $("closeDialogConfirm");
const desktopToast = $("desktopToast");

brandLogo.src = new URL("./logo.png", homeUrl).href;
versionText.textContent = version ? `v${version}` : "";

const tabs = new Map();
let activeId = "";
let tabSequence = 0;
let updateInfo = null;
let clientConfig = {};
let toastTimer = 0;
let closeInProgress = false;
let updateStarted = false;
let canvasBackupDirectory = "";

function normalizedUrl(url) {
  try { return new URL(url, homeUrl).href; } catch (_error) { return url; }
}

function showToast(message, error = false) {
  clearTimeout(toastTimer);
  desktopToast.textContent = message;
  desktopToast.classList.toggle("error", error);
  desktopToast.hidden = false;
  toastTimer = window.setTimeout(() => { desktopToast.hidden = true; }, 2600);
}

function createTabButton(tab, closable) {
  const button = document.createElement("button");
  button.className = "tab";
  button.classList.toggle("home-tab", tab.pinned);
  button.type = "button";
  button.dataset.tabId = tab.id;
  button.setAttribute("role", "tab");

  const icon = document.createElement("span");
  icon.className = "tab-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = tab.pinned ? "●" : "○";
  button.append(icon);

  const label = document.createElement("span");
  label.className = "tab-label";
  label.textContent = tab.title;
  button.append(label);

  if (closable) {
    const close = document.createElement("span");
    close.className = "tab-close";
    close.setAttribute("role", "button");
    close.setAttribute("aria-label", "关闭标签");
    close.title = "关闭标签";
    close.textContent = "×";
    button.append(close);
  }

  button.addEventListener("click", (event) => {
    if (event.target.closest(".tab-close")) closeTab(tab.id);
    else activateTab(tab.id);
  });
  return button;
}

function openTab({ url, title = "新标签页", pinned = false }) {
  if (!url) return null;
  const targetUrl = normalizedUrl(url);
  const existing = [...tabs.values()].find((tab) => tab.url === targetUrl);
  if (existing) {
    activateTab(existing.id);
    return existing;
  }

  const id = `tab-${++tabSequence}`;
  const view = document.createElement("webview");
  view.className = "view";
  view.dataset.tabId = id;
  view.setAttribute("preload", preloadUrl);
  view.setAttribute("webpreferences", "contextIsolation=yes, sandbox=yes");
  view.src = targetUrl;

  const tab = { id, url: targetUrl, title, pinned, view, button: null };
  tab.button = createTabButton(tab, !pinned);
  tabs.set(id, tab);
  tabList.append(tab.button);
  views.append(view);

  view.addEventListener("did-navigate", (event) => {
    tab.url = event.url;
    updateNavigation();
  });
  view.addEventListener("did-navigate-in-page", (event) => {
    tab.url = event.url;
    updateNavigation();
  });
  view.addEventListener("page-title-updated", (event) => {
    if (tab.title === "新标签页" || tab.title === "豌豆AI") {
      tab.title = event.title || tab.title;
      tab.button.querySelector(".tab-label").textContent = tab.title;
    }
  });
  view.addEventListener("did-start-loading", () => tab.button.classList.add("loading"));
  view.addEventListener("did-stop-loading", () => {
    tab.button.classList.remove("loading");
    syncThemeFromActivePage();
  });
  view.addEventListener("did-fail-load", () => tab.button.classList.remove("loading"));

  activateTab(id);
  return tab;
}

function activateTab(id) {
  if (!tabs.has(id)) return;
  activeId = id;
  for (const tab of tabs.values()) {
    const active = tab.id === id;
    tab.button.classList.toggle("active", active);
    tab.button.setAttribute("aria-selected", String(active));
    tab.view.classList.toggle("active", active);
  }
  const tab = tabs.get(id);
  tab.button.scrollIntoView({ block: "nearest", inline: "nearest" });
  brandText.textContent = "首页";
  brandButton.title = "返回首页";
  brandButton.classList.toggle("active", tab.pinned);
  brandButton.setAttribute("aria-current", tab.pinned ? "page" : "false");
  updateNavigation();
  syncThemeFromActivePage();
}

function isNodeCanvasTab(tab) {
  try { return new URL(tab?.url || "").pathname.toLowerCase().endsWith("/ai-node-canvas.html"); }
  catch (_error) { return false; }
}

async function saveTabBeforeClose(tab) {
  const base = { tabId: tab?.id || "", tabTitle: tab?.title || "未命名标签" };
  if (!tab?.view) return { ...base, success: true, supported: false };
  if (tab.view.isLoading?.()) {
    return isNodeCanvasTab(tab)
      ? { ...base, success: false, supported: true, error: "页面仍在加载，尚未保存" }
      : { ...base, success: true, supported: false };
  }
  try {
    const saveTask = tab.view.executeJavaScript(`(async () => {
      if (typeof window.wandouSaveBeforeClose === "function") {
        const result = await window.wandouSaveBeforeClose();
        if (result && typeof result === "object") return { supported: true, ...result };
        return { supported: true, success: result === true };
      }
      return { supported: false, success: true };
    })()`, true).catch((error) => ({
      supported: isNodeCanvasTab(tab),
      success: !isNodeCanvasTab(tab),
      error: error?.message || "保存调用失败"
    }));
    let timeoutId = null;
    const timeout = new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve({
        supported: isNodeCanvasTab(tab),
        success: !isNodeCanvasTab(tab),
        error: "保存超过 120 秒，已停止关闭或更新"
      }), 120000);
    });
    const result = await Promise.race([saveTask, timeout]);
    clearTimeout(timeoutId);
    return { ...base, ...result };
  } catch (error) {
    return {
      ...base,
      supported: isNodeCanvasTab(tab),
      success: !isNodeCanvasTab(tab),
      error: error?.message || "保存调用失败"
    };
  }
}

async function saveAllOpenWorkflows() {
  const results = [];
  for (const tab of tabs.values()) {
    results.push(await saveTabBeforeClose(tab));
  }
  const failures = results.filter((result) => result.supported && !result.success);
  const saved = results.filter((result) => result.supported && result.success);
  return {
    success: failures.length === 0,
    results,
    failures,
    saved,
    backupPath: saved.find((result) => result.backupPath)?.backupPath || canvasBackupDirectory
  };
}

async function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab || tab.pinned) return;
  const saveResult = await saveTabBeforeClose(tab);
  if (saveResult.supported && !saveResult.success) {
    showToast(`${tab.title || "当前标签"}保存失败，标签没有关闭`, true);
    return;
  }
  const order = [...tabs.keys()];
  const index = order.indexOf(id);
  tab.view.remove();
  tab.button.remove();
  tabs.delete(id);
  if (activeId === id) activateTab(order[index - 1] || order[index + 1] || [...tabs.keys()][0]);
}

function activeView() { return tabs.get(activeId)?.view || null; }

function safeWebviewCall(view, method, fallback = false) {
  try { return view && typeof view[method] === "function" ? view[method]() : fallback; }
  catch (_error) { return fallback; }
}

function updateNavigation() {
  const view = activeView();
  backButton.disabled = !safeWebviewCall(view, "canGoBack");
  forwardButton.disabled = !safeWebviewCall(view, "canGoForward");
}

async function syncThemeFromActivePage() {
  const view = activeView();
  if (!view || safeWebviewCall(view, "isLoading", true)) return;
  try {
    const theme = await view.executeJavaScript(`(() => {
      const saved = localStorage.getItem("ai-tools-theme") || localStorage.getItem("wd-theme");
      if (saved === "dark" || saved === "light") return saved;
      const root = document.documentElement;
      const body = document.body;
      return root.dataset.theme === "dark" || root.classList.contains("dark") || body?.classList.contains("dark-theme") ? "dark" : "light";
    })()`, true);
    const safeTheme = theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = safeTheme;
    window.wandouShell?.setTheme(safeTheme);
  } catch (_error) {
    // 页面加载完成后的下一轮会继续同步。
  }
}

async function openAnnouncement() {
  const homeTab = [...tabs.values()].find((tab) => tab.pinned);
  if (!homeTab) return;
  activateTab(homeTab.id);
  try {
    const opened = await homeTab.view.executeJavaScript(`(() => {
      const items = [...document.querySelectorAll("button, a")];
      const target = items.find((item) => (item.textContent || "").trim().includes("公告"));
      if (target) { target.click(); return true; }
      return false;
    })()`, true);
    if (opened && clientConfig.announcementVersion) {
      localStorage.setItem("wandou-announcement-seen", clientConfig.announcementVersion);
      noticeButton.classList.remove("has-unread");
      noticeDot.hidden = true;
    }
  } catch (_error) {
    showToast("请在首页打开公告");
  }
}

function showUpdateDialog() {
  if (!updateInfo?.available || updateStarted) return;
  dialogVersion.textContent = `当前 ${updateInfo.currentVersion} · 最新 ${updateInfo.latestVersion}`;
  const location = canvasBackupDirectory ? `\n\n工作流备份位置：\n${canvasBackupDirectory}` : "";
  dialogNotes.textContent = `${updateInfo.notes || "新版本已经准备好。"}\n\n更新前会强制保存并校验当前工作流，保存失败时不会更新。${location}`;
  dialogOverlay.hidden = false;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function refreshUpdateInfo({ retries = 0 } = {}) {
  let result = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      result = await window.wandouShell?.checkForUpdates();
    } catch (error) {
      result = { available: false, error: error.message || "检查更新失败" };
    }
    if (!result?.error || attempt === retries) break;
    await wait(1500 * (attempt + 1));
  }
  updateInfo = result;
  updateBadge.hidden = !updateInfo?.available;
  return updateInfo;
}

async function checkForUpdatesManually() {
  if (updateStarted) return;
  versionText.disabled = true;
  showToast("正在检查更新…");
  try {
    await refreshUpdateInfo({ retries: 2 });
    if (updateInfo?.available) showUpdateDialog();
    else if (updateInfo?.error) showToast(`暂时无法检查更新：${updateInfo.error}`, true);
    else showToast(`当前 v${version || updateInfo?.currentVersion || ""} 已是最新版本`);
  } finally {
    versionText.disabled = false;
  }
}

async function openFreshUpdateDialog() {
  if (updateStarted) return;
  versionText.disabled = true;
  showToast("正在检查更新…");
  try {
    await refreshUpdateInfo({ retries: 2 });
    if (updateInfo?.available) showUpdateDialog();
    else if (updateInfo?.error) showToast(`暂时无法检查更新：${updateInfo.error}`, true);
    else showToast(`当前 v${version || updateInfo?.currentVersion || ""} 已是最新版本`);
  } finally {
    versionText.disabled = false;
  }
}

async function refreshClientState() {
  try {
    clientConfig = await window.wandouShell?.getClientConfig() || {};
    const seen = localStorage.getItem("wandou-announcement-seen");
    const unread = Boolean(clientConfig.announcementVersion && seen !== clientConfig.announcementVersion);
    noticeButton.classList.toggle("has-unread", unread);
    noticeDot.hidden = !unread;
  } catch (_error) {
    noticeButton.classList.remove("has-unread");
    noticeDot.hidden = true;
  }
  await refreshUpdateInfo();
}

async function initializeClientState() {
  try {
    const backupInfo = await window.wandouShell?.getCanvasBackupDirectory();
    canvasBackupDirectory = backupInfo?.directory || "";
  } catch (_error) {
    canvasBackupDirectory = "";
  }
  await refreshClientState();
  if (updateInfo?.error) await refreshUpdateInfo({ retries: 2 });
  if (updateInfo?.available) showUpdateDialog();
}

function showCloseDialog() {
  closeInProgress = false;
  closeDialogStatus.textContent = "关闭前会强制保存并校验所有已打开的节点工作流；大画布可能需要 1–2 分钟。";
  closeDialogLocation.textContent = canvasBackupDirectory
    ? `工作流备份位置：\n${canvasBackupDirectory}`
    : "工作流保存在软件数据目录的 canvas-backups 文件夹中。";
  closeDialogCancel.disabled = false;
  closeDialogConfirm.disabled = false;
  closeDialogConfirm.textContent = "保存并关闭";
  closeDialogOverlay.hidden = false;
}

async function saveAllAndClose() {
  if (closeInProgress) return;
  closeInProgress = true;
  closeDialogCancel.disabled = true;
  closeDialogConfirm.disabled = true;
  closeDialogConfirm.textContent = "正在保存…";
  closeDialogStatus.textContent = "正在逐个保存并核对已打开的节点工作流，大画布可能需要 1–2 分钟，请稍候…";
  const saveReport = await saveAllOpenWorkflows();
  if (!saveReport.success) {
    const failedNames = saveReport.failures.map((item) => item.tabTitle).join("、") || "当前工作流";
    closeInProgress = false;
    closeDialogCancel.disabled = false;
    closeDialogConfirm.disabled = false;
    closeDialogConfirm.textContent = "重新保存";
    closeDialogStatus.textContent = `保存校验失败：${failedNames}。软件没有关闭，请检查页面后重试。`;
    showToast("工作流没有保存成功，已停止关闭", true);
    return;
  }
  closeDialogStatus.textContent = `已验证保存 ${saveReport.saved.length} 个工作流，正在关闭软件…`;
  if (saveReport.backupPath) closeDialogLocation.textContent = `本次备份：\n${saveReport.backupPath}`;
  closeDialogConfirm.textContent = "正在关闭…";
  const closed = await window.wandouShell?.confirmClose({
    saveVerified: true,
    verifiedAt: Date.now(),
    savedWorkflowCount: saveReport.saved.length
  });
  if (!closed) {
    closeInProgress = false;
    closeDialogCancel.disabled = false;
    closeDialogConfirm.disabled = false;
    closeDialogConfirm.textContent = "重新保存";
    closeDialogStatus.textContent = "关闭前保存凭证已失效，请重新保存。";
  }
}

brandButton.addEventListener("click", () => {
  const homeTab = [...tabs.values()].find((tab) => tab.pinned);
  if (homeTab) activateTab(homeTab.id);
});
backButton.addEventListener("click", () => {
  const view = activeView();
  if (safeWebviewCall(view, "canGoBack")) view.goBack();
});
forwardButton.addEventListener("click", () => {
  const view = activeView();
  if (safeWebviewCall(view, "canGoForward")) view.goForward();
});
noticeButton.addEventListener("click", openAnnouncement);
updateBadge.addEventListener("click", openFreshUpdateDialog);
versionText.addEventListener("click", checkForUpdatesManually);
dialogCancel.addEventListener("click", () => { dialogOverlay.hidden = true; });
dialogDownload.addEventListener("click", async () => {
  if (!updateInfo?.available || updateStarted) return;
  updateStarted = true;
  document.body.classList.add("update-in-progress");
  dialogCancel.disabled = true;
  dialogDownload.disabled = true;
  dialogDownload.textContent = "正在保存…";
  dialogNotes.textContent = "正在强制保存并校验本地项目和生成记录，请不要关闭软件。";
  const saveReport = await saveAllOpenWorkflows();
  if (!saveReport.success) {
    const failedNames = saveReport.failures.map((item) => item.tabTitle).join("、") || "当前工作流";
    updateStarted = false;
    document.body.classList.remove("update-in-progress");
    dialogCancel.disabled = false;
    dialogDownload.disabled = false;
    dialogDownload.textContent = "重新保存并更新";
    dialogNotes.textContent = `工作流保存校验失败：${failedNames}。\n更新已经停止，旧版本和原数据均未覆盖。`;
    showToast("保存失败，已停止更新", true);
    return;
  }
  dialogDownload.textContent = "正在下载…";
  const savedLocation = saveReport.backupPath || canvasBackupDirectory;
  dialogNotes.textContent = `已验证保存 ${saveReport.saved.length} 个工作流。${savedLocation ? `\n备份位置：${savedLocation}` : ""}\n\n正在从 GitHub 安全下载新版本，请不要关闭软件。`;
  const result = await window.wandouShell?.startUpdate({
    ...updateInfo,
    saveVerified: true,
    saveVerifiedAt: Date.now(),
    savedWorkflowCount: saveReport.saved.length
  });
  if (!result?.started) {
    updateStarted = false;
    document.body.classList.remove("update-in-progress");
    dialogCancel.disabled = false;
    dialogDownload.disabled = false;
    dialogDownload.textContent = "重新更新";
    dialogNotes.textContent = result?.error || "更新失败，请稍后重试。";
  }
});
dialogOverlay.addEventListener("click", (event) => {
  if (!updateStarted && event.target === dialogOverlay) dialogOverlay.hidden = true;
});
closeDialogCancel.addEventListener("click", () => {
  if (closeInProgress) return;
  closeDialogOverlay.hidden = true;
  window.wandouShell?.cancelClose();
});
closeDialogConfirm.addEventListener("click", saveAllAndClose);

window.wandouShell?.onOpenTab((payload) => openTab(payload));
window.wandouShell?.onCloseRequested(showCloseDialog);
window.wandouShell?.markReady();
window.wandouShell?.onDownloadResult((payload) => {
  const name = payload?.filename ? `：${payload.filename}` : "";
  showToast(payload?.success ? `下载完成${name}` : `下载失败${name}`, !payload?.success);
});
window.wandouShell?.onUpdateStatus((payload) => {
  dialogNotes.textContent = payload?.message || "正在更新…";
  if (payload?.state === "ready") dialogDownload.textContent = "准备安装…";
  if (payload?.state === "error") {
    updateStarted = false;
    document.body.classList.remove("update-in-progress");
    dialogCancel.disabled = false;
    dialogDownload.disabled = false;
    dialogDownload.textContent = "重新更新";
  }
});

openTab({ url: homeUrl, title: "首页", pinned: true });
initializeClientState();
setInterval(refreshUpdateInfo, 30 * 60 * 1000);
window.addEventListener("online", () => refreshUpdateInfo({ retries: 1 }));
setInterval(syncThemeFromActivePage, 1000);
