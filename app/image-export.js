(function () {
  const extensions = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
    'image/svg+xml': 'svg', 'image/bmp': 'bmp', 'image/tiff': 'tiff', 'image/avif': 'avif',
    'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/wav': 'wav',
    'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'text/plain': 'txt'
  };

  async function readSource(source) {
    let url = String(source || '');
    if (url.startsWith('indexed-media:')) {
      const id = url.slice('indexed-media:'.length);
      url = await window.WandouMediaUrls?.resolve(id) || '';
      if (!url) {
        const stored = await window.wandouShell?.readCanvasMedia?.({ id });
        if (stored?.success) url = stored.value || '';
      }
    }
    if (!/^(?:data:|blob:|https?:|wandou-media:)/i.test(url)) throw new Error('未找到可下载的原图，请重新打开项目后再试');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error('原文件读取失败，请稍后重试');
      const blob = await response.blob();
      if (!blob.size) throw new Error('原文件内容为空');
      return blob;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('原文件读取超时，请稍后重试');
      throw error;
    } finally { clearTimeout(timer); }
  }

  async function fileType(blob, fallback) {
    const bytes = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
    const head = String.fromCharCode(...bytes);
    if (bytes[0] === 137 && head.slice(1, 4) === 'PNG') return 'image/png';
    if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
    if (/^GIF8[79]a/.test(head)) return 'image/gif';
    if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'image/webp';
    if (head.startsWith('BM')) return 'image/bmp';
    if (/^(?:II\*\x00|MM\x00\*)/.test(head)) return 'image/tiff';
    if (head.slice(4, 8) === 'ftyp' && /avif|avis/.test(head.slice(8))) return 'image/avif';
    const type = String(blob.type || '').split(';')[0].toLowerCase();
    if (/^(?:text\/html|application\/json)/.test(type)) throw new Error('服务器没有返回图片文件，请重试');
    return extensions[type] ? type : fallback || type || 'application/octet-stream';
  }

  function outputName(filename, type) {
    let name = String(filename || '豌豆图片').split(/[\\/]/).pop().replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 160) || '豌豆图片';
    const ext = extensions[type];
    if (ext) name = name.replace(/\.(?:png|jpe?g|webp|gif|svg|bmp|tiff?|avif|data|mp4|webm|mp3|wav|ogg|m4a|txt)$/i, '') + '.' + ext;
    return name;
  }

  async function save({ source, blob, filename, mimeType = '' } = {}) {
    try {
      const original = blob || await readSource(source);
      if (!original.size) throw new Error('原文件内容为空');
      const type = await fileType(original, mimeType);
      const name = outputName(filename, type);
      if (window.wandouShell?.saveFileAs) {
        // The native dialog is required on every export. A canceled or failed
        // dialog must never fall through to a remembered directory or download.
        return await window.wandouShell.saveFileAs(name, new Uint8Array(await original.arrayBuffer()), type);
      }
      if (window.wandouShell) return { success: false, error: '请更新桌面版后使用选择位置保存' };
      if (typeof window.showSaveFilePicker === 'function') {
        const ext = extensions[type];
        const handle = await window.showSaveFilePicker({ suggestedName: name,
          ...(ext ? { types: [{ description: '文件', accept: { [type]: ['.' + ext] } }] } : {}) });
        const writable = await handle.createWritable();
        try { await writable.write(original); await writable.close(); }
        catch (error) { await writable.abort().catch(() => {}); throw error; }
        return { success: true, filename: name };
      }
      const url = URL.createObjectURL(original);
      const link = document.createElement('a');
      link.href = url; link.download = name; link.rel = 'noopener';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      return { success: true, started: true, filename: name };
    } catch (error) {
      if (error?.name === 'AbortError') return { success: false, canceled: true };
      return { success: false, error: error?.message || '无法保存文件，请稍后重试' };
    }
  }
  window.WandouImageExport = Object.freeze({ save });
})();
