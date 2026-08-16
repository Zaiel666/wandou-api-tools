const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "desktop-client", "main.js"), "utf8");
const preload = fs.readFileSync(path.join(root, "desktop-client", "preload.js"), "utf8");
const canvas = fs.readFileSync(path.join(root, "app", "ai-node-canvas.html"), "utf8");

assert.match(preload, /wandouDesktopApi/);
assert.match(preload, /ipcRenderer\.invoke\("desktop:api-fetch"/);
assert.match(main, /ipcMain\.handle\("desktop:api-fetch"/);
assert.match(main, /isLocalAppPage\(event\.senderFrame\?\.url/);
assert.match(main, /isAllowedCanvasApiUrl\(url\)/);
assert.match(main, /MAX_DESKTOP_API_RESPONSE_BYTES/);
assert.match(main, /bodyBase64:\s*bytes\.toString\("base64"\)/);
assert.match(canvas, /async function fetchMaybeProxied\(/);
assert.match(canvas, /window\.wandouDesktopApi\?\.fetch && isDesktopApiEndpoint\(targetUrl\)/);
assert.match(canvas, /serializeDesktopApiBody\(options\.body\)/);
assert.match(canvas, /return desktopApiResponse\(result\)/);
assert.match(canvas, /接口请求失败：\$\{reason\}/);
assert.match(canvas, /generateOneResult\(sourceNode, pending/);
assert.match(canvas, /isRetryableGenerationError\(error\)/);

console.log("PASS: packaged image generation uses the guarded desktop API bridge with bounded responses and visible retry errors");
