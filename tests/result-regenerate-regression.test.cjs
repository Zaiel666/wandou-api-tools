const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pagePath = path.resolve(__dirname, "../app/ai-node-canvas.html");
const source = fs.readFileSync(pagePath, "utf8");

assert.match(source, /id="lightboxContextRegenerate"[^>]*>重新生成<\/button>/, "enlarged image menu must expose regenerate");
assert.match(source, /class="preview-regenerate[^"`]*\$\{generating/, "result node must render the circular regenerate control");
assert.match(source, /previewFavoriteButton\(node\)\}\$\{previewRegenerateButton\(node\)\}\$\{previewDownloadButton\(node\)/, "regenerate must sit immediately left of download");
assert.match(source, /<path d="M3 12a9 9 0 1 0 3-6\.7L3 8"\/><path d="M3 3v5h5"\/>/, "regenerate must use the compact linear refresh icon");

const start = source.indexOf("async function regenerateResultNode(");
const end = source.indexOf("async function generateFromNode(", start);
assert.ok(start >= 0 && end > start, "single-result regeneration workflow must exist");
const workflow = source.slice(start, end);

assert.match(workflow, /resultGridPositioner\(sourceNode, 1, parsed\)\(0\)/, "replacement must append below the existing result group");
assert.match(workflow, /createNode\("result"/, "replacement must be a new result node");
assert.match(workflow, /regeneratedFromId:\s*original\.id/, "replacement must retain its origin relationship");
assert.doesNotMatch(workflow, /original\.(?:mediaUrl|previewUrl|fullUrl)\s*=/, "the original image must never be overwritten");
assert.match(workflow, /original\.generationPrompt \|\| original\.prompt \|\| sourceNode\.prompt/, "regeneration must reuse the exact stored prompt");
assert.match(workflow, /model:\s*original\.model \|\| sourceNode\.model/, "regeneration must preserve the original model");
assert.match(workflow, /original\.width && original\.height/, "regeneration must preserve the original output dimensions");
assert.match(workflow, /resultSeriesStyleReference\(sourceNode, original\)/, "series regeneration must reuse a batch style reference");
assert.match(workflow, /autoSaveGeneratedNodeMedia\(pending\)|generateOneResult\(regenerationSource, pending/, "replacement must use the normal generated-result save pipeline");
assert.match(workflow, /original\.regenerating = true/);
assert.match(workflow, /original\.regenerating = false/);

console.log("PASS: a single effect image can regenerate without replacing the original and appends below the batch");
