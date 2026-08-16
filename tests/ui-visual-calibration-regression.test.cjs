const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const visual = fs.readFileSync(path.join(root, "app", "fluid-glass.css"), "utf8");
const shell = fs.readFileSync(path.join(root, "desktop-client", "shell.css"), "utf8");

assert.match(visual, /2026 neutral UI calibration/);
assert.match(visual, /--wd-neutral-page:\s*#f5f7f6/);
assert.match(visual, /--wd-neutral-page:\s*#101211/);
assert.match(visual, /--wd-accent:\s*#2eae61/);
assert.match(visual, /body\.home-page \.tool-section\[data-home-section\] \.tool-label[^}]*font-size:\s*18px/s);
assert.match(visual, /body\.project-hub-page h1[^}]*font-size:\s*24px/s);
assert.match(visual, /body\.node-canvas-page \.node:hover[^}]*rgba\(127, 136, 130, \.28\)/s);
assert.match(visual, /body\.node-canvas-page \.node\.selected[^}]*var\(--wd-accent\)/s);
assert.doesNotMatch(shell.slice(0, 900), /--bar:\s*#0c0e0d/);

console.log("PASS: home, project hub, node canvas, and desktop shell share the restrained neutral UI calibration");
