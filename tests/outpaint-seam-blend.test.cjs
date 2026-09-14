const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "app", "ai-node-canvas.html"), "utf8");
const begin = html.indexOf("function outpaintSeamWidth(");
const end = html.indexOf("async function composeOutpaintImage(", begin);
assert.ok(begin !== -1 && end > begin);
const { fadeOutpaintOriginalEdges, outpaintReferenceMismatch } = vm.runInNewContext(
  `${html.slice(begin, end)}\n({ fadeOutpaintOriginalEdges, outpaintReferenceMismatch })`
);

function retention(placement, expected, offsetX = 0, offsetY = 0) {
  const { width, height } = placement;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 3; index < data.length; index += 4) data[index] = 255;
  const ctx = {
    getImageData(x, y, w, h) {
      assert.deepEqual([x, y, w, h], [placement.x - offsetX, placement.y - offsetY, width, height]);
      return { data };
    },
    putImageData(image, x, y) {
      assert.equal(image.data, data);
      assert.deepEqual([x, y], [placement.x - offsetX, placement.y - offsetY]);
    }
  };
  fadeOutpaintOriginalEdges(ctx, placement, expected, offsetX, offsetY);
  return (x, y) => data[(y * width + x) * 4 + 3];
}

test("four-sided expansion transitions smoothly while preserving the original center", () => {
  const alpha = retention({ x: 150, y: 150, width: 600, height: 600 }, { width: 900, height: 900 });
  assert.equal(alpha(0, 300), 0);
  assert.ok(alpha(12, 300) > 0 && alpha(12, 300) < 255);
  assert.equal(alpha(24, 300), 255);
  assert.equal(alpha(300, 300), 255);
  assert.equal(alpha(599, 300), 0);
  assert.equal(alpha(300, 0), 0);
  assert.equal(alpha(300, 599), 0);
  for (let x = 1; x <= 24; x++) {
    assert.ok(alpha(x, 300) - alpha(x - 1, 300) <= 11, "the seam must not jump to full opacity");
  }
});

test("an unexpanded side keeps its original pixels to the canvas edge", () => {
  const alpha = retention({ x: 0, y: 100, width: 400, height: 400 }, { width: 600, height: 600 });
  assert.equal(alpha(0, 200), 255);
  assert.equal(alpha(399, 200), 0);
  assert.equal(alpha(200, 0), 0);
  assert.equal(alpha(200, 200), 255);
});

test("compositing on a source-sized layer uses local pixel coordinates", () => {
  const placement = { x: 50, y: 30, width: 200, height: 120 };
  const alpha = retention(placement, { width: 300, height: 180 }, 50, 30);
  assert.equal(alpha(0, 60), 0);
  assert.equal(alpha(100, 60), 255);
});

function solidPixels(size, red, green, blue, alpha = 255) {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = red;
    pixels[index + 1] = green;
    pixels[index + 2] = blue;
    pixels[index + 3] = alpha;
  }
  return pixels;
}

test("a redrawn source is detected instead of being pasted back as a rectangle", () => {
  const size = 64;
  const original = solidPixels(size, 20, 130, 180);
  assert.equal(outpaintReferenceMismatch(solidPixels(size, 20, 130, 180), original, size), false);
  assert.equal(outpaintReferenceMismatch(solidPixels(size, 140, 160, 50), original, size), true);
  assert.equal(outpaintReferenceMismatch(solidPixels(size, 0, 0, 0, 0), original, size), false,
    "an edit API may return a transparent center that still needs the original below it");
  const changedEdge = solidPixels(size, 20, 130, 180);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (x < 9 || x >= 55 || y < 9 || y >= 55) {
        const index = (y * size + x) * 4;
        changedEdge[index] += 16;
        changedEdge[index + 1] += 16;
        changedEdge[index + 2] += 16;
      }
    }
  }
  assert.equal(outpaintReferenceMismatch(changedEdge, original, size), true,
    "a subtle but continuous boundary mismatch should not become a visible rectangle");
});
