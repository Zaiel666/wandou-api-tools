const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
test('assistant floats without reserving canvas space or displacing the toolbar',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../app/ai-node-canvas-test-v2.css'),'utf8');
 const controls=fs.readFileSync(path.join(__dirname,'../app/ai-node-canvas-test-controls.css'),'utf8');
 const margins=[...css.matchAll(/\.app\.assistant-open \.canvas-wrap\s*\{([^}]*)\}/g)];
 assert.ok(margins.length);
 for(const rule of margins) assert.match(rule[1],/margin-right:0;/);
 assert.doesNotMatch(css,/body:has\(\.app[^)]*assistant-open[^)]*\) \.test-canvas-toolbar/);
 assert.match(css,/\.assistant-panel \{position:fixed;/);
 assert.match(controls,/width:var\(--assistant-width,/);
 assert.match(controls,/height:var\(--assistant-height,/);
});
