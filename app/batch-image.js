/* Batch edits use the existing generation, media and project-save pipeline. */
(() => {
  const drafts = new Map();
  let state, busy = false, importing = false, stop = false, activeNodeId = null, chatDraft = '';
  const key = () => projectCanvasStorageKey();
  const draftKey = nodeId => `${key()}::${nodeId || 'assistant'}`;
  const fresh = () => ({slots:[{name:'参考图',images:[]},{name:'我们的产品图',images:[]},{name:'模特参考图',images:[],optional:true}],prompt:'请把 @参考图 里的产品替换为 @我们的产品图，保持产品外观、颜色与 Logo 准确。',preserve:true,grid:true,jobs:[]});
  const dialog = document.createElement('dialog');
  dialog.className = 'batch-dialog'; dialog.id = 'batchImageDialog'; dialog.setAttribute('aria-labelledby','batchTitle');
  dialog.innerHTML = `<header class="batch-header"><div><h2 id="batchTitle">批量改图</h2><p>组合参考图，批量生成结果</p></div><div class="batch-header-actions"><button type="button" data-history-trigger aria-expanded="false" aria-controls="batchHistoryPanel">历史</button><button type="button" data-close aria-label="关闭批量改图">✕</button></div></header>
    <div class="batch-body"><section class="batch-history" id="batchHistoryPanel" hidden><strong>历史与模板</strong><label>历史文字模板<select data-templates aria-label="历史文字模板"><option value="">选择已保存模板</option></select></label><div class="batch-history-actions"><button type="button" data-save-template>保存文字模板</button><button type="button" data-clear>清空图片</button></div><small>文字模板只保存槽位名称、提示词和生成设置。</small></section>
    <div class="batch-section-head"><div><strong>图片参考</strong><small>各槽位取一张 · 上传图仅本页保留</small></div><button type="button" data-add>＋ 添加槽位</button></div>
    <div class="batch-slots"></div><div class="batch-tokens"></div><label for="batchPrompt">改图要求</label><textarea id="batchPrompt" placeholder="输入改图要求，可点击槽位名称插入引用"></textarea>
    <div class="batch-settings"><div class="batch-picker batch-picker-model" data-picker="model"><span class="batch-field-label">模型</span><button type="button" class="batch-picker-trigger" aria-label="批量改图模型" aria-haspopup="listbox" aria-expanded="false"><span class="batch-picker-value"></span><span class="batch-chevron" aria-hidden="true">⌄</span></button><div class="batch-picker-options" role="listbox" hidden></div><select data-model hidden aria-label="批量改图模型"></select></div>
    <div class="batch-picker" data-picker="resolution"><span class="batch-field-label">清晰度</span><button type="button" class="batch-picker-trigger" aria-label="批量改图清晰度" aria-haspopup="listbox" aria-expanded="false"><span class="batch-picker-value"></span><span class="batch-chevron" aria-hidden="true">⌄</span></button><div class="batch-picker-options" role="listbox" hidden></div><select data-resolution hidden aria-label="批量改图清晰度"></select></div>
    <div class="batch-picker" data-picker="ratio"><span class="batch-field-label">比例</span><button type="button" class="batch-picker-trigger" aria-label="批量改图比例" aria-haspopup="listbox" aria-expanded="false"><span class="batch-picker-value"></span><span class="batch-chevron" aria-hidden="true">⌄</span></button><div class="batch-picker-options" role="listbox" hidden></div><select data-ratio hidden aria-label="批量改图比例"><option>Auto自适应</option><option>1:1</option><option>3:4</option><option>4:3</option><option>9:16</option><option>16:9</option></select></div></div>
    <div class="batch-toggles"><label><input type="checkbox" data-preserve checked><span>保留未修改内容</span></label><label><input type="checkbox" data-grid checked><span>结果按批次排列</span></label></div></div>
    <div class="batch-summary"><strong data-count></strong><p>每组生成 1 张 · 最多 120 个任务 · 按 API 实际计费</p><div class="batch-progress" role="status" aria-live="polite"></div></div>
    <div class="batch-footer"><button type="button" data-stop hidden>停止后续任务</button><button type="button" data-retry hidden>重试未完成</button><button type="button" class="batch-primary" data-run>开始批量生成</button></div>`;
  const composer = document.getElementById('assistantComposer');
  const assistantInput = document.getElementById('assistantInput');
  const assistantSend = document.getElementById('assistantSendButton');
  const chatView = document.getElementById('assistantChatView');
  dialog.append(dialog.querySelector('.batch-summary'),dialog.querySelector('.batch-footer'));
  composer.before(dialog);
  const $ = selector => dialog.querySelector(selector);
  const prompt = $('#batchPrompt'), model = $('[data-model]'), resolution = $('[data-resolution]');
  const message = text => {$('.batch-progress').textContent = text;};
  const templateKey = 'wandouBatchImageTemplatesV1';
  function templates() {
    const data = JSON.parse(canvasTestStorage.getItem(templateKey) || '[]');
    if (!Array.isArray(data)) throw new Error('模板格式异常');
    return data;
  }
  function refreshTemplates() {
    const select = $('[data-templates]'); select.replaceChildren(new Option('选择已保存模板',''));
    try {templates().forEach((t,i) => select.add(new Option(t.prompt.slice(0,32),String(i))));}
    catch (_) {message('模板读取失败，原数据已保留。');}
  }
  function closePickers() {
    dialog.querySelectorAll('.batch-picker').forEach(picker => {
      picker.classList.remove('is-open');
      picker.querySelector('.batch-picker-trigger').setAttribute('aria-expanded','false');
      picker.querySelector('.batch-picker-options').hidden=true;
    });
  }
  function syncPickers() {
    dialog.querySelectorAll('.batch-picker').forEach(picker => {
      const select=picker.querySelector('select'), trigger=picker.querySelector('.batch-picker-trigger');
      const menu=picker.querySelector('.batch-picker-options');
      picker.querySelector('.batch-picker-value').textContent=select.selectedOptions[0]?.textContent||'请选择';
      menu.replaceChildren(...Array.from(select.options,option=>{
        const item=document.createElement('button');item.type='button';item.className='batch-picker-option';
        item.setAttribute('role','option');item.setAttribute('aria-selected',String(option.value===select.value));
        item.textContent=option.textContent;
        item.onclick=()=>{select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));closePickers();trigger.focus();};
        return item;
      }));
      trigger.title=select.selectedOptions[0]?.textContent||'';
    });
  }
  function updateResolution(value) {
    resolution.replaceChildren(...imageResolutionOptionsForModel(model.value).map(v => new Option(v,v)));
    if ([...resolution.options].some(o => o.value === value)) resolution.value = value;
    syncPickers();
  }
  function readForm() {
    const value=dialog.open ? assistantInput.value : prompt.value;
    prompt.value=value;
    Object.assign(state,{prompt:value,model:model.value,resolution:resolution.value,ratio:$('[data-ratio]').value,preserve:$('[data-preserve]').checked,grid:$('[data-grid]').checked});
    const anchor=nodes.find(node=>node.id===activeNodeId&&node.type==='batch');
    if(anchor){Object.assign(anchor,{prompt:value,model:state.model,resolution:state.resolution,ratio:state.ratio});scheduleCanvasSave();}
  }
  function count() {
    const total = state.slots.some(s=>!s.optional&&!s.images.length)||!state.slots.some(s=>s.images.length) ? 0 : state.slots.reduce((n,s) => n * (s.optional && !s.images.length ? 1 : s.images.length),1);
    $('[data-count]').textContent = `${state.slots.filter(s=>s.images.length).map(s=>s.images.length).join(' × ')||'0'} = ${total} 个任务`;
    $('[data-run]').disabled = busy || importing || !total || total > WandouBatchCore.MAX_TASKS;
    if(dialog.open) assistantSend.disabled = busy || importing || !total || total > WandouBatchCore.MAX_TASKS;
    $('[data-add]').disabled = busy || importing || state.slots.length >= 6;
  }
  function renderSlots() {
    const holder = $('.batch-slots'), tokens = $('.batch-tokens'); holder.replaceChildren();tokens.replaceChildren();
    state.slots.forEach((slot,index) => {
      const card = document.createElement('section'); card.className='batch-slot';
      const head=document.createElement('div');head.className='batch-slot-head';
      const name=document.createElement('input');name.value=slot.name;name.maxLength=30;name.setAttribute('aria-label',`槽位 ${index+1} 名称`);name.disabled=busy||importing;
      name.onchange=()=>{const old=slot.name;slot.name=name.value.trim();if(old && slot.name) {state.prompt=assistantInput.value.split('@'+old).join('@'+slot.name);prompt.value=state.prompt;assistantInput.value=state.prompt;readForm();}renderSlots();};
      const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.title='删除槽位';remove.setAttribute('aria-label',`删除槽位 ${index+1}`);remove.disabled=busy||importing||state.slots.length<=1;
      remove.onclick=()=>{state.slots.splice(index,1);renderSlots();};
      const badge=document.createElement('span');badge.className='batch-optional';badge.textContent=slot.optional?'可选':'必填';
      const amount=document.createElement('span');amount.className='batch-slot-count';amount.textContent=`${slot.images.length} 张`;
      head.append(name,remove,badge,amount);card.append(head);
      const thumbs=document.createElement('div');thumbs.className='batch-thumbs';
      if(!slot.images.length){const empty=document.createElement('span');empty.className='batch-empty';empty.textContent=slot.optional?'换模特时上传，可留空':'上传或拖入图片';thumbs.append(empty);}
      slot.images.forEach((ref,i)=>{const box=document.createElement('div');box.className='batch-thumb';const img=document.createElement('img');img.src=ref.url;img.alt=ref.name||`图片 ${i+1}`;const del=document.createElement('button');del.type='button';del.textContent='×';del.setAttribute('aria-label',`移除图片 ${i+1}`);del.disabled=busy||importing;del.onclick=()=>{slot.images.splice(i,1);renderSlots();};box.append(img,del);thumbs.append(box);});card.append(thumbs);
      const input=document.createElement('input');input.type='file';input.accept='image/*';input.multiple=true;input.hidden=true;
      const upload=document.createElement('button');upload.type='button';upload.className='batch-upload';upload.textContent='＋ 上传图片';upload.setAttribute('aria-label',`向${slot.name}上传图片`);upload.disabled=busy||importing;upload.onclick=()=>input.click();
      input.onchange=()=>addFiles(slot,input.files);card.ondragover=e=>e.preventDefault();card.ondrop=e=>{e.preventDefault();addFiles(slot,e.dataTransfer.files);};card.append(input,upload);holder.append(card);
      const token=document.createElement('button');token.type='button';token.textContent='@'+slot.name;token.disabled=busy||importing||(slot.optional&&!slot.images.length);if(slot.optional&&!slot.images.length)token.title='上传模特参考图后可引用';token.onclick=()=>{const field=dialog.open?assistantInput:prompt;field.setRangeText('@'+slot.name,field.selectionStart,field.selectionEnd,'end');readForm();field.focus();};tokens.append(token);
    }); count();
  }
  async function addFiles(slot,files) {
    if(busy||importing)return;
    const target=state, origin=key(); importing=true;renderSlots();lock();
    let failed=0;
    try {
      for(const file of Array.from(files)) {
        if(slot.images.length>=120){message('每个槽位最多 120 张图片。');break;}
        if(!file.type.startsWith('image/')){failed++;continue;}
        try {const ref=await imageFileToReference(file);if(origin!==key()||state!==target)return;slot.images.push(ref);}catch(_){failed++;}
      }
      message(failed ? `${failed} 个文件不是可读取的图片，其余已添加。` : '图片已添加。');
    } finally {importing=false;lock();renderSlots();}
  }
  function lock() {
    dialog.querySelectorAll('textarea,select,[data-preserve],[data-grid],[data-save-template],[data-clear],.batch-picker-trigger').forEach(el=>el.disabled=busy||importing);
    if(busy||importing)closePickers();
    $('[data-stop]').hidden=!busy; $('[data-stop]').disabled=stop;
    $('[data-retry]').hidden=!state.jobs.some(j=>j.status!=='success');$('[data-retry]').disabled=busy||importing;
    count();
  }
  async function run(retry=false) {
    if(busy||importing)return;readForm();
    let plan;
    try {if(!retry)plan=WandouBatchCore.plan(state.slots,state.prompt,state.preserve);}catch(e){message(e.message);return;}
    const chosenModel=retry ? state.jobs.find(j=>j.status!=='success')?.node.model : state.model;
    if(!chosenModel)return;
    if(!apiProfileForModel(chosenModel).key){setSettingsOpen(true);close();showToast('请先在设置中填写当前模型的 API 密钥。');return;}
    const context=key(), nodeList=nodes, anchor=nodes.find(node=>node.id===activeNodeId&&node.type==='batch'); busy=true;stop=false;lock();renderSlots();
    if(anchor){anchor.status=`批量改图 · ${retry?state.jobs.length:plan.length} 个任务处理中`;render();}
    try {
      const handle=nativeAutoSaveDirectory||autoSaveDirectoryHandle||await loadAutoSaveDirectoryHandle();
      if(window.wandouShell?.chooseSaveDirectory && !(nativeAutoSaveDirectory||(handle&&await hasAutoSaveDirectoryPermission(handle,true)))) {
        message('请先设置图片保存位置，然后再开始。');close(true);await chooseAutoSaveDirectory();return;
      }
      if(context!==key()||nodeList!==nodes)throw new Error('项目已变化，任务未启动。');
      if(!retry) {
        pushHistory();
        const x=nodes.length ? Math.max(...nodes.map(n=>n.x+nodeWidth(n)))+160 : 80;
        const batchId=Date.now().toString(36);
        state.jobs=plan.map((task,i)=>({status:'queued',node:createNode('generator',x+(i%3)*1100,80+Math.floor(i/3)*600,{...task,model:state.model,resolution:state.resolution,ratio:state.ratio,count:1,skillId:'',skillName:'',batchEditId:batchId,status:'批量任务 · 等待生成',_deferRender:true})}));
        render();
      }
      if(!await saveCanvasState())throw new Error('画布尚未保存成功。任务已保留，请稍后点击重试未完成。');
      const jobs=state.jobs.filter(j=>j.status!=='success');
      for(const job of jobs) {
        if(stop)break;
        if(context!==key()||nodeList!==nodes)throw new Error('项目已变化，已停止后续任务。');
        if(!nodes.includes(job.node)){job.status='missing';continue;}
        const previous=new Set(links.filter(l=>l.from===job.node.id).map(l=>l.to));
        job.status='running';message(`正在处理 ${state.jobs.indexOf(job)+1}/${state.jobs.length} · 已成功 ${state.jobs.filter(j=>j.status==='success').length} 个`);
        try {
          await generateFromNode(job.node.id);
          const outputs=links.filter(l=>l.from===job.node.id&&!previous.has(l.to)).map(l=>nodes.find(n=>n.id===l.to)).filter(Boolean);
          job.status=outputs.some(n=>n.mediaUrl&&!n.pending)?'success':'failed';
        }catch(e){job.status='failed';job.node.status='批量生成失败：'+e.message;}
      }
      if(state.grid && context===key() && nodeList===nodes) {
        const ids=new Set(state.jobs.map(j=>j.node.id));
        const results=links.filter(l=>ids.has(l.from)).map(l=>nodes.find(n=>n.id===l.to)).filter(n=>n?.type==='result');
        if(results.length){const x=Math.max(...state.jobs.map(j=>j.node.x+nodeWidth(j.node)))+110;results.forEach((n,i)=>{n.x=x+(i%3)*380;n.y=80+Math.floor(i/3)*400;});reflowResultGrid(results);render();}
      }
      fitCanvasToContent();
      if(!await saveCanvasState())throw new Error('图片处理已结束，但画布尚未保存成功，请保留页面并稍后保存。');
      const done=state.jobs.filter(j=>j.status==='success').length;
      if(anchor){anchor.status=`批量改图 · 成功 ${done}/${state.jobs.length}`;render();}
      message(`${stop?'已停止后续任务':'本批处理结束'}：成功 ${done}/${state.jobs.length}，未完成 ${state.jobs.length-done}。${state.jobs.length>done?'可重试未完成任务，或在画布查看失败原因。':''}`);
    } catch(e){if(anchor){anchor.status=`批量改图 · ${e.message}`;render();}message(e.message);} finally {busy=false;lock();renderSlots();}
  }
  function close(force=false) {
    if((busy||importing)&&!force){showToast('请先停止并等待当前批量任务结束。');return;}
    if(dialog.open&&state)readForm();
    closePickers();
    if(dialog.open)dialog.close();
    const anchor=nodes.find(node=>node.id===activeNodeId&&node.type==='batch');
    if(anchor&&!anchor.status){anchor.status='已设置改图要求 · 打开以添加图片';render();}
    activeNodeId=null;
    chatView.classList.remove('batch-mode');
    assistantInput.value=chatDraft;
    assistantInput.placeholder='询问、搜索或制作任何内容…';
    assistantInput.setAttribute('aria-label','输入对话内容');
    assistantSend.setAttribute('aria-label','发送');assistantSend.dataset.tooltip='发送';
    assistantSend.disabled=typeof assistantSending!=='undefined'&&assistantSending;
    document.querySelector('.batch-toggle')?.setAttribute('aria-pressed','false');
    document.querySelector('.batch-chat-toggle')?.setAttribute('aria-pressed','true');
    resizeAssistantInput();
  }
  function open(nodeId=null, refresh=false) {
    if((busy||importing)&&(!dialog.open||nodeId!==activeNodeId)){showToast('当前批量任务仍在处理中。');return;}
    if(dialog.open&&state&&!refresh)readForm();
    if(!dialog.open)chatDraft=assistantInput.value;
    activeNodeId=nodes.some(node=>node.id===nodeId&&node.type==='batch')?nodeId:null;
    const anchor=nodes.find(node=>node.id===activeNodeId&&node.type==='batch');
    state=drafts.get(draftKey(activeNodeId))||{...fresh(),prompt:anchor?.prompt||fresh().prompt,model:anchor?.model,resolution:anchor?.resolution,ratio:anchor?.ratio};
    drafts.set(draftKey(activeNodeId),state);
    prompt.value=state.prompt;
    model.replaceChildren(...imageModelOptions.map(v=>new Option(v,v)));model.value=state.model||defaultImageModel();updateResolution(state.resolution);
    $('[data-ratio]').value=state.ratio||'Auto自适应';$('[data-preserve]').checked=state.preserve;$('[data-grid]').checked=state.grid;message('');refreshTemplates();syncPickers();closePickers();
    $('#batchHistoryPanel').hidden=true;$('[data-history-trigger]').setAttribute('aria-expanded','false');
    setAssistantOpen(true,false);setAssistantTab('chat');
    if(!dialog.open)dialog.show();
    chatView.classList.add('batch-mode');
    assistantInput.value=state.prompt;
    assistantInput.placeholder='输入改图要求，可用 @槽位名 引用图片…';
    assistantInput.setAttribute('aria-label','输入批量改图要求');
    assistantSend.setAttribute('aria-label','开始批量生成');assistantSend.dataset.tooltip='开始批量生成';
    document.querySelector('.batch-toggle')?.setAttribute('aria-pressed','true');
    document.querySelector('.batch-chat-toggle')?.setAttribute('aria-pressed','false');
    renderSlots();lock();resizeAssistantInput();
  }
  $('[data-close]').onclick=()=>close();
  $('[data-history-trigger]').onclick=()=>{
    const panel=$('#batchHistoryPanel'), next=panel.hidden;
    panel.hidden=!next;$('[data-history-trigger]').setAttribute('aria-expanded',String(next));
    closePickers();
  };
  dialog.querySelectorAll('.batch-picker').forEach(picker=>{
    picker.querySelector('.batch-picker-trigger').onclick=()=>{
      const wasOpen=picker.classList.contains('is-open');closePickers();
      if(wasOpen)return;
      picker.classList.add('is-open');picker.querySelector('.batch-picker-options').hidden=false;
      picker.querySelector('.batch-picker-trigger').setAttribute('aria-expanded','true');
      picker.scrollIntoView({block:'nearest'});
    };
  });
  dialog.addEventListener('click',event=>{if(!event.target.closest('.batch-picker'))closePickers();});
  dialog.addEventListener('keydown',event=>{if(event.key==='Escape'){closePickers();}});
  $('[data-add]').onclick=()=>{let n=state.slots.length+1;while(state.slots.some(s=>s.name===`槽位${n}`))n++;state.slots.push({name:`槽位${n}`,images:[]});renderSlots();};
  $('[data-clear]').onclick=()=>{state.slots.forEach(s=>s.images=[]);renderSlots();message('图片已清空，文字设置保留。');};
  prompt.oninput=readForm;model.onchange=()=>{updateResolution();readForm();};
  dialog.addEventListener('change',()=>{if(state){readForm();syncPickers();}});
  $('[data-run]').onclick=()=>run();$('[data-retry]').onclick=()=>run(true);
  $('[data-stop]').onclick=()=>{stop=true;$('[data-stop]').disabled=true;message('将在当前任务完成后停止，已发送的请求仍会完成。');};
  $('[data-save-template]').onclick=()=>{
    readForm();try {const entries=templates();entries.unshift({names:state.slots.map(s=>s.name),slots:state.slots.map(s=>({name:s.name,optional:!!s.optional})),prompt:state.prompt,model:state.model,resolution:state.resolution,ratio:state.ratio,preserve:state.preserve,grid:state.grid});const value=JSON.stringify(entries);canvasTestStorage.setItem(templateKey,value);if(canvasTestStorage.getItem(templateKey)!==value)throw new Error('存储空间不足');refreshTemplates();message('文字模板已保存，包含槽位名称、提示词和生成设置；不包含图片。');}catch(e){message('模板保存失败：'+e.message);}
  };
  $('[data-templates]').onchange=()=>{
    if($('[data-templates]').value==='')return;
    try {const t=templates()[Number($('[data-templates]').value)];if(!t||!Array.isArray(t.names)||t.names.length<1||t.names.length>6)throw new Error('无效模板');
      if(state.slots.some(s=>s.images.length)){$('[data-templates]').value='';message('请先清空图片，再加载文字模板。');return;}
      Object.assign(state,{...t,jobs:[],slots:(Array.isArray(t.slots)&&t.slots.length===t.names.length?t.slots:t.names.map(name=>({name,optional:name==='模特参考图'}))).map(slot=>({name:slot.name,optional:!!slot.optional,images:[]}))});open(activeNodeId,true);message('模板已载入，请上传图片。');
    }catch(e){message('无法加载模板：'+e.message);}
  };
  // Block project replacement while the existing generator is awaiting a response.
  const guard=fn=>function(...args){if(busy||importing){showToast('批量任务处理中，请先停止并等待当前任务结束。');return;}if(dialog.open)close();return fn.apply(this,args);};
  switchProject=guard(switchProject);createProject=guard(createProject);deleteProject=guard(deleteProject);importProjectFile=guard(importProjectFile);
  // Some legacy listeners captured their original handler before this module loaded.
  // Keep the canvas stable while generation mutates its node and link arrays.
  for(const type of ['pointerdown','click','keydown','drop']) document.addEventListener(type,event=>{
    if(!(busy||importing)||dialog.contains(event.target)||event.target.closest?.('.batch-toggle'))return;
    if(event.target.closest?.('.app')){event.preventDefault();event.stopImmediatePropagation();if(type==='click')showToast('批量任务处理中，请在批量改图中停止后等待当前任务结束。');}
  },true);
  composer.addEventListener('submit',event=>{
    if(!dialog.open)return;
    event.preventDefault();event.stopImmediatePropagation();run();
  },true);
  assistantInput.addEventListener('keydown',event=>{
    if(!dialog.open||event.isComposing||event.keyCode===229||event.key!=='Enter'||event.shiftKey)return;
    event.preventDefault();event.stopImmediatePropagation();run();
  },true);
  assistantInput.addEventListener('input',()=>{if(dialog.open)readForm();});
  window.WandouBatchImage={open,close};
  const init=()=>{
    if(document.body.dataset.testReady!=='true'){setTimeout(init,100);return;}
    const bar=document.createElement('div');bar.className='batch-mode-bar';bar.setAttribute('role','group');bar.setAttribute('aria-label','对话创作模式');
    const chat=document.createElement('button');chat.type='button';chat.className='batch-chat-toggle';chat.textContent='对话';chat.setAttribute('aria-pressed','true');chat.onclick=()=>close();
    const batch=document.createElement('button');batch.type='button';batch.className='batch-toggle';batch.textContent='批量改图';batch.setAttribute('aria-pressed','false');batch.onclick=()=>open();
    bar.append(chat,batch);composer.prepend(bar);
  };
  init();
})();
