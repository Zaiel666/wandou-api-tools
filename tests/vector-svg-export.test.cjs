const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(path.join(__dirname, "..", "desktop-client", "node_modules", "playwright"));

async function downloadBuffer(download) {
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function downloadText(download) {
  return (await downloadBuffer(download)).toString("utf8");
}

test("vector node exports SVG and Adobe Illustrator AI in lossless and editable modes", async (t) => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ acceptDownloads: true });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve(__dirname, "../app/ai-node-canvas.html")).href);
  await page.waitForFunction(() => document.body.dataset.canvasReady === "true");
  await page.locator('[data-add-node="vector"]').click();
  await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 4;
    canvas.height = 2;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ff0000";
    context.fillRect(0, 0, 2, 2);
    context.fillStyle = "#0066ff";
    context.fillRect(2, 0, 2, 2);
    const node = nodes.find((item) => item.type === "vector");
    node.references = [{ url: canvas.toDataURL("image/png"), width:4, height:2, mediaType:"image" }];
    render();
  });

  const vectorNode = page.locator(".node.vector");
  assert.equal(await vectorNode.locator("[data-vector-mode]").inputValue(), "trace", "new vector nodes must default to real editable paths");
  await vectorNode.locator("[data-vector-mode]").selectOption("preserve");
  const preserveDownload = page.waitForEvent("download");
  await vectorNode.locator("[data-vector-generate]").click();
  const preserve = await preserveDownload;
  const preserveSvg = await downloadText(preserve);
  assert.match(preserve.suggestedFilename(), /\.svg$/i);
  assert.match(preserveSvg, /<image[^>]+data:image\/png;base64,/);
  assert.match(preserveSvg, /viewBox="0 0 4 2"/);

  await vectorNode.locator("[data-vector-mode]").selectOption("trace");
  const traceDownload = page.waitForEvent("download");
  await vectorNode.locator("[data-vector-generate]").click();
  const traceSvg = await downloadText(await traceDownload);
  assert.doesNotMatch(traceSvg, /<image/);
  assert.match(traceSvg, /inkscape:groupmode="layer"/);
  assert.match(traceSvg, /id="object-\d+-\d+"/);
  assert.match(traceSvg, /<path[^>]+fill="#ff0000"/);
  assert.match(traceSvg, /<path[^>]+fill="#0066ff"/);
  assert.match(traceSvg, /shape-rendering="crispEdges"/);

  await vectorNode.locator("[data-vector-format]").selectOption("ai");
  await vectorNode.locator("[data-vector-mode]").selectOption("preserve");
  const aiPreserveDownload = page.waitForEvent("download");
  await vectorNode.locator("[data-vector-generate]").click();
  const aiPreserve = await aiPreserveDownload;
  const aiPreserveBytes = await downloadBuffer(aiPreserve);
  assert.match(aiPreserve.suggestedFilename(), /\.ai$/i);
  assert.equal(aiPreserveBytes.subarray(0, 8).toString("ascii"), "%PDF-1.4");
  assert.match(aiPreserveBytes.toString("latin1"), /\/Subtype \/Image/);

  await vectorNode.locator("[data-vector-mode]").selectOption("trace");
  const aiTraceDownload = page.waitForEvent("download");
  await vectorNode.locator("[data-vector-generate]").click();
  const aiTraceBytes = await downloadBuffer(await aiTraceDownload);
  assert.equal(aiTraceBytes.subarray(0, 8).toString("ascii"), "%PDF-1.4");
  assert.match(aiTraceBytes.toString("latin1"), /\/ExtGState/);
  assert.match(aiTraceBytes.toString("latin1"), /\/Type \/OCG/);
  assert.doesNotMatch(aiTraceBytes.toString("latin1"), /\/Subtype \/Image/);

  await vectorNode.locator("[data-vector-format]").selectOption("eps");
  const epsDownload = page.waitForEvent("download");
  await vectorNode.locator("[data-vector-generate]").click();
  const eps = await epsDownload;
  const epsText = await downloadText(eps);
  assert.match(eps.suggestedFilename(), /\.eps$/i);
  assert.match(epsText, /^%!PS-Adobe-3\.0 EPSF-3\.0/);
  assert.match(epsText, /%%BeginLayer:/);
  assert.match(epsText, /%%BeginObject:/);
  assert.doesNotMatch(epsText, /image|colorimage/i);
  assert.ok(await vectorNode.locator("[data-vector-download]").evaluate((button) => button.getBoundingClientRect().height >= 48), "file download button should remain large and easy to click");
  assert.deepEqual(errors, []);
});
