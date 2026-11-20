const { app, BrowserWindow, ipcMain, Menu, shell, net, session, dialog, clipboard, nativeImage, protocol, webContents } = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { pathToFileURL, fileURLToPath } = require("url");
const canvasMediaProtocol = require('./canvas-media-protocol.cjs')({ directory: canvasMediaRootDirectory });
protocol.registerSchemesAsPrivileged([{ scheme: 'wandou-media', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
app.on('will-quit', () => { canvasMediaProtocol.dispose(); canvasStandardMedia.dispose(); });
require('./director-ipc.cjs')({app, ipcMain, getAppRoot});

const APP_NAME = "豌豆AI工具";
const PORTABLE_RUNTIME_DIRECTORY = "程序文件";
const TRUSTED_WEB_APPS = new Set(["wandou-video-workbench.netlify.app"]);
const CANVAS_API_HOSTS = new Set([
  "zayapi.top",
  "www.zayapi.top",
  "zexitongxue.com",
  "www.zexitongxue.com",
  "api.openai.com"
]);
const MAX_DESKTOP_API_RESPONSE_BYTES = 32 * 1024 * 1024;
const MAX_SKILL_INSTRUCTIONS_BYTES = 256 * 1024;
const MAX_CLIPBOARD_IMAGE_BYTES = 64 * 1024 * 1024;

let mainWindow = null;
let allowWindowClose = false;
let closePromptPending = false;
let shellReady = false;
let closeCoordinator = null;
let shutdownFinishing = false;
const { createCloseCoordinator, withTimeout: withCloseTimeout } = require('./close-coordinator.cjs');
let downloadListenerReady = false;
const activeDesktopExports = new Set();
async function trackDesktopExport(task) {
  if (updateInProgress || storageMigrationPreparing || storageOutageHandling) {
    return { success: false, error: '正在更新、迁移或恢复数据，请完成后再导出文件' };
  }
  const token = {};
  activeDesktopExports.add(token);
  try { return await task(); }
  finally { activeDesktopExports.delete(token); }
}
let updateInProgress = false;
let applicationSession = null;
let browserSessionInfo = null;
let applicationStorageReady = false;
let applicationStorageStarting = true;
function getApplicationSession() {
  if (!applicationSession) throw new Error('项目浏览器存储尚未准备好，请等待初始化完成');
  return applicationSession;
}
let installedSkillsCache = { savedAt: 0, items: [] };
const ipcPolicy = require('./ipc-policy.cjs')({ appRoot: getAppRoot, shellFile: path.join(__dirname, 'shell.html'), shellContents: () => mainWindow?.webContents });
const handleDesktop = (channel, handler) => ipcPolicy.handle(ipcMain, channel, handler);
const onDesktop = (channel, handler) => ipcPolicy.on(ipcMain, channel, handler);

// Keep small main-process preferences in the existing profile. Browser-stored
// API settings and workbench data use the verified project browser-session.
app.setPath("userData", process.env.WANDOU_TEST_USER_DATA_DIR || path.join(app.getPath("appData"), "豌豆AI"));
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.exit(0);
app.on('second-instance', () => { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); } });
let storageMigrationPreparing = false;
let storageOutageHandling = false;
let storageProgressWindow = null;
const storageMediaTokens = new Map();
function reportProjectStorageProgress(state) {
  for (const contents of webContents.getAllWebContents()) {
    if (!contents.isDestroyed() && isTrustedThemePage(contents.getURL())) { try{contents.send('desktop:project-storage-progress',state);}catch(_error){/* A tab can close while progress is broadcast. */} }
  }
  if (storageProgressWindow && !storageProgressWindow.isDestroyed()) {
    const text = state.message + (state.totalBytes ? `\n${Math.round((state.completedBytes || 0)/1048576)} / ${Math.round(state.totalBytes/1048576)} MB` : '');
    storageProgressWindow.webContents.executeJavaScript(`document.querySelector('p').textContent=${JSON.stringify(text)}`).catch(()=>{});
  }
}
const projectInstallRoot = process.env.WANDOU_TEST_USER_DATA_DIR
  ? `${app.getPath('userData')}-portable-program`
  : (app.isPackaged ? portableInstallContext().installDirectory : path.dirname(__dirname));
if (process.env.WANDOU_TEST_USER_DATA_DIR) fs.mkdirSync(projectInstallRoot, { recursive: true });
const projectStorage = require('./project-storage.cjs')({
  legacyRoot: app.getPath('userData'), installRoot: projectInstallRoot,
  onProgress: reportProjectStorageProgress,
  isBrowserSessionActive: () => Boolean(applicationSession)
});
const browserSessionStorage = require('./browser-session-storage.cjs')({
  legacyProfileRoot: app.getPath('userData'),
  projectRoot: () => projectStorage.root(),
  assertInactive: async () => {
    if (!primaryInstance || !app.hasSingleInstanceLock() || applicationSession || mainWindow) throw new Error('浏览器存储正在使用，不能迁移或覆盖');
    return true;
  },
  onProgress: state => reportProjectStorageProgress({ phase: 'browser-session', message: '正在核对工作台与浏览器作品存储…', ...state })
});
const canvasMediaFiles = require('./canvas-media-files.cjs');
const canvasStandardMedia = require('./canvas-media-standard-store.cjs')({
  directory: canvasMediaRootDirectory,
  guardWrite: task => withProjectStorage('write', task),
  isBusy: () => Boolean(activeCanvasApiCount || storageMediaTokens.size || storageMigrationPreparing || updateInProgress)
});
const storageMaintenance = require('./storage-maintenance.cjs')({
  projectRoot: () => projectStorage.root(), profileRoot: () => app.getPath('userData'),
  sessionRoot: () => getApplicationSession().storagePath, session: getApplicationSession,
  isBusy: () => Boolean(activeCanvasApiCount || storageMediaTokens.size || storageMigrationPreparing || updateInProgress),
  confirmClear: async directory => {
    const result = await dialog.showMessageBox(mainWindow, { type:'question', title:'清理网络缓存', message:'仅清理可重新下载的浏览器网络缓存？', detail:`位置：${directory}\n项目、原图、备份、API 设置和工作台浏览器存储都会保留。缓存可由重新打开页面恢复。`, buttons:['取消','清理网络缓存'], defaultId:0, cancelId:0, noLink:true });
    return result.response === 1;
  }
});
async function withProjectStorage(kind, task) {
  try { return await projectStorage[kind](task); }
  catch (error) {
    const storageUnavailable=error.code==='PROJECT_STORAGE_UNAVAILABLE';
    if(storageUnavailable&&!storageOutageHandling)void handleProjectStorageOutage(error);
    return { success:false, error:error.message, storageUnavailable };
  }
}
async function handleProjectStorageOutage(error) {
  storageOutageHandling=true;
  if(mainWindow&&!mainWindow.isDestroyed())mainWindow.setEnabled(false);
  let message=error.message;
  while(true){
    const choice=await dialog.showMessageBox({type:'error',title:'项目数据盘已断开',message:'项目操作已暂停，原目录中的已保存数据不会被空画布覆盖。',detail:message+'\n重新启动会恢复最近成功保存的版本；当前尚未保存的编辑不会写入项目。',buttons:['重试连接并重新启动','退出'],defaultId:0,cancelId:1,noLink:true});
    if(choice.response!==0){allowWindowClose=true;app.quit();return;}
    try{await projectStorage.checkConnection();allowWindowClose=true;app.relaunch();app.quit();return;}
    catch(nextError){message=nextError.message;}
  }
}

let desktopThemeState = null;
function readDesktopTheme() {
  if (!desktopThemeState) {
    desktopThemeState = { theme: null, revision: 0 };
    try {
      const stored = JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "ui-theme.json"), "utf8"));
      if (stored.theme === "light" || stored.theme === "dark") {
        desktopThemeState = { theme: stored.theme, revision: Number.isSafeInteger(stored.revision) && stored.revision > 0 ? stored.revision : 1 };
      }
    } catch (_error) { /* An existing install seeds its old preference from a local page. */ }
  }
  return { ...desktopThemeState };
}

function isTrustedThemePage(url) {
  if (isLocalAppPage(url)) return true;
  try {
    return new URL(url).protocol === "file:"
      && path.resolve(fileURLToPath(url)).toLowerCase() === path.resolve(__dirname, "shell.html").toLowerCase();
  } catch (_error) { return false; }
}

function setDesktopTheme(theme) {
  if (theme !== "light" && theme !== "dark") return;
  const previous = readDesktopTheme();
  if (previous.theme === theme) return;
  desktopThemeState = { theme, revision: previous.revision + 1 };
  const file = path.join(app.getPath("userData"), "ui-theme.json");
  const temporary = `${file}.tmp`;
  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify(desktopThemeState), "utf8");
    fs.renameSync(temporary, file);
  } catch (error) {
    console.warn("Unable to persist the desktop theme:", error.message);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    const dark = theme === "dark";
    mainWindow.setBackgroundColor(dark ? "#101211" : "#ffffff");
    mainWindow.setTitleBarOverlay({ color: dark ? "#0c0e0d" : "#ffffff", symbolColor: dark ? "#eef6f0" : "#203128", height: 48 });
  }
  for (const contents of webContents.getAllWebContents()) {
    if (!contents.isDestroyed() && isTrustedThemePage(contents.getURL())) {
      try { contents.send("desktop:theme-changed", readDesktopTheme()); } catch (_error) { /* A guest may close while broadcasting. */ }
    }
  }
}

