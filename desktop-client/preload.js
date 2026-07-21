const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("wandouDesktopTabs", {
  open: (url, title) => ipcRenderer.send("desktop:open-tab", { url, title })
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
  confirmClose: () => ipcRenderer.invoke("desktop:confirm-close"),
  cancelClose: () => ipcRenderer.send("desktop:cancel-close"),
  setTheme: (theme) => ipcRenderer.send("desktop:set-theme", theme),
  getClientConfig: () => ipcRenderer.invoke("desktop:get-client-config"),
  checkForUpdates: () => ipcRenderer.invoke("desktop:check-for-updates"),
  startUpdate: (updateInfo) => ipcRenderer.invoke("desktop:start-update", updateInfo),
  openExternal: (url) => ipcRenderer.invoke("desktop:open-external", url),
  getSaveDirectory: () => ipcRenderer.invoke("desktop:get-save-directory"),
  chooseSaveDirectory: () => ipcRenderer.invoke("desktop:choose-save-directory"),
  writeSaveFile: (filename, bytes) => ipcRenderer.invoke("desktop:write-save-file", { filename, bytes })
});
