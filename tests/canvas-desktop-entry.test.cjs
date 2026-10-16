const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../app/ai-node-canvas-test.html'), 'utf8');
const start = html.indexOf('(async function initApp() {');
const guard = html.slice(start + '(async function initApp() {'.length, html.indexOf('      await loadApiConfig();', start));
for (const bridge of ['wandouShell', 'webview']) {
  for (const production of [true, false]) {
    test(`${bridge}: ${production ? 'production initializes' : 'desktop test URL redirects without clearing UI'}`, () => {
      let redirected, initialized = false;
      const window = bridge === 'wandouShell' ? {wandouShell:{}} : {chrome:{webview:{}}};
      const document = {body:{textContent:'canvas'}, title:'test'};
      const location = {href:'file:///app/ai-node-canvas-test.html?project=existing&open=director#view', replace:url=>redirected=new URL(url)};
      vm.runInNewContext(`(function(){${guard}\ninitialize();})()`, {window,document,location,URL,canvasStoragePrefix:production?'':'test:',initialize:()=>initialized=true});
      assert.equal(initialized,production);
      assert.equal(document.body.textContent,'canvas');
      if (production) assert.equal(document.title,'豌豆 AI · 节点画布');
      else {
        assert.equal(redirected.searchParams.get('workspace'),'production');
        assert.equal(redirected.searchParams.get('project'),'existing');
        assert.equal(redirected.searchParams.get('open'),'director');
        assert.equal(redirected.hash,'#view');
      }
    });
  }
}
test('browser test URL still initializes without redirect',()=>{
 let initialized=false;
 vm.runInNewContext(`(function(){${guard}\ninitialize();})()`,{window:{},canvasStoragePrefix:'test:',initialize:()=>initialized=true});
 assert.equal(initialized,true);
});
