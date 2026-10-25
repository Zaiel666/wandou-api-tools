(() => {
 const host=document.querySelector('.home-test-hero-panel');if(!host)return;
 const slides=[
  ['01 / 无限创作','灵感不设限。','连接图像与想法，让每一次探索成为作品。','./project-hub.html','进入节点画布','<div class="poster-landscape"></div><span class="poster-caption">THE CREATIVE CANVAS</span>'],
  ['02 / 文字动态海报','字有引力。','30 种文字动效，让你的表达拥有节奏。','./type-motion.html','开始文字创作','<div class="poster-type"><span>TYPE</span><span>MOTION</span><span>STUDIO</span></div><span class="poster-caption">WORDS IN MOTION / 30 PRESETS</span>'],
  ['03 / 3D 导演台','掌控每一帧。','布置场景，定义镜头，直接渲染你的视角。','./ai-node-canvas-v2.html?open=director','进入 3D 导演台','<div class="poster-orbit"><i></i><i></i><i></i><b></b></div><span class="poster-caption">DIRECT YOUR NEXT FRAME</span>']
 ];
 host.className='home-carousel';host.setAttribute('role','region');host.setAttribute('aria-roledescription','轮播图');host.setAttribute('aria-label','创作工具推荐');
 host.innerHTML=slides.map((s,i)=>`<section class="home-slide poster-${i}" aria-roledescription="幻灯片" aria-label="${i+1} / 3" ${i?'hidden':''}><div class="home-slide-art" aria-hidden="true">${s[5]}</div><a class="poster-link" href="${s[3]}" data-tab-title="${s[4]}"><div class="home-slide-copy"><small>${s[0]}</small><h2>${s[1]}</h2><p>${s[2]}</p><span class="poster-action">${s[4]} <span aria-hidden="true">↗</span></span></div></a></section>`).join('')+'<button class="carousel-edge carousel-prev" data-prev aria-label="上一张">‹</button><button class="carousel-edge carousel-next" data-next aria-label="下一张">›</button><div class="home-carousel-controls">'+slides.map((s,i)=>`<button data-slide="${i}" aria-label="显示第 ${i+1} 张：${s[4]}" aria-pressed="${i===0}"><span></span></button>`).join('')+'<button data-pause aria-label="暂停自动轮播">暂停</button></div>';
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');let index=0,paused=reduced.matches,hover=false,focused=false,timer;
 const pauseButton=host.querySelector('[data-pause]');
 function show(next){index=(next+slides.length)%slides.length;host.querySelectorAll('.home-slide').forEach((s,i)=>{s.hidden=false;const position=i===index?'current':i===(index+1)%slides.length?'next':'previous';s.dataset.position=position;s.setAttribute('aria-hidden',String(i!==index));s.querySelector('a').tabIndex=i===index?0:-1;});host.querySelectorAll('[data-slide]').forEach((b,i)=>b.setAttribute('aria-pressed',String(i===index)));}
 function schedule(){clearInterval(timer);host.classList.toggle('is-paused',paused||hover||focused||document.hidden);pauseButton.textContent=paused?'▷':'Ⅱ';pauseButton.setAttribute('aria-label',paused?'开始自动轮播':'暂停自动轮播');pauseButton.title=paused?'开始自动轮播':'暂停自动轮播';if(!paused&&!hover&&!focused&&!document.hidden)timer=setInterval(()=>show(index+1),6500);}
 host.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.hasAttribute('data-pause'))paused=!paused;else if(b.hasAttribute('data-prev'))show(index-1);else if(b.hasAttribute('data-next'))show(index+1);else if(b.hasAttribute('data-slide'))show(Number(b.dataset.slide));schedule();});
 host.addEventListener('mouseenter',()=>{hover=true;schedule();});host.addEventListener('mouseleave',()=>{hover=false;schedule();});host.addEventListener('focusin',()=>{focused=true;schedule();});host.addEventListener('focusout',e=>{if(!host.contains(e.relatedTarget)){focused=false;schedule();}});document.addEventListener('visibilitychange',schedule);reduced.addEventListener('change',()=>{paused=reduced.matches;schedule();});window.addEventListener('pagehide',()=>clearInterval(timer));show(0);schedule();
})();

