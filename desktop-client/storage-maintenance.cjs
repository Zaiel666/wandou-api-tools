const fs = require('node:fs/promises');
const path = require('node:path');
const same = (a,b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const within = (file,root) => same(file,root) || path.resolve(file).toLowerCase().startsWith(path.resolve(root).toLowerCase()+path.sep);
const projectEntries = new Set(['canvas-media','canvas-backups','local-data','export-artifacts','project-hub-state.json','browser-session','.wandou-project-storage.json','.wandou-migration-manifest.json']);
// This is a file-size inventory, not a decoder, reference scanner or cleanup
// recommendation. Keep every byte in the existing totals and classify only the
// application's known locations/names; unknown files stay visible as "other".
function originalRole(relative) {
  const parts=relative.split(path.sep),name=parts.at(-1);
  if(parts[1]==='.original-recovery' || /^\.recovered-.+\.partial$/i.test(name))return 'recovery';
  if(parts[1]==='.original-metadata' || name==='.publication-key' || name.endsWith('.publish-intent.json'))return 'metadata';
  if(parts.length===2 && /^[a-z0-9_-]{1,100}\.data$/i.test(name))return 'compatibility';
  if(parts.length===3 && parts[1]==='originals' && /^[a-z0-9_-]{1,100}\.(?:png|jpg|webp|gif|bmp|tif|ico|avif|svg)$/i.test(name))return 'standard';
  return 'other';
}

module.exports = function createStorageMaintenance({ projectRoot, profileRoot, sessionRoot, session, confirmClear, isBusy = () => false, limit = 200000, timeoutMs = 15000 }) {
  let scanning = null, clearing = false;
  async function info() {
    if (scanning) return scanning;
    scanning = inspect().finally(() => { scanning = null; });
    return scanning;
  }
  async function inspect() {
    const root = path.resolve(projectRoot()), profile = path.resolve(profileRoot()), browser=path.resolve(sessionRoot?.() || profileRoot());
    const separateSession=!same(browser,profile);
    const sizes = { originals:0, backups:0, projects:0, exports:0, temporary:0, profile:0, browserSession:0 };
    const originalBreakdown={standard:0,compatibility:0,metadata:0,recovery:0,other:0};
    const partialReasons=new Set();
    let count=0, fileCount=0, skipped=0, partial=false; const start=Date.now();
    function incomplete(reason,skip=true){partial=true;partialReasons.add(reason);if(skip)skipped++;}
    function exhausted(){
      if(count>=limit){incomplete('entry-limit',false);return true;}
      if(Date.now()-start>timeoutMs){incomplete('time-limit',false);return true;}
      return false;
    }
    async function walk(directory, categorize, first = true) {
      if(exhausted())return;
      try {
        const stat=await fs.lstat(directory);
        if (stat.isSymbolicLink()) { incomplete('redirected-path'); return; }
        // Check each nested directory too: a replaced ancestor must not redirect
        // a later recursive scan into another location.
        if(!same(await fs.realpath(directory),directory)) { incomplete('redirected-path');return; }
        if(!stat.isDirectory())throw Error('Storage path is not a directory');
        const handle=await fs.opendir(directory);
        for await(const entry of handle) {
          if(exhausted())break;
          count++;const file=path.join(directory,entry.name);
          const category=categorize(file,entry);
          if(category===null)continue;
          if(entry.isSymbolicLink()){incomplete('redirected-path');continue;}
          if(entry.isDirectory())await walk(file,categorize,false);
          else {
            try {
              const st=await fs.lstat(file);
              if(st.isSymbolicLink()){incomplete('redirected-path');continue;}
              if(!st.isFile()){incomplete('unreadable-entry');continue;}
              sizes[category]+=st.size;fileCount++;
              if(category==='originals')originalBreakdown[originalRole(path.relative(root,file))]+=st.size;
            }
            catch(error){incomplete(error.code==='ENOENT'?'changed-during-scan':'unreadable-entry');}
          }
        }
      }catch(error){incomplete(error.code==='ENOENT'?(first?'missing-directory':'changed-during-scan'):'unreadable-entry');}
    }
    await walk(root,(file)=>{
      if(separateSession && within(file,browser))return null;
      const relative=path.relative(root,file),first=relative.split(path.sep)[0];
      if(same(profile,root)&&!projectEntries.has(first))return null;
      if(/\.tmp$/i.test(file))return 'temporary';
      return first==='canvas-media'?'originals':first==='canvas-backups'?'backups':first==='export-artifacts'?'exports':'projects';
    });
    await walk(profile,file=>{
      const first=path.relative(profile,file).split(path.sep)[0];
      // Chromium's HTTP Cache is measured by its own API. IndexedDB, local
      // storage, settings and shader/code caches are never cleanup targets.
      if((first==='Cache'&&!separateSession) || (same(profile,root)&&projectEntries.has(first)))return null;
      return 'profile';
    });
    if(separateSession)await walk(browser,file=>path.relative(browser,file).split(path.sep)[0]==='Cache'?null:'browserSession');
    let cacheBytes=null;
    try{const n=await session().getCacheSize();if(Number.isFinite(n)&&n>=0)cacheBytes=n;else incomplete('cache-unavailable',false);}catch{incomplete('cache-unavailable',false);}
    if(!same(root,projectRoot()) || !same(profile,profileRoot()) || !same(browser,sessionRoot?.() || profileRoot()))incomplete('location-changed',false);
    return { success:true, projectDirectory:root, profileDirectory:profile, browserSessionDirectory:browser, cacheDirectory:path.join(browser,'Cache'), sizes, originalBreakdown, cacheBytes, scannedFiles:count, scannedEntries:count, fileCount, skipped, partial, partialReasons:[...partialReasons], measuredAt:Date.now() };
  }
  async function clearCache() {
    if(clearing || isBusy())return {success:false,error:'请等待生成、原图保存、更新或迁移完成后再清理网络缓存'};
    clearing=true;
    try {
      const accepted=await confirmClear(path.join(path.resolve(sessionRoot?.() || profileRoot()),'Cache'));
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