function portableInstallContext() {
  const executableDirectory = path.dirname(process.execPath);
  // v1.0.69 起，真正的 Electron 运行文件位于“程序文件”中，外层仅保留
  // 启动器、网页版入口和说明。更新器必须替换外层目录，否则只会更新内部
  // 目录并丢失外层启动器，也无法兼容从旧版升级。
  if (path.basename(executableDirectory).toLowerCase() === PORTABLE_RUNTIME_DIRECTORY.toLowerCase()) {
    return {
      installDirectory: path.dirname(executableDirectory),
      executable: `${APP_NAME}.exe`
    };
  }
  return {
    installDirectory: executableDirectory,
    executable: path.basename(process.execPath)
  };
}

async function hasProtectedPortableData(directory) {
  try {
    const stat = await fs.promises.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return true;
    const real = await fs.promises.realpath(directory);
    if (path.resolve(real).toLowerCase() !== path.resolve(directory).toLowerCase()) return true;
    const children = await fs.promises.readdir(directory, { withFileTypes: true });
    return children.some(entry => entry.isSymbolicLink()
      || ['豌豆AI数据', '.wandou-project-storage.json', '.wandou-migration-manifest.json',
        'canvas-media', 'canvas-backups', 'local-data', 'export-artifacts', 'project-hub-state.json'].includes(entry.name)
      || entry.name.startsWith('.wandou-project-migration-'));
  } catch (_error) { return true; }
}

async function cleanupStalePortableInstallBackups() {
  // Historical backups can contain user files. Preserve them until a separate,
  // reviewed cleanup operation can establish ownership and a recovery path.
}

async function cleanupStalePortableUpdateStages() {
  // Never guess ownership from an old directory name, age, or marker file.
  // Protocol 2 cleans only the private stage created by that updater process.
}

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

function isAllowedCanvasApiUrl(value, method = '') {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || !CANVAS_API_HOSTS.has(parsed.hostname.toLowerCase())) return false;
    if (parsed.hostname.toLowerCase() !== 'api.openai.com') return true;
    if (parsed.search || parsed.hash) return false;
    const route = parsed.pathname;
    if (route === '/v1/models') return !method || method === 'GET';
    return ['/v1/images/generations', '/v1/images/edits'].includes(route) && (!method || method === 'POST');
  } catch (_error) {
    return false;
  }
}

function isLocalAppPage(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "file:") return false;
    const root = path.resolve(getAppRoot()).toLowerCase();
    const target = path.resolve(fileURLToPath(parsed)).toLowerCase();
    return target === root || target.startsWith(`${root}${path.sep}`);
  } catch (_error) {
    return false;
  }
}

function apiRequestHeaders(input) {
  const allowed = new Set(["accept", "authorization", "content-type"]);
  const headers = {};
  if (!input || typeof input !== "object") return headers;
  for (const [name, value] of Object.entries(input)) {
    const normalized = String(name).toLowerCase();
    if (allowed.has(normalized) && typeof value === "string") headers[normalized] = value;
  }
  return headers;
}

function apiRequestBody(payload) {
  const body = payload?.body;
  if (!body) return undefined;
  if (body.kind === "text") return String(body.value || "");
  if (body.kind !== "form" || !Array.isArray(body.entries)) throw new Error("不支持的 API 请求内容");

  const form = new FormData();
  let totalBytes = 0;
  for (const entry of body.entries) {
    const name = String(entry?.name || "");
    if (!name) continue;
    if (entry.kind === "file") {
      const data = entry.data instanceof ArrayBuffer ? Buffer.from(entry.data) : Buffer.alloc(0);
      totalBytes += data.length;
      if (totalBytes > 64 * 1024 * 1024) throw new Error("上传图片总大小超过 64 MB");
      form.append(name, new Blob([data], { type: String(entry.type || "application/octet-stream") }), String(entry.filename || "image.png"));
    } else {
      form.append(name, String(entry?.value || ""));
    }
  }
  return form;
}

function saveDirectoryConfigPath() {
  return path.join(app.getPath("userData"), "save-directory.json");
}

function readSavedDirectory() {
  try {
    const value = JSON.parse(fs.readFileSync(saveDirectoryConfigPath(), "utf8"));
    const directory = String(value.directory || "").trim();
    return directory && fs.existsSync(directory) && fs.statSync(directory).isDirectory() ? directory : "";
  } catch (_error) {
    return "";
  }
}

function storeSavedDirectory(directory) {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(saveDirectoryConfigPath(), JSON.stringify({ directory }, null, 2), "utf8");
}

function safeOutputName(filename) {
  const cleaned = path.basename(String(filename || "output.bin")).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
  return cleaned || "output.bin";
}

function safeOutputFolderName(folderName) {
  const cleaned = path.basename(String(folderName || "")).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/^\.+$/, "").slice(0, 120);
  return cleaned || "";
}

function uniqueOutputPath(directory, filename) {
  const parsed = path.parse(safeOutputName(filename));
  let candidate = path.join(directory, `${parsed.name}${parsed.ext}`);
  for (let index = 2; fs.existsSync(candidate) && index < 1000; index += 1) {
    candidate = path.join(directory, `${parsed.name}-${index}${parsed.ext}`);
  }
  return candidate;
}

function safeCanvasBackupId(value, fallback) {
  const cleaned = String(value || "").replace(/[^0-9A-Za-z_-]/g, "_").slice(0, 100);
  return cleaned || fallback;
}

function canvasBackupRootDirectory() {
  return path.join(projectStorage.root(), "canvas-backups");
}

function canvasMediaRootDirectory() {
  return path.join(projectStorage.root(), "canvas-media");
}

function localDataRootDirectory() {
  return path.join(projectStorage.root(), "local-data");
}

function safeLocalDataPath(value) {
  const normalized = String(value || "").replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === ".." || !/^[0-9A-Za-z._-]{1,180}$/.test(part))) return "";
  const root = path.resolve(localDataRootDirectory());
  const destination = path.resolve(root, ...parts);
  return destination.startsWith(`${root}${path.sep}`) ? destination : "";
}

