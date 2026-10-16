// DOM regressions only: these do not claim browser layout or API coverage.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {parseHTML} = require('../tools/canvas-ui-test/node_modules/linkedom');
const app = path.resolve(__dirname, '../app');
const script = fs.readFileSync(path.join(app, 'ai-node-canvas-test.js'), 'utf8');
const page = fs.readFileSync(path.join(app, 'ai-node-canvas-test.html'), 'utf8');

test('prompt library surfaces use standalone theme tokens and keep controls intact', () => {
  const css = fs.readFileSync(path.join(app, 'ai-node-canvas-test-v2.css'), 'utf8');
  const rules = css.slice(0, css.indexOf('/* Confirmed design'));
  for (const selector of ['.prompt-manager-modal', '.prompt-manager-main', '.prompt-tags', '.prompt-card-body', '.prompt-card-source', '.prompt-search', '.prompt-manager-close svg']) {
    assert.ok(rules.includes(selector), selector);
  }
  assert.ok(rules.includes('background:var(--ui-surface);color:var(--ui-text)'));
  assert.ok(rules.includes('padding:0 96px 0 43px'));
  assert.ok(rules.includes('color:#fff;background:rgba(0,0,0,.72)'));
  assert.ok(!rules.includes('var(--wd-'));
  const {document} = parseHTML(page);
  assert.ok(document.querySelector('#closePromptManagerButton[aria-label] svg path'));
  for (const id of ['promptManagerSearch', 'promptSourceList', 'promptTagList', 'promptManagerList', 'newPromptButton']) {
    assert.ok(document.getElementById(id));
  }
});

test('image menu download follows copy and forwards to existing download without green inline paint', () => {
  const {document}=parseHTML(page);
  const button=document.getElementById('lightboxContextDownload');
  assert.equal(document.getElementById('lightboxContextCopy').nextElementSibling,button);
  let downloads=0,closed=0;
  const context=vm.createContext({document,closeLightboxImageMenu:()=>closed++,lightboxDownload:{click:()=>downloads++}});
  const start=page.indexOf('    document.getElementById("lightboxContextDownload").addEventListener');
  vm.runInContext(page.slice(start,page.indexOf('    lightboxContextPrompt.addEventListener',start)),context);
  button.click();
  assert.equal(downloads,1);assert.equal(closed,1);
  const hot=page.slice(page.indexOf('    function setLightboxImageMenuHot('),page.indexOf('    function closeLightboxImageMenu('));
  assert.ok(!hot.includes('#13aa72'));
  assert.ok(hot.includes('removeProperty("background")'));
});

