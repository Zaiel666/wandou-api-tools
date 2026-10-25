(function(root) {
  async function mapLimited(items, limit, task, progress = () => {}) {
    const result = new Array(items.length);
    let next = 0, completed = 0, failure;
    const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
    let sliceStarted = now(), pause = null;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length && !failure) {
        // Cached media resolves immediately. Yield between short work slices so
        // a large save cannot monopolize the renderer's microtask queue.
        if (pause || now() - sliceStarted >= 8) {
          if (!pause) pause = new Promise(resolve => setTimeout(() => {
            sliceStarted = now(); pause = null; resolve();
          }, 0));
          await pause;
          if (failure || next >= items.length) break;
        }
        const index = next++;
        try { result[index] = await task(items[index], index); progress(++completed, items.length); }
        catch (error) { failure = error; }
      }
    }));
    if (failure) throw failure;
    return result;
  }
  function createQueue() {
    const pending = new Map();
    let running = false;
    async function drain() {
      if (running) return;
      running = true;
      try {
        while (pending.size) {
          const [key, entry] = pending.entries().next().value;
          pending.delete(key);
          try { const result = await entry.task(entry.context); entry.waiters.forEach(w => w.resolve(result)); }
          catch (error) { entry.waiters.forEach(w => w.reject(error)); }
        }
      } finally { running = false; }
    }
    return { enqueue(key, context, task) {
      return new Promise((resolve, reject) => {
        const entry = pending.get(key) || { waiters: [] };
        entry.context = context; entry.task = task; entry.waiters.push({resolve,reject});
        pending.set(key, entry); void drain();
      });
    } };
  }
  const api = { mapLimited, createQueue };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WandouSavePipeline = api;
})(typeof window !== 'undefined' ? window : globalThis);
