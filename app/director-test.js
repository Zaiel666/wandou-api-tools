/* Test-canvas extension. 3D editing is local; AI requests remain explicit actions
   on the existing image/video nodes, with no guessed video-reference API. */
(() => {
  const C = window.WandouDirectorCore;
  let vendorPromise, activeEditor = null;
  let pickerSerial = 0;
  function installPickers(dialog) {
    let opened = null;
    function close(focus = false) {
      if (!opened) return;
      const current = opened; opened = null; current.list.hidden = true;
      current.trigger.setAttribute('aria-expanded', 'false');
      if (focus) current.trigger.focus();
    }
    dialog.querySelectorAll('select[data-setting]').forEach(select => {
      const field = document.createElement('div'); field.className = 'director-picker';
      const trigger = document.createElement('button'); trigger.type = 'button';
      trigger.className = 'director-picker-trigger'; trigger.setAttribute('role','combobox');
      trigger.setAttribute('aria-haspopup','listbox'); trigger.setAttribute('aria-expanded','false');
      trigger.setAttribute('aria-label', select.parentElement.firstChild.textContent.trim());
      const list = document.createElement('div'); list.className = 'director-picker-menu'; list.hidden = true;
      list.id = 'director-picker-' + (++pickerSerial); list.setAttribute('role','listbox');
      list.setAttribute('aria-label',trigger.getAttribute('aria-label'));trigger.setAttribute('aria-controls',list.id);
      const options = Array.from(select.options);
      const buttons = options.map(option => {
        const button = document.createElement('button'); button.type='button';button.setAttribute('role','option');
        button.dataset.value=option.value; button.textContent=option.textContent; button.tabIndex=-1;
        button.onclick = event => {event.preventDefault();event.stopPropagation();if(trigger.disabled)return;select.value=option.value;select.onchange?.();sync();close(true);};
        list.append(button);return button;
      });
      function sync() {
        const option=options.find(item=>item.value===select.value)||options[0];
        trigger.textContent=option.textContent+'  ▾';
        buttons.forEach(button=>button.setAttribute('aria-selected',String(button.dataset.value===select.value)));
      }
      function show() {
        if(trigger.disabled)return;close();opened={trigger,list};list.hidden=false;trigger.setAttribute('aria-expanded','true');
        field.classList.toggle('opens-up',trigger.getBoundingClientRect().bottom+170>dialog.getBoundingClientRect().bottom);
        (buttons.find(button=>button.dataset.value===select.value)||buttons[0]).focus();
      }
      trigger.onclick=event=>{event.preventDefault();event.stopPropagation();if(opened?.trigger===trigger)close();else show();};
      field.onkeydown=event=>{
        if(event.key==='Escape'&&opened?.trigger===trigger){event.preventDefault();event.stopPropagation();close(true);}
        else if(event.key==='Tab')close();
        else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
          event.preventDefault();event.stopPropagation();if(opened?.trigger!==trigger){show();return;}
          const index=buttons.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;
          buttons[next].focus();
        }
      };
      select.hidden=true;select.tabIndex=-1;select.after(field);field.append(trigger,list);sync();
    });
    dialog.addEventListener('pointerdown',event=>{if(!event.target.closest('.director-picker'))close();});
    return () => close();
  }
  function loadVendor() {
    if (window.WandouDirectorVendor) return Promise.resolve(window.WandouDirectorVendor);
    if (!vendorPromise) vendorPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = './vendor/director-three.js';
      script.onload = () => resolve(window.WandouDirectorVendor);
      script.onerror = () => {vendorPromise = null; script.remove(); reject(new Error('本地 3D 库加载失败，请检查 vendor/director-three.js。'));};
      document.head.append(script);
    });
    return vendorPromise;
  }
  function renderBody(node) {
    const body = document.createElement('div');
    body.className = 'director-card';
    if (node.mediaUrl) {
      const img = document.createElement('img'); img.className = 'director-cover'; img.src = node.mediaUrl; img.alt = '已保存的导演台视角'; body.append(img);
    } else {
      const empty = document.createElement('div'); empty.className = 'director-empty';
      empty.innerHTML = '<strong>3D 导演台</strong><span>模型 · 镜头 · 预演 · 静帧</span>'; body.append(empty);
    }
    const note = document.createElement('p');
    const data = C.normalize(node.director);
    note.textContent = `${node.directorModelName || '内置汽车场景'} · ${data.ratio} · ${data.duration} 秒`;
    const button = document.createElement('button'); button.type = 'button'; button.textContent = '打开导演台';
    button.addEventListener('click', () => open(node).catch(() => showToast('导演台打开失败，请刷新测试页面后重试。', 'error')));
    const hint = document.createElement('p'); hint.textContent = '本地预演无需 API。静帧可接 AI 绘图；视频可导出或转首尾帧工作流。';
    body.append(note, button, hint); return body;
  }
  function outputNode(source, type, extra, offset = 0) {
    const row = links.filter(item => item.from === source.id).length;
    return createNode(type, source.x + (source.frameWidth || 420) + 100, source.y + offset + row * 780, {...extra, _deferRender: true});
  }
  function link(a, b) {links.push({from: a.id, to: b.id});}
  function addImageWorkflow(source, url, size) {
    pushHistory();
    const image = outputNode(source, 'image', {mediaUrl:url, mediaType:'image', width:size[0], height:size[1], frameWidth:360,
      frameHeight:360 * size[1] / size[0], autoFitReference:true,
      references:[{url, mediaType:'image', width:size[0], height:size[1], name:'导演台静帧'}]});
    const generator = createNode('generator', image.x + 450, image.y, {_deferRender:true, ratio:source.director?.ratio || '16:9',
      prompt:'以连接的 3D 静帧为构图依据，保留镜头角度、主体位置、形状与透视关系，渲染为真实电影画面。请在此补充材质、环境和光照要求。'});
    link(source, image); link(image, generator); render(); scheduleCanvasSave(); return generator;
  }
  async function open(node) {
    if (activeEditor) {activeEditor.focus(); return;}
    const dialog = document.createElement('dialog'); dialog.className = 'director-dialog';
    dialog.setAttribute('aria-label', '3D 导演台'); activeEditor = dialog;
    dialog.innerHTML = `<header><div><h2>3D 导演台 <small>本地预演 / 测试版</small></h2><small>01 布景 → 02 记录镜头 → 03 导出或接 AI 工作流</small></div><button data-close aria-label="关闭导演台">关闭</button></header>
      <div class="director-layout"><section class="director-main">
        <div class="director-stage" data-stage></div>
        <div class="director-tools"><button data-angle="front">正面</button><button data-angle="side">侧面</button><button data-angle="top">俯视</button><button data-angle="perspective">三分之四</button><button data-action="fit">居中模型</button></div>
        <p class="director-note">拖动旋转视角，右键拖动平移，滚轮推拉。也可用方向键旋转，＋/－推拉。模型不上传到服务器。</p>
        <div class="director-tools"><button data-action="start">记录起点</button><button data-action="end">记录终点</button><button data-action="play">播放预演</button><button data-action="stop">停止</button></div>
        <div class="director-timeline"><span>时间轴</span><input data-timeline aria-label="预演时间轴" type="range" min="0" max="1000" value="0"><output data-time>0.0 s</output></div>
        <p class="director-status" data-status role="status" aria-live="polite">正在加载本地 3D 引擎…</p>
        <div class="director-tools"><button data-action="still">导出 PNG 静帧</button><button data-action="image" class="director-primary">静帧 → AI 绘图</button><button data-action="record">生成预演节点</button><button data-action="frames">首尾帧 → AI 视频</button></div>
        <p class="director-note">预演导出为浏览器支持的视频格式（优先 WebM）；首尾帧生成不等同于跟随预演视频的运镜。AI 节点需手动点击生成，可能产生接口费用。</p>
      </section><aside>
        <label>导入模型（GLB / OBJ / FBX / Blender）<input data-model type="file" accept=".glb,.obj,.fbx,.blend"></label>
        <p class="director-note" data-model-name>内置汽车场景。GLB / FBX 请使用内嵌贴图；OBJ 以灰模显示。暂不支持压缩 GLB、外置贴图和骨骼动画播放。</p>
        <details data-blender-help><summary>Blender（.blend）导入方法</summary><p class="director-note">浏览器不能直接打开 Blender 工程。双击项目 tools/director-blender 下的 convert-blend.cmd，选择 .blend，保存为 GLB，再在上方导入。转换在本机 Blender 中完成，不上传文件、不修改原工程。也可在 Blender 中手动导出 glTF 2.0（GLB）。程序化材质可能需要先烘焙。</p></details>
        <div class="director-fields"><label>画面比例<select data-setting="ratio"><option value="16:9">16:9</option><option value="9:16">9:16</option><option value="1:1">1:1</option></select></label><label>时长（秒）<input data-setting="duration" type="number" min="2" max="15" step="1"></label></div>
        <div class="director-fields"><label>主体左右 X<input data-pose="x" type="number" min="-20" max="20" step=".1"></label><label>主体前后 Z<input data-pose="z" type="number" min="-20" max="20" step=".1"></label></div>
        <label>主体朝向（°）<input data-pose="yaw" type="range" min="-180" max="180" step="1"></label>
        <label>镜头视角（°）<input data-pose="fov" type="range" min="20" max="90" step="1"></label>
        <label>运动曲线<select data-setting="easing"><option value="smooth">平滑起停</option><option value="linear">匀速</option></select></label>
        <div class="director-fields"><label>场景背景<input data-setting="background" type="color"></label><label>主光强度<input data-setting="light" type="number" min=".3" max="5" step=".1"></label></div>
        <label>辅助网格<select data-setting="grid"><option value="true">显示（导出不含网格）</option><option value="false">隐藏</option></select></label>
        <p class="director-note">当前接口未验证“参考视频成片”，不会把预演视频偷偷改成图片提交。可先用静帧渲染、首尾帧视频，或导出预演到支持的视频平台。</p>
      </aside></div><footer><p>关闭会保存模型、镜头起止点和当前视角；不触发 AI 生成。</p><button data-close>保存并关闭</button></footer>`;
    const previousFocus = document.activeElement;
    document.body.append(dialog); dialog.showModal();
    const $ = s => dialog.querySelector(s);
    const status = text => {$('[data-status]').textContent = text;};
    const nativeBlend = typeof window.wandouDirectorNative?.convertBlend === 'function';
    if(nativeBlend){
      $('[data-blender-help] summary').textContent='Blender 自动转换已就绪';
      $('[data-blender-help] p').textContent='直接选择 .blend（≤64 MB），本机 Blender 将在后台转换并自动导入。无需另存或寻找工具。转换结果须 ≤20 MB；不修改原工程、不上传模型。复杂程序化材质仍可能需要烘焙。转换中可点击“停止”或关闭导演台取消。';
    }else{
      $('[data-blender-help] p').textContent='当前是浏览器页，不能启动本机 Blender。使用项目根目录的 start-director-test.cmd 打开同款独立桌面测试画布，即可选中 .blend 后自动转换导入。其项目数据与浏览器、正式版分别保存，已有项目请先导出再导入。也可继续使用 tools/director-blender/convert-blend.cmd 手动转换。';
    }
    let data = C.normalize(node.director), alive = true, loaded = false, loading = false;
    let renderer, controls, scene, camera, subject, grid, sun, subjectRoot, recording = null, stopAnimation = null, closePickers = () => {}, conversionId = null;
    let selectedModelData = node.sourceUrl || '', selectedModelName = node.directorModelName || '', selectedModelKind = node.directorModelKind || '';
    let modelValid = !selectedModelData;
    let lastCurrent = data.current;
    function stop() {stopAnimation?.(); stopAnimation = null; if (recording) recording.cancel();if(conversionId)window.wandouDirectorNative?.cancel?.(conversionId);}
    function cleanupObject(object) {object?.traverse(child => {child.geometry?.dispose(); const mats = Array.isArray(child.material) ? child.material : [child.material]; mats.forEach(mat => {if (!mat) return; Object.values(mat).forEach(value => {if (value?.isTexture) value.dispose();}); mat.dispose();});});}
    function commit() {
      if (!loaded || !modelValid || !nodes.includes(node)) return;
      pushHistory(); node.director = C.normalize({...data, current:lastCurrent});
      node.sourceUrl = selectedModelData; node.directorModelName = selectedModelName; node.directorModelKind = selectedModelKind;
      node.mediaUrl = capture(); node.width = C.dimensions(data.ratio)[0]; node.height = C.dimensions(data.ratio)[1];
      scheduleCanvasSave();
    }
    function close() { if (!alive) return; stop(); commit(); alive = false; controls?.dispose(); cleanupObject(scene); renderer?.dispose(); renderer?.forceContextLoss(); dialog.close(); dialog.remove(); activeEditor = null; render(); previousFocus?.focus?.(); }
    dialog.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
    dialog.addEventListener('cancel', event => {event.preventDefault(); close();});
    const visibility = () => {if (document.hidden) stop();};
    document.addEventListener('visibilitychange', visibility);
    dialog.addEventListener('close', () => document.removeEventListener('visibilitychange', visibility), {once:true});
    for (const type of ['pointerdown','wheel','keydown']) dialog.addEventListener(type, e => e.stopPropagation());
    function busy(value) {
      if(value)closePickers();
      dialog.querySelectorAll('input,select,button:not([data-close])').forEach(el => {el.disabled = value;});
      $('[data-action="stop"]').disabled = false;
      if (controls) controls.enabled = !value;
    }
    busy(true);
    function applyPose(p) {
      camera.position.fromArray(p.position); controls.target.fromArray(p.target);
      camera.fov = p.fov; camera.updateProjectionMatrix();
      subjectRoot.position.fromArray(p.subject); subjectRoot.rotation.y = p.yaw * Math.PI / 180;
      camera.lookAt(controls.target); controls.update();
    }
    function readPose() {return C.pose({position:camera.position.toArray(),target:controls.target.toArray(),subject:subjectRoot.position.toArray(),yaw:subjectRoot.rotation.y * 180/Math.PI,fov:camera.fov});}
    function draw() {if (!renderer || !alive) return; renderer.render(scene, camera);}
    function capture() {const was = grid.visible; grid.visible = false; draw(); const url = renderer.domElement.toDataURL('image/png'); grid.visible = was; draw(); return url;}
    function syncPoseFields() {
      const p = readPose(); lastCurrent = p;
      for (const [key,value] of Object.entries({x:p.subject[0],z:p.subject[2],yaw:p.yaw,fov:p.fov})) $(`[data-pose="${key}"]`).value = value;
    }
    function timeline(t) {
      if (!data.start || !data.end) throw new Error('请先分别记录镜头起点和终点。');
      applyPose(C.interpolate(data.start, data.end, t, data.easing)); draw();
      $('[data-timeline]').value = t * 1000; $('[data-time]').textContent = (t * data.duration).toFixed(1) + ' s';
    }
    function animate(done) {
      let frame, cancelled = false; const begin = performance.now();
      const step = now => {if (cancelled || !alive) return; const t = Math.min(1, (now-begin)/(data.duration*1000)); timeline(t); if (t < 1) frame = requestAnimationFrame(step); else {stopAnimation=null; syncPoseFields(); done?.();}};
      frame = requestAnimationFrame(step);
      stopAnimation = () => {cancelled=true;cancelAnimationFrame(frame);busy(false);if(loaded)syncPoseFields();};
    }
    try {
      const {THREE:T, OrbitControls, GLTFLoader, OBJLoader, FBXLoader} = await loadVendor();
      if (!alive) return;
      renderer = new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true}); renderer.setPixelRatio(1);
      renderer.outputColorSpace = T.SRGBColorSpace; renderer.shadowMap.enabled = true;
      scene = new T.Scene(); scene.background = new T.Color(data.background);
      camera = new T.PerspectiveCamera(45,16/9,.05,500);
      const size = C.dimensions(data.ratio); renderer.setSize(...size, false); camera.aspect=size[0]/size[1];camera.updateProjectionMatrix();
      $('[data-stage]').append(renderer.domElement); renderer.domElement.tabIndex=0;renderer.domElement.setAttribute('aria-label','3D 视口，方向键旋转，加减键推拉');
      controls = new OrbitControls(camera,renderer.domElement);controls.minDistance=.5;controls.maxDistance=80;controls.enableDamping=false;
      scene.add(new T.HemisphereLight(0xffffff,0x666666,2)); sun=new T.DirectionalLight(0xffffff,data.light);sun.position.set(4,8,5);sun.castShadow=true;scene.add(sun);
      const floor=new T.Mesh(new T.PlaneGeometry(200,200),new T.MeshStandardMaterial({color:0xbcbcbc,roughness:.9}));floor.rotation.x=-Math.PI/2;floor.position.y=-.015;floor.receiveShadow=true;scene.add(floor);
      grid=new T.GridHelper(40,40,0x777777,0xaaaaaa);grid.visible=data.grid;scene.add(grid);
      subjectRoot = new T.Group(); scene.add(subjectRoot);
      const car = new T.Group();
      const box=(w,h,d,x,y,z,color)=>{const mesh=new T.Mesh(new T.BoxGeometry(w,h,d),new T.MeshStandardMaterial({color,roughness:.55}));mesh.position.set(x,y,z);mesh.castShadow=true;car.add(mesh);};
      box(1.7,.5,3.2,0,.55,0,0x637487);box(1.4,.65,1.6,0,1.1,-.2,0x405363);
      for(const x of [-.86,.86])for(const z of [-1,1]){const wheel=new T.Mesh(new T.CylinderGeometry(.36,.36,.24,24),new T.MeshStandardMaterial({color:0x252525}));wheel.rotation.z=Math.PI/2;wheel.position.set(x,.36,z);car.add(wheel);}
      subject=car;subjectRoot.add(car);
      async function replaceModel(url, kind) {
        let object;
        const binary = Uint8Array.from(atob(url.split(',')[1]),c=>c.charCodeAt(0));
        if(kind==='obj') object = new OBJLoader().parse(new TextDecoder().decode(binary));
        else if(kind==='fbx') {
          const manager=new T.LoadingManager();
          manager.setURLModifier(resource=>{if(!/^(data:|blob:)/i.test(resource))throw new Error('FBX 包含外置贴图，请嵌入贴图或从 Blender 导出 GLB。');return resource;});
          object=new FBXLoader(manager).parse(binary.buffer,'');
        }
        else {
          const manager=new T.LoadingManager();
          manager.setURLModifier(resource=>{if (!/^(data:|blob:)/i.test(resource)) throw new Error('模型包含外部资源，请导出为贴图内嵌的 GLB。');return resource;});
          const gltf=await new GLTFLoader(manager).parseAsync(binary.buffer,''); object=gltf.scene;
        }
        if(!alive){cleanupObject(object);return;}
        const bounds=new T.Box3().setFromObject(object), size=bounds.getSize(new T.Vector3()), extent=Math.max(size.x,size.y,size.z);
        if(!Number.isFinite(extent)||extent<=0){cleanupObject(object);throw new Error('模型没有可显示的几何体。');}
        object.scale.multiplyScalar(3/extent);object.updateMatrixWorld(true);
        const fitted=new T.Box3().setFromObject(object), center=fitted.getCenter(new T.Vector3());object.position.sub(new T.Vector3(center.x,fitted.min.y,center.z));
        object.traverse(child=>{if(child.isMesh){child.castShadow=true;child.receiveShadow=true;}});
        subjectRoot.remove(subject);cleanupObject(subject);subject=object;subjectRoot.add(subject);draw();
      }
      if(selectedModelData) {try{await replaceModel(selectedModelData,selectedModelKind);modelValid=true;}catch(_error){modelValid=false;}}
      if(!alive)return;
      applyPose(data.current);loaded=true;syncPoseFields();draw();busy(false);
      controls.addEventListener('change',()=>{draw();if(!stopAnimation&&!recording)syncPoseFields();});
      for(const field of dialog.querySelectorAll('[data-setting]'))field.value=String(data[field.dataset.setting]);
      if(selectedModelName)$('[data-model-name]').textContent=selectedModelName;
      status(modelValid ? '已就绪：调整镜头后记录起点，再换一个角度记录终点。' : '保存的模型无法读取；临时显示内置场景。原模型数据保留，请重新导入后再导出。');
      if(data.start)$('[data-action="start"]').textContent='✓ 起点已记录';
      if(data.end)$('[data-action="end"]').textContent='✓ 终点已记录';
      renderer.domElement.addEventListener('webglcontextlost', e=>{e.preventDefault();stop();loaded=false;busy(true);status('图形上下文已丢失，请关闭后重新打开导演台。');});
      renderer.domElement.addEventListener('keydown',e=>{
        if(recording||stopAnimation||loading)return;
        const delta={ArrowLeft:-.12,ArrowRight:.12}[e.key];
        if(delta!==undefined){const offset=camera.position.clone().sub(controls.target);offset.applyAxisAngle(new T.Vector3(0,1,0),delta);camera.position.copy(controls.target).add(offset);}
        else if(e.key==='ArrowUp'||e.key==='ArrowDown')camera.position.y+=e.key==='ArrowUp'?.3:-.3;
        else if(['+','=','-'].includes(e.key))camera.position.sub(controls.target).multiplyScalar(e.key==='-'?1.1:.9).add(controls.target);
        else return;
        e.preventDefault();controls.update();syncPoseFields();draw();
      });
      dialog.querySelectorAll('[data-angle]').forEach(button=>button.onclick=()=>{const positions={front:[0,1.5,7],side:[7,1.5,0],top:[0,8,.01],perspective:[5,3,6]};camera.position.fromArray(positions[button.dataset.angle]);controls.target.set(0,.7,0);controls.update();syncPoseFields();draw();});
      dialog.querySelectorAll('[data-pose]').forEach(input=>input.oninput=()=>{const p=readPose(),v=Number(input.value);if(input.dataset.pose==='x')p.subject[0]=v;else if(input.dataset.pose==='z')p.subject[2]=v;else p[input.dataset.pose]=v;applyPose(C.pose(p));syncPoseFields();draw();});
      dialog.querySelectorAll('[data-setting]').forEach(input=>input.onchange=()=>{
        const k=input.dataset.setting;data=C.normalize({...data,[k]:k==='grid'?input.value==='true':input.value});input.value=String(data[k]);
        const [w,h]=C.dimensions(data.ratio);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();scene.background.set(data.background);sun.intensity=data.light;grid.visible=data.grid;draw();
      });
      closePickers=installPickers(dialog);
      $('[data-model]').onchange=async event=>{
        const file=event.target.files[0];if(!file)return;
        try{
          let kind,url;
          if(/\.blend$/i.test(file.name)&&nativeBlend){
            if(file.size<=0||file.size>64*1024*1024)throw new Error('Blender 工程须大于 0 且不超过 64 MB。');
            loading=true;busy(true);conversionId=`blend-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
            status('正在用本机 Blender 后台转换，完成后会自动导入…');
            const result=await window.wandouDirectorNative.convertBlend(file,conversionId);
            conversionId=null;if(!alive)return;
            if(!result?.success)throw new Error(result?.error||'Blender 转换失败。');
            if(!/^data:model\/gltf-binary;base64,/.test(result.dataUrl||''))throw new Error('转换结果无效。');
            kind='glb';url=result.dataUrl;
          }else{
            kind=C.validateModel(file.name,file.size);loading=true;busy(true);status('正在解析模型…');url=await readFileAsDataUrl(file);
          }
          if(!alive)return;await replaceModel(url,kind);if(!alive)return;
          selectedModelData=url;selectedModelName=file.name;selectedModelKind=kind;modelValid=true;
          $('[data-model-name]').textContent=file.name+(/\.blend$/i.test(file.name)?' · 已自动转为 GLB':'');
          status('模型已导入。原镜头保留，可按“居中模型”重新构图。');
        }
        catch(error){
          if(error.message==='BLEND_CONVERSION_REQUIRED'){$('[data-blender-help]').open=true;status('浏览器不能启动本机 Blender。请用 start-director-test.cmd 打开独立测试画布，即可自动转换；也可使用本地转换工具。原场景保留。');}
          else if(/\.blend$/i.test(file.name))status((error.message||'Blender 转换失败。')+' 原场景保留。');
          else status('导入失败：请选择 ≤20 MB、未压缩且贴图内嵌的 GLB / FBX，或 OBJ 灰模。原场景未被替换。');
        }
        finally{conversionId=null;loading=false;if(alive)busy(false);event.target.value='';}
      };
      $('[data-timeline]').oninput=()=>{try{timeline(Number($('[data-timeline]').value)/1000);syncPoseFields();}catch(error){status(error.message);}};
      $('[data-action="stop"]').onclick=()=>{if(conversionId){stop();status('正在取消转换…');return;}if(loading)return;stop();status('已停止。');};
      dialog.querySelectorAll('[data-action]:not([data-action="stop"])').forEach(button=>button.onclick=async()=>{
        if(!loaded||loading)return;
        try {
          const action=button.dataset.action;
          if(!modelValid)throw new Error('请先重新导入有效模型，原模型数据仍被保留。');
          if(action==='fit'){applyPose({...readPose(),position:[5,3,6],target:[0,.7,0]});syncPoseFields();draw();return;}
          if(action==='start'||action==='end'){data[action]=readPose();button.textContent=action==='start'?'✓ 起点已记录':'✓ 终点已记录';status('已记录'+(action==='start'?'起点':'终点')+'（镜头位置、主体位置和朝向）。');return;}
          if(action==='still'){await triggerDownload(capture(),`导演台静帧-${Date.now()}.png`,'image/png');status('静帧已交给下载功能。');return;}
          if(action==='image'){commit();addImageWorkflow(node,capture(),C.dimensions(data.ratio));status('已创建：导演台 → 静帧参考图 → AI 文字绘图。关闭导演台即可查看；尚未调用 AI。');return;}
          if(!data.start||!data.end)throw new Error('请先分别记录镜头起点和终点。');
          if(action==='play'){busy(true);timeline(0);animate(()=>{busy(false);status('预演播放完成。');});return;}
          if(action==='frames'){
            const current=readPose();timeline(0);const first=capture();timeline(1);const last=capture();applyPose(current);syncPoseFields();draw();commit();pushHistory();
            const [w,h]=C.dimensions(data.ratio);
            const image=outputNode(node,'image',{mediaUrl:first,mediaType:'image',references:[first,last].map((url,i)=>({url,mediaType:'image',width:w,height:h,name:i?'尾帧':'首帧'}))});
            const video=createNode('video',image.x+450,image.y,{_deferRender:true,videoMode:'firstLast',ratio:data.ratio==='9:16'?'9:16 竖屏':'16:9 横屏',prompt:'以连接的第一张图片为首帧、第二张为尾帧，保持主体外观一致，平滑过渡镜头。此模式仅参考首尾帧，不保证严格跟随 3D 运镜。'});
            link(node,image);link(image,video);render();scheduleCanvasSave();status('已创建首尾帧 → AI 视频工作流，尚未生成。视频时长使用现有模型默认值；方形参考转为横屏。');return;
          }
          if(action==='record'){
            const mime=C.recordingFormat(window.MediaRecorder);
            if(!mime||!renderer.domElement.captureStream)throw new Error('此浏览器不支持视频录制，可播放预演或导出静帧/首尾帧。');
            busy(true);timeline(0);grid.visible=false;draw();const stream=renderer.domElement.captureStream(30);let recorder;
            try{recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:4000000});}catch(error){stream.getTracks().forEach(t=>t.stop());throw error;}
            let cancelled=false,total=0;const chunks=[];
            recording={cancel:()=>{cancelled=true;if(recorder.state!=='inactive')recorder.stop();}};
            const blob=await new Promise((resolve,reject)=>{
              recorder.ondataavailable=e=>{if(e.data.size){total+=e.data.size;chunks.push(e.data);if(total>32*1024*1024)recording?.cancel();}};
              recorder.onerror=()=>{cancelled=true;reject(new Error('浏览器录制失败，请重试或导出静帧。'));};
              recorder.onstop=()=>resolve(cancelled?null:new Blob(chunks,{type:mime.split(';')[0]}));
              recorder.start(200);animate(()=>{if(recorder.state!=='inactive')recorder.stop();});
            }).finally(()=>{stream.getTracks().forEach(t=>t.stop());recording=null;stopAnimation?.();stopAnimation=null;if(alive){grid.visible=data.grid;draw();busy(false);}});
            if(!alive)return;if(!blob){status('预演导出已取消，没有创建结果。');return;}if(!blob.size)throw new Error('录制结果为空，请重试。');
            const url=await readFileAsDataUrl(blob);if(!alive)return;commit();pushHistory();
            const [w,h]=C.dimensions(data.ratio),result=outputNode(node,'result',{title:'预演动画（本地）',mediaType:'video',mediaUrl:url,width:w,height:h,videoMime:blob.type,apiSeconds:data.duration,directorPreview:true});
            link(node,result);render();scheduleCanvasSave();status('预演节点已创建，可播放或下载；这不是 AI 成片。');
          }
        }catch(error){status(error.message||'操作失败，请重试。');busy(false);}
      });
    } catch(_error) {status('3D 引擎不可用：请使用支持 WebGL 2 的浏览器并开启硬件加速。可关闭后重试。');}
  }
  function boot() {
    if(document.body.dataset.testReady!=='true'){setTimeout(boot,100);return;}
    const downloadOriginal = downloadNodeMedia;
    downloadNodeMedia = async function(node) {
      if (!node.directorPreview) return downloadOriginal(node);
      try {
        const mime = node.videoMime === 'video/mp4' ? 'video/mp4' : 'video/webm';
        const extension = mime === 'video/mp4' ? 'mp4' : 'webm';
        const ok = await triggerDownload(favoriteMediaUrl(node), downloadFileName(node,extension), mime);
        if(!ok) showToast('预演下载未成功，请检查下载权限。','error');
      } catch (_error) {showToast('预演下载失败，请重试。','error');}
    };
    document.querySelectorAll('.node.director').forEach(element => element.remove());
    render();
    const container=document.querySelector('.sidebar .button-grid');if(!container)return;
    const button=document.createElement('button');button.type='button';button.className='test-motion-button';
    button.innerHTML='<img class="ui-icon" src="./assets/canvas-ui-icons/director-cube.svg" alt="" aria-hidden="true"><span>3D 导演台</span>';
    button.onclick=()=>{const node=addNodeInView('director');centerOnNode(node.id);scheduleCanvasSave();open(node).catch(()=>showToast('导演台暂时无法打开','error'));};container.append(button);
    if(window.location?.search && new URLSearchParams(window.location.search).get('open')==='director'){
      const url=new URL(window.location.href);url.searchParams.delete('open');window.history.replaceState(null,'',url.href);
      button.click();
    }
  }
  window.WandouDirector={renderBody,open,addImageWorkflow,installPickers};
  boot();
})();
