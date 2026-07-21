const { app, BrowserWindow, ipcMain, Menu, shell, net, session } = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { pathToFileURL, fileURLToPath } = require("url");

const APP_NAME = "豌豆AI工具";
const TRUSTED_WEB_APPS = new Set(["wandou-video-workbench.netlify.app"]);

let mainWindow = null;
let allowWindowClose = false;
let closePromptPending = false;
let downloadListenerReady = false;
let updateInProgress = false;

// 与旧安装版共用数据目录，改成便携文件夹后用户原有的本地数据仍然可用。
app.setPath("userData", process.env.WANDOU_TEST_USER_DATA_DIR || path.join(app.getPath("appData"), "豌豆AI"));

function readClientConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "client-config.json"), "utf8"));
  } catch (_error) {
    return {};
  }
}

function compareVersions(left, right) {
  const a = String(left || "0").split(".").map((part) => Number(part) || 0);
  const b = String(right || "0").split(".").map((part) => Number(part) || 0);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if ((a[index] || 0) > (b[index] || 0)) return 1;
    if ((a[index] || 0) < (b[index] || 0)) return -1;
  }
  return 0;
}

function isSafeHttpsUrl(value) {
  try { return new URL(value).protocol === "https:"; } catch (_error) { return false; }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await net.fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeUpdateInfo(release, currentVersion, assetName, checksumAssetName) {
  const latestVersion = String(release.tag_name || release.version || "").trim().replace(/^v/i, "");
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const packageAsset = assets.find((asset) => asset?.name === assetName);
  const checksumAsset = assets.find((asset) => asset?.name === checksumAssetName);
  const downloadUrl = String(packageAsset?.browser_download_url || release.downloadUrl || "").trim();
  const checksumUrl = String(checksumAsset?.browser_download_url || release.checksumUrl || "").trim();
  if (!latestVersion || !isSafeHttpsUrl(downloadUrl) || !isSafeHttpsUrl(checksumUrl)) {
    throw new Error("最新发布缺少版本号、更新包或 SHA256 校验文件");
  }
  return {
    available: compareVersions(latestVersion, currentVersion) > 0,
    configured: true,
    currentVersion,
    latestVersion,
    downloadUrl,
    checksumUrl,
    packageApiUrl: String(packageAsset?.url || "").trim(),
    checksumApiUrl: String(checksumAsset?.url || "").trim(),
    assetName,
    error: "",
    notes: String(release.body || release.notes || "新版本已经准备好，建议更新后继续使用。")
  };
}

async function checkForUpdates() {
  const currentVersion = app.getVersion();
  const config = readClientConfig();
  const owner = String(config.githubOwner || "").trim();
  const repository = String(config.githubRepository || "").trim();
  const assetName = String(config.assetName || "").trim();
  const checksumAssetName = String(config.checksumAssetName || `${assetName}.sha256`).trim();
  if (!owner || !repository || !assetName) return { available: false, configured: false, currentVersion };
  const encodedOwner = encodeURIComponent(owner);
  const encodedRepository = encodeURIComponent(repository);
  const headers = { "User-Agent": "WandouAI-Desktop-Updater", Accept: "application/vnd.github+json" };
  const checks = [
    async () => {
      const response = await fetchWithTimeout(`https://api.github.com/repos/${encodedOwner}/${encodedRepository}/releases/latest?timestamp=${Date.now()}`, { cache: "no-store", headers: { ...headers, "X-GitHub-Api-Version": "2022-11-28" } });
      if (!response.ok) throw new Error(`GitHub API HTTP ${response.status}`);
      return normalizeUpdateInfo(await response.json(), currentVersion, assetName, checksumAssetName);
    },
    async () => {
      const response = await fetchWithTimeout(`https://github.com/${encodedOwner}/${encodedRepository}/releases/latest/download/update-manifest.json?timestamp=${Date.now()}`, { cache: "no-store", redirect: "follow", headers });
      if (!response.ok) throw new Error(`版本清单 HTTP ${response.status}`);
      return normalizeUpdateInfo(await response.json(), currentVersion, assetName, checksumAssetName);
    },
    async () => {
      const response = await fetchWithTimeout(`https://github.com/${encodedOwner}/${encodedRepository}/releases/latest`, { cache: "no-store", redirect: "follow", headers });
      if (!response.ok) throw new Error(`发布页 HTTP ${response.status}`);
      const match = response.url.match(/\/releases\/tag\/v?([^/?#]+)/i);
      if (!match) throw new Error("发布页没有返回版本号");
      const latestVersion = decodeURIComponent(match[1]);
      const base = `https://github.com/${encodedOwner}/${encodedRepository}/releases/download/v${latestVersion}`;
      return normalizeUpdateInfo({ version: latestVersion, downloadUrl: `${base}/${encodeURIComponent(assetName)}`, checksumUrl: `${base}/${encodeURIComponent(checksumAssetName)}` }, currentVersion, assetName, checksumAssetName);
    }
  ];
  const errors = [];
  for (const check of checks) {
    try {
      return await check();
    } catch (error) {
      errors.push(error?.message || String(error));
    }
  }
  return { available: false, configured: true, currentVersion, error: `三路更新检测均失败：${errors.join("；")}` };
}

async function downloadFile(url, destination) {
  const response = await net.fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": "WandouAI-Desktop-Updater" }
  });
  if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.promises.writeFile(destination, buffer);
}

async function downloadFileWithFallback(url, destination, fallbackUrl = "") {
  const sources = [...new Set([url, fallbackUrl].filter(isSafeHttpsUrl))];
  let lastError = new Error("Update download failed");
  for (const source of sources) {
    try {
      return await check();
    } catch (error) {
      errors.push(error?.message || String(error));
    }
  }
  return { available: false, configured: true, currentVersion, error: `三路更新检测均失败：${errors.join("；")}` };
}

async function downloadFile(url, destination) {
  const response = await net.fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": "WandouAI-Desktop-Updater" }
  });
  if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.promises.writeFile(destination, buffer);
}

