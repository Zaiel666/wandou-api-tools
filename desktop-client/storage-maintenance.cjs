const fs = require('node:fs/promises');
const path = require('node:path');
const same = (a,b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const projectEntries = new Set(['canvas-media','canvas-backups','local-data','export-artifacts','project-hub-state.json','.wandou-project-storage.json','.wandou-migration-manifest.json']);

module.exports = function createStorageMaintenance({ projectRoot, profileRoot, session, confirmClear, isBusy = () => false, limit = 200000, timeoutMs = 15000 }) {
  let scanning = null, clearing = false;
  async function info() {
    if (scanning) return scanning;
    scanning = inspect().finally(() => { scanning = null; });
    return scanning;
  }
  async function inspect() {
    const root = path.resolve(projectRoot()), profile = path.resolve(profileRoot());
    const sizes = { originals:0, backups:0, projects:0, exports:0, temporary:0, profile:0 };
    let count=0, skipped=0, partial=false; const start=Date.now();
    async function walk(directory, categorize, first = true) {
      try {
        const stat=await fs.lstat(directory);
        if (stat.isSymbolicLink()) { skipped++; partial=true; return; }
        if(first && !same(await fs.realpath(directory),directory)) { skipped++;partial=true;return; }
        if(!stat.isDirectory())throw Error('Storage path is not a directory');
        const handle=await fs.opendir(directory);
        for await(const entry of handle) {
          if(count>=limit || Date.now()-start>timeoutMs){partial=true;break;}
          count++;const file=path.join(directory,entry.name);
          const category=categorize(file,entry);
          if(category===null)continue;
          if(entry.isSymbolicLink()){skipped++;partial=true;continue;}
          if(entry.isDirectory())await walk(file,categorize,false);
          else {
            try { const st=await fs.lstat(file);if(st.isSymbolicLink()||!st.isFile()){skipped++;partial=true;continue;}sizes[category]+=st.size; }
            catch(error){if(error.code!=='ENOENT'){skipped++;partial=true;}}
          }
        }
      }catch(error){if(error.code!=='ENOENT' || first){skipped++;partial=true;}}
    }
    await walk(root,(file)=>{
      const relative=path.relative(root,file),first=relative.split(path.sep)[0];
      if(same(profile,root)&&!projectEntries.has(first))return null;
      if(/\.tmp$/i.test(file))return 'temporary';
      return first==='canvas-media'?'originals':first==='canvas-backups'?'backups':first==='export-artifacts'?'exports':'projects';
    });
    await walk(profile,file=>{
      const first=path.relative(profile,file).split(path.sep)[0];
      // Chromium's HTTP Cache is measured by its own API. IndexedDB, local
      // storage, settings and shader/code caches are never cleanup targets.
      if(first==='Cache' || (same(profile,root)&&projectEntries.has(first)))return null;
      return 'profile';
    });
    let cacheBytes=null;
    try{const n=await session().getCacheSize();if(Number.isFinite(n)&&n>=0)cacheBytes=n;}catch{partial=true;}
    return { success:true, projectDirectory:root, profileDirectory:profile, cacheDirectory:path.join(profile,'Cache'), sizes, cacheBytes, scannedFiles:count, skipped, partial, measuredAt:Date.now() };
  }
  async function clearCache() {
    if(clearing || isBusy())return {success:false,error:'请等待生成、原图保存、更新或迁移完成后再清理网络缓存'};
    clearing=true;
    try {
      const accepted=await confirmClear(path.join(path.resolve(profileRoot()),'Cache'));
      if(!accepted)return {success:false,canceled:true};
      if(isBusy())return {success:false,error:'当前有任务正在运行，未清理缓存，请稍后重试'};
      const before=await session().getCacheSize();
      // This API clears Chromium HTTP cache only. Never clearStorageData,
      // unlink project files, or recursively remove a renderer-provided path.
      await session().clearCache();
      const after=await session().getCacheSize();
      return {success:true,freedBytes:Math.max(0,before-after),remainingBytes:after};
    }catch(error){return {success:false,error:'网络缓存清理未完成：'+error.message};}
    finally{clearing=false;}
  }
  return {info,clearCache};
};
