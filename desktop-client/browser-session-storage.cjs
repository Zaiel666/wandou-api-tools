'use strict';
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');

// Chromium persistence only. Main-process settings and project/media directories
// deliberately do not participate. Local State travels with encrypted browser
// state; no values inside any browser database are parsed or logged here.
const entries = Object.freeze([
  'IndexedDB', 'Local Storage', 'Session Storage', 'File System', 'Service Worker',
  'blob_storage', 'WebStorage', 'Storage', 'CacheStorage', 'Network',
  'Local State', 'Preferences', 'Secure Preferences', 'Extension State',
  'Local Extension Settings', 'Sync Extension Settings', 'Extension Rules',
  'SharedStorage', 'SharedStorage-wal', 'SharedStorage-shm', 'SharedStorage-journal',
  'DIPS', 'DIPS-wal', 'DIPS-shm', 'DIPS-journal',
  'Cookies', 'Cookies-journal', 'Cookies-wal', 'Cookies-shm',
  'QuotaManager', 'QuotaManager-journal', 'QuotaManager-wal', 'QuotaManager-shm',
  'Trust Tokens', 'Trust Tokens-journal', 'Trust Tokens-wal', 'Trust Tokens-shm',
  'TransportSecurity', 'Reporting and NEL', 'Reporting and NEL-journal',
  'Reporting and NEL-wal', 'Reporting and NEL-shm'
]);
const stateName = 'browser-session-storage.json';
const markerName = '.wandou-browser-session.json';
const importName = '.wandou-browser-import.json';
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const norm = p => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
const same = (a,b) => norm(a) === norm(b);
const activeOperations = new Set();
function failure(code,message) { const e=Error(message); e.code=code; return e; }
function fail(message) { throw failure('BROWSER_SESSION_UNAVAILABLE',message); }
function absolute(p) { if(typeof p!=='string'||!path.isAbsolute(p)||p.includes('\0')) fail('浏览器存储路径无效'); return path.resolve(p); }
function child(root,relative) {
  if(typeof relative!=='string'||relative.includes('\\')||relative.split('/').some(x=>!x||x==='.'||x==='..'||/[\0:]/.test(x)||/[. ]$/.test(x))) fail('浏览器存储清单路径无效');
  const p=path.resolve(root,...relative.split('/'));
  if(!norm(p).startsWith(norm(root)+path.sep)) fail('浏览器存储路径越界');
  return p;
}
async function exists(p) { try { await fsp.lstat(p); return true; } catch(e) { if(e.code==='ENOENT')return false; throw e; } }
async function realDirectory(p) {
  const s=await fsp.lstat(p);
  if(!s.isDirectory()||s.isSymbolicLink()||!same(await fsp.realpath(p),p)) fail('浏览器存储目录包含链接或重定向');
}
async function ordinaryFile(p) {
  const s=await fsp.lstat(p);
  if(!s.isFile()||s.isSymbolicLink()||!same(await fsp.realpath(p),p)) fail('浏览器存储文件包含链接或不是普通文件');
  return s;
}
async function hashFile(p) {
  const before=await ordinaryFile(p),h=crypto.createHash('sha256');
  for await(const chunk of fs.createReadStream(p))h.update(chunk);
  const after=await ordinaryFile(p);
  if(before.size!==after.size||before.ino!==after.ino||before.dev!==after.dev||before.mtimeMs!==after.mtimeMs) fail('浏览器存储仍在变化，请完全退出应用后重试');
  return {bytes:after.size,sha256:h.digest('hex')};
}
async function readJson(p) { const stat=await ordinaryFile(p);if(stat.size>128*1024*1024)fail('浏览器存储状态文件异常过大');return JSON.parse(await fsp.readFile(p,'utf8')); }
async function mkdirChild(root,relative) {
  await realDirectory(root); let current=root;
  for(const part of relative.split('/').filter(Boolean)){
    current=child(current,part);try{await fsp.mkdir(current);}catch(e){if(e.code!=='EEXIST')throw e;}await realDirectory(current);
  }
}
async function snapshot(root,selectedEntries=entries) {
  await realDirectory(root); const files=[],directories=[],present=[];
  async function visit(relative) {
    const p=child(root,relative),s=await fsp.lstat(p);
    if(s.isSymbolicLink())fail('浏览器存储含链接，已停止复制以保护原库');
    if(s.isDirectory()){
      await realDirectory(p); directories.push(relative);
      for(const name of (await fsp.readdir(p)).sort())await visit(relative+'/'+name);
    }else if(s.isFile())files.push({path:relative,...await hashFile(p)});
    else fail('浏览器存储含非普通文件');
    if(files.length+directories.length>200000)fail('浏览器存储文件数超出安全处理范围');
  }
  for(const entry of selectedEntries)if(await exists(path.join(root,entry))){present.push(entry);await visit(entry);}
  files.sort((a,b)=>a.path.localeCompare(b.path));directories.sort();present.sort();
  return {present,directories,files,bytes:files.reduce((n,f)=>n+f.bytes,0)};
}
const snapshotBytes = value => JSON.stringify(value);
function validateSnapshot(s) {
  if(!s||!Array.isArray(s.files)||!Array.isArray(s.directories)||!Array.isArray(s.present)||!Number.isSafeInteger(s.bytes)||s.bytes<0)fail('浏览器迁移清单无效');
  const all=new Set();let bytes=0;
  for(const e of s.present)if(!entries.includes(e))fail('浏览器迁移清单含未授权数据');
  for(const rel of [...s.directories,...s.files.map(f=>f.path)]){child(path.resolve('/validation'),rel);if(!entries.includes(rel.split('/')[0])||all.has(rel))fail('浏览器迁移清单含未知或重复路径');all.add(rel);}
  for(const f of s.files){if(!Number.isSafeInteger(f.bytes)||f.bytes<0||!/^[a-f0-9]{64}$/.test(f.sha256))fail('浏览器迁移文件校验项无效');bytes+=f.bytes;}
  if(bytes!==s.bytes||!Number.isSafeInteger(bytes))fail('浏览器迁移容量无效');
  return s;
}

