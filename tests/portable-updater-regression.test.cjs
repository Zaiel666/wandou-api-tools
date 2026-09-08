const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const updater = fs.readFileSync(path.resolve(__dirname, "..", "desktop-client", "portable-updater.cs"), "utf8");
const stopParent = updater.indexOf("StopParentProcess(parent, log)");
const stopInstallProcesses = updater.indexOf("StopInstallProcesses(install, log)");
const extract = updater.indexOf("ZipFile.ExtractToDirectory(package, stage)");

assert.ok(stopParent > 0, "the updater must terminate the requesting Electron process");
assert.ok(stopInstallProcesses > stopParent, "remaining processes from the install directory must be stopped");
assert.ok(extract > stopInstallProcesses, "all application processes must stop before extraction and activation");
assert.doesNotMatch(updater, /ProcessStartInfo\("taskkill"/i, "the updater must not kill its own parent tree");
assert.match(updater, /StartsWith\(installRoot, StringComparison\.OrdinalIgnoreCase\)/, "orphan cleanup must stay inside the active install directory");
assert.match(updater, /foreach \(var process in Process\.GetProcesses\(\)\)/, "all helper executables inside the install directory must be considered");
assert.match(updater, /process\.Id == Process\.GetCurrentProcess\(\)\.Id/, "the detached updater must never terminate itself");
assert.match(updater, /Environment\.CurrentDirectory = Path\.GetTempPath\(\)/, "the updater must release an inherited install-directory working path");
assert.match(updater, /MoveDirectoryWithRetry\(install, previous, log\)/, "directory activation must retry transient Windows locks");
assert.match(updater, /Thread\.Sleep\(250\)/, "the requesting process must be stopped before the old client's quit timer");
assert.match(updater, /Directory\.Move\(source, destination\)/, "the mapped old install must be moved aside as one directory");
assert.match(updater, /MoveDirectoryWithRetry\(stage, install, log\)/, "the complete staged release must be activated as one directory");
assert.match(updater, /Directory\.Move\(previous, install\)/, "a failed activation must restore the previous install");
assert.doesNotMatch(updater, /File\.Copy\(file, destination, true\)/, "Chromium resources must not be overwritten in place");
assert.match(updater, /StartApplicationWithRetry\(install, executable, log\)/, "automatic restart must use the retry path");
assert.match(updater, /Application restart launched process/, "restart attempts must be observable in the updater log");
assert.match(updater, /CleanupPreviousInstallations\(install, log\)/, "successful updates must remove old installation directories");
assert.match(updater, /DeleteDirectoryWithRetry\(directory, log\)/, "old installation cleanup must retry transient Windows locks");
assert.match(updater, /VerifyPortableLayout\(stage, executable, target, "Package"\)/, "the extracted outer and runtime layouts must be verified");
assert.match(updater, /RuntimeDirectoryName = "程序文件"/, "the updater must understand the compact portable runtime directory");
assert.match(updater, /Directory\.GetFiles\(install, "\*", SearchOption\.AllDirectories\)/, "locked-directory migration must remove obsolete root runtime files");

const main = fs.readFileSync(path.resolve(__dirname, "..", "desktop-client", "main.js"), "utf8");
assert.match(main, /cleanupStalePortableInstallBackups/, "the restarted app must clean backups left by older updater versions");
assert.match(main, /entry\.name\.startsWith\(backupPrefix\)/, "startup cleanup must stay scoped to this portable install name");
assert.match(main, /portableInstallContext\(\)/, "the nested Electron runtime must update the outer portable folder");
assert.match(main, /PORTABLE_RUNTIME_DIRECTORY = "程序文件"/, "the client and package builder must agree on the runtime directory");

const workflow = fs.readFileSync(path.resolve(__dirname, "..", ".github", "workflows", "release.yml"), "utf8");
assert.match(workflow, /build-portable-package\.ps1/, "releases must use the compact three-entry package builder");

const packageBuilder = fs.readFileSync(path.resolve(__dirname, "..", "scripts", "build-portable-package.ps1"), "utf8");
assert.match(packageBuilder, /'使用说明\.txt', '网页版\.html', '豌豆AI工具\.exe'/, "only the three requested entries may remain visible");
assert.match(packageBuilder, /resources\\app\\VERSION\.txt/, "the outer compatibility version must support old updaters");

console.log("PASS: portable updater supports the compact outer folder, restarts, and removes stale backups");
