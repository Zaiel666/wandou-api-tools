(function (root) {
  'use strict';
  const name = 'gpt-image-playground', stores = ['tasks', 'images', 'thumbnails'], timeoutMs = 8000;
  let queue = Promise.resolve(), state = null, activityCheck = () => false, submitting = false;
  function publish(value) {
    state = Object.freeze({ ...value });
    root.dispatchEvent(new CustomEvent('wandou-workbench-storage-status', { detail: state }));
  }
  function failure(code, message) { const error = new Error(message); error.code = code; return error; }
  function reportError(error) {
    publish({ kind: 'error', code: error?.code || 'WORKBENCH_STORAGE_UNAVAILABLE', message:
      error?.code === 'WORKBENCH_STORAGE_BLOCKED'
        ? '工作台历史暂被其他页面占用。请关闭其他工作台页面后重新读取；已有记录和原图未删除。'
        : '工作台历史暂时无法读取，已有记录和原图未删除。请稍后重新读取，勿清除浏览器数据。' });
  }
  function connect(version) {
    return new Promise((resolve, reject) => {
      let request, settled = false, abandoned = false;
      const timer = root.setTimeout(() => stop(failure('WORKBENCH_STORAGE_TIMEOUT', '工作台存储读取超时')), timeoutMs);
      function stop(error) {
        if (settled) return;
        settled = true; abandoned = true; root.clearTimeout(timer);
        try { request?.transaction?.abort(); } catch (_) {}
        reject(error);
      }
      try { request = version === undefined ? root.indexedDB.open(name) : root.indexedDB.open(name, version); }
      catch (error) { stop(error); return; }
      request.onblocked = () => stop(failure('WORKBENCH_STORAGE_BLOCKED', '工作台存储升级被占用'));
      request.onupgradeneeded = () => {
        if (abandoned) { try { request.transaction.abort(); } catch (_) {} return; }
        try { for (const store of stores) if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store, { keyPath: 'id' }); }
        catch (error) { stop(error); }
      };
      request.onerror = () => stop(request.error || failure('WORKBENCH_STORAGE_UNAVAILABLE', '工作台存储不可用'));
      request.onsuccess = () => {
        const db = request.result;
        if (settled || abandoned) { db.close(); return; }
        settled = true; root.clearTimeout(timer);
        db.addEventListener('versionchange', () => db.close());
        resolve(db);
      };
    });
  }
  async function ensureOpen(attempt = 0) {
    const db = await connect(), missing = stores.filter(store => !db.objectStoreNames.contains(store));
    if (!missing.length && db.version >= 2) return db;
    const version = Math.max(2, db.version + 1); db.close();
    let upgraded;
    try { upgraded = await connect(version); }
    catch (error) {
      // Retry only a bounded cross-page version race, never blocked or failed writes.
      if (error?.name === 'VersionError' && attempt < 2) return ensureOpen(attempt + 1);
      throw error;
    }
    if (stores.some(store => !upgraded.objectStoreNames.contains(store))) {
      upgraded.close(); throw failure('WORKBENCH_STORAGE_SCHEMA', '工作台存储结构尚未完整恢复');
    }
    if (missing.length) publish({ kind: 'repaired', missingStores: missing, message:
      '已补齐工作台缺失的数据表，现存记录和原图均已保留。缺失的历史内容无法凭空重建。' });
    return upgraded;
  }
  function open() {
    const operation = queue.then(() => ensureOpen());
    queue = operation.then(() => undefined, () => undefined);
    return operation.catch(error => { reportError(error); throw error; });
  }
  function reportUnreferenced(count) {
    if (Number.isSafeInteger(count) && count > 0) publish({ kind: 'unreferenced', count,
      message: `发现 ${count} 张未关联历史记录的原图，已保留。历史可能未完整恢复，请勿清除浏览器数据。` });
  }
  async function ensureWritable() {
    if (state?.kind === 'error') throw failure('WORKBENCH_STORAGE_RELOAD_REQUIRED', '请先重新读取工作台历史');
    const db = await open();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(stores, 'readwrite');
        tx.oncomplete = resolve;
        tx.onabort = tx.onerror = () => reject(tx.error || failure('WORKBENCH_STORAGE_WRITE_FAILED', '工作台存储写入失败'));
        const id = '__wandou_storage_probe__' + crypto.randomUUID();
        try { const tasks = tx.objectStore('tasks'); tasks.put({ id }); tasks.delete(id); }
        catch (error) { try { tx.abort(); } catch (_) {} reject(error); }
      });
    } catch (error) { reportError(error); throw error; }
    finally { db.close(); }
  }
  async function runSubmission(action) {
    if (submitting) return;
    submitting = true;
    try { return await action(); }
    catch (error) { reportError(error); }
    finally { submitting = false; }
  }
  root.WandouWorkbenchImageDb = Object.freeze({ open, ensureWritable, runSubmission, reportError, reportUnreferenced,
    setActivityCheck: fn => { if (typeof fn === 'function') activityCheck = fn; },
    hasActiveTasks: () => submitting || Boolean(activityCheck()), getState: () => state });
})(window);
