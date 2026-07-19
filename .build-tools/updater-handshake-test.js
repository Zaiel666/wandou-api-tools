const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const updater = path.join(root, "build-output", "win-unpacked", "resources", "portable-updater.exe");
const packagePath = path.resolve(root, "..", "..", "v1.0.16 GitHub上传文件", "wandou-ai-tools-windows-x64.zip");
const installDirectory = path.join(root, "updater-handshake-test");
const readyPath = path.join(installDirectory, "updater-ready.txt");
const restartMarker = path.join(installDirectory, "restart-complete.txt");
const restartScript = path.join(installDirectory, "restart-marker.cmd");
const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

function waitForFile(file, timeout, message) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (fs.existsSync(file)) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - startedAt > timeout) {
        clearInterval(timer);
        reject(new Error(message));
      }
    }, 100);
  });
}

async function main() {
  fs.rmSync(installDirectory, { recursive: true, force: true });
  fs.mkdirSync(installDirectory, { recursive: true });
  fs.writeFileSync(restartScript, "@echo off\r\necho restarted>\"%~dp0restart-complete.txt\"\r\n", "ascii");

  const oldApp = spawn(powershell, ["-NoProfile", "-Command", "Start-Sleep -Seconds 2"], { windowsHide: true });
  const startedAt = Date.now();
  const updaterProcess = spawn(updater, [
    "--install", installDirectory,
    "--package", packagePath,
    "--parent", String(oldApp.pid),
    "--exe", path.basename(restartScript),
    "--ready", readyPath,
    "--target", "1.0.16"
  ], { detached: true, stdio: "ignore", windowsHide: true });

  await waitForFile(readyPath, 15000, "Updater did not create its ready marker");
  const readyMs = Date.now() - startedAt;
  const exitCode = await new Promise((resolve, reject) => {
    updaterProcess.once("error", reject);
    updaterProcess.once("exit", resolve);
  });
  if (exitCode !== 0) throw new Error(`Updater exit code: ${exitCode}`);
  await waitForFile(restartMarker, 8000, "Updated application was not restarted");

  const version = fs.readFileSync(path.join(installDirectory, "resources", "app", "VERSION.txt"), "utf8").split(/\r?\n/)[0].trim();
  const installedExe = path.join(installDirectory, "豌豆AI工具.exe");
  if (version !== "v1.0.16" || !fs.existsSync(installedExe)) {
    throw new Error(`Unexpected installed result: version=${version}; executable=${fs.existsSync(installedExe)}`);
  }
  console.log(JSON.stringify({
    passed: true,
    readyMs,
    version,
    installedExe: fs.statSync(installedExe).size,
    restartConfirmed: true
  }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
