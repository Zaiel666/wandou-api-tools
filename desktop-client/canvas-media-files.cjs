'use strict';
// Shared by the main-process coordinator and its isolated I/O workers. Original
// data-URL files remain the compatibility/rollback copy; never rewrite them.
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const MAX_BYTES = 512 * 1024 * 1024;
const RESERVE_BYTES = 64 * 1024 * 1024;
const extensions = Object.freeze({ 'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','image/bmp':'bmp','image/tiff':'tif','image/x-icon':'ico','image/avif':'avif','image/svg+xml':'svg' });
const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(id);
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const samePath = (a,b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
function problem(message, code) { return Object.assign(new Error(message), {code}); }
async function realDirectory(root) {
  root = path.resolve(root);
  const stat = await fsp.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(await fsp.realpath(root),root)) throw problem('原图库路径含链接或重定向，已停止处理','UNSAFE_MEDIA_PATH');
  return root;
}
async function ordinaryFile(file, max = MAX_BYTES) {
  const stat = await fsp.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || !samePath(await fsp.realpath(file),path.resolve(file))) throw problem('原图文件路径不安全','UNSAFE_MEDIA_PATH');
  if (stat.size > max) throw problem('原图超过本次安全处理上限，兼容原件保持不变','MEDIA_TOO_LARGE');
  return stat;
}
function names(root,id,extension) {
  if (!validId(id)) throw problem('原图标识无效','INVALID_MEDIA_ID');
  return { legacy:path.join(root,id+'.data'), originals:path.join(root,'originals'), records:path.join(root,'.original-metadata'),
    metadata:path.join(root,'.original-metadata',id+'.json'), standard:extension ? path.join(root,'originals',id+'.'+extension) : null };
}
async function readLegacy(root,id) {
  await realDirectory(root);const file=names(root,id).legacy;await ordinaryFile(file);
  const value=await fsp.readFile(file,'utf8');
  if(!value.startsWith('data:'))throw problem('原图兼容文件不是有效的数据引用','INVALID_MEDIA');
  if(id.startsWith('sha256-') && id!=='sha256-'+digest(Buffer.from(value,'utf8')))throw problem('原图内容校验失败','MEDIA_CHECKSUM');
  return value;
}
function decodeDataUrl(value,id) {
  if(typeof value!=='string' || Buffer.byteLength(value,'utf8')>MAX_BYTES)throw problem('原图数据过大或无效','MEDIA_TOO_LARGE');
  if(id && id.startsWith('sha256-') && id!=='sha256-'+digest(Buffer.from(value,'utf8')))throw problem('原图内容校验失败','MEDIA_CHECKSUM');
  const comma=value.indexOf(','),header=value.slice(0,comma),mime=/^data:(image\/[a-z0-9.+-]+)(?:;[^,]*)?$/i.exec(header)?.[1]?.toLowerCase();
  if(comma<0 || comma>1024 || !mime)throw problem('此类型保留兼容原件，不转换为标准图片','UNSUPPORTED_MEDIA');
  const body=value.slice(comma+1),base64=/;base64(?:;|$)/i.test(header);
  let bytes;
  if(base64) {
    if(!/^[A-Za-z0-9+/_=\s-]*$/.test(body))throw problem('原图 Base64 编码无效','INVALID_MEDIA');
    bytes=Buffer.from(body,'base64');
  } else { try{bytes=Buffer.from(decodeURIComponent(body),'utf8');}catch{throw problem('原图 URL 编码无效','INVALID_MEDIA');} }
  if(!bytes.length)throw problem('原图为空','INVALID_MEDIA');
  return {bytes,mime,header,canonicalBase64:base64 && body===bytes.toString('base64'),sourceSha256:digest(Buffer.from(value,'utf8'))};
}
function safeSvg(bytes) {
  if(bytes.length>16*1024*1024)return false;
  const original=bytes.toString('utf8');
  if(!Buffer.from(original,'utf8').equals(bytes))return false;
  const declaration=/^\uFEFF?\s*<\?xml\s+([^?]*)\?>/i.exec(original);
  if(declaration){
    let attrs=declaration[1].trim(),seen=new Set();
    while(attrs){const attr=/^(version|encoding|standalone)\s*=\s*(["'])(.*?)\2\s*/.exec(attrs);if(!attr||seen.has(attr[1]))return false;seen.add(attr[1]);attrs=attrs.slice(attr[0].length);if(attr[1]==='encoding'&&!/^utf-8$/i.test(attr[3]))return false;if(attr[1]==='version'&&!/^1\.[01]$/.test(attr[3]))return false;if(attr[1]==='standalone'&&!/^(yes|no)$/.test(attr[3]))return false;}
  }
  let text=original.replace(/^\uFEFF/,'').replace(/^\s*<\?xml\s+[^?]*\?>/i,'').replace(/<!--[\s\S]*?-->/g,'').trim();
  if(!/^<svg(?:\s|>)/.test(text) || /<\?|<!|\\|(?:javascript|vbscript)\s*:|expression\s*\(|@import/i.test(text))return false;
  const allowed=new Set(('svg g path rect circle ellipse line polyline polygon defs linearGradient radialGradient stop clipPath mask pattern title desc text tspan use symbol filter feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence').split(' '));
  const stack=[];let cursor=0,rootSeen=false;
  for(const match of text.matchAll(/<([^<>]*)>/g)) {
    if(text.slice(cursor,match.index).includes('<'))return false;
    cursor=match.index+match[0].length;
    const closing=/^\//.test(match[1]),self=/\/\s*$/.test(match[1]),tag=/^\/?([A-Za-z][\w.-]*)([\s\S]*)$/.exec(match[1]);
    if(!tag || !allowed.has(tag[1]))return false;
    if(closing){if(tag[2].trim() || stack.pop()!==tag[1])return false;continue;}
    if(!rootSeen){if(tag[1]!=='svg')return false;rootSeen=true;}else if(!stack.length)return false;
    let attributes=tag[2].replace(/\/\s*$/,'').trim(),used=new Set();
    while(attributes) {
      const attr=/^([A-Za-z_:][\w:.-]*)\s*=\s*(["'])([\s\S]*?)\2\s*/.exec(attributes);
      if(!attr || used.has(attr[1]) || /^on/i.test(attr[1]))return false;
      used.add(attr[1]);attributes=attributes.slice(attr[0].length);
      const key=attr[1],value=attr[3];
      if(key==='xml:base')return false;
      if(key==='xmlns' && value!=='http://www.w3.org/2000/svg')return false;
      if(key==='xmlns:xlink' && value!=='http://www.w3.org/1999/xlink')return false;
      if(key.startsWith('xmlns:') && key!=='xmlns:xlink')return false;
      if(/^(?:href|xlink:href|src)$/i.test(key) && !/^#[A-Za-z_][\w:.-]*$/.test(value))return false;
      if(/(?:javascript|vbscript|data)\s*:|@import|expression\s*\(|\\/i.test(value))return false;
      if(key==='style' && /&/.test(value))return false;
      if(key==='style' && value.split(';').some(rule=>rule.trim() && !/^(?:fill|stroke|stroke-width|stroke-linecap|stroke-linejoin|stroke-miterlimit|stroke-dasharray|stroke-dashoffset|opacity|fill-opacity|stroke-opacity|fill-rule|clip-rule|font-family|font-size|font-weight|font-style|text-anchor|dominant-baseline|letter-spacing|word-spacing|display|visibility|color|stop-color|stop-opacity)\s*:/i.test(rule.trim())))return false;
      for(const url of value.matchAll(/url\s*\(([^)]*)\)/gi))if(!/^\s*(['"]?)#[A-Za-z_][\w:.-]*\1\s*$/.test(url[1]))return false;
      if(/url/i.test(value) && !/url\s*\(/i.test(value))return false;
      if(key!=='xmlns' && key!=='xmlns:xlink' && /https?:|file:|ftp:|&#/i.test(value))return false;
    }
    if(!self)stack.push(tag[1]);
  }
  return rootSeen && stack.length===0 && !text.slice(cursor).trim();
}
function sniff(bytes) {
  if(bytes.length>=24 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.toString('ascii',12,16)==='IHDR')return 'image/png';
  if(bytes.length>=4 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255)return 'image/jpeg';
  if(bytes.length>=12 && bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP')return 'image/webp';
  if(bytes.length>=13 && /^GIF8[79]a$/.test(bytes.toString('ascii',0,6)))return 'image/gif';
  if(bytes.length>=26 && bytes.toString('ascii',0,2)==='BM')return 'image/bmp';
  if(bytes.length>=8 && (bytes.subarray(0,4).equals(Buffer.from([73,73,42,0])) || bytes.subarray(0,4).equals(Buffer.from([77,77,0,42]))))return 'image/tiff';
  if(bytes.length>=22 && bytes[0]===0 && bytes[1]===0 && bytes[2]===1 && bytes[3]===0)return 'image/x-icon';
  if(bytes.length>=20 && bytes.toString('ascii',4,8)==='ftyp' && /(?:avif|avis)/.test(bytes.toString('ascii',8,Math.min(bytes.length,64))))return 'image/avif';
  if(safeSvg(bytes))return 'image/svg+xml';
  return '';
}
async function readRecord(root,id) {
  await realDirectory(root);const paths=names(root,id);
  await realDirectory(paths.records);await ordinaryFile(paths.metadata,8192);
  const r=JSON.parse(await fsp.readFile(paths.metadata,'utf8'));
  if(r.version!==1 || r.id!==id || !/^[a-f0-9]{64}$/.test(r.sourceSha256) || !/^[a-f0-9]{64}$/.test(r.binarySha256)
    || extensions[r.mime]!==r.extension || !Number.isSafeInteger(r.bytes) || r.bytes<1 || r.bytes>MAX_BYTES
    || typeof r.canonicalBase64!=='boolean' || typeof r.header!=='string' || r.header.length>1024 || !/^data:image\/[^,]+$/i.test(r.header)
    || (r.canonicalBase64 && !/;base64(?:;|$)/i.test(r.header)))throw problem('标准原图索引无效，保留兼容原件','MEDIA_INDEX');
  if(id.startsWith('sha256-') && id!=='sha256-'+r.sourceSha256)throw problem('标准原图索引与引用不符','MEDIA_CHECKSUM');
  await realDirectory(paths.originals);const file=names(root,id,r.extension).standard,stat=await ordinaryFile(file);
  if(stat.size!==r.bytes)throw problem('标准原图大小校验失败','MEDIA_CHECKSUM');
  return {record:r,file};
}
async function readStandard(root,id) {
  const {record,file}=await readRecord(root,id),bytes=await fsp.readFile(file);
  if(digest(bytes)!==record.binarySha256 || sniff(bytes)!==record.mime)throw problem('标准原图内容校验失败','MEDIA_CHECKSUM');
  let value;
  if(record.canonicalBase64) {
    value=record.header+','+bytes.toString('base64');
    if(digest(Buffer.from(value,'utf8'))!==record.sourceSha256)throw problem('标准原图与原始引用不符','MEDIA_CHECKSUM');
    // Legacy short IDs do not cryptographically bind their original source.
    // Keep that source authoritative rather than trusting a self-edited record.
    if(!/^sha256-[a-f0-9]{64}$/.test(id) && await readLegacy(root,id)!==value)throw problem('标准原图与旧标识原件不符','MEDIA_CHECKSUM');
  } else {
    value=await readLegacy(root,id);
    const decoded=decodeDataUrl(value,id);
    if(decoded.sourceSha256!==record.sourceSha256 || !decoded.bytes.equals(bytes))throw problem('标准原图与兼容原件不符','MEDIA_CHECKSUM');
  }
  return {bytes,mime:record.mime,value,file,record};
}
async function readValue(root,id) {
  try{return {success:true,value:(await readStandard(root,id)).value,storageFormat:'image-file'};}
  catch(standardError) {
    try{return {success:true,value:await readLegacy(root,id),storageFormat:'data-url'};}
    catch(error){return {success:false,value:'',missing:error.code==='ENOENT',corrupt:error.code==='MEDIA_CHECKSUM',error:error.message};}
  }
}
async function readBinary(root,id) {
  try {const r=await readStandard(root,id);return {bytes:r.bytes,mime:r.mime,storageFormat:'image-file'};}
  catch(standardError) {const value=await readLegacy(root,id),decoded=decodeDataUrl(value,id);return {bytes:decoded.bytes,mime:decoded.mime,storageFormat:'data-url'};}
}
const publicationIdentity=stat=>({dev:String(stat.dev),ino:String(stat.ino),birthtimeMs:stat.birthtimeMs});
const sameIdentity=(a,b)=>a.dev===b.dev && a.ino===b.ino && a.birthtimeMs===b.birthtimeMs;
const publicationKeys=new Map();
async function readPublicationKey(directory,create=false){
  await realDirectory(directory);const file=path.join(directory,'.publication-key');
  if(create){let handle;try{handle=await fsp.open(file,'wx',0o600);await handle.writeFile(crypto.randomBytes(32));await handle.sync();}catch(error){if(error.code!=='EEXIST')throw error;}finally{await handle?.close();}}
  await ordinaryFile(file,32);const key=await fsp.readFile(file);if(key.length!==32)throw problem('原图发布记录密钥不完整，未修改任何既有文件','MEDIA_PUBLICATION_RECORD');return key;
}
async function publicationKey(directory,create=false){
  const identity=path.resolve(directory);if(publicationKeys.has(identity))return publicationKeys.get(identity);
  const task=readPublicationKey(directory,create);publicationKeys.set(identity,task);
  try{return await task;}finally{if(publicationKeys.get(identity)===task)publicationKeys.delete(identity);}
}
const intentPath=file=>file+'.publish-intent.json';
async function readPublicationIntent(file,sha){
  const intent=intentPath(file);await ordinaryFile(intent,8192);const signed=JSON.parse(await fsp.readFile(intent,'utf8'));
  if(typeof signed.payload!=='string'||typeof signed.mac!=='string'||!/^[a-f0-9]{64}$/.test(signed.mac))throw problem('原图发布记录无效','MEDIA_PUBLICATION_RECORD');
  const key=await publicationKey(path.dirname(file)),mac=crypto.createHmac('sha256',key).update(signed.payload).digest('hex');
  if(!crypto.timingSafeEqual(Buffer.from(mac),Buffer.from(signed.mac)))throw problem('原图发布记录校验失败','MEDIA_PUBLICATION_RECORD');
  const record=JSON.parse(Buffer.from(signed.payload,'base64').toString('utf8'));
  if(record.version!==1||record.target!==path.basename(file)||record.sha256!==sha||!Number.isSafeInteger(record.bytes)||record.bytes<1||record.bytes>MAX_BYTES||!record.identity||!/^\.standard-[a-f0-9-]+\.tmp$|^\.legacy-[a-f0-9-]+\.tmp$|^\.media-[a-f0-9-]+\.tmp$/.test(record.temporary))throw problem('原图发布记录与目标不符','MEDIA_PUBLICATION_RECORD');
  return {record,signed};
}
async function savePublicationIntent(file,record,key){
  const payload=Buffer.from(JSON.stringify(record),'utf8').toString('base64'),signed={payload,mac:crypto.createHmac('sha256',key).update(payload).digest('hex')};let handle;
  try{handle=await fsp.open(intentPath(file),'wx',0o600);await handle.writeFile(JSON.stringify(signed));await handle.sync();}finally{await handle?.close();}
}
async function recoverPublication(file,bytes,options={}){
  const sha=digest(bytes);let record;
  try{({record}=await readPublicationIntent(file,sha));}catch(error){if(error.code==='ENOENT')return false;throw error;}
  const check=async()=>{const stat=await ordinaryFile(file);if(!sameIdentity(record.identity,publicationIdentity(stat))||stat.size>bytes.length)throw problem('未完成原图的文件身份已变化，未覆盖现有文件','MEDIA_CONFLICT');const partial=await fsp.readFile(file);if(!partial.equals(bytes.subarray(0,partial.length)))throw problem('未完成原图已被编辑，未覆盖现有文件','MEDIA_CONFLICT');return partial;};
  const partial=await check();if(record.bytes!==bytes.length)throw problem('原图发布记录大小不符','MEDIA_PUBLICATION_RECORD');
  if(partial.length!==bytes.length){
    // Retain the interrupted bytes. A signed intent plus the same file identity
    // and exact expected prefix are all required; arbitrary conflicts never pass.
    const recovery=path.join(path.dirname(file),'.recovered-'+path.basename(file)+'-'+crypto.randomUUID()+'.partial');let backup;
    try{backup=await fsp.open(recovery,'wx');await backup.writeFile(partial);await backup.sync();}finally{await backup?.close();}
    if(digest(await fsp.readFile(recovery))!==digest(partial))throw problem('未完成原图恢复副本校验失败','MEDIA_CHECKSUM');
    const temporary=path.join(path.dirname(file),'.standard-'+crypto.randomUUID()+'.tmp');let handle;
    try{handle=await fsp.open(temporary,'wx');await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;await options.fault?.('before-fallback-recovery',{file,recovery});await check();await fsp.rename(temporary,file);}
    finally{await handle?.close().catch(()=>{});await fsp.unlink(temporary).catch(()=>{});}
  }
  if(digest(await fsp.readFile(file))!==sha)throw problem('恢复后的标准原图校验失败','MEDIA_CHECKSUM');
  await fsp.unlink(intentPath(file));return true;
}
async function publishTemporary(temporary,file,expectedSha256,options={}) {
  try{await (options.link||fsp.link)(temporary,file);return true;}
  catch(error){
    if(error.code==='EEXIST'){
      await ordinaryFile(file);
      if(digest(await fsp.readFile(file))!==expectedSha256)throw problem('原图位置冲突，未覆盖已有文件','MEDIA_CONFLICT');
      return false;
    }
    if(!['ENOTSUP','EOPNOTSUPP','EPERM','EXDEV','ENOSYS'].includes(error.code))throw error;
    // Persist a signed ownership/identity receipt before writing any data. This
    // permits recovery after termination on filesystems without hardlinks, while
    // preserving unknown files and every interrupted byte in a recovery copy.
    const key=await publicationKey(path.dirname(file),true);let handle,input;
    try{
      try{handle=await fsp.open(file,'wx');}
      catch(copyError){if(copyError.code!=='EEXIST')throw copyError;await ordinaryFile(file);const bytes=await fsp.readFile(temporary);if(digest(await fsp.readFile(file))===expectedSha256)return false;if(await recoverPublication(file,bytes,options))return false;throw problem('原图位置冲突，未覆盖已有文件','MEDIA_CONFLICT');}
      const stat=await handle.stat(),size=(await ordinaryFile(temporary)).size;
      await savePublicationIntent(file,{version:1,target:path.basename(file),sha256:expectedSha256,bytes:size,temporary:path.basename(temporary),identity:publicationIdentity(stat)},key);
      input=await fsp.open(temporary,'r');const buffer=Buffer.alloc(64*1024);let offset=0;
      while(offset<size){const read=await input.read(buffer,0,Math.min(buffer.length,size-offset),offset);if(!read.bytesRead)throw problem('待发布原图意外结束','MEDIA_CHECKSUM');let wrote=0;while(wrote<read.bytesRead){const result=await handle.write(buffer,wrote,read.bytesRead-wrote,offset+wrote);if(!result.bytesWritten)throw problem('磁盘写入没有取得进展','MEDIA_WRITE_FAILED');wrote+=result.bytesWritten;}offset+=read.bytesRead;await options.fault?.('fallback-copy-chunk',{file,written:offset,total:size});}
      await handle.sync();
    }finally{await input?.close().catch(()=>{});await handle?.close().catch(()=>{});}
    await ordinaryFile(file);if(digest(await fsp.readFile(file))!==expectedSha256)throw problem('原图独占写入校验失败，兼容原件仍保留','MEDIA_CHECKSUM');
    await fsp.unlink(intentPath(file));
    return true;
  }
}
async function atomicNew(file,bytes, fault=async()=>{},options={}) {
  try {await ordinaryFile(file);const existing=await fsp.readFile(file);if(existing.equals(bytes))return false;if(await recoverPublication(file,bytes,options))return false;throw problem('标准原图位置已有不同内容，已保留所有文件','MEDIA_CONFLICT');}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const temporary=path.join(path.dirname(file),'.standard-'+crypto.randomUUID()+'.tmp');
  let handle;
  try {
    handle=await fsp.open(temporary,'wx');await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
    await fault('before-publish',{file,temporary});
    // Creating the directory entry exclusively never replaces a concurrently
    // created user file. Existing identical content is a harmless deduplication.
    await publishTemporary(temporary,file,digest(bytes),options);
    await fault('after-publish',{file,temporary});
    return true;
  } finally {await handle?.close().catch(()=>{});await fsp.unlink(temporary).catch(()=>{});}
}
async function publishLegacyTemporary(root,id,temporary,expectedSha256,options={}) {
  root=await realDirectory(root);const target=names(root,id).legacy;
  await ordinaryFile(temporary);if(path.dirname(path.resolve(temporary))!==root || digest(await fsp.readFile(temporary))!==expectedSha256)throw problem('待写原图校验失败','MEDIA_CHECKSUM');
  if(id.startsWith('sha256-') && id!=='sha256-'+expectedSha256)throw problem('原图引用与写入内容不符','MEDIA_CHECKSUM');
  let existing;
  try{await ordinaryFile(target);existing=await fsp.readFile(target);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(existing && digest(existing)!==expectedSha256){
    if(await recoverPublication(target,await fsp.readFile(temporary),options))return {created:true,repaired:true};
    if(!/^sha256-[a-f0-9]{64}$/.test(id))throw problem('旧图片标识冲突，已保留原图','MEDIA_CONFLICT');
    const recovery=path.join(root,'.original-recovery');await fsp.mkdir(recovery,{recursive:true});await realDirectory(recovery);
    const corruptSha=digest(existing),saved=path.join(recovery,id+'-'+corruptSha+'.data');
    await atomicNew(saved,existing,options.fault,options);
    await options.fault?.('before-legacy-repair',{target,recovery:saved});
    await realDirectory(root);await ordinaryFile(target);
    if(digest(await fsp.readFile(target))!==corruptSha)throw problem('原图在修复期间已变化，已停止替换并保留恢复副本','MEDIA_CONFLICT');
    await fsp.rename(temporary,target);
    return {created:true,repaired:true,recovery:saved};
  }
  if(existing)return {created:false};
  return {created:await publishTemporary(temporary,target,expectedSha256,options)};
}
async function writeLegacy(root,id,value,options={}) {
  root=await realDirectory(root);names(root,id);
  if(typeof value!=='string' || !value.startsWith('data:') || Buffer.byteLength(value)>MAX_BYTES)throw problem('原图数据无效或过大','INVALID_MEDIA');
  const bytes=Buffer.from(value,'utf8'),sha=digest(bytes);
  if(id.startsWith('sha256-') && id!=='sha256-'+sha)throw problem('原图内容校验失败','MEDIA_CHECKSUM');
  const temporary=path.join(root,'.legacy-'+crypto.randomUUID()+'.tmp');let handle;
  try{handle=await fsp.open(temporary,'wx');await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;return await publishLegacyTemporary(root,id,temporary,sha,options);}
  finally{await handle?.close().catch(()=>{});await fsp.unlink(temporary).catch(()=>{});}
}
async function ensureStandard(root,id,options={}) {
  const fault=options.fault||(async()=>{});
  try {
    root=await realDirectory(root);if(!validId(id))throw problem('原图标识无效','INVALID_MEDIA_ID');
    try {const ready=await readStandard(root,id);return {success:true,path:ready.file,directory:path.dirname(ready.file),filename:path.basename(ready.file),mime:ready.record.mime,extension:ready.record.extension,storageFormat:'image-file',deduplicated:true,bytes:ready.bytes.length};}
    catch(_error) {}
    const value=await readLegacy(root,id),decoded=decodeDataUrl(value,id),mime=sniff(decoded.bytes);
    if(!mime)throw problem('此图片格式或 SVG 内容不适合直接公开为标准文件，兼容原件保持不变','UNSUPPORTED_MEDIA');
    const paths=names(root,id,extensions[mime]);
    const stats=options.statfs ? await options.statfs(root) : await fsp.statfs(root);
    if(Number(stats.bavail)*Number(stats.bsize)<decoded.bytes.length+RESERVE_BYTES+8192)throw problem('数据盘空间不足，标准图片副本暂缓创建；原件已保留','ENOSPC');
    for(const directory of [paths.originals,paths.records]){await fsp.mkdir(directory,{recursive:true});await realDirectory(directory);}
    await fault('before-original',{id});
    await atomicNew(paths.standard,decoded.bytes,fault,options);
    await fault('before-metadata',{id});
    const record={version:1,id,sourceSha256:decoded.sourceSha256,header:decoded.header,canonicalBase64:decoded.canonicalBase64,binarySha256:digest(decoded.bytes),mime,extension:extensions[mime],bytes:decoded.bytes.length};
    await atomicNew(paths.metadata,Buffer.from(JSON.stringify(record),'utf8'),fault,options);
    await fault('after-metadata',{id});
    const ready=await readStandard(root,id);
    return {success:true,path:ready.file,directory:paths.originals,filename:path.basename(ready.file),mime,extension:extensions[mime],storageFormat:'image-file',bytes:decoded.bytes.length};
  } catch(error) {return {success:false,unsupported:error.code==='UNSUPPORTED_MEDIA',missing:error.code==='ENOENT',code:error.code||'MEDIA_STANDARDIZATION_FAILED',error:error.message,legacyRetained:true};}
}
module.exports={validId,digest,names,realDirectory,ordinaryFile,readLegacy,decodeDataUrl,safeSvg,sniff,readRecord,readStandard,readValue,readBinary,ensureStandard,atomicNew,publishTemporary,publishLegacyTemporary,writeLegacy};
