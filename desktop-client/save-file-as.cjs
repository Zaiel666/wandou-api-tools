const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const MAX_EXPORT_BYTES = 512 * 1024 * 1024;
const formats = [
  ['image/png', 'PNG 图片', ['png']],
  ['image/jpeg', 'JPEG 图片', ['jpg', 'jpeg']],
  ['image/webp', 'WebP 图片', ['webp']],
  ['image/gif', 'GIF 图片', ['gif']],
  ['image/svg+xml', 'SVG 图片', ['svg']],
  ['image/avif', 'AVIF 图片', ['avif']],
  ['image/bmp', 'BMP 图片', ['bmp']],
  ['image/tiff', 'TIFF 图片', ['tif', 'tiff']],
  ['video/mp4', 'MP4 视频', ['mp4']],
  ['video/webm', 'WebM 视频', ['webm']],
  ['video/quicktime', 'QuickTime 视频', ['mov']],
  ['audio/mpeg', 'MP3 音频', ['mp3']],
  ['audio/wav', 'WAV 音频', ['wav']],
  ['audio/x-wav', 'WAV 音频', ['wav']],
  ['audio/ogg', 'OGG 音频', ['ogg']],
  ['audio/mp4', 'M4A 音频', ['m4a']],
  ['audio/flac', 'FLAC 音频', ['flac']],
  ['text/plain', '文本文件', ['txt']],
  ['application/pdf', 'PDF 文件', ['pdf']],
  ['image/vnd.adobe.photoshop', 'Photoshop 文件', ['psd']]
];

function exportName(filename, mimeType) {
  const clean = typeof filename === 'string' ? filename.replace(/\\/g, '/') : '图片';
  const base = path.posix.basename(clean).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 180) || '图片';
  const parsed = path.parse(base);
  const extension = parsed.ext.slice(1).toLowerCase();
  const mime = typeof mimeType === 'string' ? mimeType.toLowerCase().split(';')[0].trim() : '';
  const format = formats.find(item => item[0] === mime) || formats.find(item => item[2].includes(extension));
  const extensions = format?.[2] || [/^[a-z0-9]{1,12}$/.test(extension) && extension !== 'data' ? extension : 'bin'];
  let name = (parsed.name || '图片').replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
  return { filename: `${name || '图片'}.${extensions.includes(extension) ? extension : extensions[0]}`, extensions, label: format?.[1] || '文件' };
}

function exportBytes(input) {
  const length = Array.isArray(input) ? input.length : input instanceof ArrayBuffer || ArrayBuffer.isView(input) ? input.byteLength : 0;
  if (!length) throw new Error('文件内容为空或格式无效，未执行保存');
  if (length > MAX_EXPORT_BYTES) throw new Error('文件超过 512 MB，暂不支持另存为');
  if (Array.isArray(input)) {
    if (!input.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) throw new Error('文件字节无效，未执行保存');
    return Buffer.from(input);
  }
  if (input instanceof ArrayBuffer) return Buffer.from(new Uint8Array(input));
  if (input instanceof Uint8Array) return Buffer.from(input);
  throw new Error('文件字节格式无效，未执行保存');
}

module.exports = function createSaveFileAs({ showSaveDialog, defaultDirectory, fileSystem = fs }) {
  let recentDirectory = '';
  let dialogOpen = false;
  return async function saveFileAs(payload = {}) {
    if (dialogOpen) return { success: false, error: '请先完成当前的另存为操作' };
    dialogOpen = true;
    let temporary = '', handle;
    try {
      const bytes = exportBytes(payload?.bytes);
      const name = exportName(payload?.filename, payload?.mimeType);
      const choice = await showSaveDialog({
        title: '另存为',
        buttonLabel: '保存',
        defaultPath: path.join(recentDirectory || defaultDirectory(), name.filename),
        filters: [{ name: name.label, extensions: name.extensions }],
        properties: ['createDirectory', 'showOverwriteConfirmation']
      });
      if (choice.canceled || !choice.filePath) return { success: false, canceled: true };
      // Only the native dialog may supply a destination. Never append/replace a
      // suffix afterward: that could overwrite a different, unconfirmed file.
      const destination = choice.filePath;
      if (!path.isAbsolute(destination) || !name.extensions.includes(path.extname(destination).slice(1).toLowerCase())) {
        return { success: false, error: `请使用 .${name.extensions[0]} 文件扩展名后重新保存` };
      }
      const existing = await fileSystem.lstat(destination).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error('请选择普通文件作为保存位置');
      const candidate = path.join(path.dirname(destination), `.wandou-export-${randomUUID()}.tmp`);
      handle = await fileSystem.open(candidate, 'wx');
      temporary = candidate;
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close(); handle = null;
      // A failed write or rename leaves the previous destination intact. Do not
      // delete an existing file as a workaround for a failed Windows rename.
      await fileSystem.rename(temporary, destination);
      temporary = '';
      recentDirectory = path.dirname(destination);
      return { success: true, path: destination, filename: path.basename(destination) };
    } catch (error) {
      return { success: false, error: error?.message || '无法保存文件，请重新选择位置' };
    } finally {
      if (handle) await handle.close().catch(() => {});
      if (temporary) await fileSystem.unlink(temporary).catch(() => {});
      dialogOpen = false;
    }
  };
};
