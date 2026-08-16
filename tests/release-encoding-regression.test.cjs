const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const extensions = new Set([".html", ".css", ".js", ".json", ".txt", ".md", ".ps1", ".cs", ".yml", ".yaml"]);
const decoder = new TextDecoder("utf-8", { fatal: true });

function sourceFiles(directory, recursive = true) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!recursive || ["node_modules", "dist", "dist-hotfix", "dist-selection-outline-v10"].includes(entry.name)) return [];
      if (target.includes(`${path.sep}image-workbench${path.sep}assets`)) return [];
      return sourceFiles(target, true);
    }
    return extensions.has(path.extname(entry.name).toLowerCase()) ? [target] : [];
  });
}

const files = [...sourceFiles(path.join(root, "app")), ...sourceFiles(path.join(root, "desktop-client"), false)];
assert.ok(files.length > 20, "release encoding check must cover the shipped source files");
for (const file of files) {
  const text = decoder.decode(fs.readFileSync(file));
  assert.equal(text.includes("\uFFFD"), false, `${path.relative(root, file)} contains a replacement character`);
  assert.doesNotMatch(text, /锟斤拷|锟斤/, `${path.relative(root, file)} contains a mojibake marker`);
}
console.log(`PASS: ${files.length} shipped text files decode as strict UTF-8 without mojibake markers`);
