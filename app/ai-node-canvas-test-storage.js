/* Explicit release mode reuses legacy storage; the plain test URL stays isolated. */
const canvasStoragePrefix = /(?:^|[?&])workspace=production(?:&|$)/.test(window.location?.search || '') ? '' : 'wandou:canvas-ui-test:v1:';
const canvasTestStorage = (() => {
  const prefix = canvasStoragePrefix;
  const keys = () => Object.keys(window.localStorage).filter(key => key.startsWith(prefix));
  const storage = {
    getItem: key => window.localStorage.getItem(prefix + key),
    setItem: (key, value) => window.localStorage.setItem(prefix + key, value),
    removeItem: key => window.localStorage.removeItem(prefix + key),
    clear: () => keys().forEach(key => window.localStorage.removeItem(key)),
    key: index => keys()[index]?.slice(prefix.length) ?? null,
    get length() { return keys().length; }
  };
  // All browser caches (canvas, media, directory handles) use separate databases.
  if (prefix && window.indexedDB) {
    for (const method of ['open', 'deleteDatabase']) {
      const original = indexedDB[method].bind(indexedDB);
      indexedDB[method] = (name, ...args) => original(prefix + name, ...args);
    }
  }
  return storage;
})();
const canvasTestSessionStorage = {
  getItem: key => window.sessionStorage.getItem(canvasStoragePrefix + key),
  setItem: (key, value) => window.sessionStorage.setItem(canvasStoragePrefix + key, value),
  removeItem: key => window.sessionStorage.removeItem(canvasStoragePrefix + key)
};
