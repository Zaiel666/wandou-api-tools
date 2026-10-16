/* Shared visual adapter. Never replaces buttons, labels, event handlers or API logic. */
(()=>{
 const explicit='.generate-button,[data-generate],[data-psd-generate],[data-vector-generate],#generate-btn,#paste-generate-btn,#generate,.director-primary,.director-tools [data-action="frames"]';
 const excluded='.test-frame-button,.motion-export #cancel,[data-add-node],.sidebar .button-grid button,.test-generate,.preview-regenerate,.node-menu button,.preview-download,[data-preview-open],.preview-inner,.product-preview,[data-zoom-in],[data-zoom-out],[data-upload],.upload-zone,[data-action="stop"],[data-action="start"],[data-action="end"]';
 const pending=new WeakSet(),timers=new WeakMap();
 function sync(button){
  if(!button?.matches?.('button'))return;
  if(button.matches(excluded)){delete button.dataset.wdAction;delete button.dataset.wdBusy;delete button.dataset.wdFired;return;}
  const text=button.textContent.trim().replace(/^[↗↓↑✧✨⚡\s]+/u,'');
  const generate=button.matches(explicit)||(!/会显示|显示在这里|在这里展示|预览|查看/.test(text)&&/^(?:开始|立即|重新|批量|一键)?(?:生成|消除|抠图|放大|转写|转录|识别|提取提示词|渲染|分析并|转换|处理)/.test(text));
  const download=/^(?:下载|导出|保存为)/.test(text)&&!/(项目|设置|配置|工程)/.test(text);
  const large=button.matches('.primary,.primary-button,.wide-button,.landscape-export-btn,[data-psd-download],[data-vector-download]')||(button.getBoundingClientRect?.().width||0)>=120;
  const kind=generate?'generate':download&&large?'download':button.dataset.wdAction;
  if(!kind)return;
  button.dataset.wdAction=kind;
  const busy=button.getAttribute('aria-busy')==='true'||button.classList.contains('generating')||button.classList.contains('loading')||((button.disabled||button.getAttribute('aria-disabled')==='true')&&(/正在|生成中|处理中|导出中|转换中|分析中/.test(text)||pending.has(button)));
  button.dataset.wdBusy=String(busy);
  if(!button.disabled&&button.getAttribute('aria-disabled')!=='true')pending.delete(button);
 }
 function scan(root){if(root.nodeType===1)sync(root);root.querySelectorAll?.('button').forEach(sync);}
 document.addEventListener('click',e=>{const b=e.target.closest?.('button[data-wd-action]');if(!b||b.disabled||b.getAttribute('aria-disabled')==='true')return;
  pending.add(b);b.dataset.wdFired='true';clearTimeout(timers.get(b));timers.set(b,setTimeout(()=>{delete b.dataset.wdFired;sync(b);},650));
  queueMicrotask(()=>sync(b));
 },true);
 scan(document);
 const observer=new MutationObserver(records=>{const targets=new Set();for(const r of records){const b=r.target.nodeType===1?r.target.closest?.('button'):r.target.parentElement?.closest('button');if(b)targets.add(b);for(const n of r.addedNodes||[])if(n.nodeType===1)scan(n);}targets.forEach(sync);});
 observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['disabled','aria-disabled','aria-busy','class']});
 let resize;window.addEventListener('resize',()=>{clearTimeout(resize);resize=setTimeout(()=>scan(document),120);});
 window.WandouActionMotion={refresh:()=>scan(document)};
})();
