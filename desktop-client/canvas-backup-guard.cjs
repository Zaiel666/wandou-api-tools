const crypto = require('node:crypto');

function mediaId(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += Math.max(1, Math.floor(value.length / 4096))) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  return `${Math.abs(hash).toString(36)}-${value.length}`;
}
function canonical(value, root = false) {
  if (typeof value === 'string') {
    const runtime = /^wandou-media:\/\/[a-f0-9]{64}\/([A-Za-z0-9_-]{1,100})$/.exec(value);
    if (runtime) return `indexed-media:${runtime[1]}`;
    if (value.startsWith('data:')) return `indexed-media:${mediaId(value)}`;
    return value;
  }
  if (Array.isArray(value)) return value.map(item => canonical(item));
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if ((root && key === 'savedAt') || ['mediaSaveWarnings', 'mediaSourceUrl', 'previewSourceUrl', 'fullSourceUrl',
      'promptRefineLoading', 'promptOptimizeOpen', 'promptOptimizeSuggested'].includes(key)) continue;
    const item = canonical(value[key]);
    // Restore fills absent optional media fields with empty strings/arrays.
    // Clearing a previously populated field still changes the fingerprint.
    if (item === '' || item === undefined || item === null || (Array.isArray(item) && !item.length)) continue;
    result[key] = item;
  }
  return result;
}
function fingerprint(state) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(state, true))).digest('hex');
}

module.exports = function createBackupGuard({ latest, write, keyFor }) {
  const owners = new Map(), heads = new Map(), queues = new Map();
  function ownerRecords(owner) {
    if (!owners.has(owner)) owners.set(owner, new Map());
    return owners.get(owner);
  }
  function rememberRead(owner, payload, result) {
    if (!result?.success) return;
    const entries = payload.allProjects ? result.projectStates || [] : [{ projectId: payload.projectId, states: result.states || [] }];
    for (const entry of entries) {
      const state = [...entry.states].sort((a,b) => Number(b?.savedAt || 0) - Number(a?.savedAt || 0))[0];
      const key = keyFor({ folderId:payload.folderId, projectId:entry.projectId });
      ownerRecords(owner).set(key, state ? fingerprint(state) : '');
    }
  }
  function save(owner, payload) {
    const key = keyFor(payload);
    // Pending pagehide writes can outlive a destroyed webContents. Keep their
    // original baseline in the queued closure, without retaining its global Map.
    const records = ownerRecords(owner);
    const task = (queues.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
      if (!payload.state || !Array.isArray(payload.state.nodes)) return write(payload);
      const baseline = records.get(key);
      const current = await latest(payload);
      const incoming = fingerprint(payload.state);
      const head = heads.get(key);
      // Only reject a proven stale reader after another renderer committed.
      // First opens, migrations and new projects without a baseline remain compatible.
      const stale = baseline !== undefined && current && baseline !== current.fingerprint
        && head && head.owner !== owner && head.fingerprint === current.fingerprint;
      if (stale && incoming !== current.fingerprint) {
        if (incoming === baseline) {
          // Do not advance this reader: its in-memory state is still old.
          return { success:true, path:current.path, savedAt:current.savedAt, unchanged:true, newerVersionPreserved:true };
        }
        return { success:false, conflict:true, error:'另一标签已保存了此项目的新版本。当前标签有不同内容，已保留且未覆盖新版本。请先导出当前项目备份，再重新打开项目查看最新版本。' };
      }
      const result = await write(payload);
      if (result?.success) {
        const committed = result.fingerprint || incoming;
        records.set(key, committed);
        heads.set(key, { owner, fingerprint:committed });
      }
      return result;
    });
    queues.set(key, task);
    task.finally(() => { if (queues.get(key) === task) queues.delete(key); }).catch(() => {});
    return task;
  }
  return { rememberRead, save, disposeOwner: owner => owners.delete(owner) };
};
module.exports.fingerprint = fingerprint;
