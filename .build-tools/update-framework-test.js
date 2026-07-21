const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const shell = fs.readFileSync(path.join(root, "desktop-client", "shell.js"), "utf8");
const html = fs.readFileSync(path.join(root, "desktop-client", "shell.html"), "utf8");
const main = fs.readFileSync(path.join(root, "desktop-client", "main.js"), "utf8");

const requirements = [
  [shell.includes("initializeClientState();"), "startup update initialization"],
  [shell.includes("refreshUpdateInfo({ retries: 2 })"), "startup/manual retry"],
  [shell.includes('versionText.addEventListener("click", checkForUpdatesManually)'), "manual update entry"],
  [shell.includes('window.addEventListener("online"'), "online recovery check"],
  [shell.includes("30 * 60 * 1000"), "periodic update check"],
  [html.includes('id="versionText"') && html.includes('title="检查更新"'), "visible update control"],
  [main.includes("SHA256 校验文件"), "missing release asset diagnosis"],
  [main.includes("cache: \"no-store\""), "cache bypass"]
];

const failed = requirements.filter(([passed]) => !passed).map(([, name]) => name);
if (failed.length) throw new Error(`Update framework regression: ${failed.join(", ")}`);
console.log(JSON.stringify({ passed: true, checks: requirements.length }));