async function writeLocalData(payload = {}) {
  const destination = safeLocalDataPath(payload.path);
  if (!destination) return { success: false, error: "Invalid local data path" };
  try {
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${process.pid}-${Date.now()}.tmp`;
    await fs.promises.writeFile(temporary, String(payload.value ?? ""), "utf8");
    await fs.promises.rename(temporary, destination);
    return { success: true, path: destination };
  } catch (error) {
    return { success: false, error: error.message, path: destination };
  }
}

async function readLocalData(payload = {}) {
  const source = safeLocalDataPath(payload.path);
  if (!source) return { success: false, error: "Invalid local data path" };
  try {
    return { success: true, value: await fs.promises.readFile(source, "utf8"), path: source };
  } catch (error) {
    if (error?.code === "ENOENT") return { success: true, missing: true, value: null, path: source };
    return { success: false, error: error.message, path: source };
  }
}

function projectHubStatePath() {
  return path.join(projectStorage.root(), "project-hub-state.json");
}

function exportArtifactPath(id) {
  if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid export artifact id");
  return path.join(projectStorage.root(), "export-artifacts", `${id}.bin`);
}

async function writeExportArtifact(payload = {}) {
  let temporary;
  try {
    const destination = exportArtifactPath(payload.id);
    const bytes = Buffer.from(payload.bytes);
    if (!bytes.length || crypto.createHash("sha256").update(bytes).digest("hex") !== payload.id) {
      throw new Error("Export artifact checksum mismatch");
    }
    await fs.promises.mkdir(path.dirname(destination), { recursive:true });
    temporary = `${destination}.${crypto.randomBytes(8).toString("hex")}.tmp`;
    await fs.promises.writeFile(temporary, bytes, { flag:"wx" });
    await fs.promises.rename(temporary, destination);
    return {success:true};
  } catch (error) {
    return {success:false, error:error.message};
  } finally {
    // Only our exact temporary file is removed; completed exports are retained.
    if (temporary) await fs.promises.unlink(temporary).catch(() => {});
  }
}

async function readExportArtifact(payload = {}) {
  try {
    const bytes = await fs.promises.readFile(exportArtifactPath(payload.id));
    if (crypto.createHash("sha256").update(bytes).digest("hex") !== payload.id) throw new Error("导出文件校验失败");
    return {success:true, bytes};
  } catch (error) {
    return {success:false, error:error.code === "ENOENT" ? "本地导出文件不存在，请在原设备中下载或重新生成" : error.message};
  }
}

async function readProjectHubState() {
  try {
    const state = JSON.parse(await fs.promises.readFile(projectHubStatePath(), "utf8"));
    if (!state || !Array.isArray(state.projects)) throw new Error("Invalid project hub state");
    return { success: true, state, path: projectHubStatePath() };
  } catch (error) {
    if (error?.code === "ENOENT") return { success: true, missing: true, state: null, path: projectHubStatePath() };
    return { success: false, error: error.message, path: projectHubStatePath() };
  }
}

async function writeProjectHubState(payload = {}) {
  const state = payload.state;
  if (!state || !Array.isArray(state.projects)) return { success: false, error: "Invalid project hub state" };
  const serialized = JSON.stringify({
    format: "wandou-project-hub",
    version: 1,
    savedAt: Number(state.savedAt) || Date.now(),
    projects: state.projects,
    selectedProjectId: String(state.selectedProjectId || ""),
    activeProjectId: String(state.activeProjectId || "")
  }, null, 2);
  if (Buffer.byteLength(serialized, "utf8") > 4 * 1024 * 1024) {
    return { success: false, error: "项目文件夹清单异常，超过 4 MB" };
  }
  try {
    await fs.promises.mkdir(projectStorage.root(), { recursive: true });
    const destination = projectHubStatePath();
    const temporary = `${destination}.${process.pid}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}.tmp`;
    await fs.promises.writeFile(temporary, serialized, "utf8");
    await fs.promises.rename(temporary, destination).catch(async (error) => {
      if (!fs.existsSync(destination)) throw error;
      await fs.promises.copyFile(temporary, destination);
      await fs.promises.unlink(temporary).catch(() => {});
    });
    return { success: true, path: destination, savedAt: state.savedAt };
  } catch (error) {
    return { success: false, error: error.message, path: projectHubStatePath() };
  }
}

function canvasMediaPath(id) {
  return path.join(canvasMediaRootDirectory(), `${safeCanvasBackupId(id, "invalid-media")}.data`);
}

function skillRoots() {
  const codexRoot = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  return [path.join(codexRoot, "skills"), path.join(codexRoot, "plugins", "cache")];
}

function personalSkillRoot() {
  const codexRoot = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  return path.join(codexRoot, "skills");
}

function isPersonalSkillDirectory(instructionPath) {
  const root = path.resolve(personalSkillRoot());
  const directory = path.dirname(path.resolve(instructionPath));
  return path.dirname(directory) === root && path.basename(directory) !== ".system";
}

function isDrawingSkill(skill) {
  const name = String(skill?.name || "").trim().toLowerCase();
  const exact = new Set(["imagegen", "banner-design", "design", "brand", "prompt-optimizer"]);
  if (exact.has(name)) return true;
  if (!isPersonalSkillDirectory(skill?.instructionPath || "")) return false;
  const searchable = `${name} ${skill?.description || ""}`;
  if (/(clone|website|browser|chrome|skyvern|context7|theme|brutalist|apple|fluid glass|codedrobe|security|vetter|ui-styling|ui-ux|design-system)/i.test(searchable)) return false;
  return /(image|photo|visual|design|banner|brand|poster|prompt|illustrat|drawing|绘图|生图|图像|图片|海报|设计|视觉|摄影|修图|提示词|关键词)/i.test(searchable);
}

function skillFrontmatter(markdown, fallbackName) {
  const header = String(markdown || "").match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  const fields = {};
  if (header) {
    for (const line of header[1].split(/\r?\n/)) {
      const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!match) continue;
      fields[match[1]] = match[2].trim().replace(/^(["'])(.*)\1$/, "$2");
    }
  }
  return {
    name: fields.name || fallbackName,
    description: fields.description || "已安装的本地 Skill"
  };
}

function collectInstalledSkills() {
  if (Date.now() - installedSkillsCache.savedAt < 10000 && installedSkillsCache.items.length) {
    return installedSkillsCache.items;
  }
  const found = [];
  const seen = new Set();
  const visit = (directory, depth = 0) => {
    if (depth > 7 || !fs.existsSync(directory)) return;
    let entries = [];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch (_error) { return; }
    const skillFile = path.join(directory, "SKILL.md");
    if (fs.existsSync(skillFile)) {
      const resolved = path.resolve(skillFile);
      if (!seen.has(resolved)) {
        seen.add(resolved);
        try {
          const markdown = fs.readFileSync(resolved, "utf8");
          const meta = skillFrontmatter(markdown, path.basename(directory));
          found.push({
            id: crypto.createHash("sha256").update(resolved).digest("hex").slice(0, 20),
            name: meta.name,
            description: meta.description,
            directoryName: path.basename(directory),
            instructionPath: resolved
          });
        } catch (_error) {}
      }
      return;
    }
    entries.filter((entry) => entry.isDirectory()).forEach((entry) => visit(path.join(directory, entry.name), depth + 1));
  };
  skillRoots().forEach((root) => visit(root));
  const items = found.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  installedSkillsCache = { savedAt: Date.now(), items };
  return items;
}

function publicInstalledSkills() {
  const unique = new Map();
  for (const skill of collectInstalledSkills().filter(isDrawingSkill)) {
    const key = String(skill.name || skill.directoryName || "").trim().toLowerCase();
    if (!key || unique.has(key)) continue;
    const personal = isPersonalSkillDirectory(skill.instructionPath);
    unique.set(key, {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      directoryName: skill.directoryName,
      source: personal ? "个人" : "系统",
      canDelete: personal
    });
  }
  return [...unique.values()];
}

function readInstalledSkill(payload = {}) {
  const id = String(payload.id || "");
  const visibleIds = new Set(publicInstalledSkills().map((item) => item.id));
  const skill = visibleIds.has(id) ? collectInstalledSkills().find((item) => item.id === id) : null;
  if (!skill) return { success: false, error: "Skill 不存在或已卸载" };
  try {
    const stat = fs.statSync(skill.instructionPath);
    if (stat.size > MAX_SKILL_INSTRUCTIONS_BYTES) return { success: false, error: "Skill 规则文件过大" };
    return {
      success: true,
      skill: { id: skill.id, name: skill.name, description: skill.description, directoryName: skill.directoryName },
      instructions: fs.readFileSync(skill.instructionPath, "utf8")
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function validateSkillDirectory(directory) {
  const source = path.resolve(directory || "");
  const instructions = path.join(source, "SKILL.md");
  if (!source || !fs.existsSync(instructions) || !fs.statSync(instructions).isFile()) {
    throw new Error("所选文件夹不是有效 Skill：缺少 SKILL.md");
  }
  let files = 0;
  let bytes = 0;
  const visit = (current, depth = 0) => {
    if (depth > 8) throw new Error("Skill 文件夹层级过深");
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Skill 不能包含符号链接");
      if (entry.isDirectory()) {
        if ([".git", "node_modules"].includes(entry.name)) continue;
        visit(target, depth + 1);
      } else if (entry.isFile()) {
        files += 1;
        bytes += fs.statSync(target).size;
        if (files > 500 || bytes > 24 * 1024 * 1024) throw new Error("Skill 文件过多或总体积超过 24MB");
      }
    }
  };
  visit(source);
  const markdown = fs.readFileSync(instructions, "utf8");
  if (Buffer.byteLength(markdown, "utf8") > MAX_SKILL_INSTRUCTIONS_BYTES) throw new Error("SKILL.md 超过 256KB");
  return { source, meta: skillFrontmatter(markdown, path.basename(source)) };
}

async function importPersonalSkill() {
  const choice = await dialog.showOpenDialog(mainWindow, {
    title: "选择包含 SKILL.md 的 Skill 文件夹",
    properties: ["openDirectory"]
  });
  if (choice.canceled || !choice.filePaths[0]) return { success: false, canceled: true };
  try {
    const { source, meta } = validateSkillDirectory(choice.filePaths[0]);
    const folderName = path.basename(source).replace(/[^A-Za-z0-9._\-\u4e00-\u9fff]/g, "-").replace(/-+/g, "-").slice(0, 64);
    if (!folderName) throw new Error("Skill 文件夹名称无效");
    const destination = path.join(personalSkillRoot(), folderName);
    if (path.resolve(source) === path.resolve(destination)) throw new Error("该 Skill 已经位于个人 Skill 目录中");
    if (fs.existsSync(destination)) throw new Error(`已存在同名 Skill：${folderName}`);
    fs.mkdirSync(personalSkillRoot(), { recursive: true });
    fs.cpSync(source, destination, {
      recursive: true,
      errorOnExist: true,
      filter: (entry) => ![".git", "node_modules"].includes(path.basename(entry))
    });
    fs.writeFileSync(path.join(destination, ".wandou-skill.json"), JSON.stringify({ importedAt: Date.now(), name: meta.name }, null, 2), "utf8");
    installedSkillsCache = { savedAt: 0, items: [] };
    const imported = publicInstalledSkills().find((item) => item.directoryName === folderName);
    if (!imported) {
      await shell.trashItem(destination);
      installedSkillsCache = { savedAt: 0, items: [] };
      throw new Error("该 Skill 与绘图无关，因此没有导入");
    }
    return { success: true, skill: imported };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function deletePersonalSkill(payload = {}) {
  const id = String(payload.id || "");
  const skill = collectInstalledSkills().find((item) => item.id === id);
  if (!skill || !isDrawingSkill(skill)) return { success: false, error: "Skill 不存在或已隐藏" };
  if (!isPersonalSkillDirectory(skill.instructionPath)) return { success: false, error: "系统 Skill 不能删除" };
  try {
    await shell.trashItem(path.dirname(skill.instructionPath));
    installedSkillsCache = { savedAt: 0, items: [] };
    return { success: true, movedToTrash: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function openPersonalSkillDirectory() {
  try {
    const directory = personalSkillRoot();
    fs.mkdirSync(directory, { recursive: true });
    const error = await shell.openPath(directory);
    return error ? { success: false, error } : { success: true, directory };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function hasCanvasMedia(payload = {}) {
  if (!canvasMediaFiles.validId(payload.id)) return { success: false, exists: false, error: 'Invalid media id' };
  const result = await canvasStandardMedia.read(payload.id);
  return { success: result.success || Boolean(result.missing), exists: Boolean(result.success), error: result.error };
}

async function writeCanvasMedia(payload = {}) {
  const id = payload.id;
  const value = typeof payload.value === "string" ? payload.value : "";
  if (!canvasMediaFiles.validId(id) || !value.startsWith("data:")) return { success: false, error: "Invalid canvas media" };
  if (id.startsWith('sha256-') && canvasMediaStorageId(value) !== id) return { success: false, error: '图片内容校验失败' };
  try {
    const destination = canvasMediaPath(id);
    await fs.promises.mkdir(canvasMediaRootDirectory(), { recursive: true });
    await canvasMediaFiles.realDirectory(canvasMediaRootDirectory());
    const published = await canvasMediaFiles.writeLegacy(canvasMediaRootDirectory(), id, value);
    const standardization = await canvasStandardMedia.ensure(id);
    // The exact compatibility copy is durable before acknowledging the reference.
    // A secondary format/space failure must never discard a generated result.
    return { success: true, path: standardization.success ? standardization.path : destination, deduplicated: !published.created, repaired: Boolean(published.repaired), storageFormat: standardization.success ? 'image-file' : 'data-url', standardization };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function readCanvasMedia(payload = {}) {
  return canvasStandardMedia.read(payload.id);
}

function canvasBackupDirectory(folderId, projectId) {
  return path.join(
    canvasBackupRootDirectory(),
    safeCanvasBackupId(folderId, "default-folder"),
    safeCanvasBackupId(projectId, "default-project")
  );
}

function canvasBackupFingerprint(state) {
  return require('./canvas-backup-guard.cjs').fingerprint(state);
}

function containsEmbeddedCanvasMedia(value) {
  if (typeof value === "string") return value.startsWith("data:") && value.length > 1200000;
  if (Array.isArray(value)) return value.some(containsEmbeddedCanvasMedia);
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some(containsEmbeddedCanvasMedia);
}

function embeddedCanvasMediaPath(value, currentPath = "state") {
  if (typeof value === "string") {
    return value.startsWith("data:") && value.length > 1200000 ? currentPath : "";
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = embeddedCanvasMediaPath(value[index], `${currentPath}[${index}]`);
      if (found) return found;
    }
    return "";
  }
  if (!value || typeof value !== "object") return "";
  for (const [key, nested] of Object.entries(value)) {
    const found = embeddedCanvasMediaPath(nested, `${currentPath}.${key}`);
    if (found) return found;
  }
  return "";
}

function canvasMediaStorageId(value) {
  return `sha256-${crypto.createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

async function compactEmbeddedCanvasMedia(value, currentPath = "state", writes = new Map()) {
  if (typeof value === "string") {
    if (!value.startsWith("data:") || value.length <= 1200000) return value;
    const id = canvasMediaStorageId(value);
    if (!writes.has(id)) writes.set(id, writeCanvasMedia({ id, value }));
    const result = await writes.get(id);
    if (!result?.success) {
      throw new Error(`图片独立存储失败：${currentPath}${result?.error ? `（${result.error}）` : ""}`);
    }
    return `indexed-media:${id}`;
  }
  if (Array.isArray(value)) {
    const compact = [];
    for (let index = 0; index < value.length; index += 1) {
      compact.push(await compactEmbeddedCanvasMedia(value[index], `${currentPath}[${index}]`, writes));
    }
    return compact;
  }
  if (!value || typeof value !== "object") return value;
  const compact = {};
  for (const [key, nested] of Object.entries(value)) {
    compact[key] = await compactEmbeddedCanvasMedia(nested, `${currentPath}.${key}`, writes);
  }
  return compact;
}

async function writeCanvasBackup(payload = {}) {
  let state = payload.state;
  if (!state || !Array.isArray(state.nodes)) return { success: false, error: "Invalid canvas state" };
  const folderId = safeCanvasBackupId(payload.folderId, "default-folder");
  const projectId = safeCanvasBackupId(payload.projectId, "default-project");
  try {
    require('./canvas-backup-reader.cjs').validateEnvelope(
      { format: 'wandou-canvas-backup', version: 1, folderId, projectId, state },
      { folderId, projectId }, '1-00000000.json');
  } catch (error) {
    return { success: false, error: error.message, code: error.code };
  }
  try {
    state = await compactEmbeddedCanvasMedia(state);
  } catch (error) {
    return { success: false, error: error.message || "图片独立存储失败" };
  }
  if (containsEmbeddedCanvasMedia(state)) {
    const field = embeddedCanvasMediaPath(state);
    return { success: false, error: `图片仍未完成独立存储${field ? `：${field}` : ""}` };
  }
  try {
    const directory = canvasBackupDirectory(folderId, projectId);
    await fs.promises.mkdir(directory, { recursive: true });
    const fingerprint = canvasBackupFingerprint(state);
    const fingerprintPath = path.join(directory, ".latest-backup.json");
    const latest = await latestCanvasBackupForGuard({ folderId, projectId });
    if (latest?.fingerprint === fingerprint) {
      return { success: true, path: latest.path, savedAt: latest.savedAt, fingerprint, deduplicated: true };
    }
    // Renderer clocks can move backwards or repeat a millisecond. The committed
    // state and filename share a strictly increasing project revision timestamp,
    // including when an older application left a snapshot dated in the future.
    const savedAt = Math.max(Date.now(), Number(latest?.savedAt || 0) + 1);
    if (!Number.isSafeInteger(savedAt)) throw new Error("备份时间记录无效，已保留现有项目，请导出项目备份后重试");
    state = { ...state, savedAt };
    const serialized = JSON.stringify({ format: "wandou-canvas-backup", version: 1, folderId, projectId, savedAt, state });
    const suffix = crypto.randomBytes(4).toString("hex");
    const destination = path.join(directory, `${savedAt}-${suffix}.json`);
    const temporary = `${destination}.tmp`;
    const snapshotFile = await fs.promises.open(temporary, 'wx');
    try { await snapshotFile.writeFile(serialized, 'utf8'); await snapshotFile.sync(); }
    finally { await snapshotFile.close(); }
    await fs.promises.rename(temporary, destination);
    const fingerprintTemporary = `${fingerprintPath}.${suffix}.tmp`;
    // The snapshot is already durable. Failure to update this optional hint or
    // prune old files must not report a failed commit and leave the guard stale.
    try {
      await fs.promises.writeFile(fingerprintTemporary, JSON.stringify({ fingerprint, path: destination, savedAt }), "utf8");
      await fs.promises.rename(fingerprintTemporary, fingerprintPath);
    } catch (_error) { await fs.promises.unlink(fingerprintTemporary).catch(() => {}); }
    try {
      const snapshots = (await fs.promises.readdir(directory, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && /^\d+-[0-9a-f]+\.json$/i.test(entry.name))
        .map((entry) => entry.name)
        .sort((left, right) => Number(right.split("-")[0]) - Number(left.split("-")[0]));
      for (const name of snapshots.slice(12)) {
        if (await require('./canvas-backup-reader.cjs').canPrune(directory, name)) {
          await fs.promises.unlink(path.join(directory, name)).catch(() => {});
        }
      }
    } catch (_error) { /* Keep older snapshots when cleanup is unavailable. */ }
    return { success: true, path: destination, savedAt, fingerprint };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function readCanvasBackupDirectory(directory, stateLimit = 3) {
  return require('./canvas-backup-reader.cjs').readDirectory(directory, stateLimit);
}

async function readCanvasBackups(payload = {}) {
  const folderId = safeCanvasBackupId(payload.folderId, "default-folder");
  try {
    if (payload.allProjects && payload.metadataOnly === true) {
      const catalog = await require('./canvas-backup-reader.cjs').readCatalog(path.join(canvasBackupRootDirectory(), folderId));
      return { success: !catalog.blocked, metadataOnly: true, ...catalog, states: [], projectStates: [], skippedLarge: 0,
        ...(catalog.blocked ? { code: 'BACKUP_EXISTING_UNREADABLE', error: '项目目录无法安全读取，已保留原文件，请检查存储后重试。' } : {}) };
    }
    if (payload.allProjects) {
      const folderDirectory = path.join(canvasBackupRootDirectory(), folderId);
      const projectDirectories = (await fs.promises.readdir(folderDirectory, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory());
      const states = [];
      const projectStates = [];
      const issues = [];
      let skippedLarge = 0;
      for (const entry of projectDirectories) {
        let result;
        try { result = await readCanvasBackupDirectory(path.join(folderDirectory, entry.name), 1); }
        catch (error) { result = { states: [], skippedLarge: 0, blocked: true,
          issues: [{ code: error.code || 'BACKUP_READ_FAILED' }] }; }
        if (result.issues.length) issues.push({ projectId: entry.name, blocked: result.blocked, snapshots: result.issues });
        states.push(...result.states);
        if (result.states.length) {
          projectStates.push({ projectId: entry.name, states: result.states });
        }
        skippedLarge += result.skippedLarge;
      }
      states.sort((left, right) => Number(right?.savedAt || 0) - Number(left?.savedAt || 0));
      projectStates.sort((left, right) =>
        Number(right.states[0]?.savedAt || 0) - Number(left.states[0]?.savedAt || 0)
      );
      const blocked = !states.length && issues.some(issue => issue.blocked);
      return { success: !blocked, states, projectStates, skippedLarge, issues,
        partial: issues.length > 0,
        ...(blocked ? { code: 'BACKUP_EXISTING_UNREADABLE', error: '项目备份无法安全读取，已保留原文件，请检查存储或从备份副本恢复。' } : {}) };
    }
    const projectId = safeCanvasBackupId(payload.projectId, "default-project");
    const result = await readCanvasBackupDirectory(canvasBackupDirectory(folderId, projectId), 3);
    return { success: !result.blocked, ...result,
      ...(result.blocked ? { code: 'BACKUP_EXISTING_UNREADABLE', error: '项目备份无法安全读取，已保留原文件，请检查存储或从备份副本恢复。' } : {}) };
  } catch (error) {
    if (payload.allProjects && payload.metadataOnly === true) {
      return { success: error.code === 'ENOENT', metadataOnly: true, projects: [], states: [], projectStates: [], skippedLarge: 0,
        issues: error.code === 'ENOENT' ? [] : [{ code: error.code || 'BACKUP_READ_FAILED' }],
        ...(error.code === 'ENOENT' ? {} : { error: error.message, code: error.code || 'BACKUP_READ_FAILED' }) };
    }
    if (error.code === "ENOENT") return { success: true, states: [], skippedLarge: 0 };
    return { success: false, states: [], skippedLarge: 0, error: error.message };
  }
}

async function latestCanvasBackupForGuard(payload) {
  const record = await require('./canvas-backup-reader.cjs').latest(canvasBackupDirectory(payload.folderId, payload.projectId));
  return record ? { path: record.path, savedAt: record.savedAt, fingerprint: canvasBackupFingerprint(record.state) } : null;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const policy = require('./update-policy.cjs')(readClientConfig());
    policy.initial(url);
    let target = url;
    for (let count = 0; count < 6; count += 1) {
      const response = await getApplicationSession().fetch(target, { ...options, redirect: 'manual', signal: controller.signal });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get('location');
      if (!location) throw Error('更新服务器重定向无目标');
      target = new URL(location, target).href;
      policy.redirect(target);
    }
    throw Error('更新服务器重定向次数过多');
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
  const channel = require('./safe-update-channel.cjs');
  return channel.check({config:readClientConfig(),currentVersion:app.getVersion(),fetchJson:async(url,options={})=>{
    const response=await fetchWithTimeout(url,{cache:'no-store',headers:{'User-Agent':'WandouAI-Desktop-Updater','X-GitHub-Api-Version':'2022-11-28',Accept:options.asset?'application/octet-stream':'application/vnd.github+json'}});
    return channel.readJson(response);
  }});
}

async function downloadFile(url, destination) {
  const response = await getApplicationSession().fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": "WandouAI-Desktop-Updater" }
  });
  if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.promises.writeFile(destination, buffer);
}

async function downloadFileWithFallback(url, destination, fallbackUrl = '') {
  const sources = [...new Set([url,fallbackUrl].filter(isSafeHttpsUrl))];
  let lastError = Error('更新下载地址无效');
  for(const source of sources) {
    try {
      return await require('./update-download.cjs').download({url:source,destination,
        maxBytes:destination.endsWith('.sha256')?65536:1024*1024*1024,
        fetchResponse:target=>fetchWithTimeout(target,{cache:'no-store',headers:{Accept:'application/octet-stream','User-Agent':'WandouAI-Desktop-Updater'}},120000)});
    } catch(error) {lastError=error;}
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
  updateInProgress = true;
  let handoffReadyPath = '';
  try {
    // The renderer may request a version, but can never supply install URLs or
    // manufacture a save receipt. Both are obtained again inside this process.
    const requestedVersion = updateInfo?.latestVersion;
    updateInfo = await checkForUpdates();
    if (!updateInfo.available || updateInfo.manualRequired || updateInfo.updaterProtocol !== 2 || (requestedVersion && requestedVersion !== updateInfo.latestVersion)) throw Error('版本信息已变化或没有新版本，请重新检查更新');
    updateInfo = require('./update-policy.cjs')(readClientConfig()).metadata(updateInfo);
    await verifyWorkflowsForUpdate();
    const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wandou-ai-update-"));
    const packagePath = path.join(workDir, updateInfo.assetName || "wandou-ai-tools-windows-x64.zip");
    const checksumPath = `${packagePath}.sha256`;
    sendUpdateStatus("正在下载新版本…");
    await downloadFileWithFallback(updateInfo.downloadUrl, packagePath, updateInfo.packageApiUrl);
    sendUpdateStatus("正在校验更新文件…");
    await downloadFileWithFallback(updateInfo.checksumUrl, checksumPath, updateInfo.checksumApiUrl);

    const checksumText = await fs.promises.readFile(checksumPath, "utf8");
    const expected = require('./update-download.cjs').checksum(checksumText,updateInfo.assetName);
    const actual = await require('./update-download.cjs').sha256(packagePath);
    if (!expected || actual !== expected) throw new Error("更新文件校验失败，已停止安装");
    // Downloads can take minutes; a new job may have started meanwhile.
    await verifyWorkflowsForUpdate();

    const sourceUpdater = path.join(process.resourcesPath, "portable-updater.exe");
    const updaterPath = path.join(workDir, "portable-updater.exe");
    const readyPath = path.join(workDir, "updater-ready.txt");
    handoffReadyPath = readyPath;
    await fs.promises.copyFile(sourceUpdater, updaterPath);
    sendUpdateStatus("下载完成，正在启动安装程序…", "ready");

    const portableInstall = portableInstallContext();
    const args = [
      "--install", portableInstall.installDirectory,
      "--package", packagePath,
      "--parent", String(process.pid),
      "--exe", portableInstall.executable,
      "--ready", readyPath,
      "--target", String(updateInfo.latestVersion || ""),
      "--protocol", "2",
      "--sha256", expected
    ];
    const child = spawn(updaterPath, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      // Never let the updater inherit the portable installation as its current
      // directory. Windows refuses to rename a directory while any process has
      // that directory as its working directory, which previously caused the
      // updater to restore and reopen the old version.
      cwd: workDir
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
        let detail = '';
        try {
          const receiptFile = readyPath + '.error.json';
          const stat = fs.lstatSync(receiptFile);
          if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= 4096) {
            const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8').replace(/^\uFEFF/, ''));
            if (typeof receipt.message === 'string') detail = receipt.message.slice(0, 300);
          }
        } catch { /* A diagnostic receipt cannot authorize or block validation. */ }
        finish(new Error(detail || `更新程序提前退出（代码 ${code ?? "未知"}），软件不会关闭`));
      });
      timer = setInterval(() => {
        if (fs.existsSync(readyPath)) return finish();
        if (Date.now() - startedAt > 120000) finish(new Error("更新程序 120 秒内没有完成文件检查，软件不会关闭，请查看更新日志"));
      }, 120);
    });

    // Preflight can take time. Require fresh durability before authorizing the
    // waiting updater; simply closing this parent must never count as consent.
    await verifyWorkflowsForUpdate();
    if (child.exitCode != null) throw Error('更新程序已退出，软件不会关闭');
    const commitPending = readyPath + '.commit.pending';
    await fs.promises.writeFile(commitPending, 'commit', {flag:'wx'});
    await fs.promises.link(commitPending, readyPath + '.commit');
    await fs.promises.unlink(commitPending);
    child.unref();
    allowWindowClose = true;
    setTimeout(() => app.quit(), 0);
    return { started: true };
  } catch (error) {
    if (handoffReadyPath) await fs.promises.writeFile(handoffReadyPath+'.cancel','cancel',{flag:'wx'}).catch(()=>{});
    updateInProgress = false;
    sendUpdateStatus(error.message || "更新失败", "error");
    return { started: false, error: error.message || "更新失败" };
  }
}

async function verifyWorkflowsForUpdate() {
  if (!mainWindow || mainWindow.isDestroyed() || activeCanvasApiCount || activeDesktopExports.size || storageMigrationPreparing) throw Error('仍有生成、导出或数据迁移任务，请完成后再更新');
  const report = await withCloseTimeout(mainWindow.webContents.executeJavaScript('saveAllOpenWorkflows()', true), 120000, '更新前保存暂未完成，已停止本次更新。可等待保存完成后重试');
  if (!report?.success || activeCanvasApiCount || activeDesktopExports.size) throw Error('工作流尚未安全保存或仍在生成、导出，已停止更新');
}

function getAppRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, "app") : path.resolve(__dirname, "..", "app");
}
function getAppEntryUrl() { return pathToFileURL(path.join(getAppRoot(), "homepage-test.html")).href; }
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
      "homepage-test.html": "首页",
      "ai-node-canvas-v2.html": "节点画布",
      "ai-node-canvas-test.html": "节点画布",
      "project-hub.html": "项目文件夹",
      "ai-node-canvas.html": "节点画布",
      "asset-library.html": "资产",
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
    if (isInternalUrl(url) && isLocalAppPage(contents.getURL()) !== isLocalAppPage(url)) {
      event.preventDefault();
      sendTab(url, titleForUrl(url));
      return;
    }
    if (isInternalUrl(url)) return;
    event.preventDefault();
    if (isSafeHttpsUrl(url)) shell.openExternal(url);
  });
  // 画布图片很多时，最坏情况下 guest renderer 可能被系统终止。以前这里只会
  // 留下一张白页，用户只能在任务管理器里结束进程；现在由外层壳通知并恢复。
  contents.on("render-process-gone", (_event, details) => {
    const reason = details?.reason || "unknown";
    if (contents === mainWindow?.webContents) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reloadIgnoringCache();
      }, 800);
      return;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("desktop:guest-renderer-gone", { id: contents.id, reason });
    }
  });
}