/* Cover artwork stays separate from the persistent, accessible tool labels. */
(() => {
 const covers=[
  ['canvas','WORKFLOW','连接灵感，自由创作'],['gridform','LAYOUT DESIGN','把每个想法排成作品'],['audio','AUDIO TO TEXT','让声音成为文字'],
  ['image','IMAGE STUDIO','让想象清晰可见'],['motion','TYPE IN MOTION','赋予文字新的节奏'],['cutout','BACKGROUND REMOVAL','只留下你想要的主角'],
  ['watermark','IMAGE CLEANUP','让画面回归纯净'],['keyword','IMAGE TO PROMPT','读懂一张图的灵感'],['copywriter','WRITING STUDIO','让表达更准确有力'],
  ['video-prompt','STORYBOARD','把灵感写成镜头'],['video','VIDEO TO TEXT','捕捉每一句精彩'],['mindmap','MIND MAPPING','让思路自然展开']
 ];
 document.querySelectorAll('.home-test-page .module-card').forEach((card,index)=>{
  const [name,category,tagline]=covers[index];
  card.classList.add('home-cover-card');
  card.dataset.cover=name;
  card.querySelectorAll('.tool-label br').forEach(br=>br.replaceWith(' · '));
  const cover=document.createElement('span');cover.className='tool-cover';cover.setAttribute('aria-hidden','true');
  const img=document.createElement('img');img.src=`./assets/home-covers/${name}.webp`;img.alt='';img.width=960;img.height=640;img.decoding='async';img.loading=index<3?'eager':'lazy';
  const badge=document.createElement('span');badge.className='cover-category';badge.textContent=category;
  const reveal=document.createElement('span');reveal.className='cover-reveal';
  const caption=document.createElement('strong');caption.textContent=tagline;
  const action=document.createElement('span');action.textContent='开始创作 ↗';reveal.append(caption,action);
  cover.append(img,badge,reveal);card.prepend(cover);
 });
})();

/* Keep the existing links and click handlers on the secondary information panels. */
(() => {
 const cards=document.querySelectorAll('.home-test-page .blog-entry-card,.home-test-page .service-card,.home-test-page .guide-card');
 cards.forEach(card=>{
  const title=card.querySelector('.tool-label,.blog-entry-copy strong,.service-card strong,.guide-card h3');
  if(!title)return;
  const front=document.createElement('span');front.className='home-flip-front';front.setAttribute('aria-hidden','true');
  const text=document.createElement('strong');text.className='home-flip-front-title';text.textContent=title.innerText.replace(/\s+/g,' ').trim();
  front.append(text);
  if(card.matches('.service-card,.guide-card')){
   const mark=document.createElement('span');mark.className='home-flip-front-mark';mark.textContent=card.querySelector('.service-card-icon')?.textContent.trim()||'↗';front.prepend(mark);
   const back=document.createElement('span');back.className='home-flip-back';
   while(card.firstChild)back.append(card.firstChild);
   card.append(front,back);
  }else{
   const back=card.querySelector('.module-copy,.blog-entry-copy');
   back?.classList.add('home-flip-back');
   card.prepend(front);
   if(card.matches('.module-card')){
    const action=document.createElement('span');action.className='home-flip-action';action.setAttribute('aria-hidden','true');action.textContent='打开工具 ↗';back?.append(action);
   }
  }
  card.classList.add('home-flip-card');
 });
 requestAnimationFrame(()=>requestAnimationFrame(()=>cards.forEach(card=>card.classList.add('home-flip-motion-ready'))));
})();
