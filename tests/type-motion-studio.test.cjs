const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {parseHTML}=require('../tools/canvas-ui-test/node_modules/linkedom');
const core=require('../app/type-motion.js');
const read=name=>fs.readFileSync(require('node:path').join(__dirname,'../app',name),'utf8');
test('motion project normalizes untrusted import and bounded dimensions',()=>{
 const s=core.normalize({title:'a'.repeat(500),size:999,background:'url(evil)',duration:999,ratio:'evil',effect:'evil'});
 assert.equal(s.title.length,120);assert.equal(s.size,160);assert.equal(s.duration,5);assert.equal(s.effect,'wave');assert.equal(s.background,'#17181b');
 for(const r of ['1:1','3:4','16:9','9:16']){const [w,h]=core.dimensions(r);assert.ok(w<=1280&&h<=1280);assert.ok(w>0&&h>0);}
});
test('every effect renders finite geometry at different phases and dimensions',()=>{
 assert.equal(core.catalog.length,33);assert.equal(new Set(core.catalog.map(x=>x[0])).size,33);
 for(const [effect] of core.catalog)for(const ratio of ['1:1','3:4','16:9','9:16'])for(const phase of [0,.25,.5,1]){
  let calls=0;const ctx=new Proxy({measureText:t=>({width:Array.from(t).length*60})},{get(o,k){if(k in o)return o[k];return(...args)=>{calls++;for(const v of args)if(typeof v==='number')assert.ok(Number.isFinite(v),`${effect} ${k}`);};},set(o,k,v){o[k]=v;return true;}});
  const [width,height]=core.dimensions(ratio);core.draw({width,height,getContext:()=>ctx},core.normalize({effect,ratio,title:'文字\n动起来'}),phase);assert.ok(calls>10);
 }
});
test('empty and long text do not break rendering',()=>{const ctx=new Proxy({measureText:t=>({width:t.length*50})},{get:(o,k)=>o[k]||(()=>{}),set:(o,k,v)=>(o[k]=v,true)});for(const title of ['', 'A'.repeat(120),'\n\n\n'])core.draw({width:900,height:1200,getContext:()=>ctx},core.normalize({title,effect:'orbit'}),0);});
test('all 30 effects survive project roundtrip and standalone HTML renderer has no module dependencies',()=>{const draw=vm.runInNewContext('('+core.draw.toString()+')');for(const [effect] of core.catalog){const s=core.normalize(JSON.parse(JSON.stringify(core.normalize({effect}))));assert.equal(s.effect,effect);const ctx=new Proxy({measureText:t=>({width:t.length*50})},{get:(o,k)=>o[k]||(()=>{}),set:(o,k,v)=>(o[k]=v,true)});draw({width:900,height:1200,getContext:()=>ctx},s,.35);}});
test('posters are full-link surfaces and arrows are separate sibling controls',()=>{const {host}=carousel();assert.equal(host.querySelectorAll('.poster-link').length,3);assert.ok(host.querySelector('.carousel-prev'));assert.ok(host.querySelector('.carousel-next'));assert.equal(host.querySelector('.poster-link button'),null);const {document}=parseHTML(read('homepage-test.html'));const groups=[...document.querySelectorAll('.home-test-side-label')];assert.equal(groups.length,3);assert.ok(groups.every(el=>el.querySelector('svg')));});
function carousel(reduced=false){const {window,document}=parseHTML('<html><body><div class="home-test-hero-panel"></div></body></html>');let timers=new Map(),id=0;const context=vm.createContext({window,document,matchMedia:()=>({matches:reduced,addEventListener(){}}),setInterval:fn=>{timers.set(++id,fn);return id;},clearInterval:id=>timers.delete(id)});vm.runInContext(read('home-motion.js'),context);return {window,document,timers,host:document.querySelector('.home-carousel')};}
test('carousel builds three independent links and switches both directions',()=>{const {document,host}=carousel();assert.equal(host.querySelectorAll('.home-slide').length,3);host.querySelector('[data-next]').click();assert.ok(!host.querySelectorAll('.home-slide')[1].hidden);assert.match(host.querySelectorAll('a')[1].href,/type-motion/);host.querySelector('[data-prev]').click();assert.ok(!host.querySelectorAll('.home-slide')[0].hidden);host.querySelector('[data-prev]').click();assert.ok(!host.querySelectorAll('.home-slide')[2].hidden);assert.match(host.querySelectorAll('a')[2].href,/open=director/);});
test('carousel pauses on hover, focus, explicit pause, and respects reduced motion',()=>{const {host,window,timers}=carousel();assert.equal(timers.size,1);host.dispatchEvent(new window.Event('mouseenter'));assert.equal(timers.size,0);host.dispatchEvent(new window.Event('mouseleave'));assert.equal(timers.size,1);host.dispatchEvent(new window.Event('focusin'));assert.equal(timers.size,0);host.dispatchEvent(new window.Event('focusout'));assert.equal(timers.size,1);host.querySelector('[data-pause]').click();assert.equal(timers.size,0);assert.equal(carousel(true).timers.size,0);});
test('compact carousel exposes one active poster and two unfocusable neighbours',()=>{const {host}=carousel();for(let n=0;n<5;n++){const active=host.querySelectorAll('[data-position="current"]');assert.equal(active.length,1);assert.equal(active[0].getAttribute('aria-hidden'),'false');assert.equal(active[0].querySelector('a').getAttribute('tabindex'),'0');for(const side of ['previous','next']){const item=host.querySelector(`[data-position="${side}"]`);assert.ok(item);assert.equal(item.getAttribute('aria-hidden'),'true');assert.equal(item.querySelector('a').getAttribute('tabindex'),'-1');}host.querySelector('[data-next]').click();}});
test('shared tools preserve generation controls and receive same stylesheet',()=>{for(const name of ['png-workflow','watermark-remove','keyword-reverse','plain-to-pro','video-prompt-pro','upscale-4k']){const html=read(name+'.html');assert.match(html,/tool-studio.css/);assert.match(html,/tool-studio.js/);assert.match(html,/workflow.js/);assert.match(html,/generate-button/);}assert.match(read('gridform.html'),/gridform-studio.css/);});
test('export implementation preserves MIME, guards HTML injection, cancels hidden captures',()=>{const js=read('type-motion.js');assert.match(js,/replace\(\/</);assert.match(js,/video\/webm/);assert.match(js,/getTracks\(\).forEach/);assert.match(js,/visibilitychange/);assert.match(js,/job\?\.cancel/);assert.match(js,/revokeObjectURL/);assert.match(read('home-motion.css'),/prefers-reduced-motion/);});
test('actual editor boots 30 preview cards, filters groups and applies selections',()=>{
 const {window,document}=parseHTML(read('type-motion.html'));const store=new Map();
 const ctx=new Proxy({measureText:t=>({width:Array.from(t).length*50})},{get:(o,k)=>o[k]||(()=>{}),set:(o,k,v)=>(o[k]=v,true)});
 window.HTMLCanvasElement.prototype.getContext=()=>ctx;
 document.querySelectorAll('select').forEach(el=>Object.defineProperty(el,'value',{writable:true,value:el.querySelector('option').value}));
 const sandbox=vm.createContext({window,document,matchMedia:()=>({matches:false}),localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},requestAnimationFrame:()=>1,console});
 vm.runInContext(read('type-motion.js'),sandbox);
 assert.equal(document.querySelectorAll('.motion-library [data-effect]').length,33);
 document.querySelector('[data-group-filter="海报"]').click();assert.equal([...document.querySelectorAll('[data-effect]')].filter(b=>!b.hidden).length,3);
 document.querySelector('[data-effect="softflag"]').click();const poster=JSON.parse(store.get('wandou-type-motion-v1'));assert.equal(poster.background,'#233bea');assert.equal(poster.title,'让灵感\n动起来');
 document.querySelector('[data-group-filter="空间"]').click();
 const visible=[...document.querySelectorAll('[data-effect]')].filter(b=>!b.hidden);assert.equal(visible.length,5);
 const chosen=document.querySelector('[data-effect="spiral"]');chosen.click();assert.equal(chosen.getAttribute('aria-pressed'),'true');
 assert.equal(JSON.parse(store.get('wandou-type-motion-v1')).effect,'spiral');
 assert.equal(document.querySelectorAll('.motion-heading .motion-export').length,1);
 assert.equal(document.querySelectorAll('.motion-controls section:not([hidden])').length,1);
 document.querySelector('[data-panel="2"]').click();assert.equal(document.querySelector('#motion-panel-2').hidden,false);assert.equal(document.querySelector('#motion-panel-0').hidden,true);
 assert.equal(document.querySelector('[data-panel="2"]').getAttribute('aria-expanded'),'true');
 assert.ok(core.catalog.slice(3).every(item=>!['入场','循环','变形'].includes(item[2])));
});
test('banner has an accessible icon control instead of pause text',()=>{const {host}=carousel();const pause=host.querySelector('[data-pause]');assert.equal(pause.textContent,'Ⅱ');assert.equal(pause.getAttribute('aria-label'),'暂停自动轮播');pause.click();assert.equal(pause.textContent,'▷');});
