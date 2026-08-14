const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const updater = fs.readFileSync(path.resolve(__dirname, "..", "desktop-client", "portable-updater.cs"), "utf8");
const taskkill = updater.indexOf('ProcessStartInfo("taskkill"');
const stopInstallProcesses = updater.indexOf("StopInstallProcesses(install, executable, log)");
const extract = updater.indexOf("ZipFile.ExtractToDirectory(package, stage)");

assert.ok(taskkill > 0, "the updater must terminate the Electron process tree");
assert.ok(stopInstallProcesses > taskkill, "remaining processes from the install directory must be stopped");
assert.ok(extract > stopInstallProcesses, "all application processes must stop before extraction and activation");
assert.doesNotMatch(updater, /taskkill[^\n]+\/IM/, "unrelated portable copies with the same image name must not be terminated");
assert.match(updater, /StartsWith\(installRoot, StringComparison\.OrdinalIgnoreCase\)/, "orphan cleanup must stay inside the active install directory");
assert.match(updater, /MoveDirectoryWithRetry\(install, previous, log\)/, "directory activation must retry transient Windows locks");
assert.match(updater, /Thread\.Sleep\(250\)/, "the process tree must be stopped before the old client's quit timer");
assert.doesNotMatch(
  updater.slice(updater.indexOf('File.WriteAllText(ready, "ready")'), taskkill),
  /WaitForExit\(30000\)/,
  "waiting for the parent before taskkill orphans Electron renderer/GPU children",
);
assert.match(updater, /Directory\.Move\(source, destination\)/, "the mapped old install must be moved aside as one directory");
assert.match(updater, /MoveDirectoryWithRetry\(stage, install, log\)/, "the complete staged release must be activated as one directory");
assert.match(updater, /Directory\.Move\(previous, install\)/, "a failed activation must restore the previous install");
assert.doesNotMatch(updater, /File\.Copy\(file, destination, true\)/, "Chromium resources must not be overwritten in place");

console.log("PASS: portable updater kills Electron and atomically swaps the complete install directory");
