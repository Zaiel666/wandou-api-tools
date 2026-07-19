const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const asar = require(path.join(__dirname, "..", "desktop-client", "node_modules", ".pnpm", "@electron+asar@3.4.1", "node_modules", "@electron", "asar"));

const root = path.resolve(__dirname, "..");
const desktop = path.join(root, "desktop-client");
const appStage = path.join(root, "build-output", "app-stage");
const output = path.join(root, "build-output", "win-unpacked");
const electronDist = path.join(desktop, "node_modules", ".pnpm", "electron@37.10.3", "node_modules", "electron", "dist");
const appAsar = path.join(output, "resources", "app.asar");

function findRcedit() {
  const pnpmRoot = path.join(desktop, "node_modules", ".pnpm");
  const installerPackage = fs.readdirSync(pnpmRoot).find((name) => name.startsWith("electron-winstaller@"));
  if (!installerPackage) throw new Error("rcedit provider electron-winstaller was not found");
  const executable = path.join(pnpmRoot, installerPackage, "node_modules", "electron-winstaller", "vendor", "rcedit.exe");
  if (!fs.existsSync(executable)) throw new Error(`rcedit was not found: ${executable}`);
  return executable;
}

function stampExecutable(executable, appVersion) {
  // rcedit cannot reliably open paths containing non-ASCII characters.
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "wandou-rcedit-"));
  const tempExe = path.join(temp, "wandou-ai-tools.exe");
  const tempIcon = path.join(temp, "logo.ico");
  const tempRcedit = path.join(temp, "rcedit.exe");
  try {
    fs.copyFileSync(executable, tempExe);
    fs.copyFileSync(path.join(root, "app", "logo.ico"), tempIcon);
    fs.copyFileSync(findRcedit(), tempRcedit);
    const result = spawnSync(tempRcedit, [
      tempExe,
      "--set-icon", tempIcon,
      "--set-file-version", appVersion,
      "--set-product-version", appVersion,
      "--set-version-string", "ProductName", "Wandou AI Tools",
      "--set-version-string", "FileDescription", "Wandou AI Tools",
      "--set-version-string", "OriginalFilename", "wandou-ai-tools.exe"
    ], { encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`Failed to stamp executable resources: ${result.stderr || result.stdout || result.status}`);
    }
    fs.copyFileSync(tempExe, executable);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function copyTree(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else fs.copyFileSync(from, to);
  }
}

async function build() {
  const appVersion = require(path.join(desktop, "package.json")).version;
  fs.rmSync(appStage, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.mkdirSync(appStage, { recursive: true });
  for (const file of ["main.js", "preload.js", "shell.html", "shell.css", "shell.js", "client-config.json", "package.json"]) {
    fs.copyFileSync(path.join(desktop, file), path.join(appStage, file));
  }
  const electronExe = path.join(output, "electron.exe");
  const appExe = path.join(output, "豌豆AI工具.exe");
  if (!fs.existsSync(electronExe) && !fs.existsSync(appExe)) {
    throw new Error(`Electron runtime was not staged: ${electronDist}`);
  }
  if (fs.existsSync(electronExe)) fs.renameSync(electronExe, appExe);
  stampExecutable(appExe, appVersion);
  fs.mkdirSync(path.dirname(appAsar), { recursive: true });
  await asar.createPackage(appStage, appAsar);
  const appResources = path.join(output, "resources", "app");
  fs.rmSync(appResources, { recursive: true, force: true });
  copyTree(path.join(root, "app"), appResources);
  fs.copyFileSync(path.join(desktop, "portable-updater.exe"), path.join(output, "resources", "portable-updater.exe"));
  const electronVersion = require(path.join(desktop, "node_modules", "electron", "package.json")).version;
  fs.writeFileSync(path.join(output, "version"), `${electronVersion}\n`, "utf8");
  fs.writeFileSync(
    path.join(output, "使用说明.txt"),
    `豌豆AI工具 v${appVersion}\n\n使用方法：双击“豌豆AI工具.exe”。\n本软件无需安装；有新版本时，顶部会显示“发现新版本”，点击即可自动更新。\n`,
    "utf8"
  );
  console.log(output);
}

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
