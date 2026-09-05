const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const { chromium } = require(path.join(root, "desktop-client", "node_modules", "playwright"));
const canvasPath = path.join(root, "app", "ai-node-canvas.html");
const canvas = fs.readFileSync(canvasPath, "utf8");
const main = fs.readFileSync(path.join(root, "desktop-client", "main.js"), "utf8");

assert.match(canvas, /\/v1\/images\/generations\/async/);
assert.match(canvas, /async function pollImageResult\(/);
assert.match(canvas, /function imageContentEndpoint\(/);
assert.match(canvas, /async function fetchAuthenticatedImageResult\(/);
assert.match(canvas, /delete payload\.response_format/);
assert.match(main, /"www\.zexitongxue\.com"/);

const chromePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(canvasPath).href);
    await page.waitForFunction(() => document.body.dataset.canvasReady === "true");

    const result = await page.evaluate(async () => {
      document.getElementById("apiUrl").value = "https://www.zayapi.top/v1/images/generations";
      document.getElementById("apiKey").value = "sk-test-only";
      const calls = [];
      const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="), (char) => char.charCodeAt(0));
      const originalFetch = window.fetchMaybeProxied;
      window.fetchMaybeProxied = async (url, options = {}) => {
        const headers = new Headers(options.headers || {});
        calls.push({ url, method: options.method || "GET", authorization: headers.get("Authorization"), body: typeof options.body === "string" ? options.body : "" });
        if (url.endsWith("/v1/images/generations/async")) {
          return new Response(JSON.stringify({ id: "aiimg_test", task_id: "aiimg_test", status: "queued", data: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }
        if (url.includes("/v1/images/tasks/aiimg_test/content")) {
          return new Response(png, { status: 200, headers: { "Content-Type": "image/png" } });
        }
        if (url.endsWith("/v1/images/tasks/aiimg_test")) {
          return new Response(JSON.stringify({
            code: "success",
            data: {
              task_id: "aiimg_test",
              status: "SUCCESS",
              result_url: "/v1/images/tasks/aiimg_test/content?index=0"
            }
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        throw new Error(`unexpected URL: ${url}`);
      };
      try {
        const apiResult = await callApi({
          id: "node-test",
          type: "generator",
          model: "GPT-image-2",
          prompt: "test image",
          ratio: "1:1",
          resolution: "1K",
          count: 1
        }, new AbortController().signal);
        return { apiResult, calls };
      } finally {
        window.fetchMaybeProxied = originalFetch;
      }
    });

    assert.equal(result.calls.length, 3);
    assert.equal(result.calls[0].url, "https://www.zexitongxue.com/v1/images/generations/async");
    assert.equal(result.calls[1].url, "https://www.zexitongxue.com/v1/images/tasks/aiimg_test");
    assert.equal(result.calls[2].url, "https://www.zexitongxue.com/v1/images/tasks/aiimg_test/content?index=0");
    assert.equal(result.calls[2].authorization, "Bearer sk-test-only");
    const submitBody = JSON.parse(result.calls[0].body);
    assert.equal(submitBody.model, "gpt-image-2");
    assert.equal(submitBody.size, "1024x1024");
    assert.ok(!("resolution" in submitBody));
    assert.ok(!("output_format" in submitBody));
    assert.ok(!("response_format" in submitBody));
    assert.match(result.apiResult.url, /^data:image\/png;base64,/);
    assert.equal(result.apiResult.mediaType, "image");
    assert.equal(result.apiResult.fromApi, true);
  } finally {
    await browser.close();
  }

  console.log("PASS: official image generation submits asynchronously, polls the task, and downloads the authenticated PNG result");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