function configureDownloads() {
  if (downloadListenerReady) return;
  downloadListenerReady = true;
  getApplicationSession().on("will-download", (_event, item) => {
    let filename = '文件';
    try { filename = item.getFilename(); } catch (_) {}
    const notifyDownload = success => {
      try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('desktop:download-result', { success, filename }); }
      catch (_) { /* A closed renderer cannot prevent download cleanup. */ }
    };
    if (updateInProgress || storageMigrationPreparing || storageOutageHandling) {
      _event.preventDefault();
      notifyDownload(false);
      return;
    }
    activeDesktopExports.add(item);
    item.once("done", (_doneEvent, state) => {
      activeDesktopExports.delete(item);
      notifyDownload(state === 'completed');
    });
  });
}

function createWindow() {
  if (!applicationStorageReady || !applicationSession) return false;
  allowWindowClose = false;
  closePromptPending = false;
  shellReady = false;
  shutdownFinishing = false;
  const initialDarkTheme = readDesktopTheme().theme === "dark";
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 930,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: initialDarkTheme ? "#101211" : "#ffffff",
    title: APP_NAME,
    icon: getIconPath(),
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    titleBarOverlay: { color: initialDarkTheme ? "#0c0e0d" : "#ffffff", symbolColor: initialDarkTheme ? "#eef6f0" : "#203128", height: 48 },
    webPreferences: {
      session: getApplicationSession(),
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
  mainWindow.webContents.on('will-attach-webview', (event, preferences, params) => {
    if (!isInternalUrl(params.src)) { event.preventDefault(); return; }
    // A remote page never receives a bridge, even if shell markup is modified.
    if (isLocalAppPage(params.src)) preferences.preload = path.join(__dirname, 'preload.js');
    else delete preferences.preload;
    preferences.nodeIntegration = false;
    preferences.session = getApplicationSession();
    preferences.sandbox = true;
    preferences.contextIsolation = true;
    preferences.webviewTag = false;
  });
  mainWindow.webContents.on("did-attach-webview", (_event, contents) => configureWebContents(contents));

  closeCoordinator?.dispose();
  closeCoordinator = createCloseCoordinator({
    isCritical: () => updateInProgress || storageMigrationPreparing || storageOutageHandling,
    requestSave: payload => mainWindow.webContents.send('desktop:request-close', payload),
    recover: async ({ blocked }) => {
      if (!mainWindow || mainWindow.isDestroyed()) return false;
      const choice = await dialog.showMessageBox(mainWindow, {
        type: 'warning', title: APP_NAME,
        message: blocked ? '正在保护数据，请等待当前操作结束' : '尚未完成保存，是否仍然退出？',
        detail: blocked ? '正在执行更新、数据迁移或数据盘恢复。不能在此阶段强制退出；操作结束后请再次关闭。'
          : '保存可能较慢、失败或页面没有响应。继续等待会保留当前编辑；仍然退出可能丢失最近未保存的修改，并中断生成、下载或导出任务。已保存的原文件不会被主动删除。',
        buttons: blocked ? ['继续等待'] : ['继续等待', '仍然退出'], defaultId: 0, cancelId: 0, noLink: true
      });
      return !blocked && choice.response === 1;
    },
    finish: finishConfirmedClose
  });
  mainWindow.on("close", (event) => {
    event.preventDefault();
    if (allowWindowClose) { finishConfirmedClose(); return; }
    closePromptPending = true;
    closeCoordinator.request();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  mainWindow.on("closed", () => {
    closeCoordinator?.dispose();
    mainWindow = null;
    allowWindowClose = false;
    closePromptPending = false;
    shellReady = false;
  });
  mainWindow.on("unresponsive", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    closePromptPending = true;
    closeCoordinator.request();
    void closeCoordinator.emergency();
  });

  mainWindow.loadFile(path.join(__dirname, "shell.html"), {
    query: { home: getAppEntryUrl(), version: app.getVersion(), theme: initialDarkTheme ? "dark" : "light" }
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
}

function finishConfirmedClose() {
  if (shutdownFinishing) return;
  shutdownFinishing = true;
  allowWindowClose = true;
  closePromptPending = false;
  closeCoordinator?.dispose();
  // Only reached after verified save, explicit native discard confirmation,
  // or an already-authorized update/migration handoff. Guest beforeunload must
  // not veto that decision or leave invisible renderer processes behind.
  try { applicationSession?.flushStorageData(); } catch (_) {}
  const exitTimer = setTimeout(() => app.exit(0), 5000);
  exitTimer.unref?.();
  try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy(); }
  catch (_) { /* The process exit deadline remains armed if a window has failed. */ }
  finally { try { app.quit(); } catch (_) { /* app.exit remains the fallback. */ } }
}

onDesktop("desktop:open-tab", (_event, payload = {}) => {
  if (isInternalUrl(payload.url)) {
    sendTab(payload.url, payload.title || titleForUrl(payload.url));
    return;
  }
  if (isSafeHttpsUrl(payload.url)) shell.openExternal(payload.url);
});
const activeCanvasApiRequests = new Map();
let activeCanvasApiCount = 0;
handleDesktop("desktop:api-fetch", async (event, payload = {}) => {
  if (!isLocalAppPage(event.senderFrame?.url || "")) throw new Error("仅本地工具页面可以调用 API 请求");
  if (updateInProgress) throw new Error('正在更新软件，请完成或取消更新后再生成');
  if (storageMigrationPreparing) throw new Error("正在准备迁移项目数据，请等待软件重新打开后再生成");
  const url = String(payload.url || "");
  if (!isAllowedCanvasApiUrl(url)) throw new Error("接口地址不在允许范围内");

  const request = payload.request || {};
  const method = String(request.method || "GET").toUpperCase();
  if (!/^(GET|POST)$/.test(method)) throw new Error("不支持的 API 请求方法");
  if (!isAllowedCanvasApiUrl(url, method)) throw new Error("此服务仅支持模型列表与图片生成、编辑接口");
  const requestId = String(payload.requestId || "");
  const requestKey = requestId ? `${event.sender.id}:${requestId}` : "";
  const controller = new AbortController();
  if (requestKey) activeCanvasApiRequests.set(requestKey, controller);
  activeCanvasApiCount += 1;
  try {
    const response = await getApplicationSession().fetch(url, {
      method,
      headers: apiRequestHeaders(request.headers),
      body: apiRequestBody(request),
      redirect: 'manual',
      signal: controller.signal
    });
    // Never forward a credential-bearing request to a redirected destination.
    if (response.status >= 300 && response.status < 400) throw new Error('API 地址发生重定向，请检查所选服务；请求未自动转发');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_DESKTOP_API_RESPONSE_BYTES) throw new Error("接口响应超过 32 MB，无法传回页面");
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers.entries()],
      bodyBase64: bytes.toString("base64")
    };
  } finally {
    activeCanvasApiCount -= 1;
    if (requestKey && activeCanvasApiRequests.get(requestKey) === controller) activeCanvasApiRequests.delete(requestKey);
  }
});
onDesktop("desktop:api-fetch-cancel", (event, payload = {}) => {
  if (!isLocalAppPage(event.senderFrame?.url || "")) return;
  const requestId = String(payload.requestId || "");
  if (!requestId) return;
  activeCanvasApiRequests.get(`${event.sender.id}:${requestId}`)?.abort();
});
handleDesktop("desktop:get-theme", () => readDesktopTheme());
onDesktop("desktop:set-theme", (event, theme) => {
  if (event.senderFrame !== event.sender.mainFrame || !isTrustedThemePage(event.senderFrame?.url || "")) return;
  setDesktopTheme(theme);
});
onDesktop("desktop:shell-ready", () => { shellReady = true; });
onDesktop("desktop:cancel-close", () => { closePromptPending = false; closeCoordinator?.cancel(); });
onDesktop('desktop:close-state', (_event, payload) => closeCoordinator?.state(payload));
handleDesktop('desktop:force-close', () => closeCoordinator?.emergency() || false);
handleDesktop("desktop:confirm-close", (_event, verification = {}) => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (activeDesktopExports.size) return { closed: false, error: '下载或另存为尚未完成，请完成或取消保存后重新关闭；也可以选择仍然退出。' };
  return closeCoordinator?.confirm(verification) || false;
});
handleDesktop("desktop:get-client-config", () => ({ ...readClientConfig(), version: app.getVersion(), name: APP_NAME }));
handleDesktop("desktop:check-for-updates", () => checkForUpdates());
handleDesktop("desktop:start-update", (_event, updateInfo) => startPortableUpdate(updateInfo));
handleDesktop("desktop:open-update-downloads", async () => {
  const url=require('./safe-update-channel.cjs').urls(readClientConfig()).manual;
  await shell.openExternal(url);return {success:true};
});
handleDesktop("desktop:open-external", (_event, url) => {
  if (!isSafeHttpsUrl(url)) return false;
  shell.openExternal(url);
  return true;
});
handleDesktop("desktop:get-save-directory", () => {
  const directory = readSavedDirectory();
  return { directory, name: directory ? path.basename(directory) : "" };
});
handleDesktop("desktop:choose-save-directory", async () => {
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
handleDesktop("desktop:create-save-directory", async (_event, payload = {}) => {
  const rootDirectory = readSavedDirectory();
  if (!rootDirectory) return { success: false, missingDirectory: true };
  const folderName = safeOutputFolderName(payload.folderName);
  if (!folderName) return { success: false, error: "无效的文件夹名称" };
  try {
    const directory = path.join(rootDirectory, folderName);
    await fs.promises.mkdir(directory, { recursive: true });
    return { success: true, directory, folderName };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
handleDesktop("desktop:write-save-file", async (_event, payload = {}) => {
  return trackDesktopExport(async () => {
  const rootDirectory = readSavedDirectory();
  if (!rootDirectory) return { success: false, missingDirectory: true, error: "保存文件夹不存在，请重新选择保存位置" };
  try {
    const bytes = Buffer.from(payload.bytes || []);
    if (!bytes.length) return { success: false, error: "文件内容为空，未执行保存" };
    const folderName = safeOutputFolderName(payload.folderName);
    const directory = folderName ? path.join(rootDirectory, folderName) : rootDirectory;
    if (folderName) await fs.promises.mkdir(directory, { recursive: true });
    const destination = uniqueOutputPath(directory, payload.filename);
    await fs.promises.writeFile(destination, bytes);
    return { success: true, path: destination, filename: path.basename(destination) };
  } catch (error) {
    return { success: false, error: error.message };
  }
  });
});
const saveFileAs = require('./save-file-as.cjs')({
  showSaveDialog: options => dialog.showSaveDialog(mainWindow, options),
  defaultDirectory: () => readSavedDirectory() || app.getPath('pictures')
});
handleDesktop('desktop:save-file-as', (event, payload = {}) => {
  if (event.senderFrame !== event.sender.mainFrame || !isLocalAppPage(event.senderFrame?.url || '')) {
    return { success: false, error: '仅本地工具页面可以另存文件' };
  }
  return trackDesktopExport(() => saveFileAs(payload));
});
handleDesktop("desktop:copy-image", (event, payload = {}) => {
  if (!isLocalAppPage(event.senderFrame?.url || "")) {
    return { success: false, error: "仅本地工具页面可以复制图片" };
  }
  try {
    const bytes = Buffer.from(payload.bytes || []);
    if (!bytes.length) return { success: false, error: "图片内容为空" };
    if (bytes.length > MAX_CLIPBOARD_IMAGE_BYTES) return { success: false, error: "图片过大，无法复制" };
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) return { success: false, error: "图片格式无法识别" };
    clipboard.writeImage(image);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
const canvasBackupGuard = require('./canvas-backup-guard.cjs')({
  latest:latestCanvasBackupForGuard,
  write:writeCanvasBackup,
  keyFor:payload => canvasBackupDirectory(payload.folderId, payload.projectId)
});
const canvasBackupOwners = new Set();
function registerCanvasBackupOwner(sender) {
  if (!canvasBackupOwners.has(sender.id)) {
    const owner = sender.id;
    canvasBackupOwners.add(owner);
    sender.once('destroyed', () => { canvasBackupOwners.delete(owner); canvasBackupGuard.disposeOwner(owner); });
  }
  return sender.id;
}
handleDesktop("desktop:write-canvas-backup", (event, payload = {}) =>
  withProjectStorage('write', () => canvasBackupGuard.save(registerCanvasBackupOwner(event.sender), payload)));
handleDesktop("desktop:read-canvas-backups", async (event, payload = {}) => {
  const owner = registerCanvasBackupOwner(event.sender);
  const result = await withProjectStorage('read', () => readCanvasBackups(payload));
  if (!event.sender.isDestroyed()) canvasBackupGuard.rememberRead(owner, payload, result);
  return result;
});
handleDesktop("desktop:has-canvas-media", (_event, payload = {}) => withProjectStorage('read', () => hasCanvasMedia(payload)));
handleDesktop("desktop:write-canvas-media", (_event, payload = {}) => withProjectStorage('write', () => writeCanvasMedia(payload)));
const canvasMediaWriter = require('./canvas-media-writer.cjs')({ directory: canvasMediaRootDirectory, destination: canvasMediaPath, onCommitted: id => canvasStandardMedia.ensure(id) });
const mediaWriterOwners = new Set();
handleDesktop("desktop:write-canvas-media-chunk", (event, payload = {}) => {
  if (!isLocalAppPage(event.senderFrame?.url || "")) return { success: false, error: "仅本地画布可以保存媒体" };
  const owner = event.sender.id;
  if (!mediaWriterOwners.has(owner)) {
    mediaWriterOwners.add(owner);
    event.sender.once('destroyed', () => {
      mediaWriterOwners.delete(owner);
      // Keep the storage gate until pending file operations and handles drain.
      void canvasMediaWriter.disposeOwner(owner).then(() => {
        for (const [token, tokenOwner] of storageMediaTokens) if (tokenOwner === owner) storageMediaTokens.delete(token);
      }).catch(() => { /* Retain the gate if disposal cannot be confirmed. */ });
    });
  }
  return withProjectStorage('write', async () => {
    const result = await canvasMediaWriter.write(owner, payload);
    if (payload.action === 'begin' && result.success) {
      if (event.sender.isDestroyed()) { await canvasMediaWriter.disposeOwner(owner); return {success:false,error:'媒体所属页面已关闭',code:'MEDIA_OWNER_DISPOSED'}; }
      storageMediaTokens.set(result.token,owner);
    }
    // A rejected overlapping request does not end the in-flight owner session.
    // Another renderer must not be able to clear its migration/save gate either.
    if (payload.token && storageMediaTokens.get(payload.token) === owner && !result.sessionRetained
      && (payload.action === 'commit' || payload.action === 'abort' || !result.success)) storageMediaTokens.delete(payload.token);
    return result;
  });
});
handleDesktop("desktop:read-canvas-media", (_event, payload = {}) => withProjectStorage('read', () => readCanvasMedia(payload)));
handleDesktop("desktop:get-canvas-media-url", (event, payload = {}) => {
  if (!isLocalAppPage(event.senderFrame?.url || "")) return { success: false, error: "仅本地页面可以读取图片" };
  return withProjectStorage('read', () => canvasMediaProtocol.getUrl(payload.id));
});
const canvasMediaLocation = require('./canvas-media-location.cjs')({
  directory: canvasMediaRootDirectory,
  getUrl: id => canvasMediaProtocol.getUrl(id),
  standardize: id => canvasStandardMedia.ensure(id),
  openPath: directory => shell.openPath(directory),
  showItemInFolder: file => shell.showItemInFolder(file)
});
function isCanvasMediaLocationCaller(event) {
  return event.senderFrame === event.sender.mainFrame && isLocalAppPage(event.senderFrame?.url || "");
}
handleDesktop("desktop:get-canvas-media-location", (event, payload = {}) => {
  if (!isCanvasMediaLocationCaller(event)) return { success: false, error: "仅本地资产页面可以查看原图位置" };
  return withProjectStorage('read', () => canvasMediaLocation.get(payload?.ref));
});
handleDesktop("desktop:show-canvas-media-in-folder", (event, payload = {}) => {
  if (!isCanvasMediaLocationCaller(event)) return { success: false, error: "仅本地资产页面可以打开原图位置" };
  return withProjectStorage('read', () => canvasMediaLocation.show(payload?.ref));
});
handleDesktop("desktop:write-export-artifact", (event, payload = {}) => {
  if (!isLocalAppPage(event.senderFrame?.url || "")) return {success:false, error:"仅本地工具页面可以保存导出文件"};
  return withProjectStorage('write', () => writeExportArtifact(payload));
});
handleDesktop("desktop:read-export-artifact", (event, payload = {}) => {
  if (!isLocalAppPage(event.senderFrame?.url || "")) return {success:false, error:"仅本地工具页面可以读取导出文件"};
  return withProjectStorage('read', () => readExportArtifact(payload));
});
handleDesktop("desktop:get-local-data-config", (event) => {
  if (!isLocalAppPage(event.senderFrame?.url || "")) return { success: false, error: "仅本地工具页面可以读取本地存储配置" };
  return withProjectStorage('read', () => ({ success: true, mode: "disk", directory: localDataRootDirectory() }));
});
handleDesktop("desktop:write-local-data", (event, payload = {}) => {
  if (!isLocalAppPage(event.senderFrame?.url || "")) return { success: false, error: "仅本地工具页面可以写入本地数据" };
  return withProjectStorage('write', () => writeLocalData(payload));
});
handleDesktop("desktop:read-local-data", (event, payload = {}) => {
  if (!isLocalAppPage(event.senderFrame?.url || "")) return { success: false, error: "仅本地工具页面可以读取本地数据" };
  return withProjectStorage('read', () => readLocalData(payload));
});
handleDesktop("desktop:read-project-hub-state", (event) => {
  if (!isLocalAppPage(event.senderFrame?.url || "")) return { success: false, error: "仅本地工具页面可以读取项目文件夹" };
  return withProjectStorage('read', () => readProjectHubState());
});
handleDesktop("desktop:write-project-hub-state", (event, payload = {}) => {
  if (!isLocalAppPage(event.senderFrame?.url || "")) return { success: false, error: "仅本地工具页面可以保存项目文件夹" };
  return withProjectStorage('write', () => writeProjectHubState(payload));
});
handleDesktop("desktop:list-skills", (event, payload = {}) => {
  if (!isLocalAppPage(event.senderFrame?.url || "")) return [];
  if (payload?.force) installedSkillsCache = { savedAt: 0, items: [] };
  return publicInstalledSkills();
});
handleDesktop("desktop:read-skill", (event, payload = {}) => {
  if (!isLocalAppPage(event.senderFrame?.url || "")) return { success: false, error: "仅本地工具页面可以读取 Skill" };
  return readInstalledSkill(payload);
});
handleDesktop("desktop:import-skill", (event) => {
  if (!isLocalAppPage(event.senderFrame?.url || "")) return { success: false, error: "仅本地工具页面可以导入 Skill" };
  return importPersonalSkill();
});
handleDesktop("desktop:delete-skill", (event, payload = {}) => {
  if (!isLocalAppPage(event.senderFrame?.url || "")) return { success: false, error: "仅本地工具页面可以删除 Skill" };
  return deletePersonalSkill(payload);
});
handleDesktop("desktop:open-skill-directory", (event) => {
  if (!isLocalAppPage(event.senderFrame?.url || "")) return { success: false, error: "仅本地工具页面可以打开 Skill 目录" };
  return openPersonalSkillDirectory();
});
handleDesktop("desktop:get-canvas-backup-directory", () => ({
  directory: canvasBackupRootDirectory()
}));

function isProjectStorageSettingsCaller(event) {
  if (event.senderFrame !== event.sender.mainFrame || !isLocalAppPage(event.senderFrame?.url || '')) return false;
  try { return ['index.html','homepage-test.html','asset-library.html','asset-library-test.html'].includes(path.basename(fileURLToPath(event.senderFrame.url)).toLowerCase()); }
  catch (_error) { return false; }
}
async function inspectStorageMigrationTabs() {
  if (!mainWindow || mainWindow.isDestroyed() || !shellReady) throw Error('页面尚未准备好，请稍后再试');
  if (activeCanvasApiCount || activeDesktopExports.size) throw Error('仍有生成、导出或识别请求正在运行，请完成后再迁移');
  const result = await withCloseTimeout(mainWindow.webContents.executeJavaScript(`(async()=>{
    for (const tab of tabs.values()) {
      if (tab.suspended) continue;
      let name='';try{name=new URL(tab.url).pathname.split('/').pop().toLowerCase()}catch{}
      if (!isNodeCanvasTab(tab)) {
        if (!['index.html','homepage-test.html','asset-library.html','asset-library-test.html'].includes(name)) return {success:false,error:'请先完成任务并关闭其他工具标签：'+(tab.title||name)};
        continue;
      }
      if (!tab.domReady || safeWebviewCall(tab.view,'isLoading',true)) return {success:false,error:'画布仍在加载，请稍后再试'};
      const state=await tab.view.executeJavaScript("({pending:(typeof nodes!=='undefined'&&nodes.some(n=>n.pending||n.promptRefineLoading))||(typeof psdJobs!=='undefined'&&psdJobs.size>0)||(typeof vectorJobs!=='undefined'&&vectorJobs.size>0)||(typeof audioJobs!=='undefined'&&audioJobs.size>0)||(typeof assistantSending!=='undefined'&&assistantSending)})");
      if (state.pending) return {success:false,error:'画布仍在生成或处理图片，请完成后再迁移：'+tab.title};
    }
    return {success:true};
  })()`), 60000, '页面状态检查暂未完成，已停止本次迁移。请等待页面恢复后重试');
  if (!result?.success) throw Error(result?.error || '无法确认所有画布状态，已停止迁移');
}
async function requestProjectStorageMigration(payload) {
  if (storageMigrationPreparing || updateInProgress) return {success:false,error:'正在执行其他保存或更新操作，请稍后重试'};
  storageMigrationPreparing=true;
  try {
    if (!mainWindow || mainWindow.isDestroyed()) throw Error('主窗口不可用');
    mainWindow.setEnabled(false);
    await inspectStorageMigrationTabs();
    reportProjectStorageProgress({phase:'saving',message:'正在保存并核对所有打开的画布…'});
    const report=await withCloseTimeout(mainWindow.webContents.executeJavaScript('saveAllOpenWorkflows()'), 120000, '迁移前保存暂未完成，已停止本次迁移。原数据目录未变');
    if (!report?.success) throw Error('画布保存未通过：'+(report?.failures||[]).map(item=>item.tabTitle+' '+(item.error||'')).join('；'));
    await inspectStorageMigrationTabs();
    if (storageMediaTokens.size) throw Error('原图仍在写入，请等待保存完成后再迁移');
    canvasStandardMedia.pause();
    await projectStorage.freeze();
    if (activeCanvasApiCount || storageMediaTokens.size || activeDesktopExports.size) throw Error('仍有后台任务或导出文件，请完成后重试');
    await projectStorage.prepare(payload);
    getApplicationSession().flushStorageData();
    reportProjectStorageProgress({phase:'restarting',message:'已保存，软件将重启并迁移。旧目录会完整保留。'});
    // After this point all project writers are frozen. Startup performs the copy
    // before any editing page exists; pagehide cannot race with the source copy.
    setTimeout(()=>{allowWindowClose=true;app.relaunch();app.quit();},250);
    return {success:true,restarting:true};
  } catch(error) {
    projectStorage.unfreeze();storageMigrationPreparing=false;canvasStandardMedia.resume();
    if(mainWindow&&!mainWindow.isDestroyed())mainWindow.setEnabled(true);
    reportProjectStorageProgress({phase:'error',message:error.message});
    return {success:false,error:error.message};
  }
}
handleDesktop('desktop:get-project-storage-info',async(event)=>{
  if(!isProjectStorageSettingsCaller(event))return{success:false,error:'仅本地存储设置可以查看项目目录'};
  return {...await projectStorage.info(),profileDirectory:app.getPath('userData'),
    browserSessionDirectory:applicationSession?.storagePath || '',
    browserSessionLegacyDirectory:app.getPath('userData'),
    browserSessionMigration:browserSessionInfo ? {migrated:Boolean(browserSessionInfo.migrated),resumed:Boolean(browserSessionInfo.resumed),files:browserSessionInfo.files,bytes:browserSessionInfo.bytes} : null,
    originalFiles:canvasStandardMedia.info()};
});
handleDesktop('desktop:get-storage-usage',(event)=>{
  if(!isProjectStorageSettingsCaller(event))return {success:false,error:'仅本地存储设置可以查看存储占用'};
  return withProjectStorage('read',()=>storageMaintenance.info());
});
handleDesktop('desktop:clear-network-cache',(event)=>{
  if(!isProjectStorageSettingsCaller(event))return {success:false,error:'仅本地存储设置可以清理网络缓存'};
  return storageMaintenance.clearCache();
});
handleDesktop('desktop:choose-project-storage-directory',async(event,payload={})=>{
  if(!isProjectStorageSettingsCaller(event))return{success:false,error:'仅本地存储设置可以选择项目目录'};
  try {
    if(payload?.useDefault===true)return await projectStorage.chooseDefault();
    const selected=await dialog.showOpenDialog(mainWindow,{title:'选择磁盘或父目录（将建立“豌豆AI数据”）',properties:['openDirectory','createDirectory']});
    if(selected.canceled||!selected.filePaths.length)return{success:false,canceled:true};
    return await projectStorage.choose(selected.filePaths[0]);
  }catch(error){return{success:false,error:error.message};}
});
handleDesktop('desktop:request-project-storage-migration',(event,payload={})=>{
  if(!isProjectStorageSettingsCaller(event))return{success:false,error:'仅本地存储设置可以迁移项目目录'};
  return requestProjectStorageMigration(payload);
});

app.whenReady().then(async () => {
  if(!primaryInstance)return;
  while(true){
    try{await projectStorage.prepareStartup();await projectStorage.available();break;}
    catch(error){const choice=await dialog.showMessageBox({type:'error',title:'项目存储目录不可用',message:error.message,buttons:['重试','退出'],defaultId:0,cancelId:1,noLink:true});if(choice.response!==0){app.quit();return;}}
  }
  // Even an in-memory BrowserWindow initializes Chromium's default storage on
  // Windows. Keep all webContents closed until the old browser library has been
  // copied and verified; otherwise its LevelDB LOCK files cannot be read.
  let migration;
  try{migration=await projectStorage.initialize();}
  catch(error){await dialog.showMessageBox({type:'error',title:'项目存储初始化失败',message:error.message,buttons:['退出']});app.quit();return;}
  if(migration?.success===false)await dialog.showMessageBox({type:'warning',title:'项目迁移未完成',message:'仍使用原目录，原数据没有删除。',detail:migration.error,buttons:['继续使用原目录']});
  while (true) {
    try {
      await projectStorage.available();
      browserSessionInfo = await browserSessionStorage.prepare();
      if (path.resolve(browserSessionInfo.sessionPath).toLowerCase() !== path.join(projectStorage.root(),'browser-session').toLowerCase()) throw new Error('浏览器存储不在已选择的受管项目目录');
      applicationSession = session.fromPath(browserSessionInfo.sessionPath);
      if (path.resolve(applicationSession.storagePath) !== path.resolve(browserSessionInfo.sessionPath)) throw new Error('浏览器存储路径核验失败');
      break;
    } catch (error) {
      // A missing or unverified target is never replaced by a fresh defaultSession.
      // Once a session exists, restarting is required; do not re-import over it.
      const buttons=applicationSession ? ['退出'] : ['重试','退出'];
      const choice=await dialog.showMessageBox({type:'error',title:'工作台存储初始化失败',message:error.message,detail:'旧数据会保留，不会打开空白工作台。请恢复目标磁盘或写入权限后重试。',buttons,defaultId:0,cancelId:buttons.length-1,noLink:true});
      if(applicationSession || choice.response!==0){app.quit();return;}
    }
  }
  applicationSession.protocol.handle('wandou-media', request => canvasMediaProtocol.handle(request));
  applicationStorageReady=true;
  applicationStorageStarting=false;
  createWindow();
  const originalFilesTimer = setTimeout(() => { void canvasStandardMedia.start(); }, 4000);
  originalFilesTimer.unref?.();
  if(storageProgressWindow&&!storageProgressWindow.isDestroyed())storageProgressWindow.destroy();storageProgressWindow=null;
  const testCloseDelay = Number(process.env.WANDOU_TEST_CLOSE_AFTER_MS || 0);
  if (Number.isInteger(testCloseDelay) && testCloseDelay >= 1000 && testCloseDelay <= 60000) {
    setTimeout(() => {
      // Packaged smoke tests use the normal close request, including renderer save
      // verification, instead of terminating the Electron process directly.
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.close();
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.executeJavaScript("document.getElementById('closeDialogConfirm')?.click()", true).catch(() => {});
        }
      }, 500);
    }, testCloseDelay);
  }
  const cleanupTimer = setTimeout(() => {
    cleanupStalePortableInstallBackups();
    cleanupStalePortableUpdateStages();
  }, 2500);
  cleanupTimer.unref?.();
  const completedStageTimer = setTimeout(() => { cleanupStalePortableUpdateStages(); }, 45 * 1000);
  completedStageTimer.unref?.();
  const stageCleanupTimer = setInterval(() => { cleanupStalePortableUpdateStages(); }, 10 * 60 * 1000);
  stageCleanupTimer.unref?.();
});
app.on('before-quit', () => { try { applicationSession?.flushStorageData(); } catch (_) {} });
app.on("window-all-closed", () => { if (!applicationStorageStarting && process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (applicationStorageReady && applicationSession && !storageMigrationPreparing && !storageOutageHandling && BrowserWindow.getAllWindows().length === 0) createWindow(); });
