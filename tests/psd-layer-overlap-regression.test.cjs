const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(path.join(__dirname, "..", "desktop-client", "node_modules", "playwright"));

test("PSD text, subject and element layers do not duplicate the same pixels", async (t) => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(pathToFileURL(path.resolve(__dirname, "../app/ai-node-canvas.html")).href);

  const result = await page.evaluate(() => {
    const makeLayer = (left, top, width, height, color) => {
      const canvas = psdCanvas(10, 10);
      const context = canvas.getContext("2d");
      context.fillStyle = color;
      context.fillRect(left, top, width, height);
      return canvas;
    };
    const subject = makeLayer(1, 1, 8, 8, "rgba(255,0,0,1)");
    const text = makeLayer(3, 3, 4, 4, "rgba(255,255,255,1)");
    const element = makeLayer(5, 5, 5, 5, "rgba(0,0,255,1)");
    psdMakeObjectLayersDisjoint(
      [subject, text, element],
      [{ category:"subject" }, { category:"text" }, { category:"element" }]
    );
    const alpha = (canvas, x, y) => canvas.getContext("2d").getImageData(x, y, 1, 1).data[3];
    return {
      textCenter:alpha(text, 4, 4),
      subjectUnderText:alpha(subject, 4, 4),
      subjectOnly:alpha(subject, 2, 2),
      elementUnderText:alpha(element, 5, 5),
      elementOnly:alpha(element, 9, 9),
    };
  });

  assert.equal(result.textCenter, 255, "text must retain its own pixels");
  assert.equal(result.subjectUnderText, 0, "text pixels must be removed from the subject layer");
  assert.equal(result.subjectOnly, 255, "non-overlapping subject pixels must remain");
  assert.equal(result.elementUnderText, 0, "text pixels must not be duplicated in an element layer");
  assert.equal(result.elementOnly, 255, "non-overlapping element pixels must remain");
});
