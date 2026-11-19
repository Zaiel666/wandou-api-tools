const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const mediaFiles = require('./canvas-media-files.cjs');

// Reserve slots and acquire each token before the first await. IPC invocations
// can overlap even though the normal renderer submits its chunks sequentially.
module.exports = function createCanvasMediaWriter({ directory, destination, onCommitted }) {
  const sessions = new Map(), owners = new Map();
  const problem = (message, code) => Object.assign(Error(message), { code });
  const failure = error => ({ success: false, error: error.message, code: error.code || 'MEDIA_WRITE_FAILED' });
  function assertLive(entry) {
    if (entry.ownerState.closed) throw problem('媒体所属页面已关闭', 'MEDIA_OWNER_DISPOSED');
    if (entry.cancelled) throw problem('媒体写入已取消', 'MEDIA_ABORTED');
    if (path.resolve(directory()) !== entry.root) throw problem('项目目录已切换，请重新保存原图', 'MEDIA_ROOT_CHANGED');
  }
  function discard(entry) {
    if (entry.discarding) return entry.discarding;
    entry.discarding = (async () => {
      await entry.handle?.close().catch(() => {}); entry.handle = null;
      // A failed exclusive open never owns the existing file at this name.
      if (entry.ownsTemporary) await fs.unlink(entry.temporary).catch(() => {});
      if (sessions.get(entry.token) === entry) sessions.delete(entry.token);
      entry.ownerState.tokens.delete(entry.token);
    })();
    return entry.discarding;
  }
  function execute(entry, action) {
    entry.busy = true;
    // Defer work until operation is registered, so immediate disposal also
    // waits for a begin whose first filesystem operation has not yet started.
    const task = Promise.resolve().then(async () => {
      try {
        assertLive(entry);
        if (action.action === 'begin') {
          await fs.mkdir(entry.root, { recursive: true });
          await mediaFiles.realDirectory(entry.root); assertLive(entry);
          entry.target = destination(entry.id);
          if (path.resolve(entry.target) !== path.join(entry.root, `${entry.id}.data`)) throw Error('Invalid media destination');
          entry.temporary = path.join(entry.root, `.media-${entry.token}.tmp`);
          entry.handle = await fs.open(entry.temporary, 'wx'); entry.ownsTemporary = true;
          assertLive(entry);
          return { success: true, token: entry.token };
        }
        await mediaFiles.realDirectory(entry.root); assertLive(entry);
        if (action.action === 'chunk') {
          const chunk = action.chunk;
          if (typeof chunk !== 'string' || !chunk.length || chunk.length > 1024 * 1024 || action.offset !== entry.written || entry.written + chunk.length > entry.length) throw Error('媒体数据块不完整');
          if (!entry.written && !chunk.startsWith('data:')) throw Error('Invalid canvas media');
          const bytes = Buffer.from(chunk, 'utf8');
          let offset = 0;
          while (offset < bytes.length) {
            assertLive(entry);
            const result = await entry.handle.write(bytes, offset, bytes.length - offset, entry.bytes + offset);
            if (!result.bytesWritten) throw Error('磁盘写入未取得进展');
            offset += result.bytesWritten;
          }
          assertLive(entry);
          entry.written += chunk.length; entry.bytes += bytes.length; entry.hash.update(bytes);
          return { success: true, written: entry.written, total: entry.length };
        }
        if (action.action !== 'commit' || entry.written !== entry.length) throw Error('媒体尚未完整写入，未提交');
        const actualId = `sha256-${entry.hash.digest('hex')}`;
        if (entry.id.startsWith('sha256-') && entry.id !== actualId) throw Error('图片内容校验失败');
        await entry.handle.sync(); assertLive(entry);
        const stat = await entry.handle.stat();
        if (stat.size !== entry.bytes) throw Error('媒体文件大小校验失败');
        await entry.handle.close(); entry.handle = null; assertLive(entry);
        const published = await mediaFiles.publishLegacyTemporary(entry.root, entry.id, entry.temporary, actualId.slice(7));
        entry.published = true; assertLive(entry);
        let standardization;
        try { standardization = await onCommitted?.(entry.id); } catch (error) { standardization = { success: false, error: error.message }; }
        assertLive(entry);
        await discard(entry);
        return { success: true, sessionClosed: true, path: standardization?.success ? standardization.path : entry.target, bytes: entry.bytes, repaired: Boolean(published.repaired), storageFormat: standardization?.success ? 'image-file' : 'data-url', standardization };
      } catch (error) {
        await discard(entry);
        // If cancellation races with publication, the verified original stays
        // on disk. Only this operation's private temporary file is discarded.
        return { ...failure(error), sessionClosed: true, committed: Boolean(entry.published) };
      } finally { entry.busy = false; }
    });
    entry.operation = task;
    return task;
  }
  async function cancel(entry) {
    entry.cancelled = true;
    await entry.operation;
    await discard(entry);
    return { success: true, sessionClosed: true };
  }
  function write(owner, payload = {}) {
    try {
      if (payload.action === 'begin') {
        if (!mediaFiles.validId(payload.id)) throw Error('Invalid media id');
        if (!Number.isSafeInteger(payload.length) || payload.length < 5) throw Error('Invalid media length');
        let state = owners.get(owner);
        if (!state) { state = { closed: false, tokens: new Set(), disposal: null }; owners.set(owner, state); }
        if (state.closed) throw problem('媒体所属页面已关闭', 'MEDIA_OWNER_DISPOSED');
        if (state.tokens.size >= 4) throw problem('同时写入的媒体过多', 'MEDIA_LIMIT');
        const token = crypto.randomUUID();
        const entry = { token, owner, ownerState: state, root: path.resolve(directory()), id: payload.id, length: payload.length,
          hash: crypto.createHash('sha256'), written: 0, bytes: 0, busy: false, cancelled: false, ownsTemporary: false, published: false };
        state.tokens.add(token); sessions.set(token, entry);
        return execute(entry, payload);
      }
      const entry = sessions.get(String(payload.token || ''));
      if (!entry || entry.owner !== owner) throw problem('媒体写入会话已失效', 'MEDIA_SESSION_INVALID');
      if (payload.action === 'abort') return cancel(entry);
      if (entry.busy || entry.cancelled) return Promise.resolve({ ...failure(problem('媒体写入尚未完成', 'MEDIA_BUSY')), sessionRetained: true });
      return execute(entry, payload);
    } catch (error) { return Promise.resolve(failure(error)); }
  }
  function disposeOwner(owner) {
    let state = owners.get(owner);
    if (!state) { state = { closed: true, tokens: new Set(), disposal: null }; owners.set(owner, state); }
    state.closed = true;
    if (!state.disposal) state.disposal = Promise.all([...state.tokens].map(token => cancel(sessions.get(token)))).then(() => undefined);
    return state.disposal;
  }
  return { write, disposeOwner };
};
