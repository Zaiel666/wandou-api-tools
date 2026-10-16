/* Browser-only prototype: never reads or changes production projects/settings. */
const canvasTestStorage = (() => {
  const prefix = 'wandou:canvas-ui-test:v1:';
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
  if (window.indexedDB) {
    for (const method of ['open', 'deleteDatabase']) {
      const original = indexedDB[method].bind(indexedDB);
      indexedDB[method] = (name, ...args) => original(prefix + name, ...args);
    }
  }
  return storage;
})();
const canvasTestSessionStorage = {
  getItem: key => window.sessionStorage.getItem('wandou:canvas-ui-test:v1:' + key),
  setItem: (key, value) => window.sessionStorage.setItem('wandou:canvas-ui-test:v1:' + key, value),
  removeItem: key => window.sessionStorage.removeItem('wandou:canvas-ui-test:v1:' + key)
};
