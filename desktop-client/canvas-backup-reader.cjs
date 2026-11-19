'use strict';
// Read-only validation shared by restore, commit ordering and retention. A file
// in another project's directory must never become that project's history.
const fs=require('node:fs'),path=require('node:path');
const snapshotName=/^(\d+)-[0-9a-f]+\.json$/i;
function problem(code){return Object.assign(new Error('项目备份无法安全读取，已保留原文件，请检查存储或从备份副本恢复。'),{code});}
function samePath(a,b){return process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;}
function safeId(value){return typeof value==='string'&&/^[0-9A-Za-z_-]{1,100}$/.test(value);}
function identity(directory){return {folderId:path.basename(path.dirname(directory)),projectId:path.basename(directory)};}
async function ordinary(file,directory){const stat=await fs.promises.lstat(file);if(stat.isSymbolicLink()||stat.isDirectory()!==directory||(!directory&&!stat.isFile())||!samePath(await fs.promises.realpath(file),path.resolve(file)))throw problem('BACKUP_UNSAFE_PATH');return stat;}
function time(value){if(value===undefined||value===null)return 0;const number=typeof value==='string'&&/^\d+$/.test(value)?Number(value):value;if(!Number.isSafeInteger(number)||number<0)throw problem('BACKUP_INVALID_TIME');return number;}
function validateEnvelope(envelope,expected,name){
 if(!envelope||typeof envelope!=='object'||Array.isArray(envelope)||envelope.format!=='wandou-canvas-backup')throw problem('BACKUP_INVALID_FORMAT');
 if(envelope.version!==undefined&&envelope.version!==1)throw problem('BACKUP_UNSUPPORTED_VERSION');
 if(!safeId(expected?.folderId)||!safeId(expected?.projectId))throw problem('BACKUP_INVALID_IDENTITY');
 const state=envelope.state;if(!state||typeof state!=='object'||Array.isArray(state)||!Array.isArray(state.nodes)||(state.links!==undefined&&!Array.isArray(state.links)))throw problem('BACKUP_INVALID_STATE');
 for(const field of ['folderId','projectId']){
  let verified=false;
  for(const candidate of [envelope[field],state[field]]){
   if(candidate===undefined||candidate===null||candidate==='')continue;
   if(typeof candidate!=='string'||candidate!==expected[field])throw problem('BACKUP_IDENTITY_MISMATCH');
   verified=true;
  }
  if(!verified)throw problem('BACKUP_IDENTITY_UNPROVEN');
 }
 const match=snapshotName.exec(name);if(!match)throw problem('BACKUP_INVALID_NAME');
 const savedAt=Math.max(time(match[1]),time(envelope.savedAt),time(state.savedAt));
 if(!savedAt)throw problem('BACKUP_INVALID_TIME');
 return {state:{...state,savedAt},savedAt,legacy:envelope.version===undefined||envelope.folderId===undefined||envelope.projectId===undefined};
}
async function readFile(directory,name){
 if(!snapshotName.test(name)||path.basename(name)!==name)throw problem('BACKUP_INVALID_NAME');
 await ordinary(directory,true);const file=path.join(directory,name);await ordinary(file,false);
 let envelope;try{envelope=JSON.parse(await fs.promises.readFile(file,'utf8'));}catch(error){if(error instanceof SyntaxError)throw problem('BACKUP_INVALID_JSON');throw error;}
 return {...validateEnvelope(envelope,identity(directory),name),path:file};
}
async function readDirectory(directory,stateLimit=3){
 if(!Number.isInteger(stateLimit)||stateLimit<1||stateLimit>12)throw problem('BACKUP_INVALID_LIMIT');
 const states=[],records=[],issues=[];let entries;
 try{await ordinary(directory,true);entries=await fs.promises.readdir(directory,{withFileTypes:true});}
 catch(error){if(error.code==='ENOENT')return {states,records,issues,skippedLarge:0,candidateCount:0,blocked:false};throw error;}
 const snapshots=entries.filter(entry=>snapshotName.test(entry.name)).map(entry=>entry.name).sort((a,b)=>Number(b.split('-')[0])-Number(a.split('-')[0]));
 // Keep the historical twelve-snapshot search range. The audit tool separately
 // inventories every file and reports any recoverable older copy explicitly.
 for(const name of snapshots.slice(0,12)){
  if(states.length>=stateLimit)break;
  try{const record=await readFile(directory,name);states.push(record.state);records.push(record);}
  catch(error){issues.push({file:name,code:error.code||'BACKUP_READ_FAILED'});}
 }
 return {states,records,issues,skippedLarge:0,candidateCount:snapshots.length,searchLimited:snapshots.length>12,partial:issues.length>0,blocked:snapshots.length>0&&states.length===0};
}
// Startup needs project identities before it needs their contents. Listing a
// backup is deliberately not validation: filenames never prove that its JSON,
// identity or version is safe to restore. Selected/unknown projects still use
// readDirectory; that path retains all existing recovery and conflict checks.
async function readCatalog(folderDirectory){
 const projects=[],issues=[];
 if(!safeId(path.basename(folderDirectory)))throw problem('BACKUP_INVALID_IDENTITY');
 let entries;
 try{await ordinary(folderDirectory,true);entries=await fs.promises.readdir(folderDirectory,{withFileTypes:true});}
 catch(error){if(error.code==='ENOENT')return {projects,issues,partial:false,blocked:false};throw error;}
 for(const entry of entries){
  if(!entry.isDirectory()&&!entry.isSymbolicLink())continue;
  const projectId=entry.name;
  try{
   if(!safeId(projectId))throw problem('BACKUP_INVALID_IDENTITY');
   const directory=path.join(folderDirectory,projectId);await ordinary(directory,true);
   const candidates=(await fs.promises.readdir(directory,{withFileTypes:true})).filter(file=>snapshotName.test(file.name));
   let latestSavedAt=0,candidateCount=0;
   for(const file of candidates){
    try{
     await ordinary(path.join(directory,file.name),false);
     const savedAt=time(snapshotName.exec(file.name)[1]);if(!savedAt)throw problem('BACKUP_INVALID_TIME');
     candidateCount++;latestSavedAt=Math.max(latestSavedAt,savedAt);
    }catch(error){issues.push({projectId,blocked:false,snapshots:[{file:file.name,code:error.code||'BACKUP_READ_FAILED'}]});}
   }
   if(candidateCount)projects.push({projectId,latestSavedAt,candidateCount,stateVerified:false});
  }catch(error){issues.push({projectId,blocked:true,snapshots:[{code:error.code||'BACKUP_READ_FAILED'}]});}
 }
 projects.sort((a,b)=>b.latestSavedAt-a.latestSavedAt||a.projectId.localeCompare(b.projectId));
 return {projects,issues,partial:issues.length>0,blocked:!projects.length&&issues.length>0};
}
async function latest(directory){const result=await readDirectory(directory,1);if(result.blocked)throw problem('BACKUP_EXISTING_UNREADABLE');return result.records[0]||null;}
async function canPrune(directory,name){try{await readFile(directory,name);return true;}catch{return false;}}
module.exports={validateEnvelope,readDirectory,readCatalog,readFile,latest,canPrune,problem};
