const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const canvas = fs.readFileSync(path.join(root, "app", "ai-node-canvas.html"), "utf8");
const main = fs.readFileSync(path.join(root, "desktop-client", "main.js"), "utf8");
const preload = fs.readFileSync(path.join(root, "desktop-client", "preload.js"), "utf8");
const updater = fs.readFileSync(path.join(root, "desktop-client", "portable-updater.cs"), "utf8");
const fluidGlass = fs.readFileSync(path.join(root, "app", "fluid-glass.css"), "utf8");

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
  [canvas.includes('const autoSaveDbName = "wandou-auto-save-v1"'), "persistent save-directory database"],
  [main.includes('"save-directory.json"') && main.includes('desktop:write-save-file'), "native save-directory persistence"],
  [preload.includes("getSaveDirectory") && preload.includes("chooseSaveDirectory") && preload.includes("writeSaveFile"), "native save-directory bridge"],
  [canvas.includes('format: "wandou-node-project"') && canvas.includes("importProjectFile") && canvas.includes("exportCurrentProject"), "project migration package"],
  [canvas.includes("grid-template-columns: minmax(0, 1fr) 34px") && canvas.includes(".project-transfer-actions {\n      grid-row: 2;\n      grid-column: 1 / -1") && canvas.includes("#newProjectButton {\n      grid-row: 1;\n      grid-column: 1") && canvas.includes("#pinProjectHubButton {\n      grid-row: 1;\n      grid-column: 2") && canvas.includes("row-gap: 4px") && canvas.includes(".project-transfer-actions .wide-button {\n      margin-top: 0;"), "locked compact two-row project actions"],
  [canvas.includes("body.node-canvas-page::before") && canvas.includes(".canvas-wrap::after") && fluidGlass.includes("body.project-hub-page::before") && fluidGlass.includes("body.project-hub-page .shell::after"), "top accent strip suppression"],
  [canvas.includes("body.node-canvas-page.dark-theme .topbar") && canvas.includes("background: transparent !important") && canvas.includes("backdrop-filter: none !important"), "canvas toolbar remains transparent"],
  [fluidGlass.includes("two iOS-like material scales") && fluidGlass.includes("backdrop-filter: blur(28px)"), "project hub two-level material styling"]
];

const failed = checks.filter(([passed]) => !passed).map(([, label]) => label);
if (failed.length) throw new Error(`v1.0.25 regression: ${failed.join(", ")}`);
console.log(JSON.stringify({ passed: true, checks: checks.length }));
