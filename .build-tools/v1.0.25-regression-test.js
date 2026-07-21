const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const canvas = fs.readFileSync(path.join(root, "app", "ai-node-canvas.html"), "utf8");
const main = fs.readFileSync(path.join(root, "desktop-client", "main.js"), "utf8");
const updater = fs.readFileSync(path.join(root, "desktop-client", "portable-updater.cs"), "utf8");

const checks = [
  [canvas.includes("refreshRenderedNode(pendingNodes[index].id)"), "single-node batch refresh"],
  [canvas.includes("createPreviewImageUrl(url, 320"), "lightweight display preview"],
  [canvas.includes("fitCanvasToContent(true)"), "automatic large-canvas fit"],
  [canvas.includes("attempt < 3") && canvas.includes("isRetryableGenerationError"), "per-image retry"],
  [canvas.includes('classList.toggle("low-detail"'), "low-detail zoom mode"],
  [!main.match(/TRUSTED_WEB_APPS[^\n]+zayapi/), "product center uses external browser"],
  [main.includes('if (isSafeHttpsUrl(payload.url)) shell.openExternal(payload.url);'), "external tab IPC opens system browser"],
  [canvas.includes("will-change: auto") && canvas.includes(".canvas-wrap.is-panning .lines"), "lightweight pan composition"],
  [canvas.includes('lines.querySelectorAll(".temp-line").forEach((element) => element.remove())'), "temporary connection cleanup"],
  [updater.includes("CopyDirectory(stage, install)") && !updater.includes("Directory.Delete(install"), "update preserves user folders"],
  [canvas.includes('const autoSaveDbName = "wandou-auto-save-v1"'), "persistent save-directory database"]
];

const failed = checks.filter(([passed]) => !passed).map(([, label]) => label);
if (failed.length) throw new Error(`v1.0.25 regression: ${failed.join(", ")}`);
console.log(JSON.stringify({ passed: true, checks: checks.length }));
