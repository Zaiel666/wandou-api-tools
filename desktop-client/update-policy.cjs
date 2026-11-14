// Metadata and initial URLs must belong to the configured release repository.
// GitHub redirects binary assets to its dedicated, signed download hosts.
module.exports = function createUpdatePolicy(config) {
  const owner = encodeURIComponent(String(config.githubOwner || '').trim());
  const repo = encodeURIComponent(String(config.githubRepository || '').trim());
  const prefix = `/${owner}/${repo}/releases/`;
  function parsed(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) throw Error('更新地址必须使用官方 HTTPS 来源');
    return url;
  }
  function initial(value) {
    const url = parsed(value);
    if (url.hostname === 'github.com' && url.pathname.startsWith(prefix)) return true;
    if (url.hostname === 'api.github.com' && url.pathname.startsWith(`/repos/${owner}/${repo}/releases/`)) return true;
    throw Error('更新地址不属于配置的官方仓库');
  }
  function redirect(value) {
    const url = parsed(value);
    if (['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(url.hostname)) return true;
    return initial(value);
  }
  function metadata(info) {
    if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(info.latestVersion || '')) throw Error('更新版本号无效');
    const asset = String(config.assetName || '');
    const checksum = String(config.checksumAssetName || `${asset}.sha256`);
    if (!asset || /[\\/]/.test(asset)) throw Error('更新文件名无效');
    for (const [value, name] of [[info.downloadUrl, asset], [info.checksumUrl, checksum]]) {
      initial(value);
      const url = parsed(value);
      const tag = url.pathname.split('/').at(-2);
      if (url.hostname !== 'github.com' || !url.pathname.startsWith(`${prefix}download/`) ||
          decodeURIComponent(url.pathname.split('/').at(-1)) !== name || decodeURIComponent(tag).replace(/^v/, '') !== info.latestVersion) throw Error('更新文件与官方版本不匹配');
    }
    for (const value of [info.packageApiUrl, info.checksumApiUrl].filter(Boolean)) {
      initial(value);
      if (!new RegExp(`^/repos/${owner}/${repo}/releases/assets/[0-9]+$`).test(parsed(value).pathname)) throw Error('更新资源 API 地址无效');
    }
    return { ...info, assetName: asset };
  }
  return { initial, redirect, metadata };
};
