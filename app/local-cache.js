(function () {
  const DB_NAME = "wandou-ai-local-cache";
  const STORE_NAME = "files";
  const GLOBAL_THEME_KEY = "ai-tools-theme";
  const pending = new Map();
  let requestId = 0;
  let fallbackDbPromise = null;
  let configPromise = null;

  function hasDesktopBridge() {
    return !!(window.chrome && window.chrome.webview);
  }

  function safeName(value) {
    return String(value || "default")
      .replace(/^[a-z]+:/i, "")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .replace(/\.\.+/g, "_")
      .slice(0, 160) || "default";
  }

  function pathFor(kind, key, ext) {
    return `${safeName(kind)}/${safeName(key)}.${ext || "txt"}`;
  }

  function openFallbackDb() {
    if (fallbackDbPromise) return fallbackDbPromise;
    fallbackDbPromise = new Promise((resolve) => {
      if (!window.indexedDB) {
        resolve(null);
        return;
      }
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE_NAME, { keyPath: "path" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    return fallbackDbPromise;
  }

  async function fallbackWrite(path, value) {
    const db = await openFallbackDb();
    if (!db) return { ok: false, fallback: true };
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put({ path, value, savedAt: Date.now() });
      tx.oncomplete = () => resolve({ ok: true, fallback: true });
      tx.onerror = () => resolve({ ok: false, fallback: true });
    });
  }

  async function fallbackRead(path) {
    const db = await openFallbackDb();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(path);
      request.onsuccess = () => resolve(request.result ? request.result.value : null);
      request.onerror = () => resolve(null);
    });
  }

  function postDesktop(type, payload) {
    if (!hasDesktopBridge()) return null;
    const id = `cache-${Date.now()}-${++requestId}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, timeout: true });
      }, 8000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      window.chrome.webview.postMessage(JSON.stringify({ id, type, ...(payload || {}) }));
    });
  }

  if (hasDesktopBridge() && window.chrome.webview.addEventListener) {
    window.chrome.webview.addEventListener("message", (event) => {
      let message = event.data;
      if (typeof message === "string") {
        try {
          message = JSON.parse(message);
        } catch {
          return;
        }
      }
      if (!message || message.type !== "LOCAL_CACHE_RESULT" || !message.id) return;
      const resolve = pending.get(message.id);
      if (!resolve) return;
      pending.delete(message.id);
      resolve(message);
    });
  }

  async function config() {
    if (!configPromise) {
      configPromise = (async () => {
        const desktop = await postDesktop("LOCAL_CACHE_CONFIG");
        if (desktop && desktop.ok) return desktop;
        await openFallbackDb();
        return {
          ok: true,
          mode: "browser",
          cacheDir: "Browser local IndexedDB",
          note: "Web mode stores cache locally in this browser. No cloud cache is used."
        };
      })();
    }
    return configPromise;
  }

  async function setDirectory(path) {
    const desktop = await postDesktop("LOCAL_CACHE_SET_DIR", { path: String(path || "") });
    if (desktop && desktop.ok) {
      configPromise = Promise.resolve(desktop);
      return desktop;
    }
    return config();
  }

  async function writeText(path, value) {
    const desktop = await postDesktop("LOCAL_CACHE_WRITE", { path, value: String(value || "") });
    if (desktop && desktop.ok) return desktop;
    return fallbackWrite(path, String(value || ""));
  }

  async function readText(path) {
    const desktop = await postDesktop("LOCAL_CACHE_READ", { path });
    if (desktop && desktop.ok && typeof desktop.value === "string") return desktop.value;
    return fallbackRead(path);
  }

  function writeJson(key, value) {
    return writeText(pathFor("json", key, "json"), JSON.stringify(value));
  }

  async function readJson(key) {
    const text = await readText(pathFor("json", key, "json"));
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function syncTheme(theme) {
    const next = theme === "light" ? "light" : "dark";
    try {
      localStorage.setItem(GLOBAL_THEME_KEY, next);
      localStorage.setItem("wd-theme", next);
      localStorage.setItem("aiCanvasProjectHubTheme", next);
    } catch {}
  }

  function readTheme(defaultTheme) {
    try {
      return localStorage.getItem(GLOBAL_THEME_KEY) || localStorage.getItem("wd-theme") || defaultTheme || "light";
    } catch {
      return defaultTheme || "light";
    }
  }

  function deleteDb(name) {
    return new Promise((resolve) => {
      if (!window.indexedDB) {
        resolve(false);
        return;
      }
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve(true);
      request.onerror = () => resolve(false);
      request.onblocked = () => resolve(false);
    });
  }

  async function clearHeavyCache() {
    const dbResults = await Promise.all([
      deleteDb(DB_NAME),
      deleteDb("ai-node-canvas-media-v1"),
      deleteDb("gpt-image-playground")
    ]);
    try {
      const removeKeys = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key) continue;
        if (key.includes(":deleted-results:")) removeKeys.push(key);
      }
      removeKeys.forEach((key) => localStorage.removeItem(key));
    } catch {}
    fallbackDbPromise = null;
    configPromise = null;
    return {
      ok: dbResults.some(Boolean),
      clearedDatabases: dbResults.filter(Boolean).length
    };
  }

  window.WandouLocalCache = {
    config,
    setDirectory,
    writeText,
    readText,
    writeJson,
    readJson,
    pathFor,
    safeName,
    syncTheme,
    readTheme,
    clearHeavyCache
  };

  config().catch(() => {});
})();
