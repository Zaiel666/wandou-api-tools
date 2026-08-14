const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const updater = fs.readFileSync(path.resolve(__dirname, "..", "desktop-client", "portable-updater.cs"), "utf8");
const stopParent = updater.indexOf("StopParentProcess(parent, log)");
const stopInstallProcesses = updater.indexOf("StopInstallProcesses(install, executable, log)");
const extract = updater.indexOf("ZipFile.ExtractToDirectory(package, stage)");

assert.ok(stopParent > 0, "the updater must terminate the requesting Electron process");
assert.ok(stopInstallProcesses > stopParent, "remaining processes from the install directory must be stopped");
assert.ok(extract > stopInstallProcesses, "all application processes must stop before extraction and activation");
assert.doesNotMatch(updater, /ProcessStartInfo\("taskkill"/i, "the updater must not kill its own parent tree");
assert.match(updater, /StartsWith\(installRoot, StringComparison\.OrdinalIgnoreCase\)/, "orphan cleanup must stay inside the active install directory");
assert.match(updater, /MoveDirectoryWithRetry\(install, previous, log\)/, "directory activation must retry transient Windows locks");
assert.match(updater, /Thread\.Sleep\(250\)/, "the requesting process must be stopped before the old client's quit timer");
assert.match(updater, /Directory\.Move\(source, destination\)/, "the mapped old install must be moved aside as one directory");
assert.match(updater, /MoveDirectoryWithRetry\(stage, install, log\)/, "the complete staged release must be activated as one directory");
assert.match(updater, /Directory\.Move\(previous, install\)/, "a failed activation must restore the previous install");
assert.doesNotMatch(updater, /File\.Copy\(file, destination, true\)/, "Chromium resources must not be overwritten in place");
assert.match(updater, /StartApplicationWithRetry\(install, executable, log\)/, "automatic restart must use the retry path");
assert.match(updater, /Application restart launched process/, "restart attempts must be observable in the updater log");

console.log("PASS: portable updater survives parent shutdown, swaps the complete install, and retries restart");
