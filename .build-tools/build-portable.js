const fs = require("fs");
const path = require("path");
const asar = require(path.join(__dirname, "..", "desktop-client", "node_modules", ".pnpm", "@electron+asar@3.4.1", "node_modules", "@electron", "asar"));

const root = path.resolve(__dirname, "..");
const desktop = path.join(root, "desktop-client");
const appStage = path.join(root, "build-output", "app-stage");
const output = path.join(root, "build-output", "win-unpacked");
const electronDist = path.join(desktop, "node_modules", ".pnpm", "electron@37.10.3", "node_modules", "electron", "dist");
const appAsar = path.join(output, "resources", "app.asar");

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
  fs.mkdirSync(path.dirname(appAsar), { recursive: true });
  await asar.createPackage(appStage, appAsar);
  const appResources = path.join(output, "resources", "app");
  fs.rmSync(appResources, { recursive: true, force: true });
  copyTree(path.join(root, "app"), appResources);
  fs.copyFileSync(path.join(desktop, "portable-updater.exe"), path.join(output, "resources", "portable-updater.exe"));
  const appVersion = require(path.join(desktop, "package.json")).version;
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
