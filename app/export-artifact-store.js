/* Binary exports stay outside project JSON/localStorage. Metadata is portable;
   the bytes are local to this device/browser and validated again on download. */
(function () {
  let databasePromise;
  async function digest(bytes) {
    const value = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function database() {
    if (!databasePromise) {
      databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open('wandou-export-artifacts-v1', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('files');
        request.onsuccess = () => {
          request.result.onversionchange = () => { request.result.close(); databasePromise = null; };
          resolve(request.result);
        };
        request.onerror = () => reject(request.error || new Error('无法打开本地导出存储'));
        request.onblocked = () => reject(new Error('导出存储被另一页面占用，请关闭旧页面后重试'));
      }).catch(error => { databasePromise = null; throw error; });
    }
    return databasePromise;
  }
  async function browserFile(id, blob) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', blob ? 'readwrite' : 'readonly');
      const request = blob ? tx.objectStore('files').put(blob, id) : tx.objectStore('files').get(id);
      tx.oncomplete = () => resolve(blob || request.result);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('本地导出文件读写失败'));
    });
  }
  async function save(blob) {
    if (!blob?.size) throw new Error('导出文件为空');
    const bytes = await blob.arrayBuffer();
    const id = await digest(bytes);
    let storage = 'browser';
    if (window.wandouShell?.writeExportArtifact) {
      const result = await window.wandouShell.writeExportArtifact({id, bytes});
      if (!result?.success) throw new Error(result?.error || '导出文件未能保存到磁盘');
      storage = 'disk';
    } else {
      await browserFile(id, blob);
    }
    return {version:1, id, size:blob.size, type:blob.type, storage};
  }
  async function load(metadata) {
    if (metadata?.version !== 1 || !/^[a-f0-9]{64}$/.test(metadata.id || '')) throw new Error('导出文件记录无效');
    let blob;
    if (metadata.storage === 'disk') {
      if (!window.wandouShell?.readExportArtifact) throw new Error('此文件保存在桌面客户端，请在桌面客户端中下载');
      const result = await window.wandouShell.readExportArtifact({id:metadata.id});
      if (!result?.success) throw new Error(result?.error || '本地导出文件不存在');
      blob = new Blob([result.bytes], {type:metadata.type || 'application/octet-stream'});
    } else if (metadata.storage === 'browser') {
      blob = await browserFile(metadata.id);
    }
    if (!blob || blob.size !== metadata.size) throw new Error('本地导出文件缺失或大小不符，请重新生成');
    if (await digest(await blob.arrayBuffer()) !== metadata.id) throw new Error('本地导出文件校验失败，请重新生成');
    return blob;
  }
  window.WandouExportStore = {save, load, fingerprint: value => digest(typeof value === 'string' ? new TextEncoder().encode(value) : value)};
})();
