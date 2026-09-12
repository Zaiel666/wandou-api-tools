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
  const canvasPrefix = "aiCanvasStateV1";
  const indexedPrefix = "indexed-media:";
  let filter = "all";
  let assets = [];
  let folders = [];
  let visibleLimit = 120;
  let toastTimer = 0;

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

  async function resolveMedia(value) {
    if (!String(value || "").startsWith(indexedPrefix)) return value || "";
    const id = value.slice(indexedPrefix.length);
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
        folderName: folder?.name || "未命名文件夹",
        projectId,
        projectName: project?.name || ""
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

  function collectMediaAssets() {
    const keys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key === canvasPrefix || key?.startsWith(`${canvasPrefix}:`)) keys.push(key);
    }
    keys.sort((left, right) => right.split(":").length - left.split(":").length);
    const media = [];
    const seen = new Set();
    for (const key of keys) {
      if (key.includes(":project-collection:") || key.includes(":active-project-collection:")) continue;
      const state = readJson(key, null);
      if (!state || !Array.isArray(state.nodes)) continue;
      const project = projectContextForStorageKey(key, state);
      if (!project) continue;
      for (const node of state.nodes) {
        if (node?.type !== "result" || !["image", "video"].includes(node.mediaType)) continue;
        const stored = node.previewUrl || node.mediaUrl || node.fullUrl || "";
        const fullStored = node.fullUrl || node.mediaUrl || node.previewUrl || "";
        if (!stored || seen.has(stored)) continue;
        seen.add(stored);
        media.push({
          type: node.mediaType,
          name: node.title || node.prompt?.slice(0, 36) || (node.mediaType === "video" ? "视频资产" : "图片资产"),
          stored,
          fullStored,
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
    applyTheme();
    visibleLimit = 120;
    folders = readJson("aiCanvasProjectsV1", []);
    if (!Array.isArray(folders)) folders = [];
    const skills = await WandouSkills.list();
    assets = [...collectMediaAssets(), ...skills.map((skill) => ({ ...skill, type: "skill" }))];
    refreshFolderOptions();
    render();
  }

  function mediaCard(asset) {
    const index = assets.indexOf(asset);
    const directory = [asset.folderName, asset.projectName].filter(Boolean).map(escapeHtml).join(" / ");
    return `<article class="asset-card media-card" data-media-index="${index}"><div class="media-preview" data-preview-index="${index}"><span>正在读取…</span></div><div class="asset-card-body"><h3 class="asset-card-title">${escapeHtml(asset.name)}</h3><div class="asset-card-meta">${asset.type === "video" ? "视频" : "图片"}${asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}</div>${directory ? `<div class="asset-card-directory" title="${directory}">${directory}</div>` : ""}</div></article>`;
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
    title.textContent = { all: "全部资产", image: "图片资产", video: "视频资产", skill: "绘图 Skill" }[filter];
    subtitle.textContent = filter === "skill"
      ? "个人 Skill 统一存放在软件 Skill 目录；ZIP 请先解压，再导入含 SKILL.md 的文件夹。"
      : `图片和视频按文件夹目录归类，当前${direction < 0 ? "最近生成优先" : "最早生成优先"}。`;
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
