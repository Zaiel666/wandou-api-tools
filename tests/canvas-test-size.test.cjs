// Offline regressions: execute the real sizing functions, never call an image API.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {parseHTML} = require('../tools/canvas-ui-test/node_modules/linkedom');
const read = file => fs.readFileSync(path.join(__dirname, '../app', file), 'utf8').replace(/\r\n/g, '\n');
const page = read('ai-node-canvas-test.html');
const previous = read('ai-node-canvas.html');
const expectedOptions = ['Auto自适应','自定义尺寸','1:1 方图','21:9 超宽屏','16:9 横屏','9:16 竖屏','4:3 横图','3:4 竖图','3:2 摄影横图','2:3 摄影竖图','5:4 商品图','4:5 社媒图','3:1 屏幕横图','1:3 长竖图'];
function sourceFunction(source, name) {
  const start = source.search(new RegExp('    (?:async )?function ' + name + '\\('));
  assert.ok(start >= 0, name);
  const remaining = source.slice(start + 1);
  const end = remaining.search(/\n    (?:async )?function /);
  assert.ok(end >= 0, name + ' end');
  return source.slice(start, start + 1 + end).trim();
}
const helpers = ['resolutionLongSide','scaleToResolution','closestImageSizeFromMap','orderedAutoKeys','normalizePromptSizeText','extractPromptSizeKey','extractPromptPixelSize','sizeDecisionFromRatio','sizeFromRatio','roundToMultiple','apiSizeFromTarget','apiSafeGenerationSize','ratioKey','parseSize'];
function sizing(source) {
  const context = vm.createContext({
    imageGenerationApiModel: model => model,
    isGptImageModel: model => model.startsWith('gpt-image-'),
    isGrokImageModel: () => false,
    isOneKOnlyImageModel: () => false,
    promptRequestsTransparentPng: () => false,
    promptWithSize: (prompt, size) => `${prompt}\n${size}`
  });
  vm.runInContext('const randomAutoKeys = ["9:16","3:4","2:3"]; let lastRandomAutoKey = "";\n' + helpers.map(name => sourceFunction(source, name)).join('\n') + '\n' + sourceFunction(source, 'buildApiRequest'), context);
  return context;
}
const optionsFrom = source => JSON.parse(source.match(/const imageRatioOptions = (\[[\s\S]*?\]);/)[1]);

test('all 14 screenshot options retain the original canvas labels and row-major order', () => {
  assert.deepEqual(optionsFrom(page), expectedOptions);
  assert.deepEqual(optionsFrom(previous), expectedOptions);
  const css = read('ai-node-canvas-test-v2.css');
  assert.match(css, /\.test-compact-settings \.ratio-menu \{[^}]*width:calc\(300% \+ 36px\)/);
  assert.match(css, /\.node-select-menu\.ratio-menu \{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)[^}]*overflow-y:auto/);
  assert.match(css, /\.custom-size-field input \{background:var\(--ui-surface\);color:var\(--ui-text\)/);
});

test('generation, reference dimensions, API sizing and result processing are unchanged from the old canvas', () => {
  for (const name of [...helpers,'ensureReferenceDimensions','buildApiRequest','generateFromNode','generateOneResult']) {
    const normalize = value => value.replaceAll('canvasTestStorage', 'localStorage').replaceAll('canvasTestSessionStorage','sessionStorage');
    assert.equal(normalize(sourceFunction(page, name)), normalize(sourceFunction(previous, name)), name);
  }
});

test('all 36 fixed ratio/precision combinations preserve target dimensions and request sizing', async () => {
  const current = sizing(page), old = sizing(previous);
  for (const ratio of expectedOptions.slice(2)) {
    for (const resolution of ['1K','2K','4K']) {
      const size = current.sizeFromRatio(ratio, resolution, [], {prompt:'9:16'});
      assert.equal(size, old.sizeFromRatio(ratio, resolution), `${ratio} ${resolution}`);
      const decision = current.sizeDecisionFromRatio(ratio, resolution);
      assert.equal(decision.source, '手动比例');
      assert.equal(decision.size, size);
      const node = {type:'generator',model:'gpt-image-2',ratio,resolution,prompt:'测试',count:1,_apiTargetSize:size};
      const request = await current.buildApiRequest(node, []);
      const payload = JSON.parse(request.body);
      assert.equal(payload.size, old.apiSafeGenerationSize(size));
      assert.equal(payload.resolution, resolution.toLowerCase());
      assert.match(payload.prompt, new RegExp(size));
      assert.deepEqual(payload, JSON.parse((await old.buildApiRequest(node, [])).body));
    }
  }
  assert.equal(current.sizeFromRatio('16:9 横屏','2K'), '2560x1440');
  assert.equal(current.sizeFromRatio('3:4 竖图','2K'), '1536x2048');
  assert.equal(current.sizeFromRatio('21:9 超宽屏','4K'), '3840x1646');
});

