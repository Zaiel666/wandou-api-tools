const { app, BrowserWindow, ipcMain, Menu, shell, net, session, dialog } = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { pathToFileURL, fileURLToPath } = require("url");

const APP_NAME = "豌豆AI工具";
const TRUSTED_WEB_APPS = new Set(["wandou-video-workbench.netlify.app"]);
const CANVAS_API_HOSTS = new Set(["zayapi.top", "www.zayapi.top"]);
const MAX_DESKTOP_API_RESPONSE_BYTES = 32 * 1024 * 1024;
const MAX_SKILL_INSTRUCTIONS_BYTES = 256 * 1024;

let mainWindow = null;
let allowWindowClose = false;
let closePromptPending = false;
let shellReady = false;
let downloadListenerReady = false;
let updateInProgress = false;
let installedSkillsCache = { savedAt: 0, items: [] };

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

function isAllowedCanvasApiUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && CANVAS_API_HOSTS.has(parsed.hostname.toLowerCase());
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
  return path.join(app.getPath("userData"), "canvas-backups");
}

function canvasMediaRootDirectory() {
  return path.join(app.getPath("userData"), "canvas-media");
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

async function hasCanvasMedia(payload = {}) {
  const id = safeCanvasBackupId(payload.id, "");
  if (!id) return { success: false, exists: false, error: "Invalid media id" };
  return { success: true, exists: fs.existsSync(canvasMediaPath(id)) };
}

async function writeCanvasMedia(payload = {}) {
  const id = safeCanvasBackupId(payload.id, "");
  const value = typeof payload.value === "string" ? payload.value : "";
  if (!id || !value.startsWith("data:")) return { success: false, error: "Invalid canvas media" };
  if (Buffer.byteLength(value, "utf8") > 96 * 1024 * 1024) {
    return { success: false, error: "Canvas media is larger than 96 MB" };
  }
  try {
    const destination = canvasMediaPath(id);
    if (fs.existsSync(destination)) return { success: true, path: destination, deduplicated: true };
    await fs.promises.mkdir(canvasMediaRootDirectory(), { recursive: true });
    const temporary = `${destination}.${process.pid}-${crypto.randomBytes(4).toString("hex")}.tmp`;
    await fs.promises.writeFile(temporary, value, "utf8");
    try {
      await fs.promises.rename(temporary, destination);
    } catch (error) {
      if (!fs.existsSync(destination)) throw error;
      await fs.promises.unlink(temporary).catch(() => {});
    }
    return { success: true, path: destination };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function readCanvasMedia(payload = {}) {
  const id = safeCanvasBackupId(payload.id, "");
  if (!id) return { success: false, value: "", error: "Invalid media id" };
  try {
    const value = await fs.promises.readFile(canvasMediaPath(id), "utf8");
    return { success: value.startsWith("data:"), value: value.startsWith("data:") ? value : "" };
  } catch (error) {
    if (error.code === "ENOENT") return { success: false, value: "", missing: true };
    return { success: false, value: "", error: error.message };
  }
}

function canvasBackupDirectory(folderId, projectId) {
  return path.join(
    canvasBackupRootDirectory(),
    safeCanvasBackupId(folderId, "default-folder"),
    safeCanvasBackupId(projectId, "default-project")
  );
}

function canvasBackupFingerprint(state) {
  const stableState = { ...state, savedAt: 0 };
  return crypto.createHash("sha256").update(JSON.stringify(stableState)).digest("hex");
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
  let hash = 0;
  for (let index = 0; index < value.length; index += Math.max(1, Math.floor(value.length / 4096))) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return `${Math.abs(hash).toString(36)}-${value.length}`;
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
  try {
    state = await compactEmbeddedCanvasMedia(state);
  } catch (error) {
    return { success: false, error: error.message || "图片独立存储失败" };
  }
  if (containsEmbeddedCanvasMedia(state)) {
    const field = embeddedCanvasMediaPath(state);
    return { success: false, error: `图片仍未完成独立存储${field ? `：${field}` : ""}` };
  }
  const folderId = safeCanvasBackupId(payload.folderId, "default-folder");
  const projectId = safeCanvasBackupId(payload.projectId, "default-project");
  const savedAt = Number(state.savedAt) || Date.now();
  const envelope = {
    format: "wandou-canvas-backup",
    version: 1,
    folderId,
    projectId,
    savedAt,
    state
  };
  const serialized = JSON.stringify(envelope);
  if (Buffer.byteLength(serialized, "utf8") > 160 * 1024 * 1024) {
    return { success: false, error: "Canvas backup is larger than 160 MB" };
  }
  try {
    const directory = canvasBackupDirectory(folderId, projectId);
    await fs.promises.mkdir(directory, { recursive: true });
    const fingerprint = canvasBackupFingerprint(state);
    const fingerprintPath = path.join(directory, ".latest-backup.json");
    try {
      const latest = JSON.parse(await fs.promises.readFile(fingerprintPath, "utf8"));
      if (latest?.fingerprint === fingerprint && latest?.path && fs.existsSync(latest.path)) {
        return { success: true, path: latest.path, savedAt, deduplicated: true };
      }
    } catch (_error) {
      // 首次保存或旧版本没有指纹文件时继续写入新快照。
    }
    const suffix = crypto.randomBytes(4).toString("hex");
    const destination = path.join(directory, `${savedAt}-${suffix}.json`);
    const temporary = `${destination}.tmp`;
    await fs.promises.writeFile(temporary, serialized, "utf8");
    await fs.promises.rename(temporary, destination);
    const fingerprintTemporary = `${fingerprintPath}.tmp`;
    await fs.promises.writeFile(fingerprintTemporary, JSON.stringify({ fingerprint, path: destination, savedAt }), "utf8");
    await fs.promises.rename(fingerprintTemporary, fingerprintPath);
    const snapshots = (await fs.promises.readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /^\d+-[0-9a-f]+\.json$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => Number(right.split("-")[0]) - Number(left.split("-")[0]));
    await Promise.all(snapshots.slice(12).map((name) =>
      fs.promises.unlink(path.join(directory, name)).catch(() => {})
    ));
    return { success: true, path: destination, savedAt };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function readCanvasBackups(payload = {}) {
  const folderId = safeCanvasBackupId(payload.folderId, "default-folder");
  const projectId = safeCanvasBackupId(payload.projectId, "default-project");
  const directory = canvasBackupDirectory(folderId, projectId);
  try {
    const snapshots = (await fs.promises.readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /^\d+-[0-9a-f]+\.json$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => Number(right.split("-")[0]) - Number(left.split("-")[0]))
      .slice(0, 12);
    const states = [];
    let skippedLarge = 0;
    for (const name of snapshots) {
      if (states.length >= 3) break;
      try {
        const backupPath = path.join(directory, name);
        const stats = await fs.promises.stat(backupPath);
        // Old builds could embed every base64 image in every JSON snapshot. Reading
        // twelve 100+ MB snapshots during project startup blocks Electron's main
        // process and makes every tab appear frozen. Current saves keep media in
        // canvas-media, so oversized legacy snapshots remain on disk for manual
        // recovery but are not parsed during normal startup.
        if (stats.size > 12 * 1024 * 1024) {
          skippedLarge += 1;
          continue;
        }
        const backup = JSON.parse(await fs.promises.readFile(backupPath, "utf8"));
        if (backup?.format === "wandou-canvas-backup" && Array.isArray(backup.state?.nodes)) {
          states.push(backup.state);
        }
      } catch (_error) {
        // A damaged snapshot must not prevent older snapshots from being read.
      }
    }
    return { success: true, states, skippedLarge };
  } catch (error) {
    if (error.code === "ENOENT") return { success: true, states: [] };
    return { success: false, states: [], error: error.message };
  }
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
      const response = await fetchWithTimeout(source, {
        cache: "no-store",
        redirect: "follow",
        headers: {
          Accept: "application/octet-stream, application/vnd.github+json;q=0.9, */*;q=0.8",
          "User-Agent": "WandouAI-Desktop-Updater"
        }
      }, 120000);
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
  if (!updateInfo?.saveVerified || Date.now() - Number(updateInfo.saveVerifiedAt || 0) > 30000) {
    return { started: false, error: "更新前的工作流保存尚未通过校验，已停止更新" };
  }
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
        if (!fs.existsSync(readyPath)) finish(new Error(`更新程序提前退出（代码 ${code ?? "未知"}），软件不会关闭`));
      });
      timer = setInterval(() => {
        if (fs.existsSync(readyPath)) return finish();
        if (Date.now() - startedAt > 15000) finish(new Error("更新程序 15 秒内没有成功接管，软件不会关闭，请重试"));
      }, 120);
    });

    child.unref();
    allowWindowClose = true;
    setTimeout(() => app.quit(), 4000);
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
  shellReady = false;
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
    if (!shellReady) return;
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
    shellReady = false;
  });
  mainWindow.on("unresponsive", async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const choice = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: APP_NAME,
      message: "页面暂时没有响应",
      detail: "通常由大量图片同时加载或保存引起。可等待恢复；若持续无响应，可重新载入当前软件页面。",
      buttons: ["继续等待", "重新载入", "立即关闭"],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    });
    if (choice.response === 1 && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.reloadIgnoringCache();
    }
    if (choice.response === 2 && mainWindow && !mainWindow.isDestroyed()) {
      allowWindowClose = true;
      mainWindow.destroy();
    }
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
ipcMain.handle("desktop:api-fetch", async (event, payload = {}) => {
  if (!isLocalAppPage(event.senderFrame?.url || "")) throw new Error("仅本地工具页面可以调用 API 请求");
  const url = String(payload.url || "");
  if (!isAllowedCanvasApiUrl(url)) throw new Error("接口地址不在允许范围内");

  const request = payload.request || {};
  const method = String(request.method || "GET").toUpperCase();
  if (!/^(GET|POST)$/.test(method)) throw new Error("不支持的 API 请求方法");
  const response = await net.fetch(url, {
    method,
    headers: apiRequestHeaders(request.headers),
    body: apiRequestBody(request)
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_DESKTOP_API_RESPONSE_BYTES) throw new Error("接口响应超过 32 MB，无法传回页面");
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers.entries()],
    bodyBase64: bytes.toString("base64")
  };
});
ipcMain.on("desktop:set-theme", (_event, theme) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const dark = theme === "dark";
  mainWindow.setTitleBarOverlay({ color: dark ? "#0c0e0d" : "#ffffff", symbolColor: dark ? "#eef6f0" : "#203128", height: 48 });
});
ipcMain.on("desktop:shell-ready", () => { shellReady = true; });
ipcMain.on("desktop:cancel-close", () => { closePromptPending = false; });
ipcMain.handle("desktop:confirm-close", (_event, verification = {}) => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (!verification.saveVerified || Date.now() - Number(verification.verifiedAt || 0) > 30000) return false;
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
ipcMain.handle("desktop:create-save-directory", async (_event, payload = {}) => {
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
ipcMain.handle("desktop:write-save-file", async (_event, payload = {}) => {
  const rootDirectory = readSavedDirectory();
  if (!rootDirectory) return { success: false, missingDirectory: true };
  try {
    const folderName = safeOutputFolderName(payload.folderName);
    const directory = folderName ? path.join(rootDirectory, folderName) : rootDirectory;
    if (folderName) await fs.promises.mkdir(directory, { recursive: true });
    const destination = uniqueOutputPath(directory, payload.filename);
    await fs.promises.writeFile(destination, Buffer.from(payload.bytes || []));
    return { success: true, path: destination, filename: path.basename(destination) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
ipcMain.handle("desktop:write-canvas-backup", (_event, payload = {}) => writeCanvasBackup(payload));
ipcMain.handle("desktop:read-canvas-backups", (_event, payload = {}) => readCanvasBackups(payload));
ipcMain.handle("desktop:has-canvas-media", (_event, payload = {}) => hasCanvasMedia(payload));
ipcMain.handle("desktop:write-canvas-media", (_event, payload = {}) => writeCanvasMedia(payload));
ipcMain.handle("desktop:read-canvas-media", (_event, payload = {}) => readCanvasMedia(payload));
ipcMain.handle("desktop:list-skills", (event) => {
  if (!isLocalAppPage(event.senderFrame?.url || "")) return [];
  return publicInstalledSkills();
});
ipcMain.handle("desktop:read-skill", (event, payload = {}) => {
  if (!isLocalAppPage(event.senderFrame?.url || "")) return { success: false, error: "仅本地工具页面可以读取 Skill" };
  return readInstalledSkill(payload);
});
ipcMain.handle("desktop:import-skill", (event) => {
  if (!isLocalAppPage(event.senderFrame?.url || "")) return { success: false, error: "仅本地工具页面可以导入 Skill" };
  return importPersonalSkill();
});
ipcMain.handle("desktop:delete-skill", (event, payload = {}) => {
  if (!isLocalAppPage(event.senderFrame?.url || "")) return { success: false, error: "仅本地工具页面可以删除 Skill" };
  return deletePersonalSkill(payload);
});
ipcMain.handle("desktop:get-canvas-backup-directory", () => ({
  directory: canvasBackupRootDirectory()
}));

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
