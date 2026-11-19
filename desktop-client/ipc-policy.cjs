const path = require('node:path');
const { fileURLToPath } = require('node:url');

module.exports = function createIpcPolicy({ appRoot, shellFile, shellContents }) {
  const shellOnly = new Set(['desktop:shell-ready', 'desktop:cancel-close', 'desktop:confirm-close', 'desktop:start-update', 'desktop:open-update-downloads']);
  function isShell(event) {
    if (!event?.senderFrame || event.senderFrame !== event.sender?.mainFrame || event.sender !== shellContents()) return false;
    try { return path.resolve(fileURLToPath(event.senderFrame.url)).toLowerCase() === path.resolve(shellFile).toLowerCase(); }
    catch (_) { return false; }
  }
  function isLocal(event) {
    if (!event?.senderFrame || event.senderFrame !== event.sender?.mainFrame) return false;
    try {
      const target = path.resolve(fileURLToPath(event.senderFrame.url)).toLowerCase();
      const root = path.resolve(appRoot()).toLowerCase();
      return target.startsWith(root + path.sep) && /\.html?$/i.test(target);
    } catch (_) { return false; }
  }
  function allowed(channel, event) { return shellOnly.has(channel) ? isShell(event) : isShell(event) || isLocal(event); }
  return {
    allowed, isShell, isLocal,
    handle(ipc, channel, handler) {
      ipc.handle(channel, (event, ...args) => {
        if (!allowed(channel, event)) return { success: false, started: false, error: '此页面无权访问本地功能' };
        return handler(event, ...args);
      });
    },
    on(ipc, channel, handler) {
      ipc.on(channel, (event, ...args) => { if (allowed(channel, event)) handler(event, ...args); });
    }
  };
};
