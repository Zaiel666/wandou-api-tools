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

test("AI 音频节点按模型选择 Gemini 原生或 OpenAI Speech 路由并播放结果", async (t) => {
  const browser = await chromium.launch({ headless:true, executablePath:"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport:{ width:1400, height:1000 } });
  const errors = [];
  const requests = [];
  let geminiAttempts = 0;
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
  await page.route("https://www.zayapi.top/v1beta/models/gemini-3.1-flash-tts-preview:generateContent", async (route) => {
    const request = route.request();
    requests.push({
      route:"gemini-native",
      authorization:request.headers().authorization || "",
      contentType:request.headers()["content-type"] || "",
      body:request.postData() || ""
    });
    geminiAttempts += 1;
    if (geminiAttempts === 1) {
      return route.fulfill({ status:503, contentType:"application/json", body:'{"error":{"message":"temporary upstream failure"}}' });
    }
    return route.fulfill({ status:200, contentType:"application/json", body:JSON.stringify({
      candidates:[{ content:{ parts:[{ inlineData:{ mimeType:"audio/wav", data:tinyWav().toString("base64") } }] } }]
    }) });
  });
  await page.route("https://www.zayapi.top/v1/audio/speech", async (route) => {
    const request = route.request();
    requests.push({
      route:"openai-speech",
      authorization:request.headers().authorization || "",
      contentType:request.headers()["content-type"] || "",
      body:request.postData() || ""
    });
    return route.fulfill({ status:200, contentType:"audio/wav", body:tinyWav() });
  });
  await page.goto(pathToFileURL(canvasPath).href);
  await page.waitForFunction(() => document.body.dataset.canvasReady === "true");
  await page.evaluate(() => {
    nodes = [];
    links = [];
    selectedNodeId = null;
    render();
  });
  await page.locator('[data-add-node="audio"]').click();
  const audioNode = page.locator(".node.audio").last();
  assert.equal(await page.locator('[data-menu-node="audio"]').count(), 1);
  assert.equal(await audioNode.locator("[data-audio-model-trigger]").getAttribute("data-value"), "gemini-3.1-flash-tts-preview");
  assert.deepEqual(await audioNode.locator(".audio-quickbar button, .audio-quickbar label").allTextContents(), ["信息", "删除", "上传音频"]);
  assert.equal(await audioNode.locator(".audio-stage-empty", { hasText:"空音频节点" }).count(), 1);
  assert.equal(await audioNode.locator(".audio-composer").count(), 1);
  assert.equal(await audioNode.locator(".audio-quickbar").isVisible(), false, "未选中时应只显示紧凑音频卡片");
  assert.equal(await audioNode.locator(".audio-composer").isVisible(), false, "未选中时不应展开编辑器");
  if (process.env.AUDIO_UI_ARTIFACT_DIR) {
    fs.mkdirSync(process.env.AUDIO_UI_ARTIFACT_DIR, { recursive:true });
    await page.screenshot({ path:path.join(process.env.AUDIO_UI_ARTIFACT_DIR, "audio-node-collapsed-dark.png") });
  }
  await audioNode.locator("[data-audio-stage]").click();
  assert.equal(await audioNode.getAttribute("aria-selected"), "true");
  assert.equal(await audioNode.locator("[data-audio-stage]").getAttribute("aria-expanded"), "true");
  assert.equal(await audioNode.locator(".audio-quickbar").isVisible(), true, "选中时应显示悬浮快捷工具栏");
  assert.equal(await audioNode.locator(".audio-composer").isVisible(), true, "选中时应显示下方编辑面板");
  const selectedFrameStyle = await audioNode.evaluate((element) => {
    const style = getComputedStyle(element);
    return { borderStyle:style.borderStyle, outlineStyle:style.outlineStyle, boxShadow:style.boxShadow };
  });
  assert.deepEqual(selectedFrameStyle, { borderStyle:"none", outlineStyle:"none", boxShadow:"none" }, "音频节点外层不得出现绿色选中框");
  await page.mouse.click(300, 850);
  assert.equal(await audioNode.getAttribute("aria-selected"), "false", "点击画布空白处应取消节点选中");
  assert.equal(await audioNode.locator(".audio-composer").isVisible(), false, "点击画布空白处应收起详情面板");
  await audioNode.locator("[data-audio-stage]").click();
  assert.equal(await audioNode.locator("[data-audio-upload]").count(), 2, "上传入口应同时出现在快捷工具栏和参考内容区");
  await audioNode.locator("[data-audio-upload]").first().setInputFiles({ name:"node-audio.wav", mimeType:"audio/wav", buffer:tinyWav() });
  await audioNode.locator(".audio-stage-player audio").waitFor({ state:"attached", timeout:5000 });
  assert.equal(await audioNode.locator(".audio-stage-player audio").count(), 1, "上传音频后紧凑卡片应可直接播放");
  assert.equal(await audioNode.locator('[data-audio-format-option="wav"]').getAttribute("aria-checked"), "true");
  assert.equal(await audioNode.locator(".audio-info-panel, .audio-status").count(), 0, "底部技术说明和状态文字不应再暴露给用户");
  await audioNode.locator("[data-audio-settings-trigger]").click();
  assert.equal(await audioNode.locator("[data-audio-settings-popover]").isVisible(), true, "音频设置应使用统一弹出层");
  assert.equal(await audioNode.locator("[data-audio-voice-option]").count(), 5);
  assert.equal(await audioNode.locator("[data-audio-speed-option]").count(), 4);
  await audioNode.locator('[data-audio-speed-option="1.25"]').click();
  await audioNode.locator("[data-audio-instruction]").fill("自然、温暖、适合旁白");
  assert.match(await audioNode.locator("[data-audio-settings-trigger]").innerText(), /Kore · WAV · 1\.25×/);
  if (process.env.AUDIO_UI_ARTIFACT_DIR) {
    await page.screenshot({ path:path.join(process.env.AUDIO_UI_ARTIFACT_DIR, "audio-settings-popover-dark.png") });
  }
  await audioNode.locator("[data-audio-settings-close]").click();
  await audioNode.locator("[data-audio-guide]").click();
  assert.equal(await audioNode.locator(".audio-keyword-popover").isVisible(), true, "书本按钮应打开关键词弹出层");
  await audioNode.locator('[data-audio-keyword="沉稳"]').click();
  assert.match(await audioNode.locator("[data-audio-instruction]").inputValue(), /沉稳/, "关键词应写入声音指令");
  await audioNode.locator("[data-audio-settings-close]").click();
  await audioNode.locator("[data-audio-prompt]").fill("请用自然清晰的女声朗读：豌豆音频节点测试成功。");
  if (process.env.AUDIO_UI_ARTIFACT_DIR) {
    fs.mkdirSync(process.env.AUDIO_UI_ARTIFACT_DIR, { recursive:true });
    await page.screenshot({ path:path.join(process.env.AUDIO_UI_ARTIFACT_DIR, "audio-node-dark.png") });
    await page.evaluate(() => applyGlobalTheme("light"));
    await page.screenshot({ path:path.join(process.env.AUDIO_UI_ARTIFACT_DIR, "audio-node-light.png") });
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
    audioFormat:"wav",
    audioSpeed:1,
    references:[]
  }, new AbortController().signal));
  assert.equal(directResult.mediaType, "audio");
  assert.match(directResult.url, /^data:audio\/wav;base64,/);
  const openAiResult = await page.evaluate(() => callAudioApi({
    id:"direct-openai-audio-test",
    type:"audio",
    model:"gpt-4o-mini-tts",
    prompt:"OpenAI 语音路由测试",
    audioVoice:"marin",
    audioFormat:"wav",
    audioSpeed:1,
    references:[]
  }, new AbortController().signal));
  assert.equal(openAiResult.mediaType, "audio");
  assert.equal(requests.length, 4);
  assert.equal(requests[0].authorization, "Bearer audio-test-key");
  assert.equal(requests[0].route, "gemini-native");
  assert.match(requests[0].contentType, /^application\/json/i);
  assert.match(requests[0].body, /responseModalities/);
  assert.match(requests[0].body, /Kore/);
  assert.match(requests[0].body, /Voice direction/);
  assert.match(requests[0].body, /自然、温暖、适合旁白/);
  assert.doesNotMatch(requests[0].body, /reference_audio/);
  assert.equal(requests[1].route, "gemini-native", "a temporary 503 should be retried automatically");
  assert.match(requests[1].contentType, /^application\/json/i);
  assert.equal(requests[2].route, "gemini-native");
  assert.match(requests[2].body, /纯文字音频测试/);
  assert.equal(requests[3].route, "openai-speech");
  assert.match(requests[3].body, /gpt-4o-mini-tts/);
  assert.match(requests[3].body, /marin/);
  assert.deepEqual(errors, []);
});

