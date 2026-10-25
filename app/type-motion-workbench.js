/* Local editor refinements. Does not change other studios or project namespaces. */
(()=>{
 'use strict';
 const api=window.WandouTypeMotion,$=id=>document.getElementById(id);
 if(!api?.update)return;
 const svg=path=>`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
 $('theme').innerHTML=svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>');
 $('theme').setAttribute('aria-label','切换明暗主题');$('theme').title='切换明暗主题';
 document.querySelector('.motion-heading p:last-child').textContent='选择排版，放入产品，完成一张会呼吸的海报。';
 document.querySelector('.motion-library .motion-note').textContent='点击应用 · 停留片刻预览动效';
 $('status').textContent='本地制作 · 无需接口。可导出图片、动画或备份项目。';
 $('duration').insertAdjacentHTML('beforeend','<option value="10">10 秒</option>');
 const fonts=[['notosanssc','思源风格黑体 · Noto Sans SC'],['notoserifsc','思源风格宋体 · Noto Serif SC'],['mashanzheng','马善政楷书'],['zhimangxing','志莽行书'],['zcoolkuaile','站酷快乐体'],['zcoolqingkehuangyou','站酷庆科黄油体'],['zcoolxiaowei','站酷小薇体'],['longcang','龙藏手写体'],['liujianmaocao','刘建毛草'],['bebasneue','Bebas Neue · 英文标题']];
 fonts.forEach(([id,name])=>{const option=document.createElement('option');option.value=id;option.textContent=name;$('font').append(option);});
 const fontNote=document.createElement('p');fontNote.className='motion-note';fontNote.textContent='新增 10 款 OFL 开源字体，允许商业设计使用。字体按需加载；英文标题字体的中文使用系统回退。';$('font').parentElement.after(fontNote);
 const loaded=new Map(),images=new Map();
 async function loadFont(id){if(!fonts.some(f=>f[0]===id)||!document.fonts)return;if(!loaded.has(id)){const promise=(async()=>{const face=new FontFace('Motion-'+id,`url("./assets/motion-fonts/${id}/font.ttf")`,{weight:id.startsWith('noto')?'100 900':'400'});await face.load();document.fonts.add(face);})();loaded.set(id,promise);}try{await loaded.get(id);}catch(error){loaded.delete(id);throw Error('字体加载失败，请重新选择或使用系统字体');}}
 async function loadSubject(src){if(!src||images.has(src))return;const im=new Image();im.src=src;await im.decode();if(im.width*im.height>24000000)throw Error('产品图片像素过大，请缩小后导入');images.clear();images.set(src,im);}
 api.prepare=async state=>{await Promise.all([loadFont(state.font),loadSubject(state.subject)]);};
 api.decorate((state,main)=>{
  if(state.preview)return state;
  const fontFamily=state.font==='local'?api.localFamily?.(state.localFontName):fonts.some(f=>f[0]===state.font)?`"Motion-${state.font}","Microsoft YaHei",sans-serif`:undefined;
  return {...state,fontFamily,subjectImage:images.get(state.subject),draft:main&&!api.busy()};
 });
 const notify=text=>$('status').textContent=text;
 // Native select remains the form state; the visible popover follows the studio theme.
 const menus=[];
 for(const id of ['duration','ratio','font']){
  const select=$(id),box=document.createElement('div');box.className='motion-select';select.after(box);box.append(select);select.hidden=true;
  const trigger=document.createElement('button');trigger.type='button';trigger.className='motion-select-trigger';trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls',id+'-menu');trigger.setAttribute('aria-label',id==='font'?'选择字体':id==='ratio'?'选择画面比例':'选择循环时长');
  const menu=document.createElement('div');menu.id=id+'-menu';menu.className='motion-select-menu';menu.hidden=true;
  const close=()=>{menu.hidden=true;trigger.setAttribute('aria-expanded','false');};menus.push({box,close});
  const update=()=>{trigger.textContent=select.options[select.selectedIndex]?.textContent||select.value;menu.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.value===select.value)));};
  [...select.options].forEach(option=>{const b=document.createElement('button');b.type='button';b.dataset.value=option.value;b.textContent=option.textContent;menu.append(b);b.onclick=async()=>{if(api.busy())return;close();trigger.focus();trigger.disabled=true;try{await api.update({[id]:option.value});select.value=option.value;api.refresh();update();notify('已应用：'+option.textContent);}catch(error){notify(error.message);}finally{trigger.disabled=false;}};});
  trigger.onclick=()=>{if(api.busy())return;const opening=menu.hidden;menus.forEach(m=>m.close());menu.hidden=!opening;trigger.setAttribute('aria-expanded',String(opening));if(opening)menu.querySelector('button[aria-pressed=true]')?.focus();};
  box.addEventListener('keydown',e=>{if(e.key==='Escape'){close();trigger.focus();}if(!menu.hidden&&['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const choices=[...menu.querySelectorAll('button')],at=choices.indexOf(document.activeElement),next=e.key==='Home'?0:e.key==='End'?choices.length-1:(at+(e.key==='ArrowDown'?1:-1)+choices.length)%choices.length;choices[next].focus();}});
  box.append(trigger,menu);update();select.addEventListener('change',update);document.addEventListener('motion-state-change',update);
  new MutationObserver(update).observe(select,{childList:true});
 }
 document.addEventListener('pointerdown',e=>menus.forEach(m=>{if(!m.box.contains(e.target))m.close();}));
 const subject=document.createElement('div');subject.className='motion-subject';subject.innerHTML='<h3>产品主体</h3><p class="motion-note">上传产品图片，不是三维模型。建议使用透明 PNG；空间模板的字带会从主体前后绕过。</p><label class="motion-drop">＋ 上传产品图片<input id="subjectFile" type="file" accept="image/png,image/jpeg,image/webp"></label><p id="subjectInfo" class="motion-note">未添加产品 · PNG / JPG / WebP，最大 8 MB</p><label>主体大小<input id="subjectScale" type="range" min="15" max="70" value="38"></label><button id="removeSubject" type="button">移除产品图片</button>';
 $('motion-panel-0').append(subject);
 const subjectInfo=()=>{$('subjectInfo').textContent=api.getState().subject?'已添加产品 · 随 JSON 导出备份。使用「空间」分类前四款模板查看环绕效果。':'未添加产品 · PNG / JPG / WebP，最大 8 MB';$('removeSubject').disabled=!api.getState().subject;$('subjectScale').value=api.getState().subjectScale;};document.addEventListener('motion-state-change',subjectInfo);
 async function upload(file){if(!file||api.busy())return;let url;try{if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>8*1024*1024)throw Error('请选择 8 MB 以内的 PNG、JPG 或 WebP 图片');notify('正在载入产品图片…');url=URL.createObjectURL(file);const im=new Image();im.src=url;await im.decode();if(im.width*im.height>24000000)throw Error('图片超过 2400 万像素，请缩小后重试');const c=document.createElement('canvas'),scale=Math.min(1,1000/Math.max(im.width,im.height));c.width=Math.round(im.width*scale);c.height=Math.round(im.height*scale);c.getContext('2d').drawImage(im,0,0,c.width,c.height);const data=c.toDataURL('image/png');if(data.length>=4000000)throw Error('图片内容过大，请压缩后上传');await api.update({subject:data,...(!['helix','cylinder','gyroscope','typeglobe'].includes(api.getState().effect)?{effect:'helix'}:{})});subjectInfo();notify('产品已置于字带中央，可调节主体大小。');}catch(e){notify(e.message);}finally{if(url)URL.revokeObjectURL(url);$('subjectFile').value='';}}
 $('subjectFile').onchange=e=>upload(e.target.files[0]);
 const drop=subject.querySelector('.motion-drop');drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('is-over');});drop.addEventListener('dragleave',()=>drop.classList.remove('is-over'));drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('is-over');upload(e.dataTransfer.files[0]);});
 $('subjectScale').oninput=async e=>{await api.update({subjectScale:e.target.value});};$('removeSubject').onclick=async()=>{await api.update({subject:null});images.clear();subjectInfo();};
 const projectLabel=$('loadProject').parentElement;projectLabel.firstChild.textContent='导入项目备份（JSON）';
 // Resizing has keyboard alternatives and a hard minimum for the central stage.
 const workspace=document.querySelector('.motion-workspace');
 for(const [side,panel,min,max,initial] of [['left','.motion-library',220,420,272],['right','.motion-controls',280,440,320]]){
  const handle=document.createElement('div');handle.className='motion-divider '+side;handle.tabIndex=0;handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','vertical');handle.setAttribute('aria-label',side==='left'?'调整模板栏宽度':'调整设置栏宽度');handle.setAttribute('aria-valuemin',min);handle.setAttribute('aria-valuemax',max);let width=initial;const set=value=>{const other=workspace.querySelector(side==='left'?'.motion-controls':'.motion-library').getBoundingClientRect().width;const limit=Math.max(min,workspace.clientWidth-other-330);width=Math.round(Math.max(min,Math.min(max,limit,value)));workspace.style.setProperty('--'+side+'-width',width+'px');handle.setAttribute('aria-valuenow',width);};handle.setAttribute('aria-valuenow',width);workspace.querySelector(panel).append(handle);let drag;
  handle.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();drag={x:e.clientX,width:workspace.querySelector(panel).getBoundingClientRect().width};handle.setPointerCapture(e.pointerId);};handle.onpointermove=e=>{if(drag)set(drag.width+(e.clientX-drag.x)*(side==='left'?1:-1));};handle.onpointerup=handle.onpointercancel=()=>drag=null;handle.onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();set(width+(e.key==='ArrowRight'?16:-16)*(side==='left'?1:-1));}};handle.ondblclick=()=>set(initial);
 }
 // Standalone export embeds the product; font file is embedded when readable.
 const download=(blob,name)=>{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);};
 $('html').onclick=async()=>{if(api.busy())return;try{const state=api.getState();if(state.font==='local')throw Error('本地字体不自动分发：请导出 PNG / 视频，或切换内置字体后导出 HTML');if(fonts.some(f=>f[0]===state.font)){notify('正在打包字体…');const response=await fetch(`./assets/motion-fonts/${state.font}/font.ttf`);if(!response.ok)throw Error('字体文件无法读取');const bytes=new Uint8Array(await response.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));state.fontData=btoa(binary);state.fontFamily=`"Motion-${state.font}"`;}const data=JSON.stringify(state).replace(/</g,'\\u003c');const html='<!doctype html><meta charset="utf-8"><title>文字动态海报</title><style>body{margin:0;background:#111;display:grid;place-items:center;min-height:100vh}canvas{max-width:100%;max-height:94vh}button{position:fixed;bottom:8px;right:8px}</style><canvas></canvas><button>播放 / 暂停</button><script>const s='+data+';const draw='+api.draw.toString()+';const c=document.querySelector("canvas");[c.width,c.height]='+JSON.stringify(api.dimensions(state.ratio))+';let playing=!matchMedia("(prefers-reduced-motion: reduce)").matches;document.querySelector("button").onclick=()=>playing=!playing;async function start(){if(s.fontData){const f=new FontFace("Motion-"+s.font,"url(data:font/ttf;base64,"+s.fontData+")",{weight:s.font.startsWith("noto")?"100 900":"400"});await f.load();document.fonts.add(f);}if(s.subject){const im=new Image();im.src=s.subject;await im.decode();s.subjectImage=im;}let p=0,last=0;function frame(n){if(last&&playing&&!document.hidden)p=(p+Math.min(n-last,100)/1000*s.speed/s.duration)%1;last=n;draw(c,s,p);requestAnimationFrame(frame)}requestAnimationFrame(frame)}start();<\/script>';download(new Blob([html],{type:'text/html'}),'文字动态海报.html');notify('动态 HTML 已导出，包含产品图片。');}catch(e){notify('HTML 打包失败：'+e.message+'。可先导出 PNG / 视频，或切换系统字体后导出 HTML。');}};
 api.prepare(api.getState()).then(()=>{api.refresh();subjectInfo();}).catch(e=>notify(e.message));
})();
