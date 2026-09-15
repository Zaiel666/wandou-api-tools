(function initWandouPromptRegistry(global) {
  "use strict";

  const sourceBase = "https://raw.githubusercontent.com/yukkcat/image-prompts/main/dist/sources";
  const sources = [
    { id: "banana-prompt-quicker", name: "Banana Prompt Quicker", url: `${sourceBase}/banana-prompt-quicker.json`, homepage: "https://glidea.github.io/banana-prompt-quicker/" },
    { id: "davidwu-gpt-image2-prompts", name: "DavidWu GPT Image 2", url: `${sourceBase}/davidwu-gpt-image2-prompts.json`, homepage: "https://github.com/davidwuw0811-boop/awesome-gpt-image2-prompts" },
    { id: "freestylefly-gpt-image-2", name: "Freestylefly GPT Image 2", url: `${sourceBase}/freestylefly-gpt-image-2.json`, homepage: "https://github.com/freestylefly/awesome-gpt-image-2" },
    { id: "awesome-gpt-image", name: "Awesome GPT Image", url: `${sourceBase}/awesome-gpt-image.json`, homepage: "https://github.com/ZeroLu/awesome-gpt-image" },
    { id: "awesome-gpt4o-image-prompts", name: "Awesome GPT-4o", url: `${sourceBase}/awesome-gpt4o-image-prompts.json`, homepage: "https://github.com/ImgEdify/Awesome-GPT4o-Image-Prompts" },
    { id: "youmind-gpt-image-2", name: "YouMind GPT Image 2", url: `${sourceBase}/youmind-gpt-image-2.json`, homepage: "https://github.com/YouMind-OpenLab/awesome-gpt-image-2" },
    { id: "youmind-nano-banana-pro", name: "YouMind Nano Banana Pro", url: `${sourceBase}/youmind-nano-banana-pro.json`, homepage: "https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts" }
  ];

  const databaseName = "wandou-prompt-library";
  const storeName = "source-cache";
  const cacheLifetimeMs = 60 * 60 * 1000;
  const bundledData = global.WandouBundledPromptData || {};

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!global.indexedDB) return reject(new Error("当前环境不支持提示词缓存"));
      const request = global.indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(storeName)) database.createObjectStore(storeName, { keyPath: "sourceId" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("无法打开提示词缓存"));
    });
  }

  async function readCache(sourceId) {
    try {
      const database = await openDatabase();
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, "readonly");
        const request = transaction.objectStore(storeName).get(sourceId);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => database.close();
      });
    } catch (error) {
      return null;
    }
  }

  async function writeCache(record) {
    try {
      const database = await openDatabase();
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, "readwrite");
        transaction.objectStore(storeName).put(record);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
    } catch (error) {
      // The remote data is still usable when persistent browser storage is unavailable.
    }
  }

  function absoluteUrl(baseUrl, value) {
    if (!value) return "";
    try { return new URL(String(value), baseUrl).toString(); } catch (error) { return String(value); }
  }

  function normalizeItems(values, source) {
    if (!Array.isArray(values)) return [];
    const seen = new Set();
    return values.flatMap((value, index) => {
      if (!value || typeof value !== "object") return [];
      const title = String(value.title || "").trim();
      const prompt = String(value.prompt || "").trim();
      if (!title || !prompt) return [];
      const rawId = String(value.id || `${source.id}-${String(index + 1).padStart(4, "0")}`);
      const id = `${source.id}:${rawId}`;
      if (seen.has(id)) return [];
      seen.add(id);
      const references = Array.isArray(value.referenceImageUrls)
        ? value.referenceImageUrls.map((url) => absoluteUrl(source.url, url)).filter(Boolean)
        : [];
      const coverUrl = absoluteUrl(source.url, value.coverUrl) || references[0] || "";
      return [{
        id,
        name: title,
        title,
        text: prompt,
        prompt,
        description: String(value.description || "").trim(),
        coverUrl,
        referenceImageUrls: references,
        tags: Array.isArray(value.tags) ? value.tags.map((tag) => String(tag).trim()).filter(Boolean) : [],
        tag: Array.isArray(value.tags) && value.tags[0] ? String(value.tags[0]).trim() : source.name,
        sourceId: source.id,
        sourceName: source.name,
        sourceUrl: absoluteUrl(source.url, value.sourceUrl) || source.homepage,
        createdAt: String(value.createdAt || ""),
        updatedAt: String(value.updatedAt || ""),
        _key: `remote:${id}`,
        _source: "remote"
      }];
    });
  }

  async function fetchSource(source) {
    const controller = new AbortController();
    const timeout = global.setTimeout(() => controller.abort(), 25000);
    try {
      const response = await global.fetch(source.url, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const items = normalizeItems(await response.json(), source);
      if (!items.length) throw new Error("提示词来源没有可用内容");
      const record = { sourceId: source.id, items, fetchedAt: Date.now() };
      await writeCache(record);
      return { source, items, cached: false, error: "" };
    } finally {
      global.clearTimeout(timeout);
    }
  }

  async function loadSource(source, force) {
    const cached = await readCache(source.id);
    const bundledItems = normalizeItems(bundledData[source.id], source);
    if (!force && cached?.items?.length && Date.now() - Number(cached.fetchedAt || 0) < cacheLifetimeMs) {
      return { source, items: cached.items, cached: true, error: "" };
    }
    if (!force && bundledItems.length) {
      // Render the complete bundled library immediately. A successful refresh is
      // cached for the next open without making the current dialog wait on GitHub.
      fetchSource(source).catch(() => undefined);
      return { source, items: bundledItems, cached: true, bundled: true, error: "" };
    }
    try {
      return await fetchSource(source);
    } catch (error) {
      if (cached?.items?.length) {
        return { source, items: cached.items, cached: true, error: error instanceof Error ? error.message : String(error) };
      }
      if (bundledItems.length) {
        return { source, items: bundledItems, cached: true, bundled: true, error: error instanceof Error ? error.message : String(error) };
      }
      return { source, items: [], cached: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async function loadAll(options = {}) {
    const force = Boolean(options.force);
    const results = await Promise.all(sources.map((source) => loadSource(source, force)));
    return {
      items: results.flatMap((result) => result.items),
      results,
      total: results.reduce((total, result) => total + result.items.length, 0),
      failed: results.filter((result) => !result.items.length)
    };
  }

  global.WandouPromptRegistry = { sources, loadAll };
})(window);
