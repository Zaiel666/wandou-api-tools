(function () {
  "use strict";

  const DB_NAME = "wandou-auto-save-v1";
  const STORE_NAME = "handles";
  const GLOBAL_KEY = "default-output-directory";
  const TOOL_IDS = {
    "upscale-page": "upscale-4k",
    "png-page": "png-workflow",
    "watermark-page": "watermark-remove"
  };
  let globalHandle = null;
  let toolHandle = null;
  let loaded = false;
  let button = null;
  let panel = null;

  function toolId() {
    const bodyClass = Object.keys(TOOL_IDS).find((name) => document.body.classList.contains(name));
    return TOOL_IDS[bodyClass] || document.body.dataset.saveDirectoryTool || location.pathname.split("/").pop().replace(/\.html?$/i, "") || "image-tool";
  }

  function toolKey() {
    return `tool-output-directory:${toolId()}`;
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function readHandle(key) {
    const db = await openDb();
    return new Promise((resolve) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  }

  async function writeHandle(key, handle) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(handle, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function deleteHandle(key) {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  async function load() {
    if (loaded) return effectiveHandle();
    loaded = true;
    if (!window.indexedDB) return null;
    [globalHandle, toolHandle] = await Promise.all([readHandle(GLOBAL_KEY), readHandle(toolKey())]);
    renderButton();
    return effectiveHandle();
  }

  function effectiveHandle() {
    return toolHandle || globalHandle || null;
  }

  async function ensurePermission(handle, requestAccess) {
    if (!handle) return false;
    try {
      if ((await handle.queryPermission({ mode: "readwrite" })) === "granted") return true;
      return requestAccess && (await handle.requestPermission({ mode: "readwrite" })) === "granted";
    } catch {
      return false;
    }
  }

  function folderIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5h6l2 2h9v9a2 2 0 0 1-2 2h-15v-13Z"/><path d="M3.5 9h17"/></svg>';
  }

  function renderButton() {
    if (!button) return;
    const handle = effectiveHandle();
    const source = toolHandle ? "本工具" : globalHandle ? "全局" : "";
    button.classList.toggle("required", !handle);
    button.innerHTML = `${folderIcon()}<span>${handle ? `${source}保存：${handle.name}` : "⚠ 必须设置保存位置"}</span>`;
    button.title = handle ? "管理全局或当前工具的本地保存文件夹" : "生成图片前必须设置本地保存文件夹";
  }

  async function choose(scope) {
    if (typeof window.showDirectoryPicker !== "function") {
      alert("当前浏览器不支持本地文件夹保存，请使用最新版 Chrome 或 Edge。");
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: "readwrite" });
      if (!(await ensurePermission(handle, true))) return;
      if (scope === "tool") {
        toolHandle = handle;
        await writeHandle(toolKey(), handle);
      } else {
        globalHandle = handle;
        await writeHandle(GLOBAL_KEY, handle);
      }
      renderButton();
      closePanel();
    } catch (error) {
      if (error?.name !== "AbortError") console.error("保存位置设置失败", error);
    }
  }

  async function useGlobal() {
    toolHandle = null;
    await deleteHandle(toolKey());
    renderButton();
    closePanel();
  }

  function closePanel() {
    if (panel) panel.hidden = true;
  }

  function createUi() {
    const style = document.createElement("style");
    style.textContent = `
      .wandou-page-actions{position:relative;z-index:1200;display:inline-flex;align-items:center;justify-content:flex-end;gap:10px;flex:none}
      .wandou-save-directory{position:static;height:48px;max-width:310px;padding:0 14px;display:flex;align-items:center;gap:8px;border:1px solid #cbd5e1;border-radius:13px;background:#fff;color:#334155;font:600 13px/1.2 system-ui,"Microsoft YaHei",sans-serif;box-shadow:0 8px 24px rgba(15,23,42,.08);cursor:pointer}
      .wandou-save-directory svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;flex:none}.wandou-save-directory span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .wandou-save-directory.required{border-color:#ef4444;color:#dc2626;background:#fff7f7;box-shadow:0 0 0 3px rgba(239,68,68,.12)}
      .wandou-save-panel{position:fixed;z-index:1201;top:66px;right:20px;width:290px;padding:14px;border:1px solid #dbe3ea;border-radius:14px;background:#fff;color:#1f2937;box-shadow:0 18px 50px rgba(15,23,42,.18);font:13px/1.45 system-ui,"Microsoft YaHei",sans-serif}
      .wandou-save-panel h3{margin:0 0 4px;font-size:15px}.wandou-save-panel p{margin:0 0 12px;color:#64748b}.wandou-save-actions{display:grid;gap:8px}.wandou-save-actions button{height:36px;border:1px solid #d1d5db;border-radius:9px;background:#fff;color:#334155;font-weight:600;cursor:pointer}.wandou-save-actions button.primary{border-color:#45c936;background:#45c936;color:#fff}.wandou-save-actions button:hover{filter:brightness(.97)}
      html[data-theme="dark"] .wandou-save-directory{background:#252a27;border-color:#4b5563;color:#e5e7eb}html[data-theme="dark"] .wandou-save-panel{background:#252a27;border-color:#4b5563;color:#f3f4f6}html[data-theme="dark"] .wandou-save-actions button{background:#303632;border-color:#59625c;color:#f3f4f6}html[data-theme="dark"] .wandou-save-directory.required{border-color:#ef4444;color:#fca5a5;background:#2b2020}
      .theme-toggle [data-theme-icon].theme-svg{display:block!important;width:22px;height:22px}.theme-toggle [data-theme-icon].theme-svg svg{display:block;width:22px;height:22px}
      @media(max-width:720px){.wandou-page-actions{gap:6px}.wandou-save-directory{max-width:185px;height:42px;padding:0 10px}.wandou-save-panel{top:58px;right:10px;width:min(290px,calc(100vw - 20px))}}
    `;
    document.head.appendChild(style);

    button = document.createElement("button");
    button.type = "button";
    button.className = "wandou-save-directory required";
    button.addEventListener("click", () => { panel.hidden = !panel.hidden; });

    panel = document.createElement("section");
    panel.className = "wandou-save-panel";
    panel.hidden = true;
    panel.innerHTML = '<h3>本地保存位置</h3><p>默认与所有图片工具、节点画布和绘图工作台同步；也可以只为当前工具单独设置。</p><div class="wandou-save-actions"><button class="primary" type="button" data-save-global>设置/更改全局文件夹</button><button type="button" data-save-tool>单独设置当前工具</button><button type="button" data-save-inherit>当前工具改用全局文件夹</button><button type="button" data-save-close>关闭</button></div>';
    panel.querySelector("[data-save-global]").addEventListener("click", () => choose("global"));
    panel.querySelector("[data-save-tool]").addEventListener("click", () => choose("tool"));
    panel.querySelector("[data-save-inherit]").addEventListener("click", useGlobal);
    panel.querySelector("[data-save-close]").addEventListener("click", closePanel);
    const themeButton = document.querySelector("[data-theme-toggle]");
    if (themeButton?.parentElement) {
      const actions = document.createElement("div");
      actions.className = "wandou-page-actions";
      themeButton.parentElement.insertBefore(actions, themeButton);
      actions.append(button, themeButton);
    } else {
      document.body.appendChild(button);
    }
    document.body.appendChild(panel);
    renderButton();
  }

  async function requireDirectory() {
    await load();
    const handle = effectiveHandle();
    if (handle && await ensurePermission(handle, true)) return handle;
    button?.classList.add("required");
    if (panel) panel.hidden = false;
    return null;
  }

  async function uniqueName(handle, filename) {
    const dot = filename.lastIndexOf(".");
    const base = dot > 0 ? filename.slice(0, dot) : filename;
    const ext = dot > 0 ? filename.slice(dot) : "";
    for (let index = 0; index < 1000; index += 1) {
      const candidate = index ? `${base}-${index}${ext}` : filename;
      try { await handle.getFileHandle(candidate); } catch { return candidate; }
    }
    return `${base}-${Date.now()}${ext}`;
  }

  async function writeBlob(blob, filename) {
    const handle = await requireDirectory();
    if (!handle || !blob) return false;
    const safeName = await uniqueName(handle, filename.replace(/[\\/:*?"<>|]+/g, "-"));
    const file = await handle.getFileHandle(safeName, { create: true });
    const writable = await file.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  }

  window.WandouSaveDirectory = { load, require: requireDirectory, writeBlob, effectiveHandle };
  document.addEventListener("DOMContentLoaded", async () => { createUi(); await load(); });
  window.addEventListener("focus", async () => {
    loaded = false;
    await load();
  });
})();
