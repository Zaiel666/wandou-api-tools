const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(path.join(__dirname, "..", "desktop-client", "node_modules", "playwright"));

const canvasPath = path.resolve(__dirname, "../app/ai-node-canvas.html");

function tinyWav() {
  const samples = 800;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24);
  buffer.writeUInt32LE(32000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) {
    buffer.writeInt16LE(Math.round(Math.sin(index / 12) * 1800), 44 + index * 2);
  }
  return buffer;
}

test("AI 音频节点可上传参考音频、请求指定 TTS 模型并播放结果", async (t) => {
  const browser = await chromium.launch({ headless:true, executablePath:"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport:{ width:1400, height:1000 } });
  const errors = [];
  const requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("ai-tools-api-config", JSON.stringify({ key:"audio-test-key" }));
    localStorage.setItem("aiCanvasAssistantOpenV1", "0");
    localStorage.setItem("wd-theme", "dark");
  });
  await page.route("https://www.zayapi.top/v1/models", (route) => route.fulfill({
    status:200,
    contentType:"application/json",
    body:JSON.stringify({ data:[{ id:"gemini-3.1-flash-tts-preview" }, { id:"gpt-image-2.5-1k" }] })
  }));
  await page.route("https://www.zayapi.top/v1/audio/speech", async (route) => {
    const request = route.request();
    requests.push({
      authorization:request.headers().authorization || "",
      contentType:request.headers()["content-type"] || "",
      body:request.postData() || (await request.postDataBuffer())?.toString("latin1") || ""
    });
    return route.fulfill({ status:200, contentType:"audio/wav", body:tinyWav() });
  });
  await page.goto(pathToFileURL(canvasPath).href);
  await page.waitForFunction(() => document.body.dataset.canvasReady === "true");
  await page.locator('[data-add-node="audio"]').click();
  const audioNode = page.locator(".node.audio").last();
  assert.equal(await page.locator('[data-menu-node="audio"]').count(), 1);
  assert.equal(await audioNode.locator("[data-audio-model]").inputValue(), "gemini-3.1-flash-tts-preview");
  assert.deepEqual(await audioNode.locator(".audio-quickbar button, .audio-quickbar label").allTextContents(), ["信息", "删除", "上传音频"]);
  assert.equal(await audioNode.locator(".audio-stage-empty", { hasText:"空音频节点" }).count(), 1);
  assert.equal(await audioNode.locator(".audio-composer").count(), 1);
  await audioNode.locator("[data-audio-upload]").first().setInputFiles({ name:"reference.wav", mimeType:"audio/wav", buffer:tinyWav() });
  await audioNode.locator(".audio-reference-card audio").waitFor();
  assert.equal(await audioNode.locator(".audio-reference-card audio").count(), 1);
  assert.equal(await audioNode.locator(".audio-stage-player audio").count(), 1);
  await audioNode.locator("[data-audio-prompt]").fill("请用自然清晰的女声朗读：豌豆音频节点测试成功。");
  if (process.env.AUDIO_UI_ARTIFACT_DIR) {
    fs.mkdirSync(process.env.AUDIO_UI_ARTIFACT_DIR, { recursive:true });
    await audioNode.screenshot({ path:path.join(process.env.AUDIO_UI_ARTIFACT_DIR, "audio-node-dark.png") });
    await page.evaluate(() => applyGlobalTheme("light"));
    await audioNode.screenshot({ path:path.join(process.env.AUDIO_UI_ARTIFACT_DIR, "audio-node-light.png") });
    await page.evaluate(() => applyGlobalTheme("dark"));
  }
  await audioNode.locator("[data-audio-generate]").click();
  await page.waitForFunction(() => {
    const result = nodes.find((node) => node.type === "result" && node.mediaType === "audio" && !node.pending);
    return Boolean(result?.mediaUrl);
  });
  const result = page.locator(".node.result.audio-result").last();
  assert.equal(await result.locator("audio").count(), 1);
  await result.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector(".node.result.audio-result audio")?.getAttribute("src")?.startsWith("data:audio/wav"));
  const directResult = await page.evaluate(() => callAudioApi({
    id:"direct-audio-test",
    type:"audio",
    model:"gemini-3.1-flash-tts-preview",
    prompt:"纯文字音频测试",
    audioVoice:"Kore",
    audioFormat:"mp3",
    audioSpeed:1,
    references:[]
  }, new AbortController().signal));
  assert.equal(directResult.mediaType, "audio");
  assert.match(directResult.url, /^data:audio\/wav;base64,/);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].authorization, "Bearer audio-test-key");
  assert.match(requests[0].contentType, /^multipart\/form-data; boundary=/i);
  assert.match(requests[0].body, /gemini-3\.1-flash-tts-preview/);
  assert.match(requests[0].body, /reference_audio/);
  assert.match(requests[0].body, /reference\.wav/);
  assert.match(requests[1].contentType, /^application\/json/i);
  assert.match(requests[1].body, /纯文字音频测试/);
  assert.deepEqual(errors, []);
});

test("PSD 图层计划按语义组去重并限制碎片数量", async (t) => {
  const browser = await chromium.launch({ headless:true, executablePath:"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(pathToFileURL(canvasPath).href);
  const grouped = await page.evaluate(() => psdLayerPlan(JSON.stringify({ layers:[
    { name:"麦克风网罩", category:"subject", group:"白色麦克风" },
    { name:"麦克风手柄", category:"subject", group:"白色麦克风" },
    { name:"主标题第一行", category:"text", group:"主标题文字块" },
    { name:"主标题第二行", category:"text", group:"主标题文字块" },
    { name:"蓝色光束", category:"lighting", group:"整体蓝色光效" },
    { name:"台面反光", category:"lighting", group:"整体蓝色光效" }
  ] })));
  assert.deepEqual(grouped, [
    { name:"白色麦克风", category:"subject" },
    { name:"主标题文字块", category:"text" },
    { name:"整体蓝色光效", category:"lighting" }
  ]);
});
