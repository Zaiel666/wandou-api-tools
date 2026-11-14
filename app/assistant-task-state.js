(() => {
  const button = document.getElementById('assistantToggleButton');
  if (!button) return;
  const active = new Set();
  let settleTimer;
  const labels = {idle:'打开豌豆助手', thinking:'豌豆正在处理任务，点击打开助手', complete:'任务已完成，点击打开助手', error:'任务未完成，请查看节点提示'};
  function show(state) {
    button.dataset.mascotState = state;
    button.setAttribute('aria-label',labels[state]);
    button.title=labels[state];
  }
  window.WandouMascotState = Object.freeze({
    set(owner,state) {
      clearTimeout(settleTimer);
      if (state === 'thinking') active.add(owner); else active.delete(owner);
      if (active.size) { show('thinking'); return; }
      show(['complete','error'].includes(state) ? state : 'idle');
      if (state === 'complete' || state === 'error') settleTimer=setTimeout(()=>show(active.size ? 'thinking' : 'idle'),1400);
    }
  });
  window.addEventListener('pagehide',()=>clearTimeout(settleTimer));
  show('idle');
})();
