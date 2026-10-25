const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

// Keep IPC messages small; publish a media file only after every chunk is on disk.
module.exports = function createCanvasMediaWriter({ directory, destination }) {
  const sessions = new Map();
  async function discard(token) {
    const entry = sessions.get(token);
    if (!entry) return;
    sessions.delete(token);
    await entry.handle.close().catch(() => {});
    await fs.unlink(entry.temporary).catch(() => {});
  }
  async function write(owner, payload = {}) {
    let token = String(payload.token || '');
    let acquired = false;
    try {
      if (payload.action === 'begin') {
        if (!/^[a-zA-Z0-9_-]{1,160}$/.test(payload.id || '')) throw Error('Invalid media id');
        if (!Number.isSafeInteger(payload.length) || payload.length < 5) throw Error('Invalid media length');
        if ([...sessions.values()].filter(s => s.owner === owner).length >= 4) throw Error('同时写入的媒体过多');
        await fs.mkdir(directory(), { recursive: true });
        token = crypto.randomUUID();
        const target = destination(payload.id);
        const temporary = path.join(directory(), `.media-${token}.tmp`);
        const handle = await fs.open(temporary, 'wx');
        sessions.set(token, { owner, handle, temporary, target, length: payload.length, written: 0, bytes: 0, busy: false });
        return { success: true, token };
      }
      const entry = sessions.get(token);
      if (!entry || entry.owner !== owner) throw Error('媒体写入会话已失效');
      if (entry.busy) throw Error('媒体写入尚未完成');
      entry.busy = true;
      acquired = true;
      if (payload.action === 'abort') {
        await discard(token);
        return { success: true };
      }
      if (payload.action === 'chunk') {
        const chunk = payload.chunk;
        if (typeof chunk !== 'string' || !chunk.length || chunk.length > 1024 * 1024 || payload.offset !== entry.written || entry.written + chunk.length > entry.length) throw Error('媒体数据块不完整');
        if (!entry.written && !chunk.startsWith('data:')) throw Error('Invalid canvas media');
        const bytes = Buffer.from(chunk, 'utf8');
        let offset = 0;
        while (offset < bytes.length) {
          const result = await entry.handle.write(bytes, offset, bytes.length - offset, entry.bytes + offset);
          if (!result.bytesWritten) throw Error('磁盘写入未取得进展');
          offset += result.bytesWritten;
        }
        entry.written += chunk.length;
        entry.bytes += bytes.length;
        entry.busy = false;
        return { success: true, written: entry.written, total: entry.length };
      }
      if (payload.action !== 'commit' || entry.written !== entry.length) throw Error('媒体尚未完整写入，未提交');
      await entry.handle.sync();
      const stat = await entry.handle.stat();
      if (stat.size !== entry.bytes) throw Error('媒体文件大小校验失败');
      await entry.handle.close();
      await fs.rename(entry.temporary, entry.target);
      sessions.delete(token);
      return { success: true, path: entry.target, bytes: entry.bytes };
    } catch (error) {
      if (acquired) await discard(token);
      return { success: false, error: error.message };
    }
  }
  return { write, async disposeOwner(owner) { for (const [token, entry] of sessions) if (entry.owner === owner) await discard(token); } };
};