test('prompt library secondary text meets AA contrast in both themes', () => {
  const luminance = hex => {
    const c = hex.match(/\w\w/g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
  };
  for (const [text, surface] of [['62626e','ffffff'], ['62626e','f8f8f9'], ['b0b0ba','1b1b1b'], ['b0b0ba','222222']]) {
    const a = luminance(text), b = luminance(surface);
    assert.ok((Math.max(a,b) + .05) / (Math.min(a,b) + .05) >= 4.5);
  }
});
test('mascot launcher retains button semantics and composer has no reserved footer', () => {
  const {document} = parseHTML(page);
  const launcher = document.getElementById('assistantToggleButton');
  assert.equal(launcher.tagName, 'BUTTON');
  assert.equal(launcher.getAttribute('aria-controls'), 'assistantPanel');
  const mascot = launcher.querySelector('.assistant-mascot');
  assert.ok(mascot);
  assert.ok(fs.existsSync(path.join(app, mascot.getAttribute('src'))));
  assert.ok(document.getElementById('assistantRailButton'));
  const base = fs.readFileSync(path.join(app, 'ai-node-canvas-test-v2.css'), 'utf8');
  const controls = fs.readFileSync(path.join(app, 'ai-node-canvas-test-controls.css'), 'utf8');
  assert.ok(!base.includes('padding-bottom:82px'));
  assert.ok(base.includes('.assistant-panel {padding-bottom:0;}'));
  assert.ok(controls.includes('margin:8px 8px 4px'));
  assert.ok(controls.includes('@keyframes pea-assistant-greet'));
  assert.match(controls, /@media\(prefers-reduced-motion:reduce\)\s*\{\s*#assistantToggleButton \.assistant-mascot \{animation:none/);
});
function setup(markup) {
  const {document, window} = parseHTML('<html><body>' + markup + '</body></html>');
  const context = vm.createContext({document, window, canvasStoragePrefix:'wandou:canvas-ui-test:v1:', renderNode:()=>document.querySelector('.node'), setTimeout:()=>{}, console});
  vm.runInContext(script, context);
  return {document, window, ui:window.WandouCanvasTestUI, node:document.querySelector('.node')};
}
const generatorFixture = (count=1, locked=false) => `<section class="node generator" data-id="g">
  <div class="node-menu"><button data-prompt-library></button><button data-duplicate></button><button data-delete></button></div>
  <section class="prompt-composer-shell"><div class="prompt-field-wrap"><textarea data-field="prompt">提示词</textarea></div>
  <div class="prompt-corner-tools"><button data-skill-picker-toggle></button><button data-prompt-library></button><button data-prompt-refine-open></button></div></section>
  <div class="form-row"><label>Skill</label><div><button data-skill-row-toggle>默认绘图规则</button><div data-generator-skill-popover><button data-generator-skill="a">摄影</button></div></div></div>
  <div class="form-row"><label>创作技能</label><div data-creative-style-control><button data-creative-style-toggle><span>电影海报</span></button><div data-creative-style-popover><button data-creative-style="a">海报</button></div></div></div>
  <div class="form-row"><label>比例尺寸</label><div><div class="ratio-menu"></div><div data-custom-size-fields><input value="512"></div></div></div>
  <div class="form-row resolution-row"><label>分辨率</label><div><div class="choice-options"><button data-resolution="1K">1K</button><button class="active" data-resolution="2K">2K</button><button disabled data-resolution="4K">4K</button></div></div></div>
  <div class="form-row generator-count-row"><label>数量</label><div class="count-options">${[1,2,3,4,5,6,7,8,9].map(n=>`<button data-count="${n}" ${locked?'disabled':''} class="${count===n?'active':''}">${n}</button>`).join('')}</div></div>
  <button data-generate>生成图片</button></section>`;

test('common ratios are display-only badges preserving original values and actions',()=>{
 const ratios=['1:1','16:9','9:16','4:3','3:4','21:9','Auto'];
 const markup=generatorFixture().replace('<div class="ratio-menu"></div>','<div class="ratio-menu">'+ratios.map(r=>`<button class="node-select-option" data-node-ratio="${r}">${r} 示例</button>`).join('')+'</div>');
 const {node,ui}=setup(markup);let clicks=0;node.querySelector('[data-node-ratio="1:1"]').onclick=()=>clicks++;
 ui.decorateNode(node,{type:'generator',count:1});assert.equal(node.querySelectorAll('.test-common-ratio').length,5);
 node.querySelector('[data-node-ratio="1:1"]').click();assert.equal(clicks,1);
 assert.equal(node.querySelector('[data-node-ratio="21:9"] .test-common-ratio'),null);
});
test('generator moves original controls, preserves handlers and selected skill summary', () => {
  const {node, ui} = setup(generatorFixture());
  const library = node.querySelector('.prompt-corner-tools [data-prompt-library]');
  const creative = node.querySelector('[data-creative-style-toggle]');
  const popover = node.querySelector('[data-generator-skill-popover]');
  let clicked=0;
  library.addEventListener('click',()=>clicked++);
  creative.addEventListener('click',()=>clicked++);
  ui.decorateNode(node,{type:'generator',count:1});
  assert.equal(node.querySelector('.prompt-corner-tools [data-prompt-library]'),library);
  assert.equal(popover.parentElement.className,'prompt-corner-tools');
  assert.equal(node.querySelectorAll('[data-prompt-library]').length,1);
  assert.equal(node.querySelector('[data-creative-style-toggle]'),creative);
  library.click(); creative.click();
  assert.equal(clicked,2);
  assert.equal(node.querySelector('.test-skill-summary').textContent,'默认绘图规则 · 电影海报');
  assert.ok(node.querySelector('[data-custom-size-fields]'));
  assert.equal(node.querySelectorAll('.test-compact-settings > .form-row').length,3);
  ui.decorateNode(node,{type:'generator'});
  assert.equal(node.querySelectorAll('.test-skill-summary').length,1);
});

test('resolution select dispatches the existing option, rejects disabled resolutions', () => {
  const {node,ui,window} = setup(generatorFixture());
  let chosen='';
  node.querySelectorAll('[data-resolution]').forEach(button=>button.addEventListener('click',()=>chosen=button.dataset.resolution));
  ui.decorateNode(node,{type:'generator',count:1});
  const select=node.querySelector('select');
  assert.equal(select.value,'2K');
  select.querySelector('[value="1K"]').selected=true;
  select.dispatchEvent(new window.Event('change'));
  assert.equal(chosen,'1K');
  select.querySelector('[value="4K"]').selected=true;
  select.dispatchEvent(new window.Event('change'));
  assert.equal(chosen,'1K');
  assert.ok(node.querySelector('.resolution-row .choice-options').parentElement.hidden);
  assert.ok(!node.querySelector('.resolution-row').hidden);
});

test('count stepper keeps 1–9 boundaries and auto-split lock, without duplicating generation', () => {
  for (const [count,locked] of [[1,false],[5,false],[9,false],[2,true]]) {
    const {node,ui}=setup(generatorFixture(count,locked));
    let clicks=[];
    node.querySelectorAll('[data-count]').forEach(button=>button.addEventListener('click',()=>clicks.push(Number(button.dataset.count))));
    ui.decorateNode(node,{type:'generator',count,autoSplit:locked});
    const [minus,plus]=node.querySelectorAll('.test-stepper button');
    assert.equal(minus.disabled,locked||count===1);
    assert.equal(plus.disabled,locked||count===9);
    minus.click();plus.click();
    assert.deepEqual(clicks,locked?[]:[count-1,count+1].filter(n=>n>=1&&n<=9));
    assert.equal(node.querySelectorAll('[data-generate]').length,1);
  }
});

test('prompt character count updates and never changes the prompt or model data', () => {
  const {node,ui,window}=setup(generatorFixture());
  const state={type:'generator',count:1,prompt:'提示词',model:'model-x'};
  ui.decorateNode(node,state);
  const input=node.querySelector('textarea');
  input.value='一个新提示词';input.dispatchEvent(new window.Event('input'));
  assert.equal(node.querySelector('.test-character-count').textContent,'6 字');
  assert.equal(state.prompt,'提示词');assert.equal(state.model,'model-x');
});

test('all four result actions retain original handlers and accessible labels', () => {
  const {node,ui}=setup(`<section class="node result"><div class="node-menu"><button data-favorite></button><button data-duplicate></button><button data-delete></button></div><div class="preview"><button data-favorite></button><button data-regenerate></button><button data-download></button><div class="result-meta-line">1024 × 1536 · 12s</div></div></section>`);
  const originals=['favorite','regenerate','download'].map(action=>node.querySelector('.preview [data-'+action+']'));
  originals.push(node.querySelector('[data-delete]'));
  let clicks=0;originals.forEach(button=>button.addEventListener('click',()=>clicks++));
  ui.decorateNode(node,{type:'result'});
  const actions=[...node.querySelectorAll('.node-menu button')];
  assert.deepEqual(actions,originals);
  actions.forEach(button=>{assert.ok(button.getAttribute('aria-label'));button.click();});
  assert.equal(clicks,4);
  assert.ok(node.querySelector('.preview .result-meta-line'));
});

test('style controls from the real HTML renderer retain strength, resolution and prompt handlers', () => {
  const {document,window,ui}=setup('');
  const start=page.indexOf('    function renderStyleTransferBody(node) {');
  const end=page.indexOf('\n    function ',start+10);
  const source=page.slice(start,end);
  const state={type:'style',id:'s',model:'GPT Image',resolution:'1K',styleStrength:'standard',styleOutputMode:'content',prompt:'保持构图'};
  const stubs={document,window,console, imageModelOptions:['GPT Image'],defaultImageModel:()=> 'GPT Image',
    styleTransferStrengths:[{value:'subtle',label:'轻度主体优先',hint:'少量迁移'},{value:'standard',label:'标准风格明显',hint:'推荐'},{value:'strong',label:'强烈风格化',hint:'强调风格'}],
    styleTransferOutputOptions:[{value:'content',label:'跟随内容图'}],imageResolutionOptionsForModel:()=>['1K','2K'],
    styleTransferReferenceItems:()=>[],escapeHtml:s=>String(s),modelValueHtml:s=>s,resolutionLabel:s=>s,
    styleTransferSlotHtml:()=>'',pushHistory:()=>{},render:()=>{},scheduleCanvasSave:()=>{},
    autoGrowTextareas:()=>{},bindAutoGrowTextareas:()=>{},bindFields:()=>{},bindPromptTextareaSizing:()=>{},requestAnimationFrame:()=>{},
    state};
  const context=vm.createContext(stubs);
  vm.runInContext(source+'\nthis.result=renderStyleTransferBody(state);',context);
  const element=document.createElement('section');element.className='node style';element.dataset.id='s';element.append(context.result);
  ui.decorateNode(element,state);
  const rows=element.querySelectorAll('.test-style-settings > .form-row');
  assert.deepEqual([...rows].map(row=>row.querySelector('label').textContent),['模型','风格强度','比例尺寸','精度']);
  element.querySelector('[data-style-strength="strong"]').click();
  assert.equal(state.styleStrength,'strong');
  const precision=element.querySelector('select');precision.querySelector('[value="2K"]').selected=true;
  precision.dispatchEvent(new window.Event('change'));assert.equal(state.resolution,'2K');
  const prompt=element.querySelector('[data-style-prompt]');prompt.value='新要求';prompt.dispatchEvent(new window.Event('input'));
  assert.equal(state.prompt,'新要求');
  assert.equal(element.querySelector('.test-style-prompt label').htmlFor,prompt.id);
});

test('vendored UI icons exist, CSS uses the real composer class and an isolated legacy layer', () => {
  const {node,ui}=setup(generatorFixture());ui.decorateNode(node,{type:'generator',count:2});
  node.querySelectorAll('img.ui-icon').forEach(img=>assert.ok(fs.existsSync(path.join(app,img.getAttribute('src')))));
  const css=fs.readFileSync(path.join(app,'ai-node-canvas-test-v2.css'),'utf8');
  assert.match(page,/href="\.\/ai-node-canvas-test-v2.css"/);
  assert.ok(!page.includes('href="./fluid-glass.css"'));
  assert.equal([...page.matchAll(/<style>\s*@layer legacy/g)].length,2);
  assert.match(css,/\.prompt-composer-shell \.prompt-textarea/);
  assert.match(css,/\.prompt-token-input \{color:transparent/);
  assert.match(css,/prefers-reduced-motion/);
  const widths=page.slice(page.indexOf('    function nodeWidth(node) {')).split('\n    function ')[0];
  for (const [type,width] of [['generator',480],['style',480],['image',320],['result',320]]) assert.ok(widths.includes(`node.type === "${type}") return ${width}`));
});

test('full-page boot wires the bottom toolbar, sidebar icons and single-row assistant controls', () => {
  const {document,window}=parseHTML(page);
  document.body.dataset.canvasReady='true';
  window.wandouShell = {};
  const canvas=document.getElementById('canvas');
  const canvasWrap=document.querySelector('.canvas-wrap');
  canvasWrap.getBoundingClientRect=()=>({width:1000,height:800});
  const calls=[];
  const view={x:40,y:20,zoom:.75};
  const imageMenuActions=[];
  for (const id of ['lightboxContextCopy','lightboxContextPrompt','lightboxContextRegenerate']) {
    document.getElementById(id).addEventListener('click',()=>imageMenuActions.push(id));
  }
  const context=vm.createContext({document,window,console,canvasStoragePrefix:'',
    renderNode:()=>document.createElement('section'),render:()=>calls.push('render'),
    setTimeout:()=>{},requestAnimationFrame:fn=>fn(),MutationObserver:window.MutationObserver,
    projectHub:document.getElementById('projectHub'),projectHubButton:document.getElementById('projectHubButton'),
    projectHubPinned:false,canvas,canvasWrap,view,panState:null,
    canvasTestStorage:{getItem:()=>null,setItem:()=>{}},
    fitCanvasToContent:()=>calls.push('fit'),autoLayout:()=>calls.push('arrange'),
    undoCanvas:()=>calls.push('undo'),redoCanvas:()=>calls.push('redo'),
    applyCanvasTransform:()=>calls.push('zoom'),scheduleCanvasSave:()=>calls.push('save')
  });
  vm.runInContext(script,context);
  assert.equal(document.body.dataset.testReady,'true');
  for (const id of ['lightboxContextCopy','lightboxContextPrompt','lightboxContextRegenerate']) {
    const button=document.getElementById(id);
    assert.ok(button.classList.contains('test-frame-button'));
    assert.equal(button.querySelectorAll('img.ui-icon').length,1);
    assert.equal(button.children.length,2);
    assert.equal(button.dataset.wdAction,undefined);
    button.click();
  }
  assert.deepEqual(imageMenuActions,['lightboxContextCopy','lightboxContextPrompt','lightboxContextRegenerate']);
  assert.ok(fs.readFileSync(path.join(app,'action-motion.js'),'utf8').includes("const excluded='.test-frame-button,"));
  assert.equal(document.querySelector('.topbar').parentElement,document.body);
  assert.equal(document.querySelectorAll('[data-add-node] .ui-icon').length,11);
  assert.equal(document.querySelectorAll('[data-menu-node].test-create-menu-item .ui-icon').length,11);
  for (const button of document.querySelectorAll('[data-menu-node]')) {
    assert.equal(button.children.length,2);
    assert.equal(button.lastElementChild.tagName,'SPAN');
    assert.equal(button.lastElementChild.textContent,button.getAttribute('aria-label'));
  }
  const hoverCss=fs.readFileSync(path.join(app,'ai-node-canvas-test-controls.css'),'utf8');
  assert.ok(hoverCss.includes('grid-template-columns:20px minmax(0,1fr)'));
  assert.ok(hoverCss.includes('pointer-events:none'));
  assert.ok(hoverCss.includes('transform:scaleX(0)'));
  assert.equal(document.querySelectorAll('.assistant-starters .ui-icon').length,4);
  assert.equal(document.querySelectorAll('.assistant-select-field > span').length,0);
  assert.ok(document.querySelector('.assistant-title-mark .green'));
  assert.ok(document.getElementById('clearButton').hidden);
  for (const action of ['fit','arrange','undo','redo','plus']) document.querySelector(`[data-tool="${action}"]`).click();
  assert.deepEqual(calls,['render','fit','fit','arrange','undo','redo','zoom','save']);
  assert.equal(view.zoom,.75*1.15);
  document.querySelector('[data-tool="pan"]').click();
  assert.equal(document.querySelector('[data-tool="pan"]').getAttribute('aria-pressed'),'true');
  assert.ok(canvasWrap.classList.contains('test-pan-mode'));
  document.querySelector('[data-tool="select"]').click();
  assert.ok(!canvasWrap.classList.contains('test-pan-mode'));
  document.querySelectorAll('img.ui-icon').forEach(img=>assert.ok(fs.existsSync(path.join(app,img.getAttribute('src')))));
});

test('API request, annotation, reference ordering and export handlers are unchanged from production', () => {
  const production=fs.readFileSync(path.join(app,'ai-node-canvas.html'),'utf8');
  for (const name of ['buildApiRequest','generatorPromptWithAnnotations','generatorAnnotationItems','reorderReference','downloadNodeMedia','exportCurrentProject']) {
    const extract=source=>{
      const regex=new RegExp('    (?:async )?function '+name+'\\(');
      const index=source.search(regex);
      assert.ok(index>=0,'missing '+name);
      const end=source.indexOf('\n    function ',index+10);
      const asyncEnd=source.indexOf('\n    async function ',index+10);
      const stop=Math.min(...[end,asyncEnd].filter(n=>n>index));
      return source.slice(index,stop).replaceAll('canvasTestStorage','localStorage').replaceAll('canvasTestSessionStorage','sessionStorage').replace(/\r\n/g,'\n');
    };
    assert.equal(extract(page),extract(production),name+' must retain the original implementation');
  }
});

test('bottom-right launcher and existing rail toggle the same panel and stay synchronized', () => {
  const {document}=parseHTML(page);
  const launcher=document.getElementById('assistantToggleButton');
  const rail=document.getElementById('assistantRailButton');
  const close=document.getElementById('assistantCloseButton');
  const writes=new Map();
  const context=vm.createContext({document,assistantToggleButton:launcher,assistantRailButton:rail,assistantCloseButton:close,
    canvasTestStorage:{setItem:(key,value)=>writes.set(key,value)},closeAssistantPickers:()=>{},
    requestAnimationFrame:fn=>fn(),scheduleDrawLinks:()=>{}});
  const start=page.indexOf('    function setAssistantOpen(');
  const end=page.indexOf('\n    function ',start+10);
  vm.runInContext(page.slice(start,end),context);
  for (const id of ['assistantToggleButton','assistantRailButton','assistantCloseButton']) {
    const line=page.split('\n').find(line=>line.trim().startsWith(id+'.addEventListener("click"'));
    assert.ok(line,'missing click handler '+id);
    vm.runInContext(line,context);
  }
  const check=open=>{
    assert.equal(document.querySelector('.app').classList.contains('assistant-open'),open);
    for (const button of [launcher,rail]) assert.equal(button.getAttribute('aria-expanded'),String(open));
    assert.equal(writes.get('aiCanvasAssistantOpenV1'),open?'1':'0');
    assert.equal(launcher.querySelector('.assistant-mascot-label').textContent,'对话助手');
  };
  launcher.click();check(false);
  rail.click();check(true);
  close.click();check(false);
  launcher.click();check(true);
  rail.click();check(false);
  assert.equal(document.querySelectorAll('#assistantToggleButton').length,1);
  assert.equal(launcher.getAttribute('aria-controls'),'assistantPanel');
  assert.ok(fs.existsSync(path.join(app,launcher.querySelector('img').getAttribute('src'))));
});

test('sidebar pointer release alone cannot open it; click opens once and remains keyboard accessible', () => {
  const {document,window}=parseHTML(page);
  const expand=document.getElementById('expandSidebarButton');
  const collapse=document.getElementById('collapseSidebarButton');
  const appElement=document.querySelector('.app');
  let saves=0;
  const context=vm.createContext({document,expandSidebarButton:expand,collapseSidebarButton:collapse,scheduleCanvasSave:()=>saves++});
  const start=page.indexOf('    collapseSidebarButton.addEventListener("click"');
  vm.runInContext(page.slice(start,page.indexOf('    themeToggleButton.addEventListener',start)),context);
  collapse.click();assert.ok(appElement.classList.contains('sidebar-collapsed'));
  for (const type of ['pointerdown','pointerup','pointercancel']) expand.dispatchEvent(new window.Event(type,{cancelable:true}));
  assert.ok(appElement.classList.contains('sidebar-collapsed'));assert.equal(saves,1);
  expand.click();assert.ok(!appElement.classList.contains('sidebar-collapsed'));assert.equal(saves,2);
  assert.equal(expand.getAttribute('type'),'button');
});

test('edge launcher motion keeps anchored hit targets, visible glyphs and reduced-motion support', () => {
  const css=fs.readFileSync(path.join(app,'ai-node-canvas-test-controls.css'),'utf8');
  assert.match(css,/#expandSidebarButton \{[^}]*top:calc\(50% - 29px\)[^}]*padding:0/);
  assert.match(css,/#expandSidebarButton:active:not\(:disabled\) \{transform:none;translate:none;animation:none;/);
  assert.match(css,/#expandSidebarButton svg,#collapseSidebarButton svg \{[^}]*flex:none[^}]*stroke:var\(--ui-green\)/);
  assert.match(css,/#assistantToggleButton:active:not\(:disabled\) \{transform:none;translate:none;animation:none;/);
  assert.match(css,/#assistantRailButton\[aria-expanded=true\],#assistantToggleButton\[aria-expanded=true\]/);
  assert.match(css,/#assistantRailButton \.assistant-rail-arrow \{translate:none!important;scale:none!important;/);
});

test('launcher events start visible glyph animations without toggling panels or moving hit targets', () => {
  const {document,window,ui}=setup('<button id="assistantToggleButton"><img class="ui-icon"><span>对话助手</span></button><button id="expandSidebarButton"><svg></svg></button>');
  let reduced=false;
  window.matchMedia=()=>({matches:reduced});
  for(const id of ['assistantToggleButton','expandSidebarButton']) {
    const button=document.getElementById(id);let actions=0,cancelled=0;const animations=[];
    button.addEventListener('click',()=>actions++);
    ui.installLauncherMotion(button,id==='assistantToggleButton');
    ui.installLauncherMotion(button,id==='assistantToggleButton');
    const glyph=button.querySelector('.test-launcher-motion-glyph');
    glyph.animate=(frames,options)=>{animations.push({frames,options});return {cancel:()=>cancelled++};};
    const hover=new window.Event('pointerenter');hover.pointerType='mouse';button.dispatchEvent(hover);
    assert.equal(animations.length,1);assert.equal(animations[0].options.duration,560);
    assert.equal(button.querySelectorAll('.test-launcher-motion-glyph').length,1);
    const press=new window.Event('pointerdown');press.button=0;button.dispatchEvent(press);
    assert.equal(animations.length,2);assert.equal(cancelled,1);assert.equal(actions,0);
    button.click();assert.equal(actions,1);
    reduced=true;button.dispatchEvent(hover);assert.equal(animations.length,2);reduced=false;
    assert.equal(button.style.transform,undefined);
  }
});

test('image result shell is edge-to-edge before, during and after generation, excluding other media', () => {
  for(const [mediaType,pending,content,expected] of [
    ['image',false,'<div class="placeholder-art"></div>',true],
    ['image',true,'<div class="loading-state"></div>',true],
    ['image',false,'<img>',true],['video',false,'<video></video>',false],
    ['audio',false,'<audio></audio>',false],['text',false,'<div class="text-result"></div>',false]
  ]) {
    const {node,ui}=setup(`<section class="node result"><div class="node-menu"><button data-delete></button></div><div class="node-body"><div class="preview">${content}<div class="result-meta-line"></div></div></div></section>`);
    ui.decorateNode(node,{type:'result',mediaType,pending});
    assert.equal(node.classList.contains('test-image-result'),expected);
    assert.ok(node.querySelector('.preview .result-meta-line'));
  }
  const css=fs.readFileSync(path.join(app,'ai-node-canvas-test-controls.css'),'utf8');
  assert.match(css,/\.node\.result\.test-image-result \{padding:0;border:0;background:transparent;box-shadow:none;/);
  assert.match(css,/\.node\.result\.test-image-result \.node-body \{padding:0/);
});

test('image result external SVG icons are whitened without changing other icons',()=>{
 const css=fs.readFileSync(path.join(app,'ai-node-canvas-test-controls.css'),'utf8');
 assert.match(css,/\.node\.result\.test-image-result \.node-menu button img\.ui-icon \{filter:brightness\(0\) invert\(1\)!important;/);
});
test('pending image and video show ghost and single generating label only',()=>{
 for(const mediaType of ['image','video','audio']){
 const {node,ui}=setup('<section class="node result"><div class="node-menu"></div><div class="preview"><div class="loading-state">old loading</div><div class="result-meta-line">12s</div></div></section>');
 ui.decorateNode(node,{type:'result',pending:true,mediaType});
 assert.equal(node.classList.contains('test-pending-media'),mediaType!=='audio');
 if(mediaType!=='audio'){assert.equal(node.querySelector('.loading-state').textContent,'正在生成中');assert.equal(node.querySelectorAll('.test-ghost-loader').length,1);}
 }
});
test('motion decorates controls without adding clicks or changing their disabled state', () => {
  const {node,ui}=setup(generatorFixture());
  ui.decorateNode(node,{type:'generator',count:1});
  const generate=node.querySelector('[data-generate]');
  let calls=0;generate.addEventListener('click',()=>calls++);
  const originalMarkup=generate.innerHTML;
  ui.decorateMotion(node,{id:'motion-generator',type:'generator',count:1});
  assert.equal(calls,0);
  assert.equal(generate.innerHTML,originalMarkup);
  assert.ok(generate.classList.contains('test-motion-button'));
  assert.equal(node.querySelector('.test-stepper button').disabled,true);
  generate.click();assert.equal(calls,1);
  assert.ok(!node.querySelector('.test-count-up,.test-count-down'));
});

test('favorite and count motion only runs on a state change, not initial load or unrelated renders', () => {
  const {document,ui}=setup('');
  const create=()=>{
    const element=document.createElement('section');
    element.innerHTML='<div class="node-menu"><button data-favorite><img class="ui-icon"></button></div><div class="test-stepper"><output>1</output></div>';
    return element;
  };
  let element=create();
  ui.decorateMotion(element,{id:'motion-result',favorite:true,count:1});
  assert.equal(element.querySelector('[data-favorite]').getAttribute('aria-pressed'),'true');
  assert.equal(element.querySelector('.test-motion-toggled'),null);
  element=create();ui.decorateMotion(element,{id:'motion-result',favorite:false,count:2});
  assert.ok(element.querySelector('.test-motion-toggled'));
  assert.ok(element.querySelector('output.test-count-up'));
  assert.equal(element.querySelector('[data-favorite]').getAttribute('aria-pressed'),'false');
  element=create();ui.decorateMotion(element,{id:'motion-result',favorite:false,count:2});
  assert.equal(element.querySelector('.test-motion-toggled,.test-count-up,.test-count-down'),null);
  element=create();ui.decorateMotion(element,{id:'motion-result',favorite:false,count:1});
  assert.ok(element.querySelector('output.test-count-down'));
  element=create();ui.decorateMotion(element,{id:'another-node',favorite:true,count:5});
  assert.equal(element.querySelector('.test-motion-toggled,.test-count-up,.test-count-down'),null);
});

test('motion is theme-neutral, scoped to controls, reduced-motion safe and tied to actual busy state', () => {
  const css=fs.readFileSync(path.join(app,'ai-node-canvas-test-motion.css'),'utf8');
  assert.match(page,/href="\.\/ai-node-canvas-test-motion\.css"/);
  assert.match(css,/@media \(hover:hover\) and \(pointer:fine\)/);
  assert.match(css,/@media \(prefers-reduced-motion:reduce\)/);
  assert.match(css,/\.test-motion-button,\.test-motion-button \.ui-icon \{transform:none!important;/);
  assert.match(css,/\[data-generate\]\.generating::after/);
  assert.match(css,/#assistantSendButton\[aria-busy=true\]::after/);
  assert.match(page,/assistantSendButton\.setAttribute\("aria-busy", String\(assistantSending\)\)/);
  assert.doesNotMatch(css,/transition:\s*all|box-shadow:|filter:|setTimeout|animation-delay:/);
  assert.doesNotMatch(css,/(?:^|\n)\.(?:canvas|node)\s*\{/);
  assert.doesNotMatch(css,/(?:color|background):\s*#[\da-f]+/i);
});

test('compact switches preserve existing handlers, off state and unsupported-model disabling', () => {
  const {node,ui}=setup('<section class="node"><div class="transparent-background-row"><label>开启透明背景</label><button data-transparent-background-toggle disabled>已关闭</button></div><button data-auto-split-toggle>已关闭</button><span class="auto-split-hint">AI按内容决定1–99张，并为每张生成独立提示词</span></section>');
  const split=node.querySelector('[data-auto-split-toggle]');
  const transparent=node.querySelector('[data-transparent-background-toggle]');
  let calls=0;split.addEventListener('click',()=>calls++);
  ui.decorateNode(node,{type:'image',autoSplit:false,transparentBackground:false});
  assert.equal(node.querySelector('[data-auto-split-toggle]'),split);
  assert.equal(split.getAttribute('role'),'switch');
  assert.equal(split.getAttribute('aria-checked'),'false');
  assert.equal(split.getAttribute('aria-label'),'自动拆分');
  assert.equal(transparent.disabled,true);
  assert.equal(transparent.getAttribute('aria-label'),'透明背景');
  assert.equal(node.querySelector('.auto-split-hint').textContent,'拆分 1–99 张 · 独立提示词');
  split.click();assert.equal(calls,1);
  ui.decorateMotion(node,{id:'switch',autoSplit:false});
  assert.equal(node.querySelector('.test-switch-changed'),null);
  ui.decorateMotion(node,{id:'switch',autoSplit:true});
  assert.ok(split.classList.contains('test-switch-changed'));
});

test('generation styling retains label, single action, disabled state and pointer-only feedback', () => {
  const {node,ui,window}=setup(generatorFixture());
  const button=node.querySelector('[data-generate]');
  let calls=0;button.addEventListener('click',()=>calls++);
  ui.decorateNode(node,{type:'generator',count:1});
  assert.equal(button.querySelector('.test-generate-label').textContent,'生成图片');
  assert.equal(button.querySelectorAll('.test-generate-orb svg').length,2);
  assert.equal(button.textContent,'生成图片');
  const press=new window.Event('pointerdown');press.button=0;
  button.dispatchEvent(press);
  assert.equal(calls,0);assert.ok(button.classList.contains('test-generate-fired'));
  button.click();assert.equal(calls,1);
  button.querySelector('.test-generate-orb').dispatchEvent(new window.Event('animationend'));
  assert.ok(!button.classList.contains('test-generate-fired'));
  button.disabled=true;button.dispatchEvent(press);
  assert.ok(!button.classList.contains('test-generate-fired'));
  assert.equal(button.disabled,true);
});

test('generator options move original switches into left/right cards with subordinate hints', () => {
  const options='<div class="form-row transparent-background-row"><label>开启透明背景</label><div class="transparent-background-control"><span class="transparent-background-hint">仅 GPT 模型可用</span><button data-transparent-background-toggle></button></div></div><div class="form-row auto-split-row"><label>自动拆分</label><div class="auto-split-control"><button data-auto-split-toggle></button><span class="auto-split-hint">AI按内容拆分</span></div></div>';
  const {node,ui}=setup(generatorFixture().replace('<button data-generate>',options+'<button data-generate>'));
  const left=node.querySelector('[data-transparent-background-toggle]');
  const right=node.querySelector('[data-auto-split-toggle]');
  let clicks=0;left.addEventListener('click',()=>clicks++);right.addEventListener('click',()=>clicks++);
  ui.decorateNode(node,{type:'generator'});
  const group=node.querySelector('.test-generator-options');
  assert.equal(group.children.length,2);
  assert.equal(group.firstElementChild.querySelector('button'),left);
  assert.equal(group.lastElementChild.querySelector('button'),right);
  assert.equal(group.querySelectorAll('[class$="-hint"]').length,2);
  left.click();right.click();assert.equal(clicks,2);
});

test('loaded single reference and image result frames use intrinsic image height, not a saved square', () => {
  for (const type of ['image','result']) {
    const markup=type==='image'
      ? '<div class="single-reference"><div class="thumb"><img style="width:100%;height:100%"><span class="reference-comment-marker">1</span></div></div>'
      : '<img><div class="result-meta-line">1024 × 1536</div>';
    const {node,ui,window}=setup(`<section class="node ${type}" style="min-height:520px"><div class="node-menu"><button data-delete></button></div><div class="node-body"><div class="preview">${markup}</div></div></section>`);
    const img=node.querySelector('.preview img');
    ui.decorateNode(node,{type,frameWidth:320,frameHeight:520});
    assert.ok(node.classList.contains('test-fitted-media'));
    assert.equal(node.style.minHeight,'0px');assert.equal(img.style.height,'auto');
    assert.equal(node.querySelector('.preview img'),img);
    img.dispatchEvent(new window.Event('load'));
    assert.ok(node.querySelector(type==='image'?'.reference-comment-marker':'.result-meta-line'));
  }
});

test('empty, multiple reference, pending, video and audio frames are not collapsed', () => {
  for (const [type,content] of [['image','<div class="placeholder-art"></div>'],['image','<div class="upload-box"><div class="thumb"><img></div><div class="thumb"><img></div></div>'],['result','<video></video>'],['result','<audio></audio>'],['result','<div class="loading-state"></div>']]) {
    const {node,ui}=setup(`<section class="node ${type}" style="min-height:520px"><div class="node-menu"><button data-delete></button></div><div class="preview">${content}</div></section>`);
    ui.decorateNode(node,{type});
    assert.ok(!node.classList.contains('test-fitted-media'));
    assert.equal(node.style.minHeight,'520px');
  }
});

test('reference control styling is scoped, uses source colors and does not crop media', () => {
  const css=fs.readFileSync(path.join(app,'ai-node-canvas-test-controls.css'),'utf8');
  assert.match(page,/ai-node-canvas-test-controls\.css/);
  assert.match(css,/linear-gradient\(135deg,#8b6cff,#4f8dff 60%,#2fc7b4\)/);
  assert.match(css,/clip-path:circle\(160%/);
  assert.match(css,/prefers-reduced-motion:reduce/);
  assert.match(css,/\.node\.test-fitted-media \.node-body \{padding:0;/);
  assert.match(css,/aspect-ratio:auto/);
  assert.doesNotMatch(css,/object-fit:cover|filter:blur|\.canvas-wrap\s*\{/);
  assert.ok(fs.existsSync(path.join(app,'../docs/lucian-ui-NOTICE.txt')));
});

test('single reference corner resizing preserves the actual image ratio without minimum-height letterboxing', () => {
  const {ui}=setup('');
  for (const ratio of [1/4,2/3,1,3/2,4]) {
    for (const corner of ['nw','ne','sw','se']) {
      for (const [dx,dy] of [[30,0],[0,40],[-500,-500]]) {
        const fitted=ui.fitImageResize(320,318/ratio+2,dx,dy,corner,ratio);
        assert.ok(fitted.width>=160);
        assert.ok(Math.abs((fitted.width-2)/(fitted.height-2)-ratio)<.000001);
      }
    }
  }
  assert.match(page,/window\.WandouCanvasTestUI\.fitImageResize\(resizeState\.width/);
});

test('precision popup uses themed options, original actions, keyboard navigation and outside dismissal', () => {
  const {node,ui,document,window}=setup(generatorFixture());
  let calls=0,chosen='';
  node.querySelectorAll('[data-resolution]').forEach(button=>button.addEventListener('click',()=>{calls++;chosen=button.dataset.resolution;}));
  ui.decorateNode(node,{id:'g',type:'generator',count:1});
  const picker=node.querySelector('.test-resolution-picker');
  const trigger=picker.querySelector('.node-select-trigger');
  const choices=[...picker.querySelectorAll('[role=option]')];
  let focused=null;
  [trigger,...choices].forEach(element=>element.focus=()=>{focused=element;});
  assert.equal(node.querySelector('select').hidden,true);
  assert.equal(trigger.getAttribute('aria-haspopup'),'listbox');
  assert.equal(choices[1].getAttribute('aria-selected'),'true');
  trigger.click();
  assert.equal(trigger.getAttribute('aria-expanded'),'true');assert.equal(focused,choices[1]);
  const up=new window.Event('keydown',{bubbles:true});up.key='ArrowUp';choices[1].dispatchEvent(up);
  assert.equal(focused,choices[0]);
  choices[2].click();assert.equal(calls,0);
  choices[0].click();assert.equal(calls,1);assert.equal(chosen,'1K');
  assert.equal(trigger.textContent,'1K');assert.equal(trigger.getAttribute('aria-expanded'),'false');
  trigger.click();
  const escape=new window.Event('keydown',{bubbles:true});escape.key='Escape';choices[0].dispatchEvent(escape);
  assert.equal(trigger.getAttribute('aria-expanded'),'false');assert.equal(focused,trigger);
  trigger.click();document.body.dispatchEvent(new window.Event('pointerdown',{bubbles:true}));
  assert.equal(trigger.getAttribute('aria-expanded'),'false');
});

function assistantGeometryHarness(width=1280,height=900) {
  const {document}=parseHTML('<html><body><div class="app assistant-open"><aside id="panel"></aside></div></body></html>');
  const app=document.querySelector('.app');
  const panel=document.getElementById('panel');
  const writes=new Map();
  panel.getBoundingClientRect=()=>Object.fromEntries(['left','top','width','height'].map(key=>[key,parseFloat(app.style.getPropertyValue('--assistant-'+key))]));
  const context=vm.createContext({document,window:{innerWidth:width,innerHeight:height},assistantPanel:panel,assistantPanelInteraction:null,
    assistantPanelGeometryStorageKey:'test-panel',canvasTestStorage:{getItem:key=>writes.get(key),setItem:(key,value)=>writes.set(key,value)}});
  const start=page.indexOf('    function normalizeAssistantPanelGeometry(');
  vm.runInContext(page.slice(start,page.indexOf('    function setAssistantOpen(',start)),context);
  const pointer=(x,y)=>({button:0,pointerId:1,clientX:x,clientY:y,target:panel,currentTarget:{setPointerCapture:()=>{}},preventDefault(){},stopPropagation(){}});
  return {context,app,panel,writes,pointer,document};
}

test('assistant eight edges/corners resize with anchored opposite edges and persist geometry', () => {
  for(const direction of ['n','s','e','w','nw','ne','sw','se']) {
    const {context:c,app,panel,writes,pointer,document}=assistantGeometryHarness();
    c.applyAssistantPanelGeometry({left:700,top:100,width:400,height:600});
    c.beginAssistantPanelInteraction(pointer(100,100),'resize',direction);
    c.updateAssistantPanelInteraction(pointer(130,140));
    const rect=c.currentAssistantPanelGeometry();
    assert.equal(rect.width,direction.includes('w')?370:direction.includes('e')?430:400);
    assert.equal(rect.height,direction.includes('n')?560:direction.includes('s')?640:600);
    if(direction.includes('w'))assert.equal(rect.left+rect.width,1100);
    if(direction.includes('n'))assert.equal(rect.top+rect.height,700);
    assert.equal(app.style.getPropertyValue('--chat-size'),(1280-rect.left)+'px');
    assert.equal(document.documentElement.style.getPropertyValue('--chat-size'),app.style.getPropertyValue('--chat-size'));
    c.finishAssistantPanelInteraction(pointer(130,140));
    assert.ok(writes.has('test-panel'));assert.equal(panel.classList.contains('resizing'),false);
    assert.equal(c.assistantPanelInteraction,null);
  }
});

test('assistant resize clamps minimums without drifting opposite edges and fits small windows', () => {
  const {context:c,pointer}=assistantGeometryHarness();
  c.applyAssistantPanelGeometry({left:700,top:100,width:400,height:600});
  c.beginAssistantPanelInteraction(pointer(0,0),'resize','nw');
  c.updateAssistantPanelInteraction(pointer(5000,5000));
  let rect=c.currentAssistantPanelGeometry();
  assert.equal(rect.width,280);assert.equal(rect.height,360);
  assert.equal(rect.left+rect.width,1100);assert.equal(rect.top+rect.height,700);
  c.updateAssistantPanelInteraction(pointer(-5000,-5000));
  rect=c.currentAssistantPanelGeometry();assert.equal(rect.left,0);assert.equal(rect.top,63);
  for(const [width,height] of [[240,300],[800,600],[1600,1000]]) {
    const {context}=assistantGeometryHarness(width,height);
    const next=context.normalizeAssistantPanelGeometry({left:9999,top:-9999,width:9999,height:9999});
    assert.ok(next.left>=0&&next.top>=0);
    assert.ok(next.left+next.width<=width);assert.ok(next.top+next.height<=height);
  }
});

test('assistant geometry restores and hidden-panel viewport changes ignore slide-out transform', () => {
  const {context:c,app,panel,writes}=assistantGeometryHarness();
  c.applyAssistantPanelGeometry({left:600,top:100,width:400,height:500},true);
  c.applyAssistantPanelGeometry({left:0,top:63,width:800,height:800});
  c.restoreAssistantPanelGeometry();
  assert.equal(c.currentAssistantPanelGeometry().left,600);
  app.classList.remove('assistant-open');
  panel.getBoundingClientRect=()=>({left:1000,top:100,width:400,height:500});
  assert.equal(c.currentAssistantPanelGeometry().left,600);
  writes.set('test-panel','null');c.restoreAssistantPanelGeometry();
  assert.equal(c.currentAssistantPanelGeometry().left,1280-316);
});
