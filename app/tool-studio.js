(() => {
  document.body.classList.add('tool-studio');
  const nav=document.createElement('nav');nav.className='studio-navigation';nav.setAttribute('aria-label','创作工具导航');
  nav.innerHTML='<a href="./homepage-test.html"><img src="./logo.png" alt="">豌豆 AI</a><a href="./png-workflow.html">AI 抠图</a><a href="./watermark-remove.html">AI 去水印</a><a href="./gridform.html">网格海报</a><a href="./type-motion.html">文字动态海报</a>';
  nav.querySelectorAll('a').forEach(a=>{if(new URL(a.href).pathname===location.pathname)a.setAttribute('aria-current','page');});
  document.body.prepend(nav);
})();
