const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const capabilities = require("../app/image-model-capabilities.js");

const canvas = fs.readFileSync(path.resolve(__dirname, "../app/ai-node-canvas.html"), "utf8");
const main = fs.readFileSync(path.resolve(__dirname, "../desktop-client/main.js"), "utf8");
const preload = fs.readFileSync(path.resolve(__dirname, "../desktop-client/preload.js"), "utf8");

assert.match(canvas, /const imageModelOptions = \[[\s\S]*?\.\.\.gptImageModelOptions,[\s\S]*?"grok-imagine-image-2\.0"/);
assert.match(canvas, /"grok-imagine-image-2\.0": "grok-imagine-image-2\.0"/);
assert.deepEqual(capabilities.resolve("grok-imagine-image-2.0").nativeTiers, ["1K", "2K"]);
const modelContext = vm.createContext({ window:{WandouImageCapabilities:capabilities},modelToApiModel:value=>value });
for (const name of ["imageResolutionOptionsForModel", "imageNativeResolutionForModel"]) {
  const begin = canvas.indexOf("    function " + name + "(");
  const end = canvas.indexOf("\n    }", begin) + 6;
  vm.runInContext(canvas.slice(begin,end), modelContext);
}
assert.deepEqual(Array.from(modelContext.imageResolutionOptionsForModel("grok-imagine-image-2.0")), ["1K", "2K", "4K"]);
assert.equal(modelContext.imageNativeResolutionForModel("grok-imagine-image-2.0","4K"), "2K");
assert.match(canvas, /imagePayload\.quality = grokImageModel \? "auto" : "high"/);
assert.match(canvas, /imagePayload\.aspect_ratio = capability\.ratios \? window\.WandouImageCapabilities\.closestRatio\(targetSize, capability\.ratios\)/);
assert.match(canvas, /navigator\.clipboard\.write\(\[new ClipboardItem\(\{ "image\/png": blobPromise \}\)\]\)/);
assert.match(canvas, /showToast\(`下载已开始：\$\{filename\}`, "success"\)/);
assert.match(canvas, /showToast\(`保存失败：\$\{result\?\.error \|\| "无法写入所选文件夹"\}`, "error", 4800\)/);
assert.match(canvas, /\.toast \{[\s\S]*?position: fixed;[\s\S]*?z-index: 500;/);
assert.match(preload, /copyImage: \(bytes\) => ipcRenderer\.invoke\("desktop:copy-image", \{ bytes \}\)/);
assert.match(main, /handleDesktop\("desktop:copy-image"/);
assert.match(main, /nativeImage\.createFromBuffer\(bytes\)/);
assert.match(main, /clipboard\.writeImage\(image\)/);
assert.match(main, /if \(!bytes\.length\) return \{ success: false, error: "文件内容为空，未执行保存" \}/);

console.log("PASS: Grok image model and reliable save/copy/download feedback are wired into the node canvas");
