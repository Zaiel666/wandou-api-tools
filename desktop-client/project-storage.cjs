const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');

const entries = ['canvas-media', 'canvas-backups', 'local-data', 'export-artifacts', 'project-hub-state.json'];
const markerName = '.wandou-project-storage.json';
const manifestName = '.wandou-migration-manifest.json';
const normalized = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const within = (candidate, root) => normalized(candidate) === normalized(root) || normalized(candidate).startsWith(normalized(root) + path.sep);

module.exports = function createProjectStorage({ legacyRoot, installRoot, onProgress = () => {}, fault = async () => {} }) {
  legacyRoot = path.resolve(legacyRoot); installRoot = path.resolve(installRoot);
  const configPath = path.join(legacyRoot, 'project-storage.json');
  let config = { version: 1, active: null }, invalidConfig = '', initialized = false, unavailableLatched = false;
  let writing = new Set(), frozen = false;
  const selections = new Map();
  try {
    const value = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (value.version !== 1 || (value.active && (!path.isAbsolute(value.active.directory || '') || !/^[a-f0-9-]{36}$/.test(value.active.id || '')))) throw Error('Invalid storage configuration');
    config = value;
  } catch (error) { if (error.code !== 'ENOENT') invalidConfig = '项目存储配置无法读取，请保留现有数据并联系支持，不会自动创建空项目库'; }
  const root = () => config.active?.directory || legacyRoot;
  const progress = (phase, message, extra = {}) => onProgress({ phase, message, ...extra });
  async function atomicJson(file, value) {
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    const handle = await fsp.open(temporary, 'wx');
    try { await handle.writeFile(JSON.stringify(value, null, 2), 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    try { await fault('config-rename', { file, value }); await fsp.rename(temporary, file); }
    catch (error) { await fsp.unlink(temporary).catch(() => {}); throw error; }
  }
  async function saveConfig(value) {
    await fsp.mkdir(legacyRoot, { recursive: true });
    await atomicJson(configPath, value); config = value;
  }
  async function realDirectory(directory) {
    const stat = await fsp.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || normalized(await fsp.realpath(directory)) !== normalized(directory)) throw Error('目录包含链接或重定向，不能作为项目数据位置');
  }
  async function readMarker(directory, id) {
    await realDirectory(directory);
    const file = path.join(directory, markerName), stat = await fsp.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('项目数据目录标记无效');
    const value = JSON.parse(await fsp.readFile(file, 'utf8'));
    if (value.format !== 'wandou-project-storage' || value.id !== id) throw Error('项目数据目录与已选择的位置不匹配');
  }
  function unavailableError(message) { const error=Error(message);error.code='PROJECT_STORAGE_UNAVAILABLE';return error; }
  async function checkConnection() {
    if (invalidConfig) throw unavailableError(invalidConfig);
    if (!config.active) return true;
    try { await readMarker(root(), config.active.id); return true; }
    catch (_error) { throw unavailableError(`项目数据目录暂不可用：${root()}。请连接对应磁盘或恢复该目录后重试；软件不会改用空白项目库。`); }
  }
  async function available() {
    if(unavailableLatched)throw unavailableError(`项目存储曾中断，已暂停项目读写。请恢复 ${root()} 后重新启动，按最近成功保存的版本恢复项目。`);
    try{return await checkConnection();}
    catch(error){if(initialized)unavailableLatched=true;throw error;}
  }
  async function hash(file) {
    const digest = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
    return digest.digest('hex');
  }
  async function inventory(directory) {
    const list = [];
    async function visit(relative) {
      const file = path.join(directory, relative);
      let stat;
      try { stat = await fsp.lstat(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
      if (stat.isSymbolicLink()) throw Error('项目数据包含链接，已停止迁移以保护原数据');
      if (stat.isDirectory()) {
        for (const name of (await fsp.readdir(file)).sort()) await visit(path.join(relative, name));
      } else if (stat.isFile()) {
        // Incomplete writes are never project data. Do not transport abandoned temp files.
        if (relative.endsWith('.tmp')) return;
        list.push({ path: relative.split(path.sep).join('/'), bytes: stat.size, sha256: await hash(file) });
      } else throw Error('项目数据包含非普通文件，已停止迁移');
    }
    for (const entry of entries) await visit(entry);
    return list.sort((a,b) => a.path.localeCompare(b.path));
  }
  async function sizeInfo() {
    await available();
    let sizeBytes = 0, fileCount = 0;
    async function visit(file) {
      let stat;try { stat = await fsp.lstat(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
      if (stat.isSymbolicLink()) throw Error('项目目录包含链接');
      if (stat.isDirectory()) { for (const name of await fsp.readdir(file)) await visit(path.join(file,name)); }
      else if (stat.isFile() && !file.endsWith('.tmp')) { sizeBytes += stat.size; fileCount++; }
    }
    for (const entry of entries) await visit(path.join(root(),entry));
    return { sizeBytes, fileCount };
  }
  async function info() {
    const base = { success: true, currentDirectory: root(), defaultDirectory: legacyRoot, custom: Boolean(config.active), previousDirectory: config.previousDirectory || '', migrationPending: Boolean(config.pending && config.pending.status !== 'failed'), lastMigration: config.lastMigration || null };
    try { return { ...base, available: true, ...await sizeInfo() }; }
    catch (error) { return { ...base, available: false, sizeBytes: null, fileCount: null, error: error.message }; }
  }
  function validateTarget(target) {
    if (!path.isAbsolute(target) || path.basename(target) !== '豌豆AI数据') throw Error('请选择目标磁盘或父目录，软件会在其中建立“豌豆AI数据”');
    if (within(target, installRoot) || within(installRoot, target) || within(target, legacyRoot) || within(legacyRoot, target) || within(target, root()) || within(root(), target)) throw Error('新数据目录不能位于当前项目目录、用户配置目录或软件安装目录内');
    if (target.split(/[\\/]/).some(part => /\.previous-|\.failed-|^wandou-ai-stage-/i.test(part))) throw Error('更新临时目录不能用来存放项目');
  }
  async function checkTarget(target, allowCompletedPending = false) {
    validateTarget(target); await realDirectory(path.dirname(target));
    try {
      await realDirectory(target);
      const children = await fsp.readdir(target);
      if (!children.length) return;
      const pending = config.pending;
      if (allowCompletedPending && pending && normalized(pending.target) === normalized(target)) { await readMarker(target,pending.id); return; }
      throw Error('目标“豌豆AI数据”目录已有内容，请选择其他空目录；现有文件不会被覆盖');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  async function capacity(target, sizeBytes) {
    const stats = await fsp.statfs(path.dirname(target));
    const availableBytes = Math.min(Number.MAX_SAFE_INTEGER, Number(stats.bavail) * Number(stats.bsize));
    const requiredBytes = sizeBytes > 0 ? sizeBytes + Math.max(64*1024*1024, Math.ceil(sizeBytes*0.05)) : 0;
    if (!Number.isFinite(availableBytes) || availableBytes < requiredBytes) throw Error('目标磁盘剩余空间不足，无法安全复制并校验项目数据');
    return { availableBytes, requiredBytes };
  }
  async function reusableCopy(target, sourceFiles) {
    const pending=config.pending;
    if(!pending||normalized(pending.target)!==normalized(target)||pending.source!==root())return null;
    let destination='',published=false;
    try{await readMarker(target,pending.id);destination=target;published=true;}catch(error){
      if(error.code!=='ENOENT' && await fsp.readdir(target).catch(()=>[]).then(items=>items.length))throw error;
      try{await readMarker(pending.stage,pending.id);destination=pending.stage;}catch(_error){return null;}
    }
    let manifest;try{const file=path.join(destination,manifestName),stat=await fsp.lstat(file);if(stat.isSymbolicLink()||!stat.isFile())throw Error('迁移清单无效');manifest=JSON.parse(await fsp.readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT'&&!published)return null;throw error;}
    const files=sourceFiles||await inventory(root());
    if(JSON.stringify(manifest.files)!==JSON.stringify(files)){
      if(published)throw Error('上次迁移副本与现有项目已不同，请保留副本后选择新的空位置');
      return null;
    }
    const copied=await inventory(destination),byPath=new Map(copied.map(item=>[item.path,item]));
    if(published&&JSON.stringify(copied)!==JSON.stringify(files))throw Error('已发布的迁移副本校验失败，仍保留原目录');
    const remainingBytes=files.reduce((total,item)=>{const previous=byPath.get(item.path);return total+(previous?.sha256===item.sha256&&previous.bytes===item.bytes?0:item.bytes)},0);
    return {id:pending.id,destination,published,remainingBytes};
  }
  async function ensureChildDirectory(rootDirectory, childDirectory) {
    await realDirectory(rootDirectory);
    const relative=path.relative(rootDirectory,childDirectory);
    if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('迁移路径超出受管目录');
    let current=rootDirectory;
    for(const part of relative.split(path.sep).filter(Boolean)){
      current=path.join(current,part);
      try{await fsp.mkdir(current);}catch(error){if(error.code!=='EEXIST')throw error;}
      await realDirectory(current);
    }
  }
  async function choose(parent) {
    await available();
    const targetDirectory = path.join(path.resolve(parent), '豌豆AI数据');
    await checkTarget(targetDirectory, true);
    const stats = await sizeInfo(), reusable=await reusableCopy(targetDirectory), disk = await capacity(targetDirectory, reusable?.remainingBytes ?? stats.sizeBytes), selectionToken = crypto.randomUUID();
    selections.clear(); selections.set(selectionToken, { targetDirectory, createdAt: Date.now() });
    return { success:true, currentDirectory:root(), targetDirectory, selectionToken, ...stats, ...disk };
  }
  async function prepare({targetDirectory, selectionToken} = {}) {
    const selected = selections.get(selectionToken);
    if (!selected || selected.targetDirectory !== targetDirectory || Date.now()-selected.createdAt > 30*60*1000) throw Error('目录选择已失效，请重新选择目标位置');
    await available(); await checkTarget(targetDirectory, true);
    const stats = await sizeInfo(), reusable=await reusableCopy(targetDirectory); await capacity(targetDirectory,reusable?.remainingBytes ?? stats.sizeBytes);
    const previous = config.pending;
    const reuse = Boolean(reusable);
    const id = reuse ? previous.id : crypto.randomUUID();
    const pending = { id, source:root(), sourceId:config.active?.id || null, target:targetDirectory, stage:path.join(path.dirname(targetDirectory),`.wandou-project-migration-${id}`), status:'pending', createdAt:Date.now() };
    await saveConfig({ ...config, pending }); selections.clear();
    return { success:true, pending };
  }
  async function migratePending() {
    const pending = config.pending;
    if (!pending || pending.status === 'failed') return { migrated:false };
    const {id,source,target,stage} = pending;
    // Pending paths are validated again after restart, not trusted from JSON alone.
    if (source !== root() || stage !== path.join(path.dirname(target),`.wandou-project-migration-${id}`) || !/^[a-f0-9-]{36}$/.test(id)) throw Error('迁移计划无效，原数据未改变');
    try {
      await available(); await checkTarget(target,true);
      progress('scanning','正在核对原目录，原数据会保留…');
      const manifest = await inventory(source), sizeBytes = manifest.reduce((total,item)=>total+item.bytes,0);
      const reusable=await reusableCopy(target,manifest);
      await capacity(target,reusable?.remainingBytes ?? sizeBytes);
      let completedTarget = false;
      try { await readMarker(target,id); completedTarget = true; } catch(error) { if (error.code !== 'ENOENT' && await fsp.readdir(target).catch(()=>[]).then(items=>items.length)) throw error; }
      const destination = completedTarget ? target : stage;
      if (!completedTarget) {
        try { await fsp.mkdir(stage); await atomicJson(path.join(stage,markerName),{format:'wandou-project-storage',version:1,id,createdAt:Date.now()}); }
        catch(error) { if(error.code !== 'EEXIST')throw error;await readMarker(stage,id); }
      }
      const manifestFile=path.join(destination,manifestName);
      let savedManifest;
      try { savedManifest=JSON.parse(await fsp.readFile(manifestFile,'utf8')); }
      catch(error){if(error.code!=='ENOENT')throw error;}
      if(savedManifest && JSON.stringify(savedManifest.files)!==JSON.stringify(manifest))throw Error('迁移中断后原目录发生了变化；已保留两边数据，请先保留未完成副本再选择新的空位置重试');
      if(!savedManifest)await atomicJson(manifestFile,{version:1,source,files:manifest});
      let completedBytes=0;
      for(const item of manifest){
        const from=path.join(source,item.path),to=path.join(destination,item.path);
        let valid=false;
        try{const stat=await fsp.lstat(to);if(stat.isSymbolicLink()||!stat.isFile())throw Error('迁移目标存在非普通文件');valid=stat.size===item.bytes&&await hash(to)===item.sha256;}catch(error){if(error.code!=='ENOENT')throw error;}
        if(!valid){
          if(completedTarget)throw Error('迁移目标校验失败，仍使用原目录');
          // Validate each parent before descending, so recursive mkdir cannot
          // follow a junction inserted into an interrupted owned stage.
          await ensureChildDirectory(destination,path.dirname(to));
          const temporary=to+`.${crypto.randomUUID()}.tmp`;
          await fsp.copyFile(from,temporary,fs.constants.COPYFILE_EXCL);
          if(await hash(temporary)!==item.sha256)throw Error('文件复制校验失败，原数据未改变');
          const handle=await fsp.open(temporary,'r+');try{await handle.sync();}finally{await handle.close();}
          await fsp.rename(temporary,to);
        }
        completedBytes+=item.bytes;progress('copying','正在复制并校验项目和原图…',{completedBytes,totalBytes:sizeBytes});
        await fault('copied-file',{item,destination});
      }
      if(JSON.stringify(await inventory(destination))!==JSON.stringify(manifest))throw Error('目标目录文件清单校验失败，仍使用原目录');
      if(JSON.stringify(await inventory(source))!==JSON.stringify(manifest))throw Error('原目录在迁移期间发生了变化，请关闭其他版本后重试');
      if(!completedTarget){
        await checkTarget(target);
        // Only an empty, explicitly selected target can be removed for atomic publish.
        try{await fsp.rmdir(target);}catch(error){if(error.code!=='ENOENT')throw error;}
        await fsp.rename(stage,target);
      }
      await fault('before-switch',{source,target});
      const lastMigration={success:true,source,target,completedAt:Date.now(),fileCount:manifest.length,sizeBytes};
      await saveConfig({...config,active:{directory:target,id},previousDirectory:source,pending:null,lastMigration});
      progress('complete','迁移完成，旧目录副本已保留。');
      return {migrated:true,...lastMigration};
    }catch(error){
      const lastMigration={success:false,source,target,error:error.message,completedAt:Date.now()};
      try{await saveConfig({...config,pending:{...pending,status:'failed'},lastMigration});}catch(_error){/* Durable pending remains retryable on restart. */}
      progress('error','迁移未完成，仍使用原目录：'+error.message);
      return {migrated:false,...lastMigration};
    }
  }
  async function initialize(){
    if(initialized)return{migrated:false};
    await available();const result=await migratePending();initialized=true;return result;
  }
  async function read(task){
    await available();
    try{const result=await task();await available();return result;}
    catch(error){await available();throw error;}
  }
  async function write(task){
    if(frozen)throw Error('正在切换项目存储位置，请等待软件重新打开');
    const work=(async()=>{await available();if(frozen)throw Error('正在切换项目存储位置');try{const result=await task();await available();return result;}catch(error){await available();throw error;}})();
    writing.add(work);try{return await work;}finally{writing.delete(work);}
  }
  async function freeze(){frozen=true;await Promise.allSettled([...writing]);}
  return {root,info,choose,prepare,initialize,available,checkConnection,read,write,freeze,unfreeze:()=>{frozen=false;},hasPending:()=>Boolean(config.pending&&config.pending.status!=='failed'),entries:[...entries]};
};
