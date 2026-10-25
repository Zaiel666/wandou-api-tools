const fs = require('node:fs/promises');
const path = require('node:path');

// References identify an existing managed image; a renderer never supplies a path.
const storedPattern = /^indexed-media:([A-Za-z0-9_-]{1,100})$/;
const runtimePattern = /^wandou-media:\/\/[a-f0-9]{64}\/([A-Za-z0-9_-]{1,100})$/;
const normalizedPath = value => process.platform === 'win32' ? value.toLowerCase() : value;

module.exports = function createCanvasMediaLocation({ directory, getUrl, showItemInFolder }) {
  async function get(ref) {
    if (typeof ref !== 'string' || ref.length > 256) {
      return { success: false, unsupported: true, error: '此图片没有可定位的本地原图存储文件' };
    }
    const stored = storedPattern.exec(ref), runtime = runtimePattern.exec(ref);
    const id = stored?.[1] || runtime?.[1];
    if (!id) return { success: false, unsupported: true, error: '此图片尚未保存在桌面原图库中' };
    try {
      const root = path.resolve(directory());
      const rootStat = await fs.lstat(root);
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Invalid media root');
      const realRoot = await fs.realpath(root);
      if (normalizedPath(realRoot) !== normalizedPath(root)) throw new Error('Redirected media root');
      const filename = `${id}.data`, file = path.join(root, filename);
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid media file');
      const realFile = await fs.realpath(file);
      if (normalizedPath(path.relative(realRoot, realFile)) !== normalizedPath(filename)) throw new Error('Media outside managed directory');
      // Existing protocol validation reads only the small data-URL header and
      // rejects video/invalid files. A runtime reference must match this session.
      const info = await getUrl(id);
      if (!info?.success) return { success: false, missing: Boolean(info?.missing), unsupported: Boolean(info?.unsupported), error: '本地原图不存在或不是受支持的图片存储文件' };
      if (runtime && info.url !== ref) return { success: false, unsupported: true, error: '此图片引用已过期，请重新打开项目后再试' };
      return { success: true, path: file, directory: root, filename, storageFormat: 'data-url' };
    } catch (error) {
      return { success: false, missing: error.code === 'ENOENT', error: error.code === 'ENOENT' ? '未找到本地原图存储文件，可能尚未归档或文件已移走' : '无法安全定位此原图存储文件' };
    }
  }
  async function show(ref) {
    const location = await get(ref);
    if (!location.success) return location;
    try {
      await showItemInFolder(location.path);
      return { ...location, shown: true };
    } catch (_error) {
      return { ...location, success: false, error: '无法打开原图所在文件夹，请稍后重试' };
    }
  }
  return { get, show };
};
