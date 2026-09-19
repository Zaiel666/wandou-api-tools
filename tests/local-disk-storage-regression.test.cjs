const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const mainSource = fs.readFileSync(path.resolve(__dirname, "../desktop-client/main.js"), "utf8");
const preloadSource = fs.readFileSync(path.resolve(__dirname, "../desktop-client/preload.js"), "utf8");
const cacheSource = fs.readFileSync(path.resolve(__dirname, "../app/local-cache.js"), "utf8");

function extractFunction(name) {
  const functionStart = mainSource.indexOf(`function ${name}(`);
  const asyncStart = mainSource.lastIndexOf("async ", functionStart);
  const start = asyncStart >= 0 && mainSource.slice(asyncStart, functionStart) === "async " ? asyncStart : functionStart;
  assert.notEqual(start, -1, `${name} must exist`);
  const open = mainSource.indexOf("{", mainSource.indexOf(")", start));
  let depth = 0;
  for (let index = open; index < mainSource.length; index += 1) {
    if (mainSource[index] === "{") depth += 1;
    if (mainSource[index] === "}") depth -= 1;
    if (depth === 0) return mainSource.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

(async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wandou-local-disk-"));
  try {
    const context = vm.createContext({
      app: { getPath: () => temporaryRoot },
      fs,
      path,
      process,
    });
    vm.runInContext([
      extractFunction("localDataRootDirectory"),
      extractFunction("safeLocalDataPath"),
      extractFunction("writeLocalData"),
      extractFunction("readLocalData"),
    ].join("\n"), context);

    const value = "本机磁盘数据".repeat(300000);
    const written = await context.writeLocalData({ path: "json/large-state.json", value });
    assert.equal(written.success, true);
    assert.ok(written.path.startsWith(path.join(temporaryRoot, "local-data")));
    const read = await context.readLocalData({ path: "json/large-state.json" });
    assert.equal(read.success, true);
    assert.equal(read.value, value);
    assert.equal(context.safeLocalDataPath("../../outside.json"), "", "path traversal must remain blocked");

    assert.doesNotMatch(mainSource, /Canvas backup is larger than 160 MB/);
    assert.doesNotMatch(mainSource, /stats\.size > 12 \* 1024 \* 1024/);
    assert.doesNotMatch(mainSource, /filter\(\(entry\) => entry\.isDirectory\(\)\)\s*\.slice\(0, 100\)/);
    assert.match(preloadSource, /writeLocalData:[\s\S]*desktop:write-local-data/);
    assert.match(preloadSource, /readLocalData:[\s\S]*desktop:read-local-data/);
    assert.match(cacheSource, /hasElectronDiskBridge[\s\S]*writeLocalData[\s\S]*readLocalData/);
    console.log("PASS: persistent app data uses unrestricted local disk files with safe paths");
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
