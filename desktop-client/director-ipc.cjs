const path = require('node:path');
const {fileURLToPath} = require('node:url');
const {convertBlend} = require('./director-converter.cjs');
module.exports = function registerDirector({app, ipcMain, getAppRoot}) {
  let job = null;
  function trusted(event) {
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false;
    try {
      const actual = path.resolve(fileURLToPath(event.senderFrame.url)).toLowerCase();
      return actual === path.join(getAppRoot(), 'ai-node-canvas-test.html').toLowerCase();
    } catch (_) { return false; }
  }
  ipcMain.handle('director:convert-blend', async (event, payload = {}) => {
    if (!trusted(event)) return {success:false,error:'仅允许本地导演台转换。'};
    if (job) return {success:false,error:'已有模型正在转换，请稍候。'};
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(payload.requestId || '')) return {success:false,error:'无效请求。'};
    const current = {id:payload.requestId,sender:event.sender,controller:new AbortController()};
    job = current;
    const abort = () => current.controller.abort();
    event.sender.once('destroyed', abort);
    try {
      return await convertBlend(payload.source, {signal:current.controller.signal,
        script:app.isPackaged ? path.join(process.resourcesPath,'director','convert-blend.py') : undefined});
    } catch (error) { return {success:false,error:error.message || '转换失败。'}; }
    finally { event.sender.removeListener('destroyed', abort); if (job === current) job = null; }
  });
  ipcMain.on('director:cancel-blend', (event, payload = {}) => {
    if (trusted(event) && job?.sender === event.sender && job.id === payload.requestId) job.controller.abort();
  });
  app.on('before-quit', () => job?.controller.abort());
};
