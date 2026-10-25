(function (global) {
  'use strict';
  let dialog, currentPath, currentMeta, targetSection, targetPath, targetMeta, previousSection, previousPath;
  let status, chooseButton, migrateButton, closeButton;
  let info = null, selection = null, busy = '', revision = 0, stopProgress = null;
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
    migrateButton.disabled = Boolean(busy) || blocked || !selection;
    closeButton.disabled = busy === 'choosing' || busy === 'migrating' || busy === 'restarting';
    dialog.setAttribute('aria-busy', busy ? 'true' : 'false');
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
    currentMeta.textContent = value?.success
      ? `当前目录内项目数据：${formatBytes(value.sizeBytes)} · ${value.custom ? '自定义位置' : '默认位置'}`
      : '当前项目信息暂不可用';
    previousSection.hidden = !value?.previousDirectory;
    previousPath.value = value?.previousDirectory || '';
    previousPath.title = previousPath.value;
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
      <p id="projectStorageScope" class="storage-settings-scope">迁移节点画布项目、原图等项目文件。API 密钥、软件配置和 AI 绘图工作台的浏览器存储仍保留在原位置；不会自动导出成品图片。</p>
      <section id="projectStorageTargetSection" class="storage-settings-section" hidden><label for="projectStorageTarget">迁移后的项目目录</label><input id="projectStorageTarget" readonly spellcheck="false"><p id="projectStorageTargetMeta" class="storage-settings-meta"></p></section>
      <section id="projectStoragePreviousSection" class="storage-settings-section" hidden><label for="projectStoragePrevious">保留的上一目录</label><input id="projectStoragePrevious" readonly spellcheck="false"></section>
      <p class="storage-settings-retention"><strong>旧目录会保留用于回退，不会自动删除。</strong>旧 C 盘副本仍占空间，迁移完成不会立即释放这部分空间。复制并校验成功后才切换；失败继续使用原目录。</p>
      <p class="storage-settings-meta">选择目标磁盘或父文件夹后，软件使用其中固定的“豌豆AI数据”目录。选择不会立即迁移，也不会自动改名覆盖已有内容。</p>
      <p id="projectStorageStatus" class="storage-settings-status" role="status" aria-live="polite"></p>
      <footer class="storage-settings-actions"><button type="button" id="projectStorageChoose">选择新位置</button><button type="button" id="projectStorageMigrate" class="storage-settings-migrate" disabled>保存并重启以迁移</button></footer>`;
    document.body.append(dialog);
    currentPath = dialog.querySelector('#projectStorageCurrent');
    currentMeta = dialog.querySelector('#projectStorageCurrentMeta');
    targetSection = dialog.querySelector('#projectStorageTargetSection');
    targetPath = dialog.querySelector('#projectStorageTarget');
    targetMeta = dialog.querySelector('#projectStorageTargetMeta');
    previousSection = dialog.querySelector('#projectStoragePreviousSection');
    previousPath = dialog.querySelector('#projectStoragePrevious');
    status = dialog.querySelector('#projectStorageStatus');
    chooseButton = dialog.querySelector('#projectStorageChoose');
    migrateButton = dialog.querySelector('#projectStorageMigrate');
    closeButton = dialog.querySelector('#projectStorageClose');
    closeButton.onclick = () => dialog.close();
    dialog.addEventListener('cancel', event => { if (closeButton.disabled) event.preventDefault(); });
    dialog.addEventListener('close', () => {
      revision += 1;
      if (typeof stopProgress === 'function') stopProgress();
      stopProgress = null;
    });
    chooseButton.onclick = chooseDirectory;
    migrateButton.onclick = requestMigration;
  }

  async function open() {
    ensureDialog();
    if (dialog.open) return;
    const request = ++revision;
    info = null; busy = 'loading'; clearSelection(); renderInfo(null);
    notify('正在读取当前项目存储位置…');
    dialog.showModal();
    if (!supported()) {
      busy = ''; updateControls();
      currentPath.placeholder = '仅桌面版可查看和迁移项目目录';
      notify('请在豌豆 AI 桌面版中打开存储设置。浏览器页面不会修改本机项目目录。');
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
      else notify('可选择其他磁盘。开始迁移前，软件会检查任务状态并保存所有打开的画布。');
    } catch (_error) {
      if (request !== revision || !dialog.open) return;
      busy = ''; updateControls(); notify('无法读取项目存储信息，请稍后重新打开设置。', 'error');
    }
  }

  async function chooseDirectory() {
    if (chooseButton.disabled) return;
    const request = revision;
    clearSelection(); busy = 'choosing'; updateControls();
    notify('请选择目标磁盘或父文件夹；此步骤不会迁移项目。');
    try {
      const result = await shell().chooseProjectStorageDirectory();
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
