(function (global) {
  'use strict';
  const pattern = /^wandou-media:\/\/[a-f0-9]{64}\/([A-Za-z0-9_-]{1,100})$/;
  const urls = new Map();
  // Only pending/failed undo writes need a safety copy. Keep this bounded;
  // oversized entries remain inline in their existing history snapshot.
  const history = new Map();
  let historyBytes = 0;
  function retainHistory(id, value) {
    if (history.has(id)) return true;
    const bytes = value.length * 2;
    if (historyBytes + bytes > 64 * 1024 * 1024) return false;
    history.set(id, value); historyBytes += bytes; return true;
  }
  function forgetHistory(id) {
    const value = history.get(id);
    if (value !== undefined) { historyBytes -= value.length * 2; history.delete(id); }
  }
  const fields = ['url', 'maskUrl', 'maskSelectionUrl', 'doodleUrl'];
  function storedReference(value) {
    const match = typeof value === 'string' && pattern.exec(value);
    return match ? `indexed-media:${match[1]}` : '';
  }
  async function resolve(id) {
    if (!global.wandouShell?.getCanvasMediaUrl) return '';
    if (urls.has(id)) return urls.get(id);
    const task = global.wandouShell.getCanvasMediaUrl({ id }).then(result => {
      return result?.success && storedReference(result.url) === `indexed-media:${id}` ? result.url : '';
    }).catch(() => '');
    urls.set(id, task);
    if (urls.size > 512) urls.delete(urls.keys().next().value);
    const result = await task;
    if (!result) urls.delete(id);
    return result;
  }
  async function toDataUrl(value) {
    if (!storedReference(value)) return value;
    const response = await fetch(value);
    if (!response.ok) throw new Error('本地原图读取失败，请重新打开项目或恢复原图');
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error || new Error('本地原图转换失败')); reader.readAsDataURL(blob);
    });
  }
  async function materializeReferences(references = []) {
    const cache = new Map(), result = [];
    for (const reference of references) {
      const copy = { ...reference };
      for (const field of fields) {
        const value = copy[field];
        if (!storedReference(value)) continue;
        if (!cache.has(value)) cache.set(value, toDataUrl(value));
        copy[field] = await cache.get(value);
      }
      result.push(copy);
    }
    return result;
  }
  async function materializeMessages(messages = []) {
    const cache = new Map(), result = [];
    for (const message of messages) {
      if (!Array.isArray(message.content)) { result.push(message); continue; }
      const content = [];
      for (const item of message.content) {
        const value = item?.image_url?.url;
        if (!storedReference(value)) { content.push(item); continue; }
        if (!cache.has(value)) cache.set(value, toDataUrl(value));
        content.push({ ...item, image_url: { ...item.image_url, url: await cache.get(value) } });
      }
      result.push({ ...message, content });
    }
    return result;
  }
  global.WandouMediaUrls = { isRuntimeUrl: value => Boolean(storedReference(value)), storedReference, resolve, toDataUrl, materializeReferences, materializeMessages,
    retainHistory, forgetHistory, historyValue: id => history.get(id) || '' };
})(window);
