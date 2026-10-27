(function () {
  const content = document.getElementById("assetContent");
  const search = document.getElementById("assetSearch");
  const title = document.getElementById("assetTitle");
  const subtitle = document.getElementById("assetSubtitle");
  const folderSelect = document.getElementById("folderFilter");
  const sortSelect = document.getElementById("assetSort");
  const importButton = document.getElementById("importSkill");
  const openSkillDirectoryButton = document.getElementById("openSkillDirectory");
  const toast = document.getElementById("assetToast");
  const locationDialog = document.getElementById("assetLocationDialog");
  const locationName = document.getElementById("assetLocationName");
  const locationStatus = document.getElementById("assetLocationStatus");
  const locationPath = document.getElementById("assetLocationPath");
  const locationDetails = document.getElementById("assetLocationDetails");
  const locationOpenButton = document.getElementById("assetLocationOpenFolder");
  const locationDownloadButton = document.getElementById("assetLocationDownload");
  const locationDownloadStatus = document.getElementById("assetLocationDownloadStatus");
  const canvasPrefix = "aiCanvasStateV1";
  const indexedPrefix = "indexed-media:";
  let filter = "all";
  let assets = [];
  let folders = [];
  let visibleLimit = 120;
  let toastTimer = 0;
  let loadRevision = 0;
  let locationRevision = 0;
  let locationRef = "";
  let locationAsset = null;
  let imageDownloadPending = false;

  const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  }[char]));

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null");
      return value ?? fallback;
    } catch (_error) {
      return fallback;
    }
  }

  function applyTheme() {
    const value = localStorage.getItem("ai-tools-theme")
      || localStorage.getItem("wd-theme")
      || localStorage.getItem("aiCanvasProjectHubTheme")
      || "light";
    const theme = value === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    document.body.classList.toggle("dark", theme === "dark");
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("show");
    toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
  }

  function updateDownloadButtons() {
    content.querySelectorAll("[data-asset-download]").forEach((button) => {
      button.disabled = imageDownloadPending;
    });
    locationDownloadButton.disabled = imageDownloadPending || !locationAsset?.originalStored;
  }

  function showDownloadResult(asset, message) {
    if (locationDialog.open && locationAsset === asset) {
      locationDownloadStatus.textContent = message;
      locationDownloadStatus.hidden = false;
    } else {
      showToast(message);
    }
  }

  async function downloadImage(asset, button) {
    if (imageDownloadPending) return;
    if (!asset?.originalStored) return showDownloadResult(asset, "这条记录只保留了预览，无法下载原图。请回到项目检查原图是否存在。");
    imageDownloadPending = true;
    clearTimeout(toastTimer);
    toast.classList.remove("show");
    locationDownloadStatus.hidden = true;
    const originalLabel = button.textContent;
    button.textContent = "保存中…";
    updateDownloadButtons();
    try {
      const source = await resolveMedia(asset.originalStored);
      if (!source) throw new Error("未找到原图，文件可能已被移走或清理。请检查项目存储目录后重试。");
      if (!window.WandouImageExport?.save) throw new Error("图片下载组件尚未就绪，请刷新资产后重试。");
      const result = await window.WandouImageExport.save({ source, filename: asset.name || "图片" });
      if (result?.canceled) return;
      if (!result?.success) throw new Error(result?.error || "图片保存失败，请重新选择保存位置后重试。");
      showDownloadResult(asset, result.path ? `图片已保存到 ${result.path}` : "已发起图片下载。");
    } catch (error) {
      showDownloadResult(asset, error?.message || "图片保存失败，请稍后重试。");
    } finally {
      imageDownloadPending = false;
      button.textContent = originalLabel;
      updateDownloadButtons();
    }
  }

  async function showOriginalLocation(asset) {
    const revision = ++locationRevision;
    locationRef = "";
    locationAsset = asset;
    locationDownloadStatus.textContent = "";
    locationDownloadStatus.hidden = true;
    updateDownloadButtons();
    locationName.textContent = asset.name;
    locationStatus.textContent = "正在查找原图存储文件…";
    locationPath.value = "";
    locationDetails.hidden = true;
    locationOpenButton.disabled = true;
    if (!locationDialog.open) locationDialog.showModal();
    if (!window.wandouShell?.getCanvasMediaLocation) {
      locationStatus.textContent = "浏览器版无法查看电脑中的原文件位置，请在豌豆 AI 桌面版打开。";
      return;
    }
    const ref = asset.originalStored;
    if (!ref) {
      locationStatus.textContent = "这条记录只保留了预览，无法确定原图文件位置。";
      return;
    }
    // Do not send inline image bytes or treat a preview/download folder as the original.
    if (!/^(?:indexed-media:|wandou-media:\/\/)/.test(ref)) {
      locationStatus.textContent = "原图尚未保存为本机项目文件。保存项目后，可刷新资产再查看。";
      return;
    }
    try {
      const result = await window.wandouShell.getCanvasMediaLocation(ref);
      if (revision !== locationRevision || !locationDialog.open) return;
      if (!result?.success || !result.path) {
        locationStatus.textContent = result?.missing
          ? "未找到本机原图存储文件，文件可能已被移走或清理。"
          : (result?.error || "这张原图没有可查看的本机文件位置。");
        return;
      }
      locationRef = ref;
      locationPath.value = result.path;
      locationPath.title = result.path;
      locationDetails.hidden = false;
      locationStatus.textContent = result.storageFormat === "data-url"
        ? "这是由软件管理的项目原图存储文件（.data），资源管理器不能直接预览。点击“另存为图片”，选择位置后即可保存为可查看的图片；无需修改或移动这个存储文件。"
        : "这是由软件管理的项目原图存储文件。";
      locationOpenButton.disabled = !window.wandouShell?.showCanvasMediaInFolder;
    } catch (_error) {
      if (revision === locationRevision && locationDialog.open) locationStatus.textContent = "暂时无法读取原文件位置，请稍后重试。";
    }
  }

  async function resolveMedia(value) {
    if (!String(value || "").startsWith(indexedPrefix)) return value || "";
    const id = value.slice(indexedPrefix.length);
    const runtimeUrl = await window.WandouMediaUrls?.resolve(id);
    if (runtimeUrl) return runtimeUrl;
    try {
      const result = await window.wandouShell?.readCanvasMedia?.({ id });
      if (result?.success) return result.value || "";
    } catch (_error) {}
    return await new Promise((resolve) => {
      const request = indexedDB.open("ai-node-canvas-media-v1", 2);
      request.onerror = () => resolve("");
      request.onsuccess = () => {
        try {
          const get = request.result.transaction("media", "readonly").objectStore("media").get(id);
          get.onsuccess = () => resolve(get.result?.value || "");
          get.onerror = () => resolve("");
        } catch (_error) {
          resolve("");
        }
      };
    });
  }

  function projectContextForStorageKey(key, state = null) {
    const ownedFolderId = String(state?.folderId || "");
    if (ownedFolderId) {
      const folder = folders.find((item) => String(item.id) === ownedFolderId);
      const projectId = String(state?.projectId || "");
      const projects = readJson(`${canvasPrefix}:project-collection:${ownedFolderId}`, []);
      const project = Array.isArray(projects) ? projects.find((item) => String(item.id) === projectId) : null;
      return {
        folderId: ownedFolderId,
        folderName: folder?.name || state?.folderName || "未命名文件夹",
        projectId,
        projectName: project?.name || state?.projectName || ""
      };
    }
    const ordered = [...folders].sort((left, right) => String(right.id).length - String(left.id).length);
    for (const folder of ordered) {
      const base = `${canvasPrefix}:${folder.id}`;
      if (key !== base && !key.startsWith(`${base}:`)) continue;
      const projectId = key === base ? "" : key.slice(base.length + 1);
      if (/^(session-|download-seq|deleted-results)/.test(projectId)) return null;
      const projects = readJson(`${canvasPrefix}:project-collection:${folder.id}`, []);
      const project = Array.isArray(projects) ? projects.find((item) => item.id === projectId) : null;
      return {
        folderId: folder.id,
        folderName: folder.name || "未命名文件夹",
        projectId,
        projectName: project?.name || ""
      };
    }
    return { folderId: "ungrouped", folderName: "未归类", projectId: "", projectName: "" };
  }

  function collectMediaAssets(stateRecords = null) {
    const keys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key === canvasPrefix || key?.startsWith(`${canvasPrefix}:`)) keys.push(key);
    }
    keys.sort((left, right) => right.split(":").length - left.split(":").length);
    const media = [];
    const seen = new Set();
    const records = stateRecords || keys.map((key) => ({ key, state: readJson(key, null) }));
    for (const { key, state } of records) {
      if (key.includes(":project-collection:") || key.includes(":active-project-collection:")) continue;
      if (!state || !Array.isArray(state.nodes)) continue;
      const project = projectContextForStorageKey(key, state);
      if (!project) continue;
      for (const node of state.nodes) {
        if (node?.type !== "result" || !["image", "video"].includes(node.mediaType)) continue;
        const stored = node.previewUrl || node.mediaUrl || node.fullUrl || "";
        const originalStored = node.transparent
          ? node.mediaUrl || node.fullUrl || ""
          : node.fullUrl || node.mediaUrl || "";
        const fullStored = originalStored || node.previewUrl || "";
        const identity = fullStored || stored;
        if (!stored || seen.has(identity)) continue;
        seen.add(identity);
        media.push({
          type: node.mediaType,
          name: node.title || node.prompt?.slice(0, 36) || (node.mediaType === "video" ? "视频资产" : "图片资产"),
          stored,
          fullStored,
          originalStored,
          createdAt: Number(node.createdAt || state.savedAt) || 0,
          sequence: Number(String(node.id || "").replace(/\D/g, "")) || 0,
          width: node.width,
          height: node.height,
          ...project
        });
      }
    }
    return media;
  }

  function refreshFolderOptions() {
    const counts = new Map();
    assets.filter((item) => item.type !== "skill").forEach((item) => {
      counts.set(item.folderId, (counts.get(item.folderId) || 0) + 1);
    });
    const current = folderSelect.value || "all";
    const options = ['<option value="all">全部项目文件夹</option>'];
    const direction = sortSelect?.value === "asc" ? 1 : -1;
    const folderTimes = new Map();
    assets.filter((item) => item.type !== "skill").forEach((item) => {
      const currentTime = folderTimes.get(item.folderId);
      const itemTime = Number(item.createdAt) || 0;
      folderTimes.set(item.folderId, currentTime === undefined
        ? itemTime
        : (direction < 0 ? Math.max(currentTime, itemTime) : Math.min(currentTime, itemTime)));
    });
    const orderedFolders = [...folders].sort((left, right) => {
      const timeDifference = (folderTimes.get(left.id) || 0) - (folderTimes.get(right.id) || 0);
      if (timeDifference) return timeDifference * direction;
      return String(left.name || "").localeCompare(String(right.name || ""), "zh-CN") * direction;
    });
    for (const folder of orderedFolders) {
      options.push(`<option value="${escapeHtml(folder.id)}">${escapeHtml(folder.name)}（${counts.get(folder.id) || 0}）</option>`);
    }
    if (counts.get("ungrouped")) options.push(`<option value="ungrouped">未归类（${counts.get("ungrouped")}）</option>`);
    folderSelect.innerHTML = options.join("");
    folderSelect.value = [...folderSelect.options].some((option) => option.value === current) ? current : "all";
  }

  async function load() {
    const revision = ++loadRevision;
    applyTheme();
    visibleLimit = 120;
    folders = readJson("aiCanvasProjectsV1", []);
    if (!Array.isArray(folders)) folders = [];
    const [skills, stateRecords] = await Promise.all([
      WandouSkills.list(),
      window.WandouAssetStates?.read(folders).catch(() => {
        if (revision === loadRevision) showToast("部分项目暂时无法读取，请稍后刷新资产。");
        return null;
      })
    ]);
    if (revision !== loadRevision) return;
    assets = [...collectMediaAssets(stateRecords), ...skills.map((skill) => ({ ...skill, type: "skill" }))];
    refreshFolderOptions();
    render();
  }

  function mediaCard(asset) {
    const index = assets.indexOf(asset);
    const directory = [asset.folderName, asset.projectName].filter(Boolean).map(escapeHtml).join(" / ");
    return `<article class="asset-card media-card" data-media-index="${index}"><div class="media-preview" data-preview-index="${index}"><span>正在读取…</span></div><div class="asset-card-body"><h3 class="asset-card-title">${escapeHtml(asset.name)}</h3><div class="asset-card-meta">${asset.type === "video" ? "视频" : "图片"}${asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}</div>${directory ? `<div class="asset-card-directory" title="${directory}">${directory}</div>` : ""}${asset.type === "image" ? `<div class="asset-media-actions"><button class="asset-download-button" type="button" data-asset-download="${index}" aria-label="下载${escapeHtml(asset.name)}，选择保存位置" title="选择位置保存原图"${imageDownloadPending ? " disabled" : ""}>下载图片</button><button class="asset-location-button" type="button" data-asset-location="${index}" aria-label="查看${escapeHtml(asset.name)}的原文件位置">原文件位置</button></div>` : ""}</div></article>`;
  }

  function skillCard(skill, selected) {
    const index = assets.indexOf(skill);
    const deleteButton = skill.canDelete
      ? `<button class="skill-delete" data-delete-skill="${index}" type="button" title="删除个人 Skill" aria-label="删除 ${escapeHtml(skill.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5"/></svg><span>删除</span></button>`
      : `<span class="skill-protected" title="系统核心 Skill，为保证生图功能完整不能删除"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg><span>系统保留</span></span>`;
    return `<article class="asset-card skill-card"><div class="skill-card-head"><span class="skill-mark">SK</span><span class="installed-badge">${escapeHtml(skill.source || "已安装")}</span></div><div><h3>${escapeHtml(skill.name)}</h3><p>${escapeHtml(skill.description)}</p></div><div class="skill-actions"><button class="skill-use ${selected?.id === skill.id ? "selected" : ""}" data-skill-index="${index}" type="button">${selected?.id === skill.id ? "已用于绘图" : "用于绘图"}</button>${deleteButton}</div></article>`;
  }

  function groupMarkup(name, items, cardRenderer) {
    return `<section class="asset-group"><header class="asset-group-head"><h2>${escapeHtml(name)}</h2><span class="asset-group-count">${items.length} 项</span></header><div class="asset-grid">${items.map(cardRenderer).join("")}</div></section>`;
  }

  function render() {
    const query = search.value.trim().toLowerCase();
    const selected = WandouSkills.getSelected();
    const chosenFolder = folderSelect.value || "all";
    const matching = assets.filter((asset) => {
      if (filter !== "all" && asset.type !== filter) return false;
      if (asset.type !== "skill" && chosenFolder !== "all" && asset.folderId !== chosenFolder) return false;
      return !query || `${asset.name || ""} ${asset.description || ""} ${asset.folderName || ""} ${asset.projectName || ""}`.toLowerCase().includes(query);
    });
    const direction = sortSelect?.value === "asc" ? 1 : -1;
    const ordered = [...matching].sort((left, right) => {
      const timeDifference = (Number(left.createdAt) || 0) - (Number(right.createdAt) || 0);
      if (timeDifference) return timeDifference * direction;
      const sequenceDifference = (Number(left.sequence) || 0) - (Number(right.sequence) || 0);
      if (sequenceDifference) return sequenceDifference * direction;
      return String(left.name || "").localeCompare(String(right.name || ""), "zh-CN") * direction;
    });
    const limited = ordered.slice(0, visibleLimit);
    for (const type of ["image", "video", "skill"]) {
      document.querySelector(`[data-count="${type}"]`).textContent = assets.filter((asset) => asset.type === type).length;
    }
    document.querySelector('[data-count="all"]').textContent = assets.length;
    title.textContent = { all: "全部资产", image: "所有图片", video: "视频资产", skill: "绘图 Skill" }[filter];
    subtitle.textContent = filter === "skill"
      ? "个人 Skill 统一存放在软件 Skill 目录；ZIP 请先解压，再导入含 SKILL.md 的文件夹。"
      : `按软件内的项目文件夹归类，当前${direction < 0 ? "最近生成优先" : "最早生成优先"}；点击“下载图片”选择保存位置，“原文件位置”可查看内部存储文件。`;
    importButton.hidden = filter !== "skill";
    openSkillDirectoryButton.hidden = filter !== "skill";
    folderSelect.hidden = filter === "skill";
    search.placeholder = filter === "skill" ? "搜索绘图 Skill…" : "搜索资产或项目…";
    if (!limited.length) {
      content.innerHTML = `<div class="asset-empty">${filter === "skill" ? "暂时没有可用的绘图 Skill。可以导入自己的 Skill。" : "这个分类中还没有资产。"}</div>`;
      return;
    }
    const sections = [];
    const media = limited.filter((asset) => asset.type !== "skill");
    const skills = limited.filter((asset) => asset.type === "skill");
    const directoryGroups = new Map();
    for (const asset of media) {
      const key = `${asset.folderId || "ungrouped"}:${asset.projectId || ""}`;
      if (!directoryGroups.has(key)) directoryGroups.set(key, []);
      directoryGroups.get(key).push(asset);
    }
    for (const items of directoryGroups.values()) {
      const first = items[0];
      const directoryName = [first.folderName || "未归类", first.projectName].filter(Boolean).join(" / ");
      sections.push(groupMarkup(directoryName, items, mediaCard));
    }
    if (skills.length) sections.push(groupMarkup("绘图 Skill", skills, (skill) => skillCard(skill, selected)));
    if (matching.length > visibleLimit) sections.push(`<button class="asset-load-more" type="button">加载更多（剩余 ${matching.length - visibleLimit}）</button>`);
    content.innerHTML = sections.join("");
    content.querySelectorAll("[data-skill-index]").forEach((button) => {
      button.onclick = () => { WandouSkills.setSelected(assets[Number(button.dataset.skillIndex)]); render(); };
    });
    content.querySelectorAll("[data-delete-skill]").forEach((button) => {
      button.onclick = () => deleteSkill(assets[Number(button.dataset.deleteSkill)]);
    });
    content.querySelectorAll("[data-asset-location]").forEach((button) => {
      button.onclick = (event) => {
        event.stopPropagation();
        showOriginalLocation(assets[Number(button.dataset.assetLocation)]);
      };
    });
    content.querySelectorAll("[data-asset-download]").forEach((button) => {
      button.onclick = (event) => {
        event.stopPropagation();
        downloadImage(assets[Number(button.dataset.assetDownload)], button);
      };
    });
    content.querySelectorAll("[data-preview-index]").forEach(async (box) => {
      const asset = assets[Number(box.dataset.previewIndex)];
      const url = await resolveMedia(asset.stored);
      asset.url = url;
      box.innerHTML = url
        ? (asset.type === "video" ? `<video src="${url}" muted preload="metadata"></video>` : `<img src="${url}" alt="">`)
        : "<span>媒体暂不可用</span>";
    });
    content.querySelectorAll("[data-media-index]").forEach((card) => {
      card.onclick = async () => {
        const asset = assets[Number(card.dataset.mediaIndex)];
        const url = await resolveMedia(asset.fullStored || asset.stored);
        if (!url) return;
        document.getElementById("lightboxMedia").innerHTML = asset.type === "video"
          ? `<video src="${url}" controls autoplay></video>`
          : `<img src="${url}" alt="">`;
        document.getElementById("assetLightbox").classList.add("open");
      };
    });
    content.querySelector(".asset-load-more")?.addEventListener("click", () => { visibleLimit += 120; render(); });
  }

  async function importSkill() {
    if (!window.wandouShell?.importSkill) return showToast("请在豌豆 AI 客户端中导入 Skill。");
    importButton.disabled = true;
    const result = await window.wandouShell.importSkill();
    importButton.disabled = false;
    if (result?.canceled) return;
    if (!result?.success) return showToast(result?.error || "Skill 导入失败");
    showToast(`已导入 ${result.skill?.name || "Skill"}`);
    await load();
  }

  async function deleteSkill(skill) {
    if (!skill?.canDelete) return;
    if (!window.wandouShell?.deleteSkill) return showToast("临时浏览器预览不能删除，请在豌豆 AI 客户端中操作。");
    if (!window.confirm(`确定删除个人 Skill“${skill.name}”吗？\n\n文件将移到系统回收站，可以恢复。`)) return;
    const result = await window.wandouShell.deleteSkill(skill.id);
    if (!result?.success) return showToast(result?.error || "Skill 删除失败");
    if (WandouSkills.getSelected()?.id === skill.id) WandouSkills.setSelected(null);
    showToast(`已将 ${skill.name} 移到回收站`);
    await load();
  }

  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.onclick = () => {
      filter = button.dataset.filter;
      visibleLimit = 120;
      document.querySelectorAll("[data-filter]").forEach((item) => item.classList.toggle("active", item === button));
      render();
    };
  });
  search.oninput = () => { visibleLimit = 120; render(); };
  folderSelect.onchange = () => { visibleLimit = 120; render(); };
  sortSelect.onchange = () => { visibleLimit = 120; refreshFolderOptions(); render(); };
  importButton.onclick = importSkill;
  openSkillDirectoryButton.onclick = async () => {
    const result = await window.wandouShell?.openSkillDirectory?.();
    if (!result?.success) showToast(result?.error || "无法打开 Skill 目录");
  };
  document.getElementById("refreshAssets").onclick = load;
  document.getElementById("assetLocationClose").onclick = () => locationDialog.close();
  locationDialog.addEventListener("close", () => { locationRevision += 1; locationRef = ""; locationAsset = null; updateDownloadButtons(); });
  locationDownloadButton.onclick = () => downloadImage(locationAsset, locationDownloadButton);
  locationDialog.addEventListener("click", (event) => {
    if (event.target !== locationDialog) return;
    const bounds = locationDialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) locationDialog.close();
  });
  locationOpenButton.onclick = async () => {
    if (!locationRef || !window.wandouShell?.showCanvasMediaInFolder) return;
    const ref = locationRef;
    locationOpenButton.disabled = true;
    try {
      const result = await window.wandouShell.showCanvasMediaInFolder(ref);
      if (!result?.success) {
        showToast(result?.error || "无法打开原图所在文件夹，请刷新后重试。");
        if (result?.missing && locationRef === ref) {
          locationRef = "";
          locationDetails.hidden = true;
          locationStatus.textContent = "未找到本机原图存储文件，文件可能已被移走或清理。";
        }
      }
    } catch (_error) { showToast("无法打开原图所在文件夹，请稍后重试。"); }
    finally { if (locationRef === ref && locationDialog.open) locationOpenButton.disabled = false; }
  };
  document.querySelector(".lightbox-close").onclick = () => document.getElementById("assetLightbox").classList.remove("open");
  document.getElementById("assetLightbox").onclick = (event) => {
    if (event.target.id === "assetLightbox") event.currentTarget.classList.remove("open");
  };
  window.addEventListener("storage", (event) => {
    if (["ai-tools-theme", "wd-theme", "aiCanvasProjectHubTheme"].includes(event.key)) applyTheme();
  });
  window.addEventListener("focus", applyTheme);
  load();
})();
