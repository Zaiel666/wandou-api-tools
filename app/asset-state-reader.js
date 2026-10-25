/* Read saved project states without loading the media object store. */
(function (global) {
  'use strict';
  const prefix = 'aiCanvasStateV1';
  const databaseName = 'ai-node-canvas-media-v1';
  const nodeFields = ['id', 'type', 'title', 'mediaType', 'previewUrl', 'mediaUrl', 'fullUrl', 'createdAt', 'width', 'height', 'pending'];
  const isStateKey = key => (key === prefix || key.startsWith(prefix + ':'))
    && !/:(?:project-collection|active-project-collection|session-[^:]*|download-seq|deleted-results)(?::|$)/.test(key);

  function openExistingDatabase() {
    if (!global.indexedDB) return Promise.resolve(null);
    return new Promise(resolve => {
      let settled = false;
      const finish = value => { if (!settled) { settled = true; resolve(value); } else value?.close(); };
      let request;
      try { request = indexedDB.open(databaseName); } catch (_) { finish(null); return; }
      request.onupgradeneeded = event => {
        // Aborting creation also rolls back the empty database. Never create or
        // upgrade storage merely because the asset page was opened.
        if (event.oldVersion === 0) request.transaction.abort();
      };
      request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); finish(request.result); };
      request.onerror = () => finish(null);
      request.onblocked = () => finish(null);
    });
  }

  function readPage(db, after) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('canvas-state', 'readonly');
      const request = tx.objectStore('canvas-state').openCursor(after === undefined ? undefined : IDBKeyRange.lowerBound(after, true));
      const records = [];
      let visited = 0, lastKey, exhausted = false;
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { exhausted = true; return; }
        lastKey = cursor.primaryKey;
        const key = String(lastKey);
        if (isStateKey(key)) {
          const row = cursor.value;
          if (Array.isArray(row?.state?.nodes)) records.push({ key, state: row.state, savedAt: Number(row.savedAt) || 0 });
        }
        if (++visited < 8) cursor.continue();
      };
      tx.oncomplete = () => resolve({ records, lastKey, exhausted });
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('Saved project state could not be read'));
    });
  }

  async function read(folders = []) {
    // Resolve at call time: the source workspace may install an account-scoped
    // storage facade before loading assets, while packaged legacy pages do not.
    const storage = typeof canvasTestStorage !== 'undefined' ? canvasTestStorage : global.localStorage;
    const json = key => { try { return JSON.parse(storage.getItem(key) || 'null'); } catch (_) { return null; } };
    const knownFolders = new Map((Array.isArray(folders) ? folders : []).filter(item => item?.id).map(item => [String(item.id), item]));
    const latest = new Map();
    function identity(key, state = {}, fallback = {}) {
      let folderId = String(state.folderId || fallback.folderId || '');
      let projectId = String(state.projectId || fallback.projectId || '');
      const tail = key.startsWith(prefix + ':') ? key.slice(prefix.length + 1) : '';
      if (!folderId && tail) {
        folderId = [...knownFolders.keys()].sort((a,b) => b.length-a.length).find(id => tail === id || tail.startsWith(id + ':')) || tail.split(':')[0];
      }
      folderId ||= String(knownFolders.keys().next().value || 'default');
      if (!projectId && tail.startsWith(folderId + ':')) projectId = tail.slice(folderId.length + 1);
      if (!projectId) {
        const collection = json(`${prefix}:project-collection:${folderId}`);
        projectId = String(Array.isArray(collection) && collection[0]?.id || 'default');
      }
      if (!knownFolders.has(folderId)) knownFolders.set(folderId, { id: folderId });
      return { folderId, projectId };
    }
    function add(key, state, priority, fallback = {}, rowSavedAt = 0) {
      if (!state || !Array.isArray(state.nodes)) return;
      const ids = identity(key, state, fallback);
      // An explicit saved reset hides earlier assets. An accidental empty
      // recovery record must not erase a prior successful nonempty state.
      if (!state.nodes.length && !(Number(state.intentionalResetAt) > 0)) return;
      const savedAt = Number(state.savedAt) || rowSavedAt || 0;
      const id = `${ids.folderId}\u0000${ids.projectId}`;
      const previous = latest.get(id);
      if (previous && (previous.state.savedAt > savedAt || (previous.state.savedAt === savedAt && previous.priority >= priority))) return;
      const nodes = state.nodes.filter(node => node && typeof node === 'object').map(node => {
        const copy = {};
        for (const field of nodeFields) if (node[field] !== undefined) copy[field] = node[field];
        if (node.prompt) copy.prompt = String(node.prompt).slice(0,200);
        return copy;
      });
      latest.set(id, { key: `${prefix}:${ids.folderId}:${ids.projectId}`, priority,
        state: { ...ids, projectName: state.projectName || '', savedAt, intentionalResetAt: Number(state.intentionalResetAt) || 0, nodes } });
    }

    const keys = [];
    try { for (let i=0;i<storage.length;i++) { const key=storage.key(i); if (key && isStateKey(key)) keys.push(key); } } catch (_) {}
    // Canonical project rows precede their folder aliases when timestamps tie.
    keys.sort((a,b) => b.split(':').length-a.split(':').length);
    for (const key of keys) {
      const state = json(key);
      if (!state || typeof state !== 'object') continue;
      identity(key,state); // Compact pointers discover folders even without nodes.
      add(key,state,1);
    }
    const db = await openExistingDatabase();
    if (db) {
      try {
        if (db.objectStoreNames.contains('canvas-state')) {
          let after;
          for (;;) {
            const page = await readPage(db,after);
            for (const row of page.records) add(row.key,row.state,2,{},row.savedAt);
            if (page.exhausted) break;
            after=page.lastKey;
            await new Promise(resolve => setTimeout(resolve,0));
          }
        }
      } catch (_) { /* Other durable sources remain available if IDB is unavailable. */ }
      finally { db.close(); }
    }
    if (global.wandouShell?.readCanvasBackups) {
      for (const folderId of [...knownFolders.keys()]) {
        try {
          const result = await global.wandouShell.readCanvasBackups({ folderId, allProjects: true });
          if (!result?.success) continue;
          if (Array.isArray(result.projectStates) && result.projectStates.length) {
            for (const project of result.projectStates) {
              let states = Array.isArray(project.states) ? project.states : [];
              // The folder listing returns one snapshot per project. Match canvas
              // recovery when that row is an accidental, non-explicit empty save.
              if (states.some(state => Array.isArray(state?.nodes) && !state.nodes.length && !(Number(state.intentionalResetAt) > 0))) {
                try {
                  const fallback = await global.wandouShell.readCanvasBackups({folderId,projectId:project.projectId});
                  if (fallback?.success && Array.isArray(fallback.states)) states = [...states,...fallback.states];
                } catch (_) {}
              }
              for (const state of states) add(`${prefix}:${folderId}:${project.projectId}`,state,3,{folderId,projectId:project.projectId});
            }
          } else for (const state of Array.isArray(result.states) ? result.states : []) add(`${prefix}:${folderId}`,state,3,{folderId});
        } catch (_) { /* A missing folder must not hide the other saved projects. */ }
        await new Promise(resolve => setTimeout(resolve,0));
      }
    }
    return [...latest.values()].map(({key,state}) => ({key,state}));
  }
  global.WandouAssetStates = { read };
})(window);
