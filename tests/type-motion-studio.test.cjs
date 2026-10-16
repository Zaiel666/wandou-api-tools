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
 assert.equal(core.catalog.length,41);assert.equal(new Set(core.catalog.map(x=>x[0])).size,41);
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
 assert.equal(document.querySelectorAll('.motion-library [data-effect]').length,41);
 document.querySelector('[data-group-filter="海报"]').click();assert.equal([...document.querySelectorAll('[data-effect]')].filter(b=>!b.hidden).length,3);
 document.querySelector('[data-effect="softflag"]').click();const poster=JSON.parse(store.get('wandou-type-motion-v1'));assert.equal(poster.background,'#233bea');assert.equal(poster.title,'让灵感\n动起来');
 document.querySelector('[data-group-filter="空间"]').click();
 const visible=[...document.querySelectorAll('[data-effect]')].filter(b=>!b.hidden);assert.equal(visible.length,9);
 const chosen=document.querySelector('[data-effect="spiral"]');chosen.click();assert.equal(chosen.getAttribute('aria-pressed'),'true');
 assert.equal(JSON.parse(store.get('wandou-type-motion-v1')).effect,'spiral');
 assert.equal(document.querySelectorAll('.motion-controls .motion-output .motion-export').length,1);
 assert.equal(document.querySelector('.motion-workspace').firstElementChild.className,'motion-library');
 assert.equal(document.querySelector('#status').parentElement.className,'motion-output');
 assert.ok(document.querySelector('.motion-output #video'));
 assert.equal(document.querySelector('#poster').getAttribute('tabindex'),'0');
 assert.equal(document.querySelectorAll('.motion-controls section:not([hidden]):not(.motion-output)').length,1);
 document.querySelector('[data-panel="2"]').click();assert.equal(document.querySelector('#motion-panel-2').hidden,false);assert.equal(document.querySelector('#motion-panel-0').hidden,true);
 assert.equal(document.querySelector('[data-panel="2"]').getAttribute('aria-expanded'),'true');
 assert.ok(core.catalog.slice(3).every(item=>!['入场','循环','变形'].includes(item[2])));
});
test('three-pane desk keeps templates scrollable and provides small-screen document flow',()=>{
 const css=read('type-motion-refined.css');
 assert.match(css,/grid-template-areas:'library stage inspector'/);
 assert.match(css,/\.motion-presets\{[^}]*min-height:0;[^}]*overflow-y:auto/);
 assert.match(css,/@media\(max-width:900px\)\{\.motion-page\{height:auto;min-height:100dvh;overflow:auto/);
 assert.match(css,/grid-template-areas:'stage' 'library' 'inspector'/);
 assert.match(css,/prefers-reduced-motion/);
});
test('spatial renderers loop seamlessly and react to view tilt without invalid geometry',()=>{
 function commands(effect,phase,pointerTilt=0){const events=[];const ctx=new Proxy({measureText:t=>({width:t.length*40})},{get(o,k){return o[k]||((...args)=>events.push([k,...args.map(v=>typeof v==='number'?Math.round(v*1000)/1000:v)]));},set(o,k,v){o[k]=v;return true}});core.draw({width:900,height:1200,getContext:()=>ctx},{...core.normalize({effect,title:'NEW HABIT'}),pointerTilt},phase);return JSON.stringify(events)}
 for(const effect of ['helix','cylinder','gyroscope','typeglobe']){
  assert.equal(commands(effect,0),commands(effect,1),effect+' loops');
  assert.notEqual(commands(effect,.2),commands(effect,.2,.6),effect+' responds to tilt');
 }
});
test('banner has an accessible icon control instead of pause text',()=>{const {host}=carousel();const pause=host.querySelector('[data-pause]');assert.equal(pause.textContent,'Ⅱ');assert.equal(pause.getAttribute('aria-label'),'暂停自动轮播');pause.click();assert.equal(pause.textContent,'▷');});

test('workbench boots themed menus, local subject controls, resize handles and 10 fonts',async()=>{
 const {window,document}=parseHTML(read('type-motion.html'));const store=new Map();let imageCalls=0;
 const ctx=new Proxy({measureText:t=>({width:t.length*50}),drawImage(){imageCalls++;}},{get:(o,k)=>o[k]||(()=>{}),set:(o,k,v)=>(o[k]=v,true)});
 window.HTMLCanvasElement.prototype.getContext=()=>ctx;
 document.querySelectorAll('select').forEach(el=>Object.defineProperty(el,'value',{writable:true,value:el.querySelector('option').value}));
 class Image {constructor(){this.width=100;this.height=100;}async decode(){}}
 const sandbox=vm.createContext({window,document,Image,MutationObserver:window.MutationObserver,matchMedia:()=>({matches:false}),localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},requestAnimationFrame:()=>1,setTimeout,clearTimeout,console});
 vm.runInContext(read('type-motion.js'),sandbox);vm.runInContext(read('type-motion-workbench.js'),sandbox);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(document.querySelectorAll('.motion-select-trigger').length,3);
 assert.equal(document.querySelectorAll('#font option').length,13);
 assert.equal(document.querySelectorAll('.motion-divider').length,2);
 assert.equal(document.querySelector('#theme').textContent,'');
 assert.equal(document.querySelector('#theme').getAttribute('aria-label'),'切换明暗主题');
 assert.match(document.querySelector('.motion-subject').textContent,/不是三维模型/);
 assert.ok(document.querySelector('#duration option[value="10"]'));
 await window.WandouTypeMotion.update({duration:10,effect:'helix',subject:'data:image/png;base64,YQ=='});
 assert.equal(window.WandouTypeMotion.getState().duration,10);
 assert.ok(imageCalls>0);assert.match(document.querySelector('#subjectInfo').textContent,/已添加产品/);
 assert.equal(document.querySelector('#poster').width,540);assert.equal(document.querySelector('#poster').height,720);
 const savedWithSubject=JSON.parse(store.get('wandou-type-motion-v1'));assert.equal(savedWithSubject.subject,undefined);assert.equal(savedWithSubject.subjectRef,true);assert.equal(store.get('wandou-type-motion-v1:subject'),'data:image/png;base64,YQ==');
 let exportSize;window.HTMLCanvasElement.prototype.toBlob=function(){exportSize=[this.width,this.height];};document.querySelector('#png').onclick();assert.deepEqual(exportSize,[900,1200]);
 await window.WandouTypeMotion.update({subject:null});assert.equal(window.WandouTypeMotion.getState().subject,undefined);
 assert.equal(document.querySelector('#removeSubject').disabled,true);
 const backup=JSON.parse(store.get('wandou-type-motion-v1'));assert.equal(backup.subjectImage,undefined);assert.equal(backup.textTexture,undefined);
 // Transport boots without requesting private font access until explicitly clicked.
 let queries=0;window.queryLocalFonts=async()=>{queries++;return [{fullName:'Example Bold',family:'Example',style:'Bold',blob:async()=>({arrayBuffer:async()=>new ArrayBuffer(16)})}];};
 document.fonts={add(){},delete(){}};sandbox.FontFace=class {constructor(family){this.family=family;}async load(){return this;}};
 vm.runInContext(read('type-motion-transport.js'),sandbox);
 assert.equal(queries,0);assert.ok(document.querySelector('.motion-scrubber #timeline'));
 const speed=document.querySelector('#speed');speed.value='6';speed.dispatchEvent(new window.Event('input',{bubbles:true}));await new Promise(resolve=>setImmediate(resolve));
 assert.equal(window.WandouTypeMotion.getState().speed,2);assert.match(document.querySelector('#cycleHint').textContent,/5.00/);
 const weight=document.querySelector('#weight');weight.value='500';weight.dispatchEvent(new window.Event('input',{bubbles:true}));assert.equal(window.WandouTypeMotion.getState().weight,500);
 await document.querySelector('#readLocalFonts').onclick();assert.equal(queries,1);
 await document.querySelector('#localFontResults button').onclick();assert.equal(window.WandouTypeMotion.getState().font,'local');assert.ok(window.WandouTypeMotion.localFamily('Example Bold · Bold'));
 assert.equal(window.WandouTypeMotion.getState().weight,400);
 assert.match(document.querySelector('#font').parentElement.querySelector('.motion-select-trigger').textContent,/Example Bold/);
 assert.equal(document.querySelector('#localFontFile'),null);
 document.querySelector('#toggleLocalFonts').onclick();assert.equal(document.querySelector('#localFontResults').hidden,true);
 document.querySelector('#toggleLocalFonts').onclick();assert.equal(document.querySelector('#localFontResults').hidden,false);
 document.querySelector('#readLocalFonts').dispatchEvent(new window.Event('pointerenter'));assert.equal(document.querySelector('#readLocalFonts').textContent,'重新读取');
 vm.runInContext(read('type-motion-alpha.js'),sandbox);
 assert.equal(document.querySelector('.motion-inspector-nav button').textContent,'内容');
 assert.equal(document.querySelectorAll('.motion-inspector-nav button')[2].textContent,'画面');
 assert.ok(document.querySelector('#motion-panel-0 .motion-alpha-option #transparent'));
 assert.deepEqual([...document.querySelectorAll('.motion-export button')].map(b=>b.id),['png','apng','html','video','cancel']);
 assert.equal(document.querySelector('#apng').textContent,'APNG 动画');
 assert.equal(document.querySelectorAll('.motion-jelly [role=radio]').length,9);
 await document.querySelector('.motion-jelly [data-weight="700"]').onclick();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(window.WandouTypeMotion.getState().weight,700);
 assert.equal(document.querySelector('.motion-jelly [data-weight="700"]').getAttribute('aria-checked'),'true');
 assert.ok(document.querySelector('#motion-panel-2 .motion-size-label #size'));
 assert.equal(document.querySelector('.motion-jelly').nextElementSibling.classList.contains('motion-size-label'),true);
 const size=document.querySelector('#size');size.value='140';size.dispatchEvent(new window.Event('input',{bubbles:true}));
 assert.equal(window.WandouTypeMotion.getState().size,140);assert.equal(document.querySelector('.motion-size-label .motion-size-bubble').textContent,'140%');
 assert.equal(document.querySelector('[data-weight="300"]').textContent,'细体');
 assert.equal(document.querySelector('[data-weight="600"]').textContent,'中等粗体');
 assert.equal(document.querySelectorAll('.motion-unified-track').length,3);
 const timelineControl=document.querySelector('#timeline');timelineControl.value='750';window.WandouTypeMotion.syncTimeline();
 assert.equal(timelineControl.parentElement.style.getPropertyValue('--size-progress'),'75%');
 assert.match(timelineControl.parentElement.querySelector('output').textContent,/s$/);
 assert.match(read('type-motion.js'),/api\.syncTimeline\?\.\(\)/);
 assert.match(read('type-motion-refined.css'),/\.motion-rate \.motion-size-bubble\{color:var\(--studio-panel\)/);
 await window.WandouTypeMotion.update({subject:'data:image/png;base64,YQ=='});
 assert.equal(document.querySelector('#removeSubject').getAttribute('aria-pressed'),'true');
 await document.querySelector('#removeSubject').onclick();assert.equal(window.WandouTypeMotion.getState().subject,undefined);
 assert.equal(document.querySelector('#removeSubject').textContent,'恢复产品图片');assert.equal(document.querySelector('#removeSubject').disabled,false);
 await document.querySelector('#removeSubject').onclick();assert.equal(window.WandouTypeMotion.getState().subject,'data:image/png;base64,YQ==');
 for(const b of document.querySelectorAll('.motion-export button:not(#cancel)'))assert.equal(b.dataset.wdAction,'download');
 assert.ok(document.querySelector('.motion-alpha-switch'));
 await window.WandouTypeMotion.update({speed:1/3,transparent:true,smallText:false,topLeft:'自定义标注'});
 assert.equal(document.querySelector('#speed').value,'0');assert.equal(document.querySelector('#transparent').checked,true);assert.ok(document.querySelector('#poster').classList.contains('has-alpha'));
 assert.equal(document.querySelector('#topLeft').value,'自定义标注');assert.equal(document.querySelector('#smallText').checked,false);
 await window.WandouTypeMotion.update({speed:3});assert.equal(document.querySelector('#speed').value,'8');
});
test('subject import bounds and font assets preserve commercial license',()=>{
 assert.equal(core.normalize({subject:'https://bad.test/x.png'}).subject,undefined);
 assert.equal(core.normalize({subject:'data:image/svg+xml;base64,YQ=='}).subject,undefined);
 assert.equal(core.normalize({duration:10}).duration,10);
 assert.equal(core.normalize({subjectScale:900}).subjectScale,70);
 assert.equal(core.normalize({speed:Infinity,weight:9999}).speed,1);assert.equal(core.normalize({speed:.5,weight:500}).weight,500);assert.equal(core.normalize({speed:.5}).speed,.5);
 const path=require('node:path'),root=path.join(__dirname,'../app/assets/motion-fonts');
 assert.equal(fs.readdirSync(root).filter(name=>fs.statSync(path.join(root,name)).isDirectory()).length,10);
 for(const family of fs.readdirSync(root).filter(name=>fs.statSync(path.join(root,name)).isDirectory())){assert.ok(fs.statSync(path.join(root,family,'font.ttf')).size>10000);assert.match(fs.readFileSync(path.join(root,family,'OFL.txt'),'utf8'),/SIL Open Font License/);}
});
