const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'ai-node-canvas.html'), 'utf8');
const inlineScript = source.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(inlineScript, 'the canvas script exists');
new vm.Script(inlineScript, { filename:'ai-node-canvas.html' });
const match = source.match(/    function extractOutputMediaUrl\(data, depth = 0\) \{[\s\S]*?(?=\n    function extractMediaUrl\()/);
assert.ok(match, 'the generated-media selector exists');
const select = vm.runInNewContext(`${match[0]}\nextractOutputMediaUrl`, {
  extractMediaUrl(value) {
    if (typeof value === 'string') return /^https?:\/\//.test(value) ? value : '';
    return value?.b64_json ? `data:image/png;base64,${value.b64_json}` : '';
  }
});

const oldImage = 'https://example.test/previous.png';
const newImage = 'https://example.test/generated.png';
assert.equal(select({ request:{ image_url:oldImage }, data:[{ url:newImage }] }), newImage);
assert.equal(select({ data:{ input_url:oldImage, result_url:newImage } }), newImage);
assert.equal(select({ request:{ image_url:oldImage }, prompt:'https://example.test/prompt.png' }), '', 'unrelated metadata must not become the generated image');
assert.equal(select({ data:[{ b64_json:'test-png' }] }), 'data:image/png;base64,test-png');
assert.match(source, /const plainTextResponse = !\/\^\[\\s\\uFEFF\]\*\[\\\[\{\]\//, 'JSON responses must not be scanned as plain-text URLs');
console.log('PASS: generated image selection ignores echoed input and metadata URLs');
