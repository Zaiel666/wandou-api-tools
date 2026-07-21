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
const reloadButton = $("reloadButton");
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

function saveTabBeforeClose(tab) {
  if (!tab?.view || tab.view.isLoading?.()) return Promise.resolve(false);
  try {
    const saveTask = tab.view.executeJavaScript(`(async () => {
      if (typeof window.wandouSaveBeforeClose === "function") {
        await window.wandouSaveBeforeClose();
        return true;
      }
      return false;
    })()`, true).catch(() => false);
    const timeout = new Promise((resolve) => setTimeout(() => resolve(false), 20000));
    return Promise.race([saveTask, timeout]);
  } catch (_error) {
    return Promise.resolve(false);
  }
}

async function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab || tab.pinned) return;
  await saveTabBeforeClose(tab);
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
  dialogNotes.textContent = updateInfo.notes || "新版本已经准备好。";
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

function saveTabBeforeClose(tab) {
  if (!tab?.view || tab.view.isLoading?.()) return Promise.resolve(false);
  try {
    const saveTask = tab.view.executeJavaScript(`(async () => {
      if (typeof window.wandouSaveBeforeClose === "function") {
        await window.wandouSaveBeforeClose();
        return true;
      }
      return false;
    })()`, true).catch(() => false);
    const timeout = new Promise((resolve) => setTimeout(() => resolve(false), 4000));
    return Promise.race([saveTask, timeout]);
  } catch (_error) {
    return Promise.resolve(false);
  }
}

async function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab || tab.pinned) return;
  await saveTabBeforeClose(tab);
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
  dialogNotes.textContent = updateInfo.notes || "新版本已经准备好。";
  dialogOverlay.hidden = false;
}

async function refreshUpdateInfo() {
  try {
    updateInfo = await window.wandouShell?.checkForUpdates();
    updateBadge.hidden = !updateInfo?.available;
  } catch (error) {
    console.warn("Update check failed", error);
    updateInfo = null;
    updateBadge.hidden = true;
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
  updateBadge.disabled = true;
  try {
    await refreshUpdateInfo();
    showUpdateDialog();
  } finally {
    updateBadge.disabled = false;
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
  await refreshClientState();
  if (updateInfo?.available) showUpdateDialog();
}

function showCloseDialog() {
  closeInProgress = false;
  closeDialogStatus.textContent = "关闭前会自动保存所有已打开的节点工作流。";
  closeDialogCancel.disabled = false;
  closeDialogConfirm.disabled = false;
  closeDialogConfirm.textContent = "保存并关闭";
  closeDialogOverlay.hidden = false;
}

function showCloseDialog() {
  closeInProgress = false;
  closeDialogStatus.textContent = "关闭前会自动保存所有已打开的节点工作流。";
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
  closeDialogStatus.textContent = "正在保存所有已打开的节点工作流，请稍候…";
  await Promise.all([...tabs.values()].map(saveTabBeforeClose));
  closeDialogStatus.textContent = "保存完成，正在关闭软件…";
  closeDialogConfirm.textContent = "正在关闭…";
  await window.wandouShell?.confirmClose();
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
reloadButton.addEventListener("click", () => activeView()?.reload?.());
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
  dialogNotes.textContent = "正在保存本地项目和生成记录，请不要关闭软件。";
  await Promise.all([...tabs.values()].map(saveTabBeforeClose));
  dialogDownload.textContent = "正在下载…";
  dialogNotes.textContent = "正在从 GitHub 安全下载新版本，请不要关闭软件。";
  const result = await window.wandouShell?.startUpdate(updateInfo);
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
setInterval(syncThemeFromActivePage, 1000);
