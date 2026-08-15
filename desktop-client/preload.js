const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("wandouDesktopTabs", {
  open: (url, title) => ipcRenderer.send("desktop:open-tab", { url, title })
});

// API 请求在主进程中执行，避免 file:// 页面被 Chromium 的 CORS 策略拦截。
contextBridge.exposeInMainWorld("wandouDesktopApi", {
  fetch: (url, request) => ipcRenderer.invoke("desktop:api-fetch", { url, request })
});

contextBridge.exposeInMainWorld("wandouShell", {
  onOpenTab: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("shell:open-tab", handler);
    return () => ipcRenderer.removeListener("shell:open-tab", handler);
  },
  onCloseRequested: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("desktop:request-close", handler);
    return () => ipcRenderer.removeListener("desktop:request-close", handler);
  },
  onDownloadResult: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("desktop:download-result", handler);
    return () => ipcRenderer.removeListener("desktop:download-result", handler);
  },
  onUpdateStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("desktop:update-status", handler);
    return () => ipcRenderer.removeListener("desktop:update-status", handler);
  },
  onGuestRendererGone: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("desktop:guest-renderer-gone", handler);
    return () => ipcRenderer.removeListener("desktop:guest-renderer-gone", handler);
  },
  confirmClose: (verification) => ipcRenderer.invoke("desktop:confirm-close", verification),
  cancelClose: () => ipcRenderer.send("desktop:cancel-close"),
  markReady: () => ipcRenderer.send("desktop:shell-ready"),
  setTheme: (theme) => ipcRenderer.send("desktop:set-theme", theme),
  getClientConfig: () => ipcRenderer.invoke("desktop:get-client-config"),
  checkForUpdates: () => ipcRenderer.invoke("desktop:check-for-updates"),
  startUpdate: (updateInfo) => ipcRenderer.invoke("desktop:start-update", updateInfo),
  openExternal: (url) => ipcRenderer.invoke("desktop:open-external", url),
  getSaveDirectory: () => ipcRenderer.invoke("desktop:get-save-directory"),
  chooseSaveDirectory: () => ipcRenderer.invoke("desktop:choose-save-directory"),
  createSaveDirectory: (folderName) => ipcRenderer.invoke("desktop:create-save-directory", { folderName }),
  writeSaveFile: (filename, bytes, folderName = "") => ipcRenderer.invoke("desktop:write-save-file", { filename, bytes, folderName }),
  writeCanvasBackup: (payload) => ipcRenderer.invoke("desktop:write-canvas-backup", payload),
  readCanvasBackups: (payload) => ipcRenderer.invoke("desktop:read-canvas-backups", payload),
  hasCanvasMedia: (payload) => ipcRenderer.invoke("desktop:has-canvas-media", payload),
  writeCanvasMedia: (payload) => ipcRenderer.invoke("desktop:write-canvas-media", payload),
  readCanvasMedia: (payload) => ipcRenderer.invoke("desktop:read-canvas-media", payload),
  getCanvasBackupDirectory: () => ipcRenderer.invoke("desktop:get-canvas-backup-directory")
});