test('Auto retains prompt pixels > prompt ratio > first usable reference > no-reference fallback', () => {
  const current = sizing(page);
  const refs = [{}, {width:600,height:800}, {width:1600,height:900}];
  const cases = [
    [{prompt:'尺寸1200×1600，比例16:9'}, refs, '1200x1600','关键词像素尺寸'],
    [{prompt:'16:9 横屏'}, refs, '2560x1440','关键词比例'],
    [{prompt:'创作一幅图'}, refs, '1536x2048','参考图比例'],
    [{randomAuto:true}, [], '1440x2560','随机比例']
  ];
  for (const [options, references, size, source] of cases) {
    const actual = current.sizeDecisionFromRatio('Auto自适应','2K',references,options);
    assert.equal(actual.size,size);
    assert.equal(actual.source,source);
  }
  const next = current.sizeFromRatio('Auto自适应','2K',[],{randomAuto:true});
  assert.notEqual(next,'1440x2560','consecutive random sizes avoid repeating the same ratio');
  assert.ok(expectedOptions.slice(2).some(ratio => current.sizeFromRatio(ratio,'2K') === next));
});

test('custom pixels retain validation, override references/precision, and reach the request builder', async () => {
  const current = sizing(page);
  const options = {customWidth:1200,customHeight:1800,prompt:'横屏'};
  for (const resolution of ['1K','2K','4K']) {
    assert.equal(current.sizeFromRatio('自定义尺寸',resolution,[{width:900,height:600}],options),'1200x1800');
  }
  assert.equal(current.sizeFromRatio('自定义尺寸','2K',[],{customWidth:-10,customHeight:99999}),'64x8192');
  assert.equal(current.sizeFromRatio('自定义尺寸','2K',[],{customWidth:1200.6,customHeight:0}),'1201x1080');
  const request = await current.buildApiRequest({type:'generator',model:'gpt-image-2',resolution:'2K',ratio:'自定义尺寸',_apiTargetSize:'1200x1800',prompt:'测试'},[]);
  assert.equal(JSON.parse(request.body).size,current.apiSafeGenerationSize('1200x1800'));
});

test('real menu handlers select every size, persist custom inputs, and leave native scrolling enabled', () => {
  const {document,window} = parseHTML('<html><body><div id="wrap"></div></body></html>');
  const wrap = document.getElementById('wrap');
  const node = {ratio:'Auto自适应'};
  const context = vm.createContext({document,wrap,node,ratios:expectedOptions,escapeHtml:x=>x,pushHistory:()=>{},render:()=>{},scheduleCanvasSave:()=>{context.saves++;},saves:0});
  const template = page.match(/      const ratioMenuHtml = [^\n]+/)[0];
  vm.runInContext(template + '\nthis.menuHtml = ratioMenuHtml;',context);
  wrap.innerHTML = `<div data-node-select><button data-node-select-toggle></button><div class="node-select-menu ratio-menu" role="listbox">${context.menuHtml}</div></div><input data-custom-size="width"><input data-custom-size="height">`;
  const start = page.indexOf('      wrap.querySelectorAll("[data-node-select-toggle]")');
  const end = page.indexOf('      wrap.querySelectorAll("[data-node-model]")',start);
  vm.runInContext(page.slice(start,end),context);
  const ratioStart = page.indexOf('      wrap.querySelectorAll("[data-node-ratio]")',end);
  const ratioEnd = page.indexOf('      wrap.querySelectorAll("[data-count]")',ratioStart);
  vm.runInContext(page.slice(ratioStart,ratioEnd),context);
  const buttons = [...wrap.querySelectorAll('[data-node-ratio]')];
  assert.equal(buttons.length,14);
  assert.equal(buttons[0].getAttribute('aria-selected'),'true');
  buttons.forEach((button,index) => {button.click();assert.equal(node.ratio,expectedOptions[index]);});
  const width = wrap.querySelector('[data-custom-size="width"]');
  const height = wrap.querySelector('[data-custom-size="height"]');
  width.value='99999';width.dispatchEvent(new window.Event('change'));
  height.value='12';height.dispatchEvent(new window.Event('change'));
  assert.equal(node.customWidth,8192);assert.equal(node.customHeight,64);assert.equal(context.saves,2);
  const menu = wrap.querySelector('.ratio-menu');
  let bubbled=0;wrap.addEventListener('wheel',()=>bubbled++);
  const wheel = new window.Event('wheel',{bubbles:true,cancelable:true});menu.dispatchEvent(wheel);
  assert.equal(wheel.defaultPrevented,false);assert.equal(bubbled,0);
  let focused;
  const toggle = wrap.querySelector('[data-node-select-toggle]');
  [...buttons,toggle].forEach(element=>element.focus=()=>{focused=element;});
  const key = (target,value) => {const event=new window.Event('keydown',{bubbles:true,cancelable:true});event.key=value;target.dispatchEvent(event);};
  key(toggle,'ArrowDown');assert.equal(focused,buttons[0]);
  key(buttons[0],'ArrowDown');assert.equal(focused,buttons[2]);
  key(buttons[2],'ArrowRight');assert.equal(focused,buttons[3]);
  key(buttons[3],'End');assert.equal(focused,buttons[13]);
  key(buttons[13],'Escape');assert.equal(focused,toggle);
  assert.equal(toggle.getAttribute('aria-expanded'),'false');
});
