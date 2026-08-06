const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const updater = fs.readFileSync(path.resolve(__dirname, "..", "desktop-client", "portable-updater.cs"), "utf8");
const taskkill = updater.indexOf('ProcessStartInfo("taskkill"');
const imageKill = updater.indexOf('/IM \\"" + executable');
const stopInstallProcesses = updater.indexOf("StopInstallProcesses(install, executable, log)");
const extract = updater.indexOf("ZipFile.ExtractToDirectory(package, stage)");

assert.ok(taskkill > 0, "the updater must terminate the Electron process tree");
assert.ok(imageKill > taskkill, "orphaned application instances must also be terminated by image name");
assert.ok(stopInstallProcesses > taskkill, "remaining processes from the install directory must be stopped");
assert.ok(extract > stopInstallProcesses, "all application processes must stop before extraction and copy");
assert.match(updater, /Thread\.Sleep\(250\)/, "the process tree must be stopped before the old client's 900 ms quit timer");
assert.doesNotMatch(
  updater.slice(updater.indexOf('File.WriteAllText(ready, "ready")'), taskkill),
  /WaitForExit\(30000\)/,
  "waiting for the parent before taskkill orphans Electron renderer/GPU children",
);
assert.match(updater, /Failed to replace " \+ destination/);
assert.match(updater, /Native copy attempt/);

console.log("PASS: portable updater kills the live Electron tree before replacing mapped files");
