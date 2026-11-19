(function (global) {
  'use strict';
  let dialog, currentPath, currentMeta, defaultSection, defaultPath, targetSection, targetPath, targetMeta, previousSection, previousPath;
  let status, chooseButton, defaultButton, migrateButton, closeButton, usageButton, clearCacheButton, usageList, usageStatus, profilePath;
  let usageBusy = false, originalPath, originalStatus, browserSessionPath, browserLegacyPath, browserSessionStatus;
  let info = null, selection = null, busy = '', revision = 0, stopProgress = null;
  const usageScope = '按需统计文件大小，不读取原图内容。原图、项目、备份和写入临时文件均不会在这里删除。';
  const shell = () => global.wandouShell;
  const supported = () => ['getProjectStorageInfo', 'chooseProjectStorageDirectory', 'requestProjectStorageMigration']
    .every(name => typeof shell()?.[name] === 'function');

  function formatBytes(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '暂时无法统计';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = value, unit = 0;
    while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
    return `${size.toFixed(unit ? (size < 10 ? 2 : 1) : 0)} ${units[unit]}`;
  }

  function notify(message, kind = '') {
    status.textContent = message;
    status.dataset.kind = kind;
  }

  function updateControls() {
    const blocked = !supported() || !info?.success || info.available === false || Boolean(info.migrationPending);
    chooseButton.disabled = Boolean(busy) || blocked;
    const normalize = value => String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    defaultButton.hidden = defaultSection.hidden;
    defaultButton.disabled = Boolean(busy) || blocked || defaultSection.hidden || info?.storageMode === 'portable'
      || normalize(info?.currentDirectory) === normalize(info?.defaultDirectory);
    migrateButton.disabled = Boolean(busy) || blocked || !selection;
    closeButton.disabled = busy === 'choosing' || busy === 'migrating' || busy === 'restarting';
    usageButton.disabled = Boolean(busy) || usageBusy || typeof shell()?.getStorageUsage !== 'function';
    clearCacheButton.disabled = Boolean(busy) || usageBusy || typeof shell()?.clearNetworkCache !== 'function';
    dialog.setAttribute('aria-busy', busy || usageBusy ? 'true' : 'false');
  }

  function clearSelection() {
    selection = null;
    targetPath.value = '';
    targetSection.hidden = true;
    targetMeta.textContent = '';
  }

  function renderInfo(value) {
    info = value;
    currentPath.value = value?.currentDirectory || '';
    currentPath.title = currentPath.value;
    const modeLabel = { portable: '随程序保存', custom: '自定义位置', legacy: '旧版保存位置' }[value?.storageMode]
      || (value?.custom ? '自定义位置' : '默认位置');
    currentMeta.textContent = value?.success
      ? `当前目录内项目数据：${formatBytes(value.sizeBytes)} · ${modeLabel}`
      : '当前项目信息暂不可用';
    // Older desktop versions report their profile as defaultDirectory. Only the
    // portable-aware contract identifies this field as a directory in the app.
    defaultSection.hidden = !value?.success || !value.defaultDirectory || !['portable', 'custom', 'legacy'].includes(value.storageMode);
    defaultPath.value = defaultSection.hidden ? '' : value.defaultDirectory;
    defaultPath.title = defaultPath.value;
    previousSection.hidden = !value?.previousDirectory;
    previousPath.value = value?.previousDirectory || '';
    previousPath.title = previousPath.value;
    profilePath.value = value?.profileDirectory || '';
    profilePath.title = profilePath.value;
    browserSessionPath.value=value?.browserSessionDirectory || '';
    browserSessionPath.title=browserSessionPath.value;
    browserLegacyPath.value=value?.browserSessionLegacyDirectory || value?.profileDirectory || '';
    browserLegacyPath.title=browserLegacyPath.value;
    browserSessionStatus.textContent=browserSessionPath.value
      ? '工作台原图、本地副本、历史记录及浏览器中的 API 设置保存在此目录；随后生成的内容继续写入这里。浏览器数据库不等于可直接双击的图片，下载时仍可自行选择位置。'
      : '当前桌面版本尚未提供独立工作台目录；请勿把空路径视为已完成迁移。';
    originalPath.value = value?.originalFiles?.originalDirectory || '';
    originalPath.title = originalPath.value;
    const originals = value?.originalFiles;
    originalStatus.textContent = !originals ? '当前桌面版本未提供标准原图状态。'
      : `${originals.running ? '后台正在逐张整理，保存和查看仍可使用。' : '支持的图片会按原始格式保存；旧件会在后台逐张整理。'}本次后台已新增 ${originals.converted || 0} 张（${formatBytes(originals.addedBytes || 0)}），保留兼容格式 ${originals.skipped || 0} 张。${originals.lastError ? ' 最近未完成原因：' + originals.lastError : ''}`;
    updateControls();
  }

  function ensureDialog() {
    if (dialog) return;
    dialog = document.createElement('dialog');
    dialog.id = 'projectStorageDialog';
    dialog.className = 'storage-settings-dialog';
    dialog.setAttribute('aria-labelledby', 'projectStorageTitle');
    dialog.setAttribute('aria-describedby', 'projectStorageScope');
    dialog.innerHTML = `
      <header class="storage-settings-head"><h2 id="projectStorageTitle">项目存储设置</h2><button type="button" id="projectStorageClose" aria-label="关闭项目存储设置">关闭</button></header>
      <section class="storage-settings-section"><label for="projectStorageCurrent">当前项目目录</label><input id="projectStorageCurrent" readonly spellcheck="false" placeholder="正在读取…"><p id="projectStorageCurrentMeta" class="storage-settings-meta"></p></section>
      <section id="projectStorageDefaultSection" class="storage-settings-section" hidden><label for="projectStorageDefault">程序内默认目录</label><input id="projectStorageDefault" readonly spellcheck="false"><p class="storage-settings-meta">项目和原图默认自动保存在程序文件夹内的“豌豆AI数据”。移动软件时，请一并保留这个数据文件夹；也可以选择独立位置。</p></section>
      <p id="projectStorageScope" class="storage-settings-scope">这里管理节点画布、原图及 AI 绘图工作台的浏览器作品。工作台历史、原图、本地副本和浏览器内的 API 设置随项目目录保存；软件主配置仍单独保留。下载图片时另行选择保存位置。</p>
      <section class="storage-settings-section"><label for="projectStorageOriginals">可直接查看的画布原图目录</label><input id="projectStorageOriginals" readonly spellcheck="false"><p id="projectStorageOriginalStatus" class="storage-settings-meta" role="status"></p><p class="storage-settings-meta">PNG、JPEG、WebP、GIF 等受支持原图保持原始字节，不会再次生成或压缩。旧 .data 和新写入的兼容副本均保留用于旧版回退，因此会额外占用约一份原图空间。空间不足、格式不支持或校验失败时继续使用兼容原件；不会删除原件，也不会更换项目引用。单张位置可在“资产 → 所有图片 → 原文件位置”查看。</p></section>
      <section class="storage-settings-section"><label for="projectStorageBrowserSession">工作台与浏览器作品目录</label><input id="projectStorageBrowserSession" readonly spellcheck="false" placeholder="当前桌面尚未提供此路径"><p id="projectStorageBrowserStatus" class="storage-settings-meta"></p></section>
      <section class="storage-settings-section"><label for="projectStorageBrowserLegacy">保留的旧浏览器存储位置</label><input id="projectStorageBrowserLegacy" readonly spellcheck="false"><p class="storage-settings-meta">旧版数据副本保留供恢复，可能仍占系统盘空间，不会自动删除。它不是新作品的实时副本；回退旧版前需先还原最新浏览器数据，不能只替换程序。</p></section>
      <section class="storage-settings-section"><label for="projectStorageProfile">软件主配置目录</label><input id="projectStorageProfile" readonly spellcheck="false" placeholder="旧版桌面未提供此路径"><p class="storage-settings-meta">主题、目录选择等主配置仍保留在此位置。独立网页版继续保存在你使用的浏览器中，不与桌面版共享；清除网站数据或更换浏览器可能使旧项目无法访问。</p></section>
      <section class="storage-settings-section" aria-labelledby="storageUsageTitle"><h3 id="storageUsageTitle">存储占用</h3><div class="storage-usage-actions"><button type="button" id="storageUsageRefresh">统计占用</button><button type="button" id="storageCacheClear">清理网络缓存…</button></div><dl id="storageUsageList" class="storage-usage-list" hidden></dl><p id="storageUsageStatus" class="storage-settings-meta" role="status">${usageScope}</p></section>
      <section id="projectStorageTargetSection" class="storage-settings-section" hidden><label for="projectStorageTarget">迁移后的项目目录</label><input id="projectStorageTarget" readonly spellcheck="false"><p id="projectStorageTargetMeta" class="storage-settings-meta"></p></section>
      <section id="projectStoragePreviousSection" class="storage-settings-section" hidden><label for="projectStoragePrevious">保留的上一目录</label><input id="projectStoragePrevious" readonly spellcheck="false"></section>
      <p class="storage-settings-retention"><strong>旧目录会保留用于回退，不会自动删除。</strong>旧副本仍占空间，迁移完成不会立即释放这部分空间。复制并校验成功后才切换；失败继续使用原目录。</p>
      <p class="storage-settings-meta">选择目标磁盘或父文件夹后，软件使用其中固定的“豌豆AI数据”目录。选择不会立即迁移，也不会自动改名覆盖已有内容。</p>
      <p id="projectStorageStatus" class="storage-settings-status" role="status" aria-live="polite"></p>
      <footer class="storage-settings-actions"><button type="button" id="projectStorageDefaultChoose" hidden>使用程序所在目录</button><button type="button" id="projectStorageChoose">选择其他位置</button><button type="button" id="projectStorageMigrate" class="storage-settings-migrate" disabled>保存并重启以迁移</button></footer>`;
    document.body.append(dialog);
    currentPath = dialog.querySelector('#projectStorageCurrent');
    currentMeta = dialog.querySelector('#projectStorageCurrentMeta');
    defaultSection = dialog.querySelector('#projectStorageDefaultSection');
    defaultPath = dialog.querySelector('#projectStorageDefault');
    targetSection = dialog.querySelector('#projectStorageTargetSection');
    targetPath = dialog.querySelector('#projectStorageTarget');
    targetMeta = dialog.querySelector('#projectStorageTargetMeta');
    previousSection = dialog.querySelector('#projectStoragePreviousSection');
    previousPath = dialog.querySelector('#projectStoragePrevious');
    status = dialog.querySelector('#projectStorageStatus');
    chooseButton = dialog.querySelector('#projectStorageChoose');
    defaultButton = dialog.querySelector('#projectStorageDefaultChoose');
    migrateButton = dialog.querySelector('#projectStorageMigrate');
    closeButton = dialog.querySelector('#projectStorageClose');
    profilePath = dialog.querySelector('#projectStorageProfile');
    browserSessionPath=dialog.querySelector('#projectStorageBrowserSession');
    browserLegacyPath=dialog.querySelector('#projectStorageBrowserLegacy');
    browserSessionStatus=dialog.querySelector('#projectStorageBrowserStatus');
    originalPath = dialog.querySelector('#projectStorageOriginals'); originalStatus = dialog.querySelector('#projectStorageOriginalStatus');
    usageButton = dialog.querySelector('#storageUsageRefresh'); clearCacheButton = dialog.querySelector('#storageCacheClear');
    usageList = dialog.querySelector('#storageUsageList'); usageStatus = dialog.querySelector('#storageUsageStatus');
    usageButton.onclick = loadUsage; clearCacheButton.onclick = clearNetworkCache;
    closeButton.onclick = () => dialog.close();
    dialog.addEventListener('cancel', event => { if (closeButton.disabled) event.preventDefault(); });
    dialog.addEventListener('close', () => {
      revision += 1;
      if (typeof stopProgress === 'function') stopProgress();
      stopProgress = null;
    });
    chooseButton.onclick = () => chooseDirectory();
    defaultButton.onclick = () => chooseDirectory(true);
    migrateButton.onclick = requestMigration;
  }

  async function open() {
    ensureDialog();
    if (dialog.open) return;
    const request = ++revision;
    info = null; busy = 'loading'; usageBusy = false; usageList.hidden = true; clearSelection(); renderInfo(null);
    usageStatus.textContent = usageScope;
    notify('正在读取当前项目存储位置…');
    dialog.showModal();
    if (!supported()) {
      busy = ''; updateControls();
      currentPath.placeholder = '仅桌面版可查看和迁移项目目录';
      notify('这是独立的网页版：项目保存在当前浏览器中，不共享桌面版项目。浏览器页面不会修改本机项目目录。请在桌面版中查看和迁移其存储位置。');
      return;
    }
    if (typeof shell().onProjectStorageProgress === 'function') {
      stopProgress = shell().onProjectStorageProgress(event => {
        if (request !== revision || !dialog.open || !event) return;
        let message = String(event.message || '正在准备迁移…');
        if (typeof event.completedBytes === 'number' && typeof event.totalBytes === 'number' && event.totalBytes > 0) message += `（${formatBytes(event.completedBytes)} / ${formatBytes(event.totalBytes)}）`;
        notify(message);
      });
    }
    try {
      const value = await shell().getProjectStorageInfo();
      if (request !== revision || !dialog.open) return;
      busy = ''; renderInfo(value);
      if (!value?.success) notify(value?.error || '无法读取项目存储信息，请稍后重新打开设置。', 'error');
      else if (value.available === false) notify(value.error || '当前项目目录不可用，请先恢复磁盘连接或访问权限。', 'error');
      else if (value.migrationPending) notify('已有迁移准备等待软件重启；完成复制校验后才会切换目录。');
      else if (value.lastMigration?.error) notify(`上次迁移未完成：${value.lastMigration.error}。当前使用上方显示的目录。`, 'error');
      else notify(value.storageMode === 'portable'
        ? '项目正在随程序保存。也可以选择独立位置；迁移前会检查任务状态并保存所有打开的画布。'
        : `${defaultSection.hidden ? '可选择其他位置。' : '可改用程序内默认目录或选择其他位置。'}开始迁移前，软件会检查任务状态并保存所有打开的画布。`);
    } catch (_error) {
      if (request !== revision || !dialog.open) return;
      busy = ''; updateControls(); notify('无法读取项目存储信息，请稍后重新打开设置。', 'error');
    }
  }

  async function loadUsage() {
    if (usageButton.disabled) return;
    const request = revision; usageBusy = true; usageList.hidden=true; updateControls(); usageStatus.textContent = '正在统计文件大小…';
    try {
      const result = await shell().getStorageUsage();
      if(request!==revision || !dialog.open)return;
      if(!result?.success)throw Error(result?.error || '暂时无法统计存储占用');
      usageList.replaceChildren();
      const details=result.originalBreakdown, keys=['standard','compatibility','metadata','recovery','other'];
      const hasDetails=details && keys.every(key=>Number.isFinite(details[key]) && details[key]>=0)
        && keys.reduce((sum,key)=>sum+details[key],0)===result.sizes.originals;
      const rows=[['画布媒体合计',result.sizes.originals,hasDetails?'以下五项已包含在合计中，不重复相加。':'含原图及兼容文件；当前桌面版本未提供分类明细。']];
      if(hasDetails)rows.push(
        ['标准原图文件',details.standard,'可直接查看的格式文件；本次未校验图片内容。',true],
        ['.data 兼容原件',details.compatibility,'新旧保存均会使用，也可能是唯一原件，需保留。',true],
        ['校验与发布记录',details.metadata,'用于校验和中断恢复，需与原件一并保留。',true],
        ['恢复保留件',details.recovery,'中断写入或修复前保留的字节，未判断是否可删除。',true],
        ['其他媒体文件',details.other,'未归入上述类别的文件，保持原样。',true]
      );
      rows.push(['项目备份',result.sizes.backups,'用于恢复历史项目，统计不会删除备份。'],['项目与索引',result.sizes.projects],
        ['导出工程素材',result.sizes.exports],['写入临时文件（保留）',result.sizes.temporary,'可能仍在使用或用于恢复，不按文件名判断可清理。'],
        ['工作台与浏览器作品',result.sizes.browserSession ?? 0],['主配置与旧浏览器兼容副本',result.sizes.profile],['可重建网络缓存',result.cacheBytes]);
      for(const [label,value,note,detail] of rows) {
        const name=document.createElement('dt'),size=document.createElement('dd');name.textContent=label;size.textContent=formatBytes(value);
        if(note){const help=document.createElement('span');help.className='storage-usage-note';help.textContent=note;name.append(help);}
        if(detail){name.className='storage-usage-detail';size.className='storage-usage-detail';}
        usageList.append(name,size);
      }
      usageList.hidden=false;
      const reasons={'entry-limit':'达到文件数量限制','time-limit':'达到扫描时间限制','redirected-path':'已跳过链接或重定向目录','unreadable-entry':'部分文件无法读取','missing-directory':'部分目录不存在','changed-during-scan':'扫描期间文件发生变化','cache-unavailable':'网络缓存大小暂不可用','location-changed':'存储位置已变化，请重新统计'};
      const reasonText=[...new Set((Array.isArray(result.partialReasons)?result.partialReasons:[]).map(code=>reasons[code]).filter(Boolean))].join('；');
      usageStatus.textContent=(result.partial?`部分统计：${reasonText || '部分文件暂不可读或扫描达到限制'}。以上仅为已统计的文件大小。`:'已完成本次统计。')
        +'按目录和文件名分类，未校验内容或项目引用；不代表可释放空间。文件大小不等于磁盘实际分配空间，写入期间数值可能变化。旧迁移目录、旧程序备份及用户手动下载不计入此表。';
    } catch(error) { if(request===revision && dialog.open)usageStatus.textContent=error.message || '占用统计失败，请稍后重试。'; }
    finally { if(request===revision){usageBusy=false;updateControls();} }
  }

  async function clearNetworkCache() {
    if(clearCacheButton.disabled)return;
    const request=revision;usageBusy=true;updateControls();usageStatus.textContent='请在系统提示中确认清理范围。';
    try {
      const result=await shell().clearNetworkCache();
      if(request!==revision || !dialog.open)return;
      usageStatus.textContent=result?.canceled?'已取消，缓存未清理。':result?.success?`网络缓存清理完成，释放 ${formatBytes(result.freedBytes)}。项目、原图和工作台数据均保留；可重新统计。`:result?.error || '清理未完成，请重试。';
      if(result?.success)usageList.hidden=true;
    }catch{if(request===revision && dialog.open)usageStatus.textContent='无法清理网络缓存，请稍后重试。';}
    finally{if(request===revision){usageBusy=false;updateControls();}}
  }

  async function chooseDirectory(useDefault = false) {
    if ((useDefault ? defaultButton : chooseButton).disabled) return;
    const request = revision;
    clearSelection(); busy = 'choosing'; updateControls();
    notify(useDefault ? '正在检查程序内默认目录；此步骤不会迁移项目。' : '请选择目标磁盘或父文件夹；此步骤不会迁移项目。');
    try {
      const result = await shell().chooseProjectStorageDirectory(useDefault ? { useDefault: true } : undefined);
      if (request !== revision || !dialog.open) return;
      busy = '';
      if (result?.canceled) notify('已取消选择，项目保存位置没有改变。');
      else if (!result?.success || !result.targetDirectory || !result.selectionToken) notify(result?.error || '未能选择目标位置，请重试。', 'error');
      else {
        selection = { targetDirectory: result.targetDirectory, selectionToken: result.selectionToken };
        targetPath.value = result.targetDirectory;
        targetPath.title = result.targetDirectory;
        targetSection.hidden = false;
        targetMeta.textContent = `所需空间：${formatBytes(result.requiredBytes)} · 目标可用空间：${formatBytes(result.availableBytes)}`;
        notify('目标已选好，尚未迁移。点击“保存并重启以迁移”后才会开始。');
      }
    } catch (_error) {
      if (request !== revision || !dialog.open) return;
      busy = ''; notify('无法选择目标位置，当前项目目录没有改变。', 'error');
    }
    updateControls();
  }

  async function requestMigration() {
    if (migrateButton.disabled || !selection) return;
    const request = revision, selected = { ...selection };
    busy = 'migrating'; updateControls();
    notify('正在检查任务并保存画布，请保持软件打开。随后重启，复制并校验项目数据。');
    try {
      // Only the native chooser result is sent; the displayed path is never an input.
      const result = await shell().requestProjectStorageMigration(selected);
      if (request !== revision || !dialog.open) return;
      if (result?.success) {
        busy = 'restarting';
        notify('迁移准备完成，正在重启。软件会显示复制进度，校验成功后使用新目录；旧目录继续保留。');
      } else {
        busy = ''; clearSelection();
        notify(result?.error || '迁移未开始，当前项目目录未切换。请处理提示后重新选择位置。', 'error');
      }
    } catch (_error) {
      if (request !== revision || !dialog.open) return;
      busy = ''; clearSelection();
      notify('暂时无法确认迁移状态，请重新打开存储设置查看。', 'error');
    }
    updateControls();
  }

  document.addEventListener('click', event => {
    if (!event.target.closest('[data-storage-settings-open]')) return;
    event.preventDefault(); open();
  });
  global.WandouStorageSettings = { open };
})(window);