async function downloadFileWithFallback(url, destination, fallbackUrl = "") {
  const sources = [...new Set([url, fallbackUrl].filter(isSafeHttpsUrl))];
  let lastError = new Error("Update download failed");
  for (const source of sources) {
    try {
      const response = await net.fetch(source, {
        cache: "no-store",
        redirect: "follow",
        headers: {
          Accept: "application/octet-stream, application/vnd.github+json;q=0.9, */*;q=0.8",
          "User-Agent": "WandouAI-Desktop-Updater"
        }
      });
      if (!response.ok) {
        lastError = new Error(`Update download failed: HTTP ${response.status}`);
        continue;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length) {
        lastError = new Error("Update download failed: empty file");
        continue;
      }
      await fs.promises.writeFile(destination, buffer);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function sendUpdateStatus(message, state = "working") {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("desktop:update-status", { message, state });
}

async function startPortableUpdate(updateInfo) {
  if (updateInProgress) return { started: false, error: "更新正在进行中" };
  if (!app.isPackaged) return { started: false, error: "开发模式不执行覆盖更新" };
  if (!updateInfo?.available || !isSafeHttpsUrl(updateInfo.downloadUrl) || !isSafeHttpsUrl(updateInfo.checksumUrl)) {
    return { started: false, error: "没有可安装的新版本" };
  }

  updateInProgress = true;
  try {
    const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wandou-ai-update-"));
    const packagePath = path.join(workDir, updateInfo.assetName || "wandou-ai-tools-windows-x64.zip");
    const checksumPath = `${packagePath}.sha256`;
    sendUpdateStatus("正在下载新版本…");
    await downloadFileWithFallback(updateInfo.downloadUrl, packagePath, updateInfo.packageApiUrl);
    sendUpdateStatus("正在校验更新文件…");
    await downloadFileWithFallback(updateInfo.checksumUrl, checksumPath, updateInfo.checksumApiUrl);

    const checksumText = await fs.promises.readFile(checksumPath, "utf8");
    const expected = checksumText.match(/[a-fA-F0-9]{64}/)?.[0]?.toLowerCase();
    const actual = crypto.createHash("sha256").update(await fs.promises.readFile(packagePath)).digest("hex");
    if (!expected || actual !== expected) throw new Error("更新文件校验失败，已停止安装");

    const sourceUpdater = path.join(process.resourcesPath, "portable-updater.exe");
    const updaterPath = path.join(workDir, "portable-updater.exe");
    const readyPath = path.join(workDir, "updater-ready.txt");
    await fs.promises.copyFile(sourceUpdater, updaterPath);
    sendUpdateStatus("下载完成，正在启动安装程序…", "ready");

    const args = [
      "--install", path.dirname(process.execPath),
      "--package", packagePath,
      "--parent", String(process.pid),
      "--exe", path.basename(process.execPath),
      "--ready", readyPath,
      "--target", String(updateInfo.latestVersion || "")
    ];
    const child = spawn(updaterPath, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });

    await new Promise((resolve, reject) => {
      const startedAt = Date.now();
      let settled = false;
      let timer = null;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearInterval(timer);
        child.removeAllListeners("error");
        child.removeAllListeners("exit");
        if (error) reject(error);
        else resolve();
      };
      child.once("error", (error) => finish(new Error(`无法启动更新程序：${error.message}`)));
      child.once("exit", (code) => {
        if (!fs.existsSync(readyPath)) finish(new Error(`更新程序提前退出（代码 ${code ?? "未知"}），软件不会关闭`));
      });
      timer = setInterval(() => {
        if (fs.existsSync(readyPath)) return finish();
        if (Date.now() - startedAt > 15000) finish(new Error("更新程序 15 秒内没有成功接管，软件不会关闭，请重试"));
      }, 120);
    });

    child.unref();
    allowWindowClose = true;
    setTimeout(() => app.quit(), 900);
    return { started: true };
  } catch (error) {
    updateInProgress = false;
    sendUpdateStatus(error.message || "更新失败", "error");
    return { started: false, error: error.message || "更新失败" };
  }
}

function getAppRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, "app") : path.resolve(__dirname, "..", "app");
}
function getAppEntryUrl() { return pathToFileURL(path.join(getAppRoot(), "index.html")).href; }
function getIconPath() {
  const ico = path.join(getAppRoot(), "logo.ico");
  return fs.existsSync(ico) ? ico : path.join(getAppRoot(), "logo.png");
}

function isInternalUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === "file:") {
      const root = path.resolve(getAppRoot()).toLowerCase();
      const target = path.resolve(fileURLToPath(parsed)).toLowerCase();
      return target === root || target.startsWith(`${root}${path.sep}`);
    }
    return parsed.protocol === "https:" && TRUSTED_WEB_APPS.has(parsed.hostname);
  } catch (_error) { return false; }
}

function titleForUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.hostname === "wandou-video-workbench.netlify.app") return "录音视频转文字";
    if (parsed.hostname === "www.zayapi.top" || parsed.hostname === "zayapi.top") return "商品中心";
    const names = {
      "index.html": "首页",
      "project-hub.html": "项目文件夹",
      "ai-node-canvas.html": "节点画布",
      "upscale-4k.html": "图片放大4K",
      "png-workflow.html": "抠图PNG工作流",
      "watermark-remove.html": "AI消除水印",
      "keyword-reverse.html": "关键词生成",
      "plain-to-pro.html": "白话转专业语言",
      "video-prompt-pro.html": "视频提示词",
      "prompt-mind-map.html": "文案转 XMind 思维导图"
    };
    return names[path.basename(parsed.pathname).toLowerCase()] || APP_NAME;
  } catch (_error) { return APP_NAME; }
}

function sendTab(url, title) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("shell:open-tab", { url, title: title || titleForUrl(url) });
}

