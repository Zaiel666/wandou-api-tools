(function (root) {
  'use strict';
  const STATES = new Set(['submitting', 'awaiting', 'unknown', 'completed', 'failed', 'cancelled']);
  const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
  const ADAPTER = 'zexi-images-async-v1';
  const text = (value, limit = 160) => {
    if (typeof value !== 'string' || !value || value.length > limit || /[\u0000-\u001f]/.test(value)) throw new Error('任务记录字段无效。');
    return value;
  };
  function endpoint(value) {
    const url = new URL(text(value, 1024));
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('任务恢复需要不含凭据或查询参数的 HTTPS 接口地址。');
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.href;
  }
  function supported(value) {
    try { return ['zexitongxue.com', 'www.zexitongxue.com'].includes(new URL(endpoint(value)).hostname); }
    catch (_) { return false; }
  }
  function validate(value) {
    if (!value || value.version !== 1 || value.adapter !== ADAPTER || !STATES.has(value.state)) throw new Error('无法识别的恢复记录，未发送请求。');
    const result = {
      version: 1, id: text(value.id), adapter: ADAPTER, state: value.state,
      folderId: text(value.folderId), projectId: text(value.projectId), sourceId: text(value.sourceId), resultId: text(value.resultId),
      channelId: text(value.channelId, 64), provider: text(value.provider, 64), endpoint: endpoint(value.endpoint),
      model: text(value.model, 200), targetSize: text(value.targetSize, 32), resolution: text(value.resolution, 8), credentialFingerprint: text(value.credentialFingerprint, 64),
      createdAt: Number(value.createdAt), updatedAt: Number(value.updatedAt), taskId: '', leaseOwner: '', leaseUntil: 0
    };
    const output = value.output;
    if (!output || output.format !== 'png' || !['transparent', 'opaque', 'auto'].includes(output.background)
      || !['low', 'medium', 'high'].includes(output.quality) || !['low', 'medium', 'high'].includes(output.complexity)
      || typeof output.size !== 'string' || !/^\d{1,5}x\d{1,5}$/.test(output.size)) throw new Error('任务原始输出参数缺失或不支持，未发送查询。');
    result.output = { format:'png', background:output.background, quality:output.quality, complexity:output.complexity, size:output.size };
    if (!supported(result.endpoint) || !['channel1', 'channel2'].includes(result.channelId)
      || !/^\d{1,5}x\d{1,5}$/.test(result.targetSize) || !['1K', '2K', '4K'].includes(result.resolution)
      || !/^[a-f0-9]{64}$/.test(result.credentialFingerprint)
      || !Number.isFinite(result.createdAt) || !Number.isFinite(result.updatedAt)) throw new Error('恢复记录不属于已支持的图片任务协议。');
    if (value.taskId) {
      if (typeof value.taskId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value.taskId)) throw new Error('任务编号无效，未发送查询。');
      result.taskId = value.taskId;
    }
    if (value.leaseOwner) { result.leaseOwner = text(value.leaseOwner); result.leaseUntil = Number(value.leaseUntil) || 0; }
    return result;
  }
  function create(options = {}) {
    const idb = options.indexedDB || root.indexedDB;
    const now = options.now || Date.now;
    const name = options.name || 'wandou-image-task-ledger-v1';
    let opening;
    function open() {
      if (!idb) return Promise.reject(new Error('任务记录不可用，未提交生成请求。'));
      if (opening) return opening;
      opening = new Promise((resolve, reject) => {
        const request = idb.open(name, 1);
        let settled = false;
        const fail = message => { if (settled) return; settled = true; clearTimeout(timer); reject(new Error(message)); };
        const timer = setTimeout(() => fail('任务记录打开超时，未提交生成请求。'), options.openTimeoutMs || 8000);
        request.onupgradeneeded = () => { if (settled) { request.transaction.abort(); return; } request.result.createObjectStore('tasks', { keyPath: 'id' }); };
        request.onsuccess = () => { clearTimeout(timer); const db = request.result; if (settled) { db.close(); return; } settled = true; db.onversionchange = () => { db.close(); opening = null; }; resolve(db); };
        request.onerror = () => fail('任务记录读取失败，原有记录已保留。');
        request.onblocked = () => fail('其他窗口正在使用任务记录，请关闭重复窗口后再试。');
      }).catch(error => { opening = null; throw error; });
      return opening;
    }
    async function transaction(id, mutate, createValue = null) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('tasks', mutate ? 'readwrite' : 'readonly');
        const store = tx.objectStore('tasks');
        let result, failure;
        const request = store.get(text(id));
        request.onsuccess = () => {
          try {
            const current = request.result ? validate(request.result) : null;
            if (!mutate) { result = current; return; }
            result = mutate(current, createValue);
            if (result) { result = validate(result); store.put(result); }
          } catch (error) { failure = error; tx.abort(); }
        };
        tx.oncomplete = () => resolve(result);
        tx.onabort = tx.onerror = () => reject(failure || new Error('任务记录写入失败；不会自动重复提交生成。'));
      });
    }
    return {
      async begin(metadata) {
        const value = validate({ ...metadata, version: 1, adapter: ADAPTER, state: 'submitting', taskId: '', createdAt: now(), updatedAt: now() });
        return transaction(value.id, current => { if (current) throw new Error('任务已存在，不会重复提交。'); return value; });
      },
      get(id) { return transaction(id); },
      acknowledge(id, taskId) {
        return transaction(id, current => {
          if (!current) throw new Error('提交记录丢失，不会重发生图。');
          if (TERMINAL.has(current.state)) return current;
          if (current.taskId && current.taskId !== taskId) throw new Error('任务编号发生冲突，停止自动处理。');
          return { ...current, taskId, state: 'awaiting', updatedAt: now() };
        });
      },
      state(id, state, owner = '') {
        if (!STATES.has(state)) return Promise.reject(new Error('任务状态无效。'));
        return transaction(id, current => {
          if (!current) throw new Error('任务记录不存在。');
          if (TERMINAL.has(current.state)) return current;
          if (owner && (current.leaseOwner !== owner || current.leaseUntil <= now())) throw new Error('任务由其他窗口接管或租约过期，未回写结果。');
          return { ...current, state, updatedAt: now(), ...(TERMINAL.has(state) ? { leaseOwner: '', leaseUntil: 0 } : {}) };
        });
      },
      claim(id, owner) {
        return transaction(id, current => {
          if (!current || !current.taskId || TERMINAL.has(current.state)) throw new Error('此记录没有可续查的任务编号。');
          if (current.leaseOwner && current.leaseOwner !== owner && current.leaseUntil > now()) throw new Error('其他窗口正在查询此任务，请勿重复操作。');
          return { ...current, leaseOwner: text(owner), leaseUntil: now() + 30000, updatedAt: now() };
        });
      },
      renew(id, owner) {
        return transaction(id, current => {
          if (!current || TERMINAL.has(current.state) || current.leaseOwner !== owner || current.leaseUntil <= now()) throw new Error('查询租约已过期或由其他窗口接管，未回写结果。');
          return { ...current, leaseUntil: now() + 30000, updatedAt: now() };
        });
      },
      release(id, owner) { return transaction(id, current => current && current.leaseOwner === owner ? { ...current, leaseOwner: '', leaseUntil: 0, updatedAt: now() } : current); },
      async close() { if (opening) (await opening).close(); opening = null; }
    };
  }
  function matches(record, profile, identity) {
    const value = validate(record);
    return value.folderId === identity.folderId && value.projectId === identity.projectId
      && value.sourceId === identity.sourceId && value.resultId === identity.resultId
      && value.channelId === profile.id && value.provider === (profile.provider || 'gateway') && value.endpoint === endpoint(profile.url);
  }
  const api = { create, validate, endpoint, supported, matches, adapter: ADAPTER, terminal: state => TERMINAL.has(state) };
  root.WandouImageTaskLedger = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
