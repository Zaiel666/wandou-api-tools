const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('../desktop-client/node_modules/playwright');

test('refine prompt, model brands, selection frame and image menu remain usable',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:960}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route(/^https?:/,route=>route.abort());
    await page.goto(pathToFileURL(path.resolve(__dirname,'../app/ai-node-canvas-test.html')).href);
    await page.waitForSelector('body[data-canvas-ready="true"][data-test-ready="true"]');
    await page.evaluate(()=>setAssistantOpen(true,false));
    await page.evaluate(()=>{
      if(!nodes.some(node=>node.type==='generator'))createNode('generator',0,0,{prompt:''});
      const generator=nodes.find(node=>node.type==='generator');generator.prompt='';render();
      assistantModelOptions=['gpt-6.1-sol','claude-sonnet','gemini-3-pro','grok-4','deepseek-v3.2','glm-5.2','kimi-k2.6','qwen3','doubao-pro','mistral-large','custom-chat'];
      renderAssistantModelOptions();
    });
    const refine=page.locator('.node.generator [data-prompt-refine-open]').first();
    assert.match(await refine.getAttribute('title'),/先写好提示词/);
    assert.notEqual(await refine.locator('.test-refine-letter').count(),0);
    assert.equal(await refine.locator('svg.test-refine-icon').count(),1);
    const colors=()=>refine.evaluate(button=>({
      ink:getComputedStyle(button).color,
      letter:getComputedStyle(button.querySelector('.test-refine-letter')).color,
      icon:getComputedStyle(button.querySelector('.test-refine-icon')).color,
      stroke:getComputedStyle(button.querySelector('.test-refine-icon')).stroke,
      background:getComputedStyle(button).backgroundColor
    }));
    const firstColor=await colors();
    assert.equal(firstColor.letter,firstColor.ink);
    assert.equal(firstColor.icon,firstColor.ink);
    assert.equal(firstColor.stroke,firstColor.ink);
    assert.notEqual(firstColor.ink,'rgb(0, 0, 0)');
    await page.waitForTimeout(850);
    const nextColor=await colors();
    assert.notEqual(nextColor.ink,firstColor.ink);
    assert.notEqual(nextColor.background,firstColor.background);
    await refine.screenshot({path:path.resolve(__dirname,'../artifacts/refine-color-light.png')});
    await refine.evaluate(button=>button.click());
    assert.equal(await page.evaluate(()=>nodes.find(node=>node.type==='generator').promptRefineOpen||false),false);
    await page.evaluate(()=>{const node=nodes.find(n=>n.type==='generator');node.prompt='一只猫';render();});
    await page.locator('.node.generator [data-prompt-refine-open]').first().evaluate(button=>button.click());
    assert.equal(await page.evaluate(()=>nodes.find(node=>node.type==='generator').promptRefineOpen),true);
    assert.equal(await page.locator('.node.generator [data-prompt-refine-open]').first().evaluate(button=>button.classList.contains('test-refine-activated')),true);
    const ratio=page.locator('.node.generator .ratio-menu .node-select-option:has(.test-common-ratio)').first();
    assert.equal(await ratio.evaluate(button=>button.querySelector('span')?.contains(button.querySelector('.test-common-ratio'))),true);
    assert.ok(await ratio.evaluate(button=>{const label=button.querySelector('span');const range=document.createRange();range.selectNodeContents(label.firstChild);return button.querySelector('.test-common-ratio').getBoundingClientRect().left-range.getBoundingClientRect().right;})<2);
    const badges=await page.locator('.node.generator .ratio-menu .test-common-ratio').count();assert.ok(badges>=5);
    const model=page.locator('.assistant-select-field.model');
    for(const [name,file] of [['claude-sonnet','claude.ico'],['deepseek-v3.2','deepseek.svg'],['glm-5.2','glm.ico'],['kimi-k2.6','kimi.ico'],['qwen3','qwen.svg'],['custom-chat','sparkles.svg']]){
      const src=await model.locator('.assistant-picker-option').filter({hasText:name}).locator('img').getAttribute('src');
      assert.ok(src.endsWith(file),`${name}: ${src}`);
      assert.ok(fs.existsSync(path.resolve(__dirname,'../app',src)));
    }
    await model.locator('[data-assistant-picker-trigger]').click();
    await model.locator('.assistant-picker-option').filter({hasText:'deepseek-v3.2'}).click();
    assert.ok((await model.locator('[data-assistant-picker-value] img').getAttribute('src')).endsWith('deepseek.svg'));
    await model.locator('[data-assistant-picker-trigger]').click();
    await page.evaluate(()=>document.body.classList.add('dark-theme'));
    await page.waitForTimeout(600);
    const darkColor=await colors();
    assert.equal(darkColor.letter,darkColor.ink);
    assert.equal(darkColor.icon,darkColor.ink);
    assert.notEqual(darkColor.ink,'rgb(0, 0, 0)');
    await page.locator('.node.generator [data-prompt-refine-open]').first().screenshot({path:path.resolve(__dirname,'../artifacts/refine-color-dark.png')});
    await page.screenshot({path:path.resolve(__dirname,'../artifacts/canvas-model-brands-dark.png')});
    await model.locator('[data-assistant-picker-trigger]').click();
    await page.locator('.node.generator .test-compact-settings .node-select:has(.ratio-menu) .node-select-trigger').first().click();
    await page.screenshot({path:path.resolve(__dirname,'../artifacts/canvas-ratio-menu-dark.png')});
    await page.locator('.node.generator .ratio-menu').first().screenshot({path:path.resolve(__dirname,'../artifacts/canvas-ratio-menu-detail.png')});
    await page.locator('.node.generator .test-compact-settings .node-select:has(.ratio-menu) .node-select-trigger').first().click();
    await page.evaluate(()=>{if(nodes.length<2)createNode('generator',650,0);render();});
    await page.locator('[data-tool="select-all"]').click();
    const selection=await page.evaluate(()=>({ids:boxSelectedIds.length,frame:selectionFrame.getBoundingClientRect().toJSON(),nodes:nodes.filter(n=>n.type!=='selection').length,mode:selectionFrame.dataset.mode}));
    assert.equal(selection.ids,selection.nodes);assert.equal(selection.mode,'all');assert.ok(selection.frame.width>100&&selection.frame.height>100);
    assert.equal(await page.locator('.node.box-selected').count(),0);
    assert.deepEqual(await page.locator('#selectionMenu button').allTextContents(),['删除','自动排列']);
    await page.evaluate(()=>{const menu=document.getElementById('lightboxImageMenu');document.body.append(menu);menu.classList.add('open');menu.style.position='fixed';menu.style.left='760px';menu.style.top='200px';menu.style.zIndex='999';});
    const copy=page.locator('#lightboxContextCopy');
    assert.equal(await copy.locator('span').evaluate(span=>getComputedStyle(span).whiteSpace),'nowrap');
    assert.equal(await copy.evaluate(button=>button.scrollHeight<=button.clientHeight+2),true);
    assert.equal(await copy.locator('span').evaluate(span=>span.getBoundingClientRect().height<30),true);
    fs.mkdirSync(path.resolve(__dirname,'../artifacts'),{recursive:true});
    await page.screenshot({path:path.resolve(__dirname,'../artifacts/canvas-refine-selection-preview.png')});
    await page.evaluate(()=>document.getElementById('lightboxImageMenu').classList.remove('open'));
    await page.mouse.move(250,64);
    await page.mouse.down({button:'right'});
    await page.mouse.move(1080,835,{steps:12});
    await page.mouse.up({button:'right'});
    assert.equal(await page.locator('#selectionMenu').evaluate(menu=>menu.classList.contains('open')),true);
    assert.equal(await page.locator('#selectionFrame').evaluate(frame=>frame.dataset.mode),'marquee');
    assert.equal(await page.locator('#selectionFrame').evaluate(frame=>getComputedStyle(frame).borderTopColor),'rgb(231, 90, 71)');
    assert.ok(await page.locator('.node.box-selected').count()>0);
    await page.screenshot({path:path.resolve(__dirname,'../artifacts/canvas-right-selection-preview.png')});
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
