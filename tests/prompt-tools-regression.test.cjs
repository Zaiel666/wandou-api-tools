const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const { chromium } = require(path.join(root, "desktop-client", "node_modules", "playwright"));
const canvasPath = path.join(root, "app", "ai-node-canvas.html");
const chromePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(canvasPath).href);
    await page.waitForFunction(() => document.body.dataset.canvasReady === "true");

    const result = await page.evaluate(async () => {
      const calls = [];
      const originalFetch = window.fetchMaybeProxied;
      window.fetchMaybeProxied = async (url, options = {}) => {
        const body = JSON.parse(String(options.body || "{}"));
        calls.push({ url, body });
        if (body.model === "gpt-5.4") {
          return new Response(JSON.stringify({ error: { message: "model not found" } }), {
            status: 400,
            headers: { "Content-Type": "application/json" }
          });
        }
        return new Response(JSON.stringify({ choices: [{ message: { content: `优化完成-${body.model}` } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      };
      try {
        const headers = { "Content-Type": "application/json", Authorization: "Bearer sk-test-only" };
        const zayResult = await postPromptModelWithFallback(
          "https://www.zayapi.top/v1/images/generations",
          headers,
          { messages: [{ role: "user", content: "测试" }] },
          new AbortController().signal
        );
        const zexiResult = await postPromptModelWithFallback(
          "https://www.zexitongxue.com/v1/images/generations/async",
          headers,
          { messages: [{ role: "user", content: "测试" }] },
          new AbortController().signal
        );
        const interrupted = {
          id: "interrupted",
          type: "generator",
          promptRefineLoading: true,
          promptRefineOpen: true,
          promptRefineResult: "",
          references: []
        };
        await cleanLoadedNode(interrupted);
        return {
          calls,
          zayResult,
          zexiResult,
          interrupted,
          endpoints: [
            normalizeApiEndpoint("https://www.zayapi.top", { type: "keyword" }),
            normalizeApiEndpoint("https://www.zayapi.top/v1", { type: "keyword" }),
            normalizeApiEndpoint("https://www.zayapi.top/v1/images/edits", { type: "keyword" }),
            normalizeApiEndpoint("https://example.com/custom-endpoint", { type: "keyword" })
          ]
        };
      } finally {
        window.fetchMaybeProxied = originalFetch;
      }
    });

    assert.equal(result.calls.length, 3);
    assert.equal(result.calls[0].url, "https://www.zayapi.top/v1/chat/completions");
    assert.equal(result.calls[0].body.model, "gpt-5.4");
    assert.equal(result.calls[0].body.stream, false);
    assert.equal(result.calls[1].url, "https://www.zayapi.top/v1/chat/completions");
    assert.equal(result.calls[1].body.model, "claude-sonnet-4-6");
    assert.equal(result.zayResult.text, "优化完成-claude-sonnet-4-6");
    assert.equal(result.calls[2].url, "https://www.zexitongxue.com/v1/chat/completions");
    assert.equal(result.calls[2].body.model, "glm-5.2");
    assert.equal(result.zexiResult.text, "优化完成-glm-5.2");
    assert.deepEqual(result.endpoints, [
      "https://www.zayapi.top/v1/chat/completions",
      "https://www.zayapi.top/v1/chat/completions",
      "https://www.zayapi.top/v1/chat/completions",
      "https://example.com/custom-endpoint"
    ]);
    assert.equal(result.interrupted.promptRefineLoading, false);
    assert.equal(result.interrupted.promptRefineOpen, true);
    assert.match(result.interrupted.promptRefineResult, /^修改失败：上次修改被关闭或中断/);
  } finally {
    await browser.close();
  }

  console.log("PASS: prompt tools use chat endpoints, non-stream replies, model fallback, and recover interrupted UI state");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
