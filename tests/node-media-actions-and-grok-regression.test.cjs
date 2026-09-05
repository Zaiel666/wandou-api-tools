const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const canvas = fs.readFileSync(path.resolve(__dirname, "../app/ai-node-canvas.html"), "utf8");
const main = fs.readFileSync(path.resolve(__dirname, "../desktop-client/main.js"), "utf8");
const preload = fs.readFileSync(path.resolve(__dirname, "../desktop-client/preload.js"), "utf8");

assert.match(canvas, /const imageModelOptions = \["GPT-image-2", "grok-imagine-image-2\.0",/);
assert.match(canvas, /"grok-imagine-image-2\.0": "grok-imagine-image-2\.0"/);
assert.match(canvas, /if \(model === "grok-imagine-image-2\.0"\) return \["1K", "2K"\]/);
assert.match(canvas, /imagePayload\.quality = grokImageModel \? "auto" : "high"/);
assert.match(canvas, /if \(grokImageModel\) imagePayload\.aspect_ratio = imagePayload\.size/);
assert.match(canvas, /navigator\.clipboard\.write\(\[new ClipboardItem\(\{ "image\/png": blobPromise \}\)\]\)/);
assert.match(canvas, /showToast\(`下载已开始：\$\{filename\}`, "success"\)/);
assert.match(canvas, /showToast\(`保存失败：\$\{result\?\.error \|\| "无法写入所选文件夹"\}`, "error", 4800\)/);
assert.match(canvas, /\.toast \{[\s\S]*?position: fixed;[\s\S]*?z-index: 500;/);
assert.match(preload, /copyImage: \(bytes\) => ipcRenderer\.invoke\("desktop:copy-image", \{ bytes \}\)/);
assert.match(main, /ipcMain\.handle\("desktop:copy-image"/);
assert.match(main, /nativeImage\.createFromBuffer\(bytes\)/);
assert.match(main, /clipboard\.writeImage\(image\)/);
assert.match(main, /if \(!bytes\.length\) return \{ success: false, error: "文件内容为空，未执行保存" \}/);

console.log("PASS: Grok image model and reliable save/copy/download feedback are wired into the node canvas");