module.exports = function createBrowserSessionStorage({legacyProfileRoot,projectRoot,assertInactive,onProgress=()=>{},fault=async()=>{},diskFree}={}) {
  legacyProfileRoot=absolute(legacyProfileRoot);
  if(typeof projectRoot!=='function'||typeof assertInactive!=='function')throw TypeError('projectRoot and assertInactive callbacks are required');
  const statePath=path.join(legacyProfileRoot,stateName);
  let lastInfo=null;
  async function guard(extra) {
    if(await assertInactive()!==true)fail('必须取得应用单实例锁并关闭所有业务会话后才能处理浏览器存储');
    if(extra&&await extra()!==true)fail('应用尚未完全关闭，不能准备旧版回退');
  }
  async function exclusive(operation,extra) {
    await guard(extra); const key=norm(legacyProfileRoot);
    if(activeOperations.has(key))throw failure('BROWSER_SESSION_BUSY','另一个浏览器存储事务正在执行');
    activeOperations.add(key);
    try { await realDirectory(legacyProfileRoot);return await operation(); }
    finally {activeOperations.delete(key);}
  }
  async function atomicJson(file,value,phase='metadata') {
    await realDirectory(path.dirname(file));
    if(await exists(file))await ordinaryFile(file);
    const old=await exists(file)?digest(await fsp.readFile(file)):null;
    const temp=file+'.'+crypto.randomUUID()+'.tmp';
    const h=await fsp.open(temp,'wx');try{await h.writeFile(JSON.stringify(value,null,2),'utf8');await h.sync();}finally{await h.close();}
    await fault('before-'+phase+'-rename',{file});
    if(await exists(file)){await ordinaryFile(file);if(old===null||digest(await fsp.readFile(file))!==old)fail('浏览器存储状态被并发修改，已保留两份数据');}
    else if(old!==null)fail('浏览器存储状态在写入时丢失');
    await fsp.rename(temp,file);
  }
  async function state() {
    if(!await exists(statePath))return null;
    let s;try{s=await readJson(statePath);}catch(e){fail('浏览器存储状态无法读取；不会改用空库');}
    if(s?.format!=='wandou-browser-session-route'||s.version!==1||!uuid.test(s.id)||!['pending','active','rollback-pending','rollback-prepared','legacy-ready'].includes(s.status)||!same(s.legacyProfileRoot||'',legacyProfileRoot))fail('浏览器存储状态无效；不会改用旧快照或空库');
    return s;
  }
  async function selectedRoot() {
    const root=absolute(projectRoot());await realDirectory(root);
    const target=path.join(root,'browser-session');
    if(same(target,legacyProfileRoot)||norm(legacyProfileRoot).startsWith(norm(target)+path.sep))fail('浏览器会话目录与原配置目录不能互相包含');
    for(const entry of entries){const sourceEntry=path.join(legacyProfileRoot,entry);if(same(root,sourceEntry)||norm(root).startsWith(norm(sourceEntry)+path.sep))fail('目标目录不能位于正在复制的浏览器库内部');}
    return {root,target};
  }
  async function capacity(parent,bytes) {
    const available=diskFree?await diskFree(parent):await fsp.statfs(parent).then(s=>Number(s.bavail)*Number(s.bsize));
    const required=bytes+Math.max(64*1024*1024,Math.ceil(bytes*.05));
    if(!Number.isFinite(available)||available<required)throw failure('BROWSER_SESSION_NO_SPACE','目标磁盘空间不足，原浏览器库仍然保留');
    await fault('capacity-checked',{bytes,availableBytes:available,requiredBytes:required});
    return {availableBytes:available,requiredBytes:required};
  }
  async function verify(root,expected) {
    const actual=await snapshot(root);
    if(snapshotBytes(actual)!==snapshotBytes(expected))fail('浏览器库完整性校验失败；不会打开不完整的库');
    return actual;
  }
  async function copy(source,destination,manifest) {
    await realDirectory(source);await realDirectory(destination);
    for(const relative of manifest.directories)await mkdirChild(destination,relative);
    let completedBytes=0;
    for(const item of manifest.files){
      const from=child(source,item.path),to=child(destination,item.path);
      await ordinaryFile(from);await realDirectory(path.dirname(to));
      await fault('before-copy-file',{relative:item.path,bytes:item.bytes});
      const h=await fsp.open(to,'wx');
      try{
        let offset=0;
        for await(const chunk of fs.createReadStream(from,{highWaterMark:256*1024})){
          let written=0;while(written<chunk.length){const r=await h.write(chunk,written,chunk.length-written,offset+written);if(!r.bytesWritten)throw Error('Short browser-session write');written+=r.bytesWritten;}
          offset+=chunk.length;await fault('copy-chunk',{relative:item.path,bytes:offset});
        }
        await h.sync();
      }finally{await h.close();}
      const checked=await hashFile(to);
      if(checked.bytes!==item.bytes||checked.sha256!==item.sha256)fail('浏览器库复制校验失败，原件未改变');
      completedBytes+=item.bytes;onProgress({phase:'copying-browser-session',completedBytes,totalBytes:manifest.bytes});
      await fault('after-copy-file',{relative:item.path,bytes:item.bytes});
    }
    await verify(destination,manifest);
  }
  async function marker(target,id) {
    await realDirectory(target);const m=await readJson(path.join(target,markerName));
    if(m.format!=='wandou-browser-session'||m.version!==1||m.id!==id||m.ready!==true)fail('已选择的浏览器库标记不匹配；不会自动重新导入旧库');
    return m;
  }
  async function loadImport(target,id) {
    const m=await marker(target,id),plan=await readJson(path.join(target,importName));
    validateSnapshot(plan.snapshot);
    if(plan.id!==id||plan.format!=='wandou-browser-import'||!same(plan.source,legacyProfileRoot)||digest(snapshotBytes(plan.snapshot))!==m.manifestSha256)fail('浏览器库迁移清单不匹配');
    return plan.snapshot;
  }
  async function prepare() {return exclusive(async()=>{
    const {root,target}=await selectedRoot();let s=await state();
    if(s?.status==='rollback-pending'||s?.status==='rollback-prepared')fail('浏览器库已进入旧版回退流程，请完成或恢复该事务后再启动新版');
    if(s?.status==='legacy-ready'){
      // v225 may now have added records in C. C is authoritative after a
      // completed rollback; never return the earlier G snapshot on upgrade.
      const p=await rollbackPlan(s);await marker(target,s.id);await verify(target,p.plan.latest);
      s={format:'wandou-browser-session-route',version:1,id:crypto.randomUUID(),status:'pending',legacyProfileRoot,source:legacyProfileRoot,target,createdAt:Date.now(),returnPreviousId:s.id,returnRollbackId:s.rollbackId,returnPlanSha256:s.rollbackPlanSha256,returnRollbackSource:s.rollbackSource,returnArchiveId:crypto.randomUUID()};
      await atomicJson(statePath,s,'state');
    }
    if(s?.status==='active'){
      await marker(target,s.id); // No re-import, including after a missing disk.
      lastInfo={sessionPath:target,id:s.id,migrated:false,resumed:false,status:'active'};return lastInfo;
    }
    if(s?.status==='pending'&&(!same(s.target||'',target)||!same(s.source||'',legacyProfileRoot)))fail('浏览器库迁移中数据目录发生变化，请恢复原路径后重试');
    if(s?.returnPreviousId){
      if(!uuid.test(s.returnPreviousId)||!uuid.test(s.returnArchiveId))fail('旧版返回迁移状态无效');
      const p=await rollbackPlan({...s,id:s.returnPreviousId,rollbackId:s.returnRollbackId,rollbackPlanSha256:s.returnPlanSha256,rollbackSource:s.returnRollbackSource});
      const archived=path.join(root,'.browser-session-before-rollback-'+s.returnArchiveId);
      if(await exists(archived)){await marker(archived,s.returnPreviousId);await verify(archived,p.plan.latest);}
      if(await exists(target)){
        const m=await readJson(path.join(target,markerName));
        if(m.id===s.returnPreviousId){
          await marker(target,s.returnPreviousId);await verify(target,p.plan.latest);
          if(await exists(archived))fail('旧版返回归档目录冲突，原库全部保留');
          await fault('before-retire-old-session',{target,archived});await fsp.rename(target,archived);
        }else if(m.id!==s.id)fail('旧版返回时存在未知浏览器库，未覆盖');
      }else if(!await exists(archived))fail('旧版返回前的原浏览器库丢失，已停止导入');
    }
    const resumed=Boolean(s);
    const id=s?.id||crypto.randomUUID(),sourceSnapshot=await snapshot(legacyProfileRoot);
    if(await exists(target)){
      if(!s)fail('目标 browser-session 已有内容，未覆盖未知浏览器库');
      const expected=await loadImport(target,id);await verify(target,expected);await verify(legacyProfileRoot,expected);
      await atomicJson(statePath,{...s,status:'active',activatedAt:Date.now()},'state');
      lastInfo={sessionPath:target,id,migrated:true,resumed:true,status:'active',files:expected.files.length,bytes:expected.bytes};return lastInfo;
    }
    await capacity(root,sourceSnapshot.bytes);
    // A retry always gets a new stage. Interrupted or edited stage files remain
    // untouched for recovery; a partial database is never reused as a live DB.
    const attempt=crypto.randomUUID(),stage=path.join(root,'.browser-session-stage-'+attempt);
    s={...s,format:'wandou-browser-session-route',version:1,id,status:'pending',legacyProfileRoot,source:legacyProfileRoot,target,stage,attempt,createdAt:s?.createdAt||Date.now()};
    await atomicJson(statePath,s,'state');await fsp.mkdir(stage);await realDirectory(stage);
    await atomicJson(path.join(stage,importName),{format:'wandou-browser-import',version:1,id,source:legacyProfileRoot,snapshot:sourceSnapshot},'manifest');
    await copy(legacyProfileRoot,stage,sourceSnapshot);
    await fault('before-source-recheck',{});await verify(legacyProfileRoot,sourceSnapshot);
    await atomicJson(path.join(stage,markerName),{format:'wandou-browser-session',version:1,id,ready:true,manifestSha256:digest(snapshotBytes(sourceSnapshot)),createdAt:Date.now()},'marker');
    await guard();await realDirectory(root);await fault('before-publish',{target});
    if(await exists(target))fail('目标浏览器库在复制期间出现，未覆盖任何已有内容');
    await fsp.rename(stage,target);await fault('after-publish',{target});
    await marker(target,id);await verify(target,sourceSnapshot);await verify(legacyProfileRoot,sourceSnapshot);
    await atomicJson(statePath,{...s,status:'active',activatedAt:Date.now()},'state');
    lastInfo={sessionPath:target,id,migrated:true,resumed,status:'active',files:sourceSnapshot.files.length,bytes:sourceSnapshot.bytes};return lastInfo;
  });}
  function subset(s,entry){return {present:s.present.includes(entry)?[entry]:[],directories:s.directories.filter(p=>p===entry||p.startsWith(entry+'/')),files:s.files.filter(f=>f.path===entry||f.path.startsWith(entry+'/')),bytes:s.files.filter(f=>f.path===entry||f.path.startsWith(entry+'/')).reduce((n,f)=>n+f.bytes,0)};}
  async function verifyEntry(root,expected,entry) {
    const actual=await snapshot(root,[entry]);
    if(snapshotBytes(subset(actual,entry))!==snapshotBytes(subset(expected,entry)))fail('浏览器回退集合被修改，已停止以保护两边数据');
  }
  async function rollbackPlan(s) {
    if(!uuid.test(s.rollbackId||''))fail('浏览器回退事务无效');
    const transaction=path.join(legacyProfileRoot,'.browser-session-rollback-'+s.rollbackId);
    await realDirectory(transaction);const plan=await readJson(path.join(transaction,'plan.json'));
    if(plan.format!=='wandou-browser-session-rollback'||plan.id!==s.rollbackId||plan.sessionId!==s.id||!same(plan.legacyProfileRoot,legacyProfileRoot)||!same(plan.source,s.rollbackSource))fail('浏览器回退清单不匹配');
    if(!same(plan.source,path.join(absolute(projectRoot()),'browser-session')))fail('浏览器回退源与当前受管项目目录不匹配');
    validateSnapshot(plan.old);validateSnapshot(plan.latest);
    if(digest(JSON.stringify(plan))!==s.rollbackPlanSha256)fail('浏览器回退清单校验失败');
    const latest=path.join(transaction,'latest'),previous=path.join(transaction,'previous');
    await realDirectory(latest);await realDirectory(previous);
    return {transaction,plan,latest,previous};
  }
  async function restoreOld(s,p) {
    // The application-wide singleton must remain held during this entire set
    // operation, including error recovery. Newer prepare() also fails closed.
    await realDirectory(legacyProfileRoot);await realDirectory(p.previous);await realDirectory(p.latest);
    // Validate the entire remaining plan before moving even its first entry.
    // An old program may have written C after a lost parent; abort must not
    // hide those newer records or leave an avoidable old/new partial mixture.
    for(const entry of entries){
      const current=path.join(legacyProfileRoot,entry),old=path.join(p.previous,entry),newFile=path.join(p.latest,entry);
      if(await exists(old)){
        await verifyEntry(p.previous,p.plan.old,entry);
        if(await exists(current)){await verifyEntry(legacyProfileRoot,p.plan.latest,entry);if(await exists(newFile))fail('浏览器回退恢复目标冲突');}
      }else if(p.plan.old.present.includes(entry))await verifyEntry(legacyProfileRoot,p.plan.old,entry);
      else if(await exists(current)){await verifyEntry(legacyProfileRoot,p.plan.latest,entry);if(await exists(newFile))fail('浏览器回退恢复目标冲突');}
    }
    for(const entry of entries){
      await realDirectory(legacyProfileRoot);await realDirectory(p.previous);await realDirectory(p.latest);
      const current=path.join(legacyProfileRoot,entry),old=path.join(p.previous,entry),newFile=path.join(p.latest,entry);
      if(await exists(old)){
        await verifyEntry(p.previous,p.plan.old,entry);
        if(await exists(current)){
          await verifyEntry(legacyProfileRoot,p.plan.latest,entry);
          if(await exists(newFile))fail('浏览器回退恢复目标冲突；保留现场，请勿启动旧版');
          await fsp.rename(current,newFile);
        }
        await fsp.rename(old,current);
      }else if(p.plan.old.present.includes(entry))await verifyEntry(legacyProfileRoot,p.plan.old,entry);
      else if(await exists(current)){
        await verifyEntry(legacyProfileRoot,p.plan.latest,entry);
        if(await exists(newFile))fail('浏览器回退恢复目标冲突');
        await fsp.rename(current,newFile);
      }
      await fault('rollback-after-restore-entry',{entry});
    }
    await verify(legacyProfileRoot,p.plan.old);
    await atomicJson(statePath,{format:'wandou-browser-session-route',version:1,id:s.id,status:'active',legacyProfileRoot,target:s.target,restoredRollback:s.rollbackId,restoredAt:Date.now()},'state');
  }
  async function prepareLegacyRollback({assertApplicationClosed}={}) {
    if(typeof assertApplicationClosed!=='function')throw TypeError('A native offline/single-instance closure is required');
    return exclusive(async()=>{
      let s=await state();if(!s||!['active','rollback-pending','rollback-prepared','legacy-ready'].includes(s.status))fail('浏览器会话尚未完成迁移，不能准备旧版回退');
      if(s.status==='rollback-prepared'||s.status==='legacy-ready'){
        const p=await rollbackPlan(s);await verify(legacyProfileRoot,p.plan.latest);
        return {success:true,status:s.status,receipt:receiptFor(s),alreadyPrepared:true,id:s.id,legacyBackupPath:p.previous,files:p.plan.latest.files.length,bytes:p.plan.latest.bytes};
      }
      if(s.status==='rollback-pending'){
        fail('上次浏览器回退事务中断，请先核对程序版本并显式恢复或完成，不能自动选择旧库');
      }
      const {target}=await selectedRoot();await marker(target,s.id);
      const latestSnapshot=await snapshot(target),oldSnapshot=await snapshot(legacyProfileRoot);
      await capacity(legacyProfileRoot,latestSnapshot.bytes);
      const rollbackId=crypto.randomUUID(),transaction=path.join(legacyProfileRoot,'.browser-session-rollback-'+rollbackId);
      await fsp.mkdir(transaction);const latest=path.join(transaction,'latest'),previous=path.join(transaction,'previous');await fsp.mkdir(latest);await fsp.mkdir(previous);
      const plan={format:'wandou-browser-session-rollback',version:1,id:rollbackId,sessionId:s.id,legacyProfileRoot,source:target,old:oldSnapshot,latest:latestSnapshot};
      await atomicJson(path.join(transaction,'plan.json'),plan,'rollback-plan');
      await copy(target,latest,latestSnapshot);await verify(target,latestSnapshot);await verify(legacyProfileRoot,oldSnapshot);
      const pending={...s,status:'rollback-pending',rollbackId,rollbackSource:target,rollbackPlanSha256:digest(JSON.stringify(plan))};
      await atomicJson(statePath,pending,'state');
      const p={transaction,plan,latest,previous};
      try{
        await guard(assertApplicationClosed);
        // First retain the complete old set. Nothing from the latest set is
        // published until all old stores are safely backed up.
        for(const entry of oldSnapshot.present){await verifyEntry(legacyProfileRoot,oldSnapshot,entry);await fsp.rename(path.join(legacyProfileRoot,entry),path.join(previous,entry));await fault('rollback-after-backup',{entry});}
        await verify(previous,oldSnapshot);
        for(const entry of latestSnapshot.present){await guard(assertApplicationClosed);if(await exists(path.join(legacyProfileRoot,entry)))fail('旧配置中出现未知同名浏览器数据，未覆盖');await fsp.rename(path.join(latest,entry),path.join(legacyProfileRoot,entry));await fault('rollback-after-publish',{entry});}
        await verify(legacyProfileRoot,latestSnapshot);await verify(target,latestSnapshot);
        await atomicJson(statePath,{...pending,status:'rollback-prepared',preparedAt:Date.now()},'state');
        return {success:true,status:'rollback-prepared',receipt:receiptFor(pending),id:s.id,legacyBackupPath:previous,files:latestSnapshot.files.length,bytes:latestSnapshot.bytes};
      }catch(error){
        try{await guard(assertApplicationClosed);await restoreOld(pending,p);}catch(recovery){throw failure('BROWSER_SESSION_ROLLBACK_RECOVERY_REQUIRED','浏览器回退未完成且恢复受阻；请保持应用关闭并保留事务目录，不要直接运行旧版。');}
        throw error;
      }
    },assertApplicationClosed);
  }
  function receiptFor(s){return {version:1,rollbackId:s.rollbackId,sessionId:s.id,planSha256:s.rollbackPlanSha256};}
  function checkReceipt(s,receipt){if(!receipt||receipt.version!==1||receipt.rollbackId!==s.rollbackId||receipt.sessionId!==s.id||receipt.planSha256!==s.rollbackPlanSha256)fail('浏览器回退凭据不匹配，未改动任何库');}
  async function getReceipt(){const s=await state();return s&&['rollback-pending','rollback-prepared','legacy-ready'].includes(s.status)?receiptFor(s):null;}
  async function finishLegacyRollback({assertApplicationClosed,receipt}={}){
    if(typeof assertApplicationClosed!=='function')throw TypeError('A native offline/single-instance closure is required');
    return exclusive(async()=>{
      const s=await state();if(!s||!['rollback-prepared','legacy-ready'].includes(s.status))fail('浏览器旧版回退尚未完整准备');checkReceipt(s,receipt);
      const p=await rollbackPlan(s);await verify(p.previous,p.plan.old);await marker(p.plan.source,s.id);await verify(p.plan.source,p.plan.latest);
      const authoritative=await snapshot(legacyProfileRoot);
      if(p.plan.latest.files.length&&authoritative.files.length===0)fail('当前旧版浏览器库意外为空，不能确认回退完成');
      const authorityHash=digest(snapshotBytes(authoritative)),changed=snapshotBytes(authoritative)!==snapshotBytes(p.plan.latest);
      // The external native maintenance guard must verify old-program hashes
      // before finishing. Parent exit alone never chooses finish or abort.
      // If the parent vanished after installing v225, C may contain newer v225
      // records. Explicit finish accepts that current set, never overwrites it.
      await atomicJson(path.join(p.transaction,'legacy-authority.json'),{version:1,rollbackId:s.rollbackId,snapshot:authoritative},'legacy-authority');
      await atomicJson(statePath,{...s,status:'legacy-ready',finishedAt:Date.now(),legacyAuthoritySha256:authorityHash},'state');
      return {success:true,status:'legacy-ready',receipt:receiptFor(s),legacyBackupPath:p.previous,legacyChangesObserved:changed,legacyAuthoritySha256:authorityHash};
    },assertApplicationClosed);
  }
  async function abortLegacyRollback({assertApplicationClosed,receipt}={}){
    if(typeof assertApplicationClosed!=='function')throw TypeError('A native offline/single-instance closure is required');
    return exclusive(async()=>{
      const s=await state();if(!s||!['rollback-pending','rollback-prepared'].includes(s.status))fail('当前浏览器回退不能取消；请保留可能已产生的新数据');checkReceipt(s,receipt);
      const p=await rollbackPlan(s);await restoreOld(s,p);
      return {success:true,status:'active',receipt};
    },assertApplicationClosed);
  }
  return {prepare,prepareLegacyRollback,getReceipt,finishLegacyRollback,abortLegacyRollback,info:()=>lastInfo,sessionDirectoryName:'browser-session'};
};
module.exports.entries=entries;
module.exports.stateName=stateName;
module.exports.markerName=markerName;
module.exports.snapshot=snapshot;
