const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../app/ai-node-canvas.html"), "utf8");
const start = source.indexOf("    async function buildApiRequest(node, references) {");
const end = source.indexOf("\n    function collectReferenceItems(", start);
assert.ok(start >= 0 && end > start, "image request builder must exist");
const promptStart = source.indexOf("    function generatorPromptWithAnnotations(node, prompt, references = []) {");
const promptEnd = source.indexOf("\n    async function appendGeneratorAnnotationGuide(", promptStart);
assert.ok(promptStart >= 0 && promptEnd > promptStart, "annotation prompt builder must exist");

class TestFormData {
  constructor() { this.fields = new Map(); }
  append(name, value) {
    const values = this.fields.get(name) || [];
    values.push(value);
    this.fields.set(name, values);
  }
  get(name) { return this.fields.get(name)?.[0] ?? null; }
  getAll(name) { return this.fields.get(name) || []; }
}

const context = {
  FormData: TestFormData,
  imageGenerationApiModel: (model) => model,
  isGptImageModel: (model) => /^gpt-image-2(?:$|[-.])/i.test(model),
  isGrokImageModel: () => false,
  isOneKOnlyImageModel: () => false,
  promptRequestsTransparentPng: () => false,
  promptWithSize: (prompt) => `${prompt}\nGENERIC_RECOMPOSE_INSTRUCTION`,
  apiSafeGenerationSize: () => "1024x1024",
  apiSizeFromTarget: () => "1024x1024",
  referenceToPngFile: async () => ({ name:"reference.png" }),
  referenceToFile: async () => ({ name:"mask.png" })
};
vm.runInNewContext(`${source.slice(start, end)}\nthis.buildApiRequest = buildApiRequest;`, context);
const promptContext = {
  generatorAnnotationItems: () => [
    { referenceNumber:1, commentNumber:1, text:"删除左上角标志", region:{ x:.1, y:.1, w:.2, h:.2 } },
    { referenceNumber:1, commentNumber:2, text:"修改右下角日期", region:{ x:.7, y:.7, w:.2, h:.1 } }
  ]
};
vm.runInNewContext(`${source.slice(promptStart, promptEnd)}\nthis.buildPrompt = generatorPromptWithAnnotations;`, promptContext);

const reference = {
  url:"data:image/png;base64,AA==",
  maskUrl:"data:image/png;base64,AA==",
  maskSelectionUrl:"data:image/png;base64,AA==",
  maskWidth:1024,
  maskHeight:1024
};

test("masked edit keeps the selected GPT image model and sends one image plus one mask", async () => {
  for (const model of ["gpt-image-2.5-sunburst", "gpt-image-2.5-1k", "gpt-image-2"]) {
    const request = await context.buildApiRequest({
      type:"generator", model, prompt:"分别完成两处批注", count:1,
      resolution:"1K", _apiTargetSize:"1024x1024"
    }, [reference]);
    assert.equal(request.body.get("model"), model);
    assert.equal(request.body.getAll("image").length, 1);
    assert.equal(request.body.getAll("mask").length, 1);
    assert.match(request.body.get("prompt"), /分别完成两处批注/);
    assert.match(request.body.get("prompt"), /按批注编号分别检查每一处透明遮罩区域/);
    assert.doesNotMatch(request.body.get("prompt"), /GENERIC_RECOMPOSE_INSTRUCTION/);
  }
});

test("non-GPT masked edit retains the GPT mask-compatible fallback", async () => {
  const request = await context.buildApiRequest({
    type:"generator", model:"gemini-image", prompt:"局部修改", count:1,
    resolution:"1K", _apiTargetSize:"1024x1024"
  }, [reference]);
  assert.equal(request.body.get("model"), "gpt-image-2");
});

test("one-call annotation prompt includes every numbered edit and the guide role", () => {
  const prompt = promptContext.buildPrompt({ type:"generator" }, "保持原图", [
    reference,
    { annotationGuideFor:1 }
  ]);
  assert.match(prompt, /批注1[^\n]*删除左上角标志/);
  assert.match(prompt, /批注2[^\n]*修改右下角日期/);
  assert.match(prompt, /第 2 张参考图是图1的黄色编号批注定位图/);
});
