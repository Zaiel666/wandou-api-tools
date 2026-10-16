/* Project-scoped conversation archive. Never modifies canvas nodes or API calls. */
(() => {
  let archiving = false;
  const historyKey = () => assistantConversationStorageKey() + ':history';
  const read = key => {
    const value = JSON.parse(canvasTestStorage.getItem(key) || '[]');
    if (!Array.isArray(value)) throw new Error('历史记录格式异常');
    return value.filter(item => item && Array.isArray(item.messages));
  };
  async function archive() {
    if (archiving || assistantSending) return false;
    if (!assistantMessages.length) return true;
    archiving = true;
    const key = historyKey(), original = assistantMessages;
    try {
      const messages = await Promise.all(original.map(async message => ({
        role:message.role, text:message.text, status:message.status,
        images:await Promise.all((message.images || []).map(url => persistMediaValue(url)))
      })));
      const records = read(key);
      const fingerprint = JSON.stringify(messages);
      if (!records.some(item => JSON.stringify(item.messages) === fingerprint)) {
        records.unshift({id:Date.now().toString(36),date:new Date().toISOString(),
          title:(messages.find(item => item.role === 'user')?.text || '图片对话').slice(0,60),messages});
        // Never silently evict older conversations.
        const serialized = JSON.stringify(records);
        canvasTestStorage.setItem(key, serialized);
        if (canvasTestStorage.getItem(key) !== serialized) throw new Error('历史写入未确认');
      }
      return key === historyKey() && original === assistantMessages && !assistantSending;
    } catch (error) {
      showToast('历史记录保存失败，已保留当前对话：' + error.message, 'error');
      return false;
    } finally { archiving = false; }
  }
  window.WandouAssistantHistory = {archive};
  const init = () => {
    if (document.body.dataset.testReady !== 'true') { setTimeout(init,100); return; }
    const panel = document.getElementById('assistantPanel');
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'assistant-history-toggle';
    button.title = '历史记录'; button.setAttribute('aria-label','历史记录');
    button.setAttribute('aria-expanded','false'); button.setAttribute('aria-controls','assistantHistoryPanel');
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11a9 9 0 1 1 2.6 7M3 4v7h7M12 7v5l3 2"/></svg>';
    panel.querySelector('.assistant-close').before(button);
    const history = document.createElement('section');
    history.id = 'assistantHistoryPanel';history.className = 'assistant-history-panel';history.hidden = true;
    history.setAttribute('aria-label','当前项目的对话历史');
    panel.append(history);
    const close = () => { history.hidden = true;button.setAttribute('aria-expanded','false');button.focus(); };
    function renderHistory() {
      history.replaceChildren();
      const head = document.createElement('div');head.className='assistant-history-head';
      const title=document.createElement('strong');title.textContent='对话历史';
      const back=document.createElement('button');back.type='button';back.textContent='返回';back.onclick=close;
      head.append(title,back);history.append(head);
      const hint=document.createElement('p');hint.textContent='仅当前项目 · 新对话会自动归档 · 点击记录查看';history.append(hint);
      let records;
      try { records=read(historyKey()); } catch (_) { hint.textContent='历史读取失败，原记录未改动。';return; }
      const key=historyKey();
      const entries = assistantMessages.length ? [{title:'当前对话',messages:assistantMessages,current:true},...records] : records;
      if (!entries.length) { const empty=document.createElement('p');empty.textContent='还没有对话记录。';history.append(empty); }
      entries.forEach(entry => {
        const item=document.createElement('details');
        const summary=document.createElement('summary');summary.textContent=entry.title;
        item.append(summary);
        if(entry.date) {const date=document.createElement('small');date.textContent=new Date(entry.date).toLocaleString();item.append(date);}
        entry.messages.forEach(message => {
          const text=document.createElement('p');
          text.textContent=(message.role==='user'?'我：':'助手：')+message.text+((message.images||[]).length?' [含图片]':'');item.append(text);
        });
        if(!entry.current) {
          const restore=document.createElement('button');restore.type='button';restore.textContent='恢复这段对话';
          restore.onclick=async()=>{
            if(key!==historyKey()) {renderHistory();return;}
            if(assistantSending) {showToast('请等待当前回复完成。');return;}
            if(assistantInput.value.trim() || assistantAttachments.length) {showToast('输入区有未发送内容，请先发送或清空后恢复。');return;}
            restore.disabled=true;
            try {
              const loaded=await Promise.all(entry.messages.map(async message=>({...message,images:await Promise.all((message.images||[]).map(url=>url.startsWith(localMediaPrefix)?getLocalMedia(url):url))})));
              if(key!==historyKey() || !await archive() || key!==historyKey()) return;
              if(assistantInput.value.trim() || assistantAttachments.length) {showToast('输入区有未发送内容，未切换对话。');return;}
              assistantMessages=loaded;saveAssistantConversation();renderAssistantConversation();close();
            } catch(error) {showToast('恢复失败，当前对话已保留。','error');}
            finally {restore.disabled=false;}
          };
          item.append(restore);
        }
        history.append(item);
      });
    }
    button.onclick=()=>{if(!history.hidden) {close();return;}renderHistory();history.hidden=false;button.setAttribute('aria-expanded','true');};
    history.addEventListener('keydown',event=>{if(event.key==='Escape') {event.stopPropagation();close();}});
    // Close the project-specific view when the underlying conversation changes.
    new MutationObserver(()=>{if(!history.hidden) {history.hidden=true;button.setAttribute('aria-expanded','false');}}).observe(document.getElementById('assistantMessages'),{childList:true});
    const input=document.getElementById('assistantInput');
    const examples=['描述你的创意，让我们一起完善…','整理构图、光线与材质…','规划从参考图到成片的节点流程…','换个角度，开启灵感头脑风暴…'];
    let index=0;
    setInterval(()=>{
      if(document.hidden || !panel.closest('.app')?.classList.contains('assistant-open') || input.value || document.activeElement===input || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      input.placeholder=examples[index++ % examples.length];
    },4500);
  };
  init();
})();
