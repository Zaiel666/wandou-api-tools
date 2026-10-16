/* Original, offline typography renderer. No remote fonts, APIs, or paid presets. */
(function(root){
 'use strict';
 const catalog=[
 ['softflag','文字软旗 · 蓝色宣言','海报'],['perspective','中轴透视 · 金色剧场','海报'],['typewall','重复阵列 · 节奏墙','海报'],
 ['wave','波纹字场','字阵'],['rise','阶梯宣言','字阵'],['orbit','环形唱片','空间'],['echo','雕塑叠层','空间'],['pulse','放射声场','几何'],['ticker','斜向胶带','拼贴'],
 ['typewriter','编辑部头版','编排'],['fade','极简展讯','编排'],['slideleft','双色对开','编排'],['slideright','竖排书脊','编排'],['drop','拼贴便笺','拼贴'],['bounce','包豪斯节拍','几何'],
 ['pop','花形字章','几何'],['flip','折页展览','空间'],['rotate','旋转十字','几何'],['stretch','拉伸建筑','字阵'],['squeeze','沙漏字场','字阵'],['tracking','棋盘字块','几何'],
 ['skew','斜切宣言','拼贴'],['blur','柔光印刷','实验'],['glitch','双色套印','实验'],['scramble','编码档案','编排'],['outline','轮廓地形','实验'],['spotlight','圆窗杂志','编排'],
 ['wipe','双幕剧场','拼贴'],['shutter','百叶字雕','空间'],['split','错位断层','实验'],['spiral','螺旋字带','空间'],['swing','悬挂标签','拼贴'],['stamp','印刷工坊','实验']
 ];
 const effects=catalog.map(item=>item[0]);
 const defaults={title:'让灵感\n动起来',subtitle:'MAKE IDEAS MOVE · 豌豆 AI',effect:'wave',duration:5,size:100,ratio:'3:4',font:'sans',background:'#17181b',foreground:'#f5f5f5',accent:'#a8d96a',decoration:true};
 function normalize(value={}){const s={...defaults};for(const k of ['title','subtitle'])if(typeof value[k]==='string')s[k]=value[k].slice(0,k==='title'?120:100);for(const k of ['background','foreground','accent'])if(/^#[\da-f]{6}$/i.test(value[k]))s[k]=value[k];if(effects.includes(value.effect))s.effect=value.effect;if(['3:4','1:1','16:9','9:16'].includes(value.ratio))s.ratio=value.ratio;if(['sans','serif','mono'].includes(value.font))s.font=value.font;s.duration=[3,5,8].includes(Number(value.duration))?Number(value.duration):5;s.size=Math.max(40,Math.min(160,Number(value.size)||100));s.decoration=value.decoration!==false;return s;}
 function dimensions(ratio){return {'3:4':[900,1200],'1:1':[1080,1080],'16:9':[1280,720],'9:16':[720,1280]}[ratio]||[900,1200];}
 function draw(canvas,s,phase){const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height,t=phase*Math.PI*2;ctx.clearRect(0,0,w,h);ctx.fillStyle=s.background;ctx.fillRect(0,0,w,h);ctx.fillStyle=s.accent;
  if(['softflag','perspective','typewall'].includes(s.effect)){
   // Each poster owns its composition. Slice clipping warps the entire printed surface,
   // including its frame, instead of moving isolated glyphs up and down.
   const font=s.font==='serif'?'"SimSun",serif':s.font==='mono'?'monospace':'"Microsoft YaHei",Arial,sans-serif';
   const rows=s.title.split('\n').filter(Boolean).slice(0,4);if(!rows.length)rows.push(' ');
   const paperW=w*.78,paperH=Math.min(h*.46,w*.72),left=(w-paperW)/2,top=(h-paperH)/2;
   let fs=Math.min(w*.15*s.size/100,paperH/(rows.length*1.3));ctx.font=`900 ${fs}px ${font}`;
   fs*=Math.min(1,paperW*.88/Math.max(1,...rows.map(x=>ctx.measureText(x).width)));
   function words(x,y,width,height,color){ctx.font=`900 ${fs}px ${font}`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=color;rows.forEach((line,j)=>{ctx.save();ctx.translate(x+width/2,y+height/2+(j-(rows.length-1)/2)*fs*1.16);ctx.scale(Math.min(3,width*.88/Math.max(1,ctx.measureText(line).width)),1);ctx.fillText(line,0,0);ctx.restore();});}
   if(s.effect==='softflag'){
    const count=80,step=paperW/count;
    for(let i=0;i<count;i++){const x=left+i*step,u=i/count,dy=Math.sin(u*Math.PI*2-t)*paperH*.075,stretch=1+Math.cos(u*Math.PI*2-t)*.07;
     ctx.save();ctx.beginPath();ctx.rect(x,top-paperH*.22,step+.6,paperH*1.45);ctx.clip();ctx.translate(0,dy);ctx.translate(0,h/2);ctx.scale(1,stretch);ctx.translate(0,-h/2);
     ctx.fillStyle=s.foreground;ctx.fillRect(left,top,paperW,paperH);ctx.strokeStyle=s.accent;ctx.lineWidth=Math.max(1,w*.002);ctx.strokeRect(left+w*.012,top+w*.012,paperW-w*.024,paperH-w*.024);words(left,top,paperW,paperH,s.background);ctx.restore();}
   }else if(s.effect==='perspective'){
    // Hourglass projection of the full title surface, animated around its centre.
    for(let i=0;i<90;i++){const x=left+i*paperW/90,u=i/90,scale=.22+Math.pow(Math.abs(u-.5)*2,1.15)*.95,shift=Math.sin(t)*paperH*.06;
     ctx.save();ctx.beginPath();ctx.rect(x,0,paperW/90+.6,h);ctx.clip();ctx.translate(0,h/2+shift*(u-.5));ctx.scale(1,scale);ctx.translate(0,-h/2);words(left,top,paperW,paperH,s.foreground);ctx.restore();}
    if(s.decoration){ctx.strokeStyle=s.accent;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(w*.08,h*.25);ctx.lineTo(w*.92,h*.25);ctx.moveTo(w*.08,h*.75);ctx.lineTo(w*.92,h*.75);ctx.stroke();}
   }else{
    ctx.save();ctx.beginPath();ctx.rect(w*.06,h*.13,w*.88,h*.72);ctx.clip();ctx.translate(w/2,h/2);ctx.rotate(-.09);
    const text=rows.join('  '),unit=Math.min(w*.16,h*.1)*s.size/100;ctx.font=`900 ${unit}px ${font}`;ctx.textBaseline='middle';ctx.textAlign='left';const span=Math.max(w*.3,ctx.measureText(text).width+unit*.35);
    for(let row=-7;row<=7;row++){const shift=phase*span*(row%2?1:-1);ctx.fillStyle=row%3===0?s.accent:s.foreground;for(let col=-4;col<=4;col++)ctx.fillText(text,col*span+shift,-h/2+row*unit*1.05);}
    ctx.restore();
   }
   if(!s.preview){ctx.fillStyle=s.foreground;ctx.globalAlpha=.85;ctx.font=`600 ${Math.max(10,w*.014)}px ${font}`;ctx.textBaseline='top';ctx.textAlign='left';ctx.fillText('豌豆 / 动态设计',w*.06,h*.045);ctx.textAlign='right';ctx.fillText(s.effect==='softflag'?'01 / SOFT FORM':s.effect==='perspective'?'02 / PERSPECTIVE':'03 / TYPE RHYTHM',w*.94,h*.045);ctx.textAlign='left';ctx.fillText(s.subtitle,w*.06,h*.92,w*.88);ctx.globalAlpha=1;}return;
  }
  {
   // Poster coordinates are normalized so typography and framing share a composition.
   // No entrance/exit envelope: every frame remains a designed poster.
   ctx.save();ctx.scale(w/900,h/1200);
   const B=s.background,F=s.foreground,A=s.accent,beat=Math.sin(t),drift=Math.cos(t),scale=s.size/100;
   const lines=s.title.split('\n').filter(Boolean).slice(0,6),text=lines.join(' ')||' ',short=lines[0]||' ';
   const font=s.font==='serif'?'"SimSun",serif':s.font==='mono'?'monospace':'"Microsoft YaHei",Arial,sans-serif';
   function box(x,y,ww,hh,color){ctx.fillStyle=color;ctx.fillRect(x,y,ww,hh);}
   function label(str,x,y,size=16,color=F,align='left'){ctx.fillStyle=color;ctx.font=`500 ${size}px ${font}`;ctx.textAlign=align;ctx.textBaseline='middle';ctx.fillText(str,x,y,800);}
   function word(str,x,y,size=130,color=F,width=780,outline=false){ctx.font=`900 ${size*scale}px ${font}`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=color;ctx.strokeStyle=color;ctx.lineWidth=1.8;const fit=Math.min(1,width/Math.max(1,ctx.measureText(str).width));ctx.save();ctx.translate(x,y);ctx.scale(fit,1);if(outline)ctx.strokeText(str,0,0);else ctx.fillText(str,0,0);ctx.restore();}
   function title(x=450,y=600,size=140,color=F,width=760){const rows=lines.length?lines:[' '],step=Math.min(size*scale*1.15,600/rows.length);rows.forEach((str,j)=>word(str,x,y+(j-(rows.length-1)/2)*step,size,color,width));}
   function circle(x,y,r,color,stroke=false){ctx.beginPath();ctx.arc(x,y,Math.max(0,r),0,Math.PI*2);ctx.fillStyle=color;ctx.strokeStyle=color;ctx.lineWidth=2;if(stroke)ctx.stroke();else ctx.fill();}
   function rotated(angle,fn,x=450,y=600){ctx.save();ctx.translate(x,y);ctx.rotate(angle);fn();ctx.restore();}
   function band(y,angle,color,ink){rotated(angle,()=>{box(-550,-85,1100,170,color);word(text,0,0,106,ink,1000);},450,y);}
   function ring(radius,angle,color,sz=55){const seed=text+' · ',chars=Array.from(seed.repeat(Math.ceil(30/Math.max(1,Array.from(seed).length)))).slice(0,100);chars.forEach((ch,i)=>{const a=angle+i/Math.max(chars.length,1)*Math.PI*2;rotated(a+Math.PI/2,()=>word(ch,0,0,Math.min(sz,radius*5/Math.max(chars.length,1)),color,90),450+Math.cos(a)*radius,600+Math.sin(a)*radius);});}
   ctx.save();ctx.beginPath();ctx.rect(34,125,832,920);ctx.clip();
   switch(s.effect){
    case 'wave':for(let j=0;j<9;j++){rotated(0,()=>{ctx.transform(1,0,Math.sin(t+j*.5)*.2,1,0,0);word(text,0,0,96,j===4?A:F,780,j%3===0);},450+Math.sin(t+j*.5)*30,205+j*94);}break;
    case 'rise':for(let j=0;j<8;j++){box(75+j*35,200+j*100,750-j*65,92,j%2?A:F);word(short,450+j*5,246+j*100,66,B,690-j*65);}box(55,175+phase*790,12,40,A);break;
    case 'orbit':circle(450,600,315,A);circle(450,600,234,B);ring(280,t,F,78);ring(180,-t,F,42);circle(450,600,70,F);circle(450,600,13,B);break;
    case 'echo':for(let j=22;j>=0;j--)title(395+j*4+beat*j*1.3,510+j*6,150,j===0?F:A,690);break;
    case 'pulse':for(let j=0;j<36;j++)rotated(j*Math.PI/18+t*.08,()=>box(155+beat*18,-3,240,6,j%3?F:A));circle(450,600,230,B);title(450,600,112,F,430);break;
    case 'ticker':for(let j=0;j<5;j++)band(240+j*180,-.22+(j%2?1:-1)*beat*.025,j%2?A:F,j%2?F:B);break;
    case 'typewriter':label('THE TYPE JOURNAL',65,172,23);box(65,204,770,4,F);title(450,400,160,F,760);box(65,620,770,300,A);word(short,450+beat*25,770,200,B,730);for(let j=0;j<6;j++){box(65,956+j*10,300-j*22,2,F);box(485,956+j*10,350-j*20,2,F);}break;
    case 'fade':circle(590,430,210+beat*18,A);title(360,750,128,F,570);label('独立设计展 / OPEN STUDIO',70,230,18);box(70,270,2,230,F);break;
    case 'slideleft':box(450,125,416,920,A);for(let half=0;half<2;half++){ctx.save();ctx.beginPath();ctx.rect(half?450:34,125,416,920);ctx.clip();ctx.translate(beat*22,0);for(let j=0;j<4;j++){word(text,450,280+j*205,148,half?B:F,780);box(70,360+j*205,760,2,half?B:F);}ctx.restore();}break;
    case 'slideright':for(let j=0;j<4;j++){rotated(-Math.PI/2,()=>{box(-435,-92,870,184,j%2?A:F);word(text,beat*25*(j%2?1:-1),0,116,B,810);},150+j*200,590);}break;
    case 'drop':for(let j=0;j<3;j++)rotated((j-1)*.15+beat*.025,()=>{box(-300,-170,600,340,j%2?A:F);word(lines[j%Math.max(1,lines.length)]||short,0,0,120,B,540);label('0'+(j+1),-270,-135,18,B);},450+(j-1)*30,320+j*270);break;
    case 'bounce':circle(260,330,180,A);box(450,150,320,360,F);circle(610,330,90+beat*28,B);box(90,600,720,330,A);title(450,765,138,B,660);break;
    case 'pop':for(let j=0;j<14;j++){const a=j*Math.PI/7+t*.08;circle(450+Math.cos(a)*220,600+Math.sin(a)*220,100,A);}circle(450,600,240,A);title(450,600,125,B,520);ring(390,-t*.1,F,32);break;
    case 'flip':for(let j=0;j<4;j++)rotated((j-1.5)*.025,()=>{box(-95,-380,190,760,j%2?A:F);ctx.save();ctx.scale(.65+Math.sin(t+j)*.12,1);word(Array.from(text)[j%Array.from(text).length]||' ',0,0,235,B,180);ctx.restore();},150+j*200,600);break;
    case 'rotate':band(600,Math.PI/4+beat*.045,A,B);band(600,-Math.PI/4-beat*.045,F,B);circle(450,600,45,B);break;
    case 'stretch':for(let j=0;j<5;j++){ctx.save();ctx.translate(125+j*160,600);ctx.scale(.55,2+Math.sin(t+j*.7)*.7);word(Array.from(text)[j%Array.from(text).length]||' ',0,0,220,j%2?A:F,250);ctx.restore();}break;
    case 'squeeze':for(let j=0;j<10;j++){const k=Math.abs(j-4.5)/4.5;word(text,450,200+j*90,105,j%3?F:A,250+k*550+beat*20);}break;
    case 'tracking':for(let y=0;y<4;y++)for(let x=0;x<3;x++){const alt=(x+y)%2;box(75+x*250,160+y*210,246,206,alt?A:F);rotated(beat*.12*(alt?1:-1),()=>word(Array.from(text)[(x+y*3)%Array.from(text).length]||' ',0,0,140,B,220),198+x*250,263+y*210);}break;
    case 'skew':for(let j=0;j<6;j++){ctx.save();ctx.beginPath();ctx.rect(65,195+j*130,770,128);ctx.clip();ctx.transform(1,0,-.25,1,150,0);title(450+(j%2?beat*45:-beat*45),600,245,F,770);ctx.restore();}band(950,-.12,A,B);break;
    case 'blur':for(let j=6;j>=0;j--){ctx.globalAlpha=j?.08:1;title(450+Math.sin(t+j)*j*7,600+Math.cos(t+j)*j*6,178,j?A:F,740);}ctx.globalAlpha=1;circle(710,220,65,A,true);break;
    case 'glitch':title(450+beat*18,580,185,A,760);title(450-beat*18,620,185,F,760);for(let j=0;j<5;j++)box(65,250+j*170,770,2,A);break;
    case 'scramble':for(let j=0;j<12;j++){label(String(j+1).padStart(2,'0'),65,190+j*65,14,A);word(j%4===0?short:'01 / '+short+' / 10',480,190+j*65,j%4===0?66:28,j%4===0?F:A,680);}box(60,165+phase*790,780,2,F);break;
    case 'outline':for(let j=14;j>=0;j--)rotated(Math.sin(t)*j*.012,()=>word(text,0,j*6,150,j===0?F:A,760,j!==0),450,540-j*14);break;
    case 'spotlight':word(short,450,260,140,F,760);circle(450,670,300,A);ctx.save();ctx.beginPath();ctx.arc(450,670,290,0,Math.PI*2);ctx.clip();for(let j=0;j<7;j++)word(text,450+beat*45,430+j*85,100,B,900);ctx.restore();break;
    case 'wipe':box(60,160,780,880,F);for(let j=0;j<6;j++)word(text,450,250+j*140,110,B,720);ctx.save();ctx.beginPath();ctx.rect(60,160,390+beat*180,880);ctx.clip();box(60,160,780,880,A);for(let j=0;j<6;j++)word(text,450,250+j*140,110,B,720,true);ctx.restore();break;
    case 'shutter':for(let j=0;j<12;j++){ctx.save();ctx.beginPath();ctx.rect(65+j*65,140,64,900);ctx.clip();ctx.translate(0,Math.sin(t+j*.4)*55);title(450,600,210,j%2?F:A,760);ctx.restore();}break;
    case 'split':for(let j=0;j<8;j++){ctx.save();ctx.beginPath();ctx.rect(65,180+j*105,770,104);ctx.clip();ctx.translate(Math.sin(t+j*.8)*40,0);title(450,600,240,j%2?F:A,780);ctx.restore();}break;
    case 'spiral':for(let j=6;j>=0;j--)ring(65+j*49,t*(j%2?-.16:.16)+j*.32,j%2?F:A,18+j*6);break;
    case 'swing':for(let j=0;j<3;j++){ctx.strokeStyle=F;ctx.beginPath();ctx.moveTo(180+j*270,150);ctx.lineTo(180+j*270+beat*25,400+j*130);ctx.stroke();rotated(beat*.12,()=>{box(-115,-20,230,380,j%2?F:A);circle(0,15,9,B);rotated(Math.PI/2,()=>word(text,0,0,80,B,300),0,190);},180+j*270+beat*25,400+j*130);}break;
    case 'stamp':box(75,200,750,760,F);rotated(-.08+beat*.018,()=>{ctx.strokeStyle=A;ctx.lineWidth=12;ctx.strokeRect(-300,-220,600,440);title(0,0,155,A,540);},450,580);label('独立印刷 / ORIGINAL EDITION',110,900,19,B);break;
   }
   ctx.restore();
   if(s.decoration&&!s.preview){box(55,102,790,1,F);box(55,1090,790,1,F);label('豌豆 / 动态海报',55,66,15);label('TYPE — MOTION',845,66,15,F,'right');label(s.subtitle,55,1130,16);}
   ctx.restore();return;
  }
 }
 const api={normalize,dimensions,draw,catalog};if(typeof module==='object'&&module.exports){module.exports=api;return;}root.WandouTypeMotion=api;
 const $=id=>document.getElementById(id),canvas=$('poster'),key='wandou-type-motion-v1';let s=normalize(),phase=0,playing=!matchMedia('(prefers-reduced-motion: reduce)').matches,last=0,job=null;
 try{s=normalize(JSON.parse(localStorage.getItem(key)||'{}'));document.documentElement.dataset.theme=localStorage.getItem('ai-tools-theme')||'light';}catch{}
 function status(text){$('status').textContent=text;}
 const presetHost=$('presets');presetHost.innerHTML=catalog.map(([id,name,group],i)=>`<button type="button" data-effect="${id}" data-group="${group}" aria-pressed="false"><canvas width="180" height="240" aria-hidden="true"></canvas><span>${name}</span><small>${String(i+1).padStart(2,'0')}</small></button>`).join('');
 const filter=document.createElement('div');filter.className='motion-filter';filter.setAttribute('aria-label','筛选海报方向');filter.innerHTML=['全部','海报','字阵','空间','几何','拼贴','编排','实验'].map((g,i)=>`<button type="button" aria-pressed="${i===0}" data-group-filter="${g}">${g}</button>`).join('');presetHost.before(filter);
 filter.addEventListener('click',e=>{const button=e.target.closest('[data-group-filter]');if(!button)return;filter.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));presetHost.querySelectorAll('button').forEach(b=>b.hidden=button.dataset.groupFilter!=='全部'&&b.dataset.group!==button.dataset.groupFilter);});
 const posterPalettes={softflag:{background:'#233bea',foreground:'#fffbed',accent:'#b5bbef'},perspective:{background:'#171613',foreground:'#d9cc84',accent:'#655d3e'},typewall:{background:'#1c1733',foreground:'#bfa4ef',accent:'#eff36a'}};
 const schemes=[['#151515','#f4f0e5','#ff5c35'],['#e8e3d4','#1c3239','#ec5936'],['#273bcb','#fff6d7','#f9a6d2'],['#1e2729','#eeedda','#b8d488'],['#efc5ca','#322a55','#db4434'],['#efe838','#232323','#faf7ed'],['#682437','#ffeed5','#ef9971'],['#e3e8ec','#1e3582','#db472c'],['#1b1734','#edc8ef','#c9e973'],['#f3ead9','#282423','#d04430']];
 catalog.slice(3).forEach(([id],i)=>{const colors=schemes[i%schemes.length];posterPalettes[id]={background:colors[0],foreground:colors[1],accent:colors[2]};});
 function thumbnail(b,p){draw(b.querySelector('canvas'),{...normalize({title:'文字\n动起来',subtitle:'',effect:b.dataset.effect,decoration:false,size:120,...posterPalettes[b.dataset.effect]}),preview:true},p);}
 presetHost.querySelectorAll('button').forEach(b=>thumbnail(b,.38));
 const library=document.createElement('aside');library.className='motion-library';library.setAttribute('aria-label','海报设计库');library.innerHTML='<div class="motion-library-heading"><h2>选择海报设计</h2><span>33 款 / 横向浏览</span></div><p class="motion-note">选择即应用排版与配色，保留你的文字 · 悬停预览</p>';
 library.append(filter,presetHost);document.querySelector('.motion-workspace').append(library);
 const controls=document.querySelector('.motion-controls'),sections=[...controls.querySelectorAll('section')];
 const nav=document.createElement('nav');nav.className='motion-inspector-nav';nav.setAttribute('aria-label','编辑设置');nav.innerHTML=['文字','节奏','画面','项目'].map((name,i)=>`<button type="button" data-panel="${i}" aria-controls="motion-panel-${i}" aria-expanded="${i===0}">${name}</button>`).join('');
 sections.forEach((section,i)=>{section.id='motion-panel-'+i;section.hidden=i!==0;});controls.prepend(nav);
 nav.addEventListener('click',e=>{const button=e.target.closest('[data-panel]');if(!button||job)return;sections.forEach((section,i)=>section.hidden=i!==Number(button.dataset.panel));nav.querySelectorAll('button').forEach(b=>b.setAttribute('aria-expanded',String(b===button)));});
 document.querySelector('.motion-heading').append(document.querySelector('.motion-export'));
 let previewButton=null;const preview=e=>{const b=e.target.closest('[data-effect]');if(b)previewButton=b;};presetHost.addEventListener('pointerover',preview);presetHost.addEventListener('focusin',preview);const stopPreview=()=>{if(previewButton)thumbnail(previewButton,.38);previewButton=null;};presetHost.addEventListener('pointerleave',stopPreview);presetHost.addEventListener('focusout',stopPreview);
 function sync(){for(const k of Object.keys(defaults)){const el=$(k);if(el){if(k==='decoration')el.checked=s[k];else el.value=s[k];}}const [w,h]=dimensions(s.ratio);canvas.width=w;canvas.height=h;$('dimensions').textContent=`${w} × ${h}`;document.querySelectorAll('[data-effect]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.effect===s.effect)));document.querySelector('.motion-stage-bar span').textContent=catalog.find(item=>item[0]===s.effect)[1]+' / 实时预览';draw(canvas,s,phase);$('play').textContent=playing?'暂停':'播放';$('play').setAttribute('aria-pressed',String(playing));}
 function save(){try{localStorage.setItem(key,JSON.stringify(s));}catch{status('草稿保存失败，请导出项目备份。');}}
 document.querySelector('.motion-controls').addEventListener('input',e=>{if(job)return;const k=e.target.id;if(k in defaults){s=normalize({...s,[k]:k==='decoration'?e.target.checked:e.target.value});save();sync();}});
 $('presets').addEventListener('click',e=>{const b=e.target.closest('[data-effect]');if(!b||job)return;s.effect=b.dataset.effect;if(posterPalettes[s.effect])s=normalize({...s,...posterPalettes[s.effect]});playing=!matchMedia('(prefers-reduced-motion: reduce)').matches;phase=playing?0:.45;save();sync();});
 $('theme').onclick=()=>{const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=theme;try{localStorage.setItem('ai-tools-theme',theme);}catch{}};
 $('play').onclick=()=>{playing=!playing;sync();};$('timeline').oninput=()=>{playing=false;phase=Number($('timeline').value)/1000;sync();};
 function frame(now){const dt=last?Math.min(now-last,100)/1000:0;last=now;if(playing&&!document.hidden&&!job){phase=(phase+dt/s.duration)%1;draw(canvas,s,phase);}if(previewButton&&!document.hidden&&!job&&!matchMedia('(prefers-reduced-motion: reduce)').matches)thumbnail(previewButton,(now%3000)/3000);$('timeline').value=Math.round(phase*1000);$('time').textContent=(phase*s.duration).toFixed(1)+' 秒';requestAnimationFrame(frame);}sync();requestAnimationFrame(frame);
 function download(blob,name){if(!blob){status('导出失败，请重试。');return;}const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
 $('png').onclick=()=>canvas.toBlob(blob=>download(blob,'文字海报.png'),'image/png');
 $('saveProject').onclick=()=>download(new Blob([JSON.stringify(s,null,2)],{type:'application/json'}),'文字动态海报.json');
 $('loadProject').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{if(f.size>100000)throw Error('项目文件过大');const data=JSON.parse(await f.text());if(!data||typeof data.title!=='string')throw Error('不是有效的海报项目');s=normalize(data);phase=0;save();sync();status('项目已导入。');}catch(error){status('导入失败：'+error.message);}finally{e.target.value='';}};
 $('html').onclick=()=>{const state=JSON.stringify(s).replace(/</g,'\\u003c');const output='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>文字动态海报</title><style>body{margin:0;background:#111;display:grid;place-items:center;min-height:100vh}canvas{max-width:100%;max-height:90vh}button{position:fixed;bottom:8px;right:8px;padding:10px}</style><canvas></canvas><button>播放 / 暂停</button><script>const s='+state+';const draw='+draw.toString()+';const c=document.querySelector("canvas");[c.width,c.height]='+JSON.stringify(dimensions(s.ratio))+';let p=0,last=0,play=!matchMedia("(prefers-reduced-motion: reduce)").matches;document.querySelector("button").onclick=()=>play=!play;function frame(n){if(last&&play&&!document.hidden)p=(p+Math.min(n-last,100)/1000/s.duration)%1;last=n;draw(c,s,p);requestAnimationFrame(frame)}requestAnimationFrame(frame);<\/script>';download(new Blob([output],{type:'text/html'}),'文字动态海报.html');};
 function lock(value){document.querySelectorAll('.motion-controls input,.motion-controls select,.motion-controls textarea,.motion-controls button,.motion-library button,.motion-export button,#play,#timeline').forEach(el=>el.disabled=value);$('cancel').hidden=!value;$('cancel').disabled=false;}
 $('cancel').onclick=()=>job?.cancel();
 $('video').onclick=async()=>{if(job)return;const mime=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm','video/mp4'].find(m=>root.MediaRecorder?.isTypeSupported(m));if(!mime||!canvas.captureStream){status('当前环境不支持视频导出，请导出动态 HTML。');return;}const wasPlaying=playing;playing=false;lock(true);let stream,recorder,cancelled=false,raf,timer;const chunks=[];try{phase=0;draw(canvas,s,0);stream=canvas.captureStream(30);recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:6000000});job={cancel(){cancelled=true;if(recorder.state!=='inactive')recorder.stop();}};await new Promise((resolve,reject)=>{recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};recorder.onerror=()=>reject(Error('浏览器录制失败'));recorder.onstop=resolve;recorder.start(100);const begin=performance.now();function tick(now){const elapsed=(now-begin)/1000;phase=Math.min(elapsed/s.duration,1);draw(canvas,s,phase);status('正在导出 '+Math.round(phase*100)+'% · 请保持页面在前台');if(phase>=1){recorder.stop();return;}raf=requestAnimationFrame(tick);}raf=requestAnimationFrame(tick);timer=setTimeout(()=>{cancelled=true;if(recorder.state!=='inactive')recorder.stop();},(s.duration+8)*1000);});if(cancelled)status('导出已取消，没有保存不完整视频。');else{const blob=new Blob(chunks,{type:mime.split(';')[0]});if(!blob.size)throw Error('录制结果为空');download(blob,'文字动态海报.'+(mime.startsWith('video/mp4')?'mp4':'webm'));status('视频已导出。');}}catch(error){status('导出失败：'+error.message);}finally{cancelAnimationFrame(raf);clearTimeout(timer);if(recorder&&recorder.state!=='inactive')recorder.stop();stream?.getTracks().forEach(track=>track.stop());job=null;lock(false);playing=wasPlaying;phase=0;sync();}};
 document.addEventListener('visibilitychange',()=>{if(document.hidden)job?.cancel();});root.addEventListener('pagehide',()=>job?.cancel());
})(typeof window!=='undefined'?window:globalThis);
