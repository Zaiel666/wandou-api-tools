const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "..", "desktop-client", "main.js"), "utf8");

function extractFunction(name) {
  const functionStart = source.indexOf(`function ${name}(`);
  const asyncStart = source.lastIndexOf("async ", functionStart);
  const start = asyncStart >= 0 && source.slice(asyncStart, functionStart) === "async " ? asyncStart : functionStart;
  assert.notEqual(start, -1, `${name} must exist`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

const writes = [];
const context = vm.createContext({
  writeCanvasMedia: async ({ id, value }) => {
    writes.push({ id, length: value.length });
    return { success: true };
  },
});
vm.runInContext(`${extractFunction("canvasMediaStorageId")}\n${extractFunction("compactEmbeddedCanvasMedia")}`, context);

(async () => {
  const image = `data:image/png;base64,${"A".repeat(1_250_000)}`;
  const state = {
    nodes: [{ id: 1, sourceUrl: image, futureMediaField: { original: image } }],
    links: [],
  };
  const compact = await context.compactEmbeddedCanvasMedia(state);
  assert.match(compact.nodes[0].sourceUrl, /^indexed-media:/);
  assert.equal(compact.nodes[0].futureMediaField.original, compact.nodes[0].sourceUrl);
  assert.equal(writes.length, 1, "duplicate images are written once even across unknown future fields");
  assert.equal(state.nodes[0].sourceUrl, image, "the renderer payload is not mutated during backup");
  console.log("PASS: desktop backup compacts legacy and future embedded image fields");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