test("PSD 图层计划按语义组去重并限制碎片数量", async (t) => {
  const browser = await chromium.launch({ headless:true, executablePath:"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(pathToFileURL(canvasPath).href);
  const grouped = await page.evaluate(() => psdLayerPlan(JSON.stringify({ layers:[
    { name:"麦克风网罩", category:"subject", group:"白色麦克风", description:"白色金属网罩与圆柱手柄", bounds:[120, 80, 360, 780] },
    { name:"麦克风手柄", category:"subject", group:"白色麦克风" },
    { name:"主标题第一行", category:"text", group:"主标题文字块", text:"替代剪贴板工具", bounds:[80, 120, 420, 90] },
    { name:"主标题第二行", category:"text", group:"主标题文字块" },
    { name:"蓝色光束", category:"lighting", group:"整体蓝色光效" },
    { name:"台面反光", category:"lighting", group:"整体蓝色光效" }
  ] })));
  assert.deepEqual(grouped, [
    { name:"白色麦克风", category:"subject", description:"白色金属网罩与圆柱手柄", text:"", bounds:[120, 80, 360, 780] },
    { name:"主标题文字块", category:"text", description:"", text:"替代剪贴板工具", bounds:[80, 120, 420, 90] },
    { name:"整体蓝色光效", category:"lighting", description:"", text:"", bounds:[] }
  ]);
});
