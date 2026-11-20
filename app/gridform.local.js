(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let localExportInProgress = false;
  let closeSaveJob = null;

  async function saveBeforeClose() {
    const gridform = window.Gridform;
    if (!gridform?.ready || typeof gridform.saveDraft !== "function" || typeof gridform.serialize !== "function") {
      return { success: false, busy: true, error: "网格海报正在初始化，请稍后关闭。" };
    }
    if (localExportInProgress) {
      return { success: false, busy: true, error: "海报正在导出，请等待导出完成后关闭。" };
    }
    try {
      // Inline editing also updates layout on blur; commit that state before taking the snapshot.
      document.activeElement?.blur?.();
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const snapshot = gridform.serialize();
        // The bundled API resolves true only after the IndexedDB transaction completes
        // (or the existing localStorage fallback succeeds), and returns false on write errors.
        if (await gridform.saveDraft(false) !== true) {
          return { success: false, error: "海报草稿保存失败，请检查存储空间后重试。" };
        }
        if (localExportInProgress) {
          return { success: false, busy: true, error: "海报正在导出，请等待导出完成后关闭。" };
        }
        if (gridform.serialize() === snapshot) return { success: true };
      }
      return { success: false, busy: true, error: "海报仍有新的编辑，请稍后再次关闭。" };
    } catch (error) {
      return { success: false, error: `海报草稿保存失败：${error?.message || "存储不可用"}` };
    }
  }

  // Register before engine startup so a slow/failed initialization cannot be mistaken for no draft.
  window.wandouSaveBeforeClose = () => {
    if (!closeSaveJob) closeSaveJob = saveBeforeClose().finally(() => { closeSaveJob = null; });
    return closeSaveJob;
  };

  function toast(message) {
    const target = $("#toast");
    target.textContent = message;
    target.classList.add("visible");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => target.classList.remove("visible"), 3000);
  }

  async function downloadBlob(blob, filename) {
    if (!window.WandouImageExport?.save) throw new Error("文件保存组件未就绪，请重新打开海报后重试");
    const result = await window.WandouImageExport.save({ blob, filename, mimeType: blob.type });
    if (result?.canceled) {
      toast("已取消导出");
      return null;
    }
    if (result?.success !== true) throw new Error(result?.error || "文件保存失败");
    return result;
  }

  async function waitForGridform() {
    const started = Date.now();
    while ((!window.Gridform || !window.Gridform.ready) && Date.now() - started < 15000) {
      await sleep(40);
    }
    if (!window.Gridform || !window.Gridform.ready) throw new Error("海报引擎初始化失败");
    return window.Gridform;
  }

  async function exportLocal(format) {
    if (localExportInProgress) return;
    const button = $("#export");
    const initial = button.innerHTML;
    localExportInProgress = true;
    button.disabled = true;
    try {
      await document.fonts.ready;
      const state = PosterEngine.clone(Gridform.state);
      if (format === "psd") {
        button.textContent = "正在生成 PSD…";
        const result = await PosterPSD.create(state, {
          scale: 2,
          onProgress(done, total) {
            button.textContent = `生成 PSD ${done}/${total}`;
          }
        });
        const saved = await downloadBlob(result.blob, `GRIDFORM-${state.layout}-${state.config.ratio.replace(":", "x")}-layers-2x.psd`);
        if (saved) toast(`PSD ${saved.started ? "已开始下载" : "已导出"} · ${result.layers.length} 个独立图层`);
        return;
      }

      button.textContent = "正在生成 PNG…";
      const canvas = document.createElement("canvas");
      await PosterEngine.renderPoster(canvas.getContext("2d"), state, { scale: 2 });
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("PNG 编码失败");
      canvas.width = canvas.height = 1;
      const saved = await downloadBlob(blob, `GRIDFORM-${state.layout}-${state.config.ratio.replace(":", "x")}-2x.png`);
      if (saved) toast(saved.started ? "高清 PNG 已开始下载" : "高清 PNG 已导出");
    } catch (error) {
      console.error(error);
      toast(`导出失败：${error && error.message ? error.message : "未知错误"}`);
    } finally {
      localExportInProgress = false;
      button.disabled = false;
      button.innerHTML = initial;
      updateExportLabel();
    }
  }

  function updateExportLabel() {
    const format = $("#exportFormat").value;
    $("#export").innerHTML = `<span>↗</span>导出 ${format === "psd" ? "PSD" : "PNG"}`;
    $("#psdHint").hidden = format !== "psd";
    $("#export").title = format === "psd"
      ? "背景、图片、装饰、Logo 与每个文字块分别生成图层"
      : "导出与画布一致的 2 倍分辨率 PNG 图片";
  }

  async function init() {
    const logo = $("[data-gridform-logo]");
    if (logo) logo.src = "./wandou-logo-latest.png";

    try {
      const gridform = await waitForGridform();
      if (logo) logo.src = "./wandou-logo-latest.png";

      const exportButton = $("#export");
      const exportFormat = $("#exportFormat");
      exportFormat.onchange = updateExportLabel;
      exportButton.onclick = () => exportLocal(exportFormat.value);
      updateExportLabel();

      $("#resetPositionsTop").onclick = () => $("#resetPositions").click();
      $("#restoreDefaultTop").onclick = () => $("#restoreDefault").click();
      $("#toggleGridTop").onclick = () => $("#toggleGrid").click();

      const manualMain = $("#preserveManual");
      const manualDock = $("#preserveManualDock");
      manualDock.checked = manualMain.checked;
      manualDock.onchange = () => {
        manualMain.checked = manualDock.checked;
        manualMain.dispatchEvent(new Event("change", { bubbles: true }));
      };
      manualMain.addEventListener("change", () => { manualDock.checked = manualMain.checked; });

      const showGrid = $("#showGrid");
      showGrid.addEventListener("change", () => $("#toggleGridTop").classList.toggle("active", showGrid.checked));

      window.gridformLocalReady = true;
      await gridform.whenRendered();
    } catch (error) {
      console.error(error);
      toast(error.message || "网格海报工作台初始化失败");
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
