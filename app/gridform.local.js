(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function toast(message) {
    const target = $("#toast");
    target.textContent = message;
    target.classList.add("visible");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => target.classList.remove("visible"), 3000);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
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
    const button = $("#export");
    const initial = button.innerHTML;
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
        downloadBlob(result.blob, `GRIDFORM-${state.layout}-${state.config.ratio.replace(":", "x")}-layers-2x.psd`);
        toast(`PSD 已导出 · ${result.layers.length} 个独立图层`);
        return;
      }

      button.textContent = "正在生成 PNG…";
      const canvas = document.createElement("canvas");
      await PosterEngine.renderPoster(canvas.getContext("2d"), state, { scale: 2 });
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("PNG 编码失败");
      downloadBlob(blob, `GRIDFORM-${state.layout}-${state.config.ratio.replace(":", "x")}-2x.png`);
      canvas.width = canvas.height = 1;
      toast("高清 PNG 已导出");
    } catch (error) {
      console.error(error);
      toast(`导出失败：${error && error.message ? error.message : "未知错误"}`);
    } finally {
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