function configureWebContents(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (isInternalUrl(url)) sendTab(url, titleForUrl(url));
    else if (isSafeHttpsUrl(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (isInternalUrl(url)) return;
    event.preventDefault();
    if (isSafeHttpsUrl(url)) shell.openExternal(url);
  });
}

function configureDownloads() {
  if (downloadListenerReady) return;
  downloadListenerReady = true;
  session.defaultSession.on("will-download", (_event, item) => {
    item.once("done", (_doneEvent, state) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send("desktop:download-result", {
        success: state === "completed",
        filename: item.getFilename()
      });
    });
  });
}

function createWindow() {
  allowWindowClose = false;
  closePromptPending = false;
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 930,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: "#ffffff",
    title: APP_NAME,
    icon: getIconPath(),
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#ffffff", symbolColor: "#203128", height: 48 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      sandbox: false
    }
  });

  Menu.setApplicationMenu(null);
  configureWebContents(mainWindow.webContents);
  configureDownloads();
  mainWindow.webContents.on("did-attach-webview", (_event, contents) => configureWebContents(contents));

  mainWindow.on("close", (event) => {
    if (allowWindowClose) return;
    event.preventDefault();
    if (updateInProgress) {
      mainWindow.focus();
      return;
    }
    if (!closePromptPending) {
      closePromptPending = true;
      mainWindow.webContents.send("desktop:request-close");
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    allowWindowClose = false;
    closePromptPending = false;
  });

  mainWindow.loadFile(path.join(__dirname, "shell.html"), {
    query: { home: getAppEntryUrl(), version: app.getVersion() }
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
}

ipcMain.on("desktop:open-tab", (_event, payload = {}) => {
  if (isInternalUrl(payload.url)) {
    sendTab(payload.url, payload.title || titleForUrl(payload.url));
    return;
  }
  if (isSafeHttpsUrl(payload.url)) shell.openExternal(payload.url);
});
ipcMain.on("desktop:set-theme", (_event, theme) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const dark = theme === "dark";
  mainWindow.setTitleBarOverlay({ color: dark ? "#0c0e0d" : "#ffffff", symbolColor: dark ? "#eef6f0" : "#203128", height: 48 });
});
ipcMain.on("desktop:cancel-close", () => { closePromptPending = false; });
ipcMain.handle("desktop:confirm-close", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  allowWindowClose = true;
  closePromptPending = false;
  mainWindow.close();
  return true;
});
ipcMain.handle("desktop:get-client-config", () => ({ ...readClientConfig(), version: app.getVersion(), name: APP_NAME }));
ipcMain.handle("desktop:check-for-updates", () => checkForUpdates());
ipcMain.handle("desktop:start-update", (_event, updateInfo) => startPortableUpdate(updateInfo));
ipcMain.handle("desktop:open-external", (_event, url) => {
  if (!isSafeHttpsUrl(url)) return false;
  shell.openExternal(url);
  return true;
});
ipcMain.handle("desktop:get-save-directory", () => {
  const directory = readSavedDirectory();
  return { directory, name: directory ? path.basename(directory) : "" };
});
ipcMain.handle("desktop:choose-save-directory", async () => {
  const current = readSavedDirectory();
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择生成文件保存位置",
    defaultPath: current || app.getPath("pictures"),
    properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const directory = result.filePaths[0];
  storeSavedDirectory(directory);
  return { canceled: false, directory, name: path.basename(directory) };
});
ipcMain.handle("desktop:write-save-file", async (_event, payload = {}) => {
  const directory = readSavedDirectory();
  if (!directory) return { success: false, missingDirectory: true };
  try {
    const destination = uniqueOutputPath(directory, payload.filename);
    await fs.promises.writeFile(destination, Buffer.from(payload.bytes || []));
    return { success: true, path: destination, filename: path.basename(destination) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
