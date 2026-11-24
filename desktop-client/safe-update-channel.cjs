const createPolicy = require('./update-policy.cjs');
const CHANNEL = 'desktop-safe-v1';
const PROTOCOL = 2;
const stable = value => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);
function compare(a, b) {
  const left=a.split('.').map(Number), right=b.split('.').map(Number);
  for(let i=0;i<3;i++) if(left[i]!==right[i]) return left[i]>right[i]?1:-1;
  return 0;
}
function urls(config) {
  const owner=String(config.githubOwner||''), repo=String(config.githubRepository||'');
  if(!/^[\w.-]+$/.test(owner)||!/^[\w.-]+$/.test(repo)) throw Error('更新仓库配置无效');
  if(config.updateChannelTag!==CHANNEL || config.updateManifestAsset!=='update-manifest.json' || config.updaterProtocol!==PROTOCOL) throw Error('安全更新通道配置无效，请使用安装器更新');
  const base=`https://github.com/${owner}/${repo}/releases`;
  return {manual:base, manifest:`${base}/download/${CHANNEL}/update-manifest.json`, release:`https://api.github.com/repos/${owner}/${repo}/releases/tags/${CHANNEL}`};
}
function validate(manifest, config, currentVersion) {
  const links=urls(config), policy=createPolicy(config);
  if(!manifest||Array.isArray(manifest)||manifest.schemaVersion!==1||manifest.updaterProtocol!==PROTOCOL) throw Error('更新协议不兼容，请使用安装器更新');
  if(!stable(manifest.version)||!stable(manifest.minimumUpdaterVersion)||!stable(currentVersion)) throw Error('安全更新版本信息无效');
  if(!['automatic','manual'].includes(manifest.installationMode)) throw Error('缺少安全更新安装方式');
  const info=policy.metadata({latestVersion:manifest.version,downloadUrl:manifest.downloadUrl,checksumUrl:manifest.checksumUrl});
  const releaseUrl=`${links.manual}/tag/v${manifest.version}`;
  if(manifest.releaseUrl!==releaseUrl) throw Error('更新说明地址与官方版本不匹配');
  const newer=compare(manifest.version,currentVersion)>0;
  const manual=newer&&(manifest.installationMode==='manual'||compare(currentVersion,manifest.minimumUpdaterVersion)<0);
  return {...info,configured:true,currentVersion,available:newer&&!manual,manualRequired:manual,retryable:false,
    updaterProtocol:PROTOCOL,minimumUpdaterVersion:manifest.minimumUpdaterVersion,installationMode:manifest.installationMode,
    manualUrl:releaseUrl,notes:String(manifest.notes||'').slice(0,16000),error:'',
    manualReason:manual?'此版本需要先保存并退出软件，再使用官方安装器覆盖原目录。':''};
}
async function check({config,currentVersion,fetchJson}) {
  let links;
  try {links=urls(config);} catch(error) {return {available:false,configured:false,currentVersion,manualRequired:false,retryable:false,error:error.message};}
  let manifest;
  const errors=[];
  let fallbackStage='release';
  try {manifest=await fetchJson(links.manifest);} catch(error) {errors.push(error);}
  // The fallback can only locate the same channel asset in the same repository.
  // A corrupt manifest is never replaced by an older /latest response.
  if(manifest===undefined) {
    try {
      const release=await fetchJson(links.release);
      fallbackStage='metadata';
      if(release.tag_name!==CHANNEL||release.draft||release.prerelease) throw Error('安全更新通道发布状态无效');
      const matches=(release.assets||[]).filter(a=>a.name==='update-manifest.json');
      if(matches.length!==1) throw Error('安全更新通道缺少唯一的版本清单');
      const asset=matches[0],prefix=links.release.slice(0,links.release.indexOf('/tags/'));
      if(asset.browser_download_url!==links.manifest||!Number.isSafeInteger(asset.id)||asset.id<=0||asset.url!==`${prefix}/assets/${asset.id}`||asset.state!=='uploaded') throw Error('安全更新清单来源无效');
      fallbackStage='asset';
      manifest=await fetchJson(asset.url,{asset:true});
    } catch(error) {
      if(fallbackStage==='metadata')return {available:false,configured:true,currentVersion,manualRequired:true,retryable:false,manualUrl:links.manual,manualReason:error.message,error:error.message};
      errors.push(error);
    }
  }
  if(manifest!==undefined) {
    try {return validate(manifest,config,currentVersion);} catch(error) {
      return {available:false,configured:true,currentVersion,manualRequired:true,retryable:false,manualUrl:links.manual,
        manualReason:error.message,error:error.message};
    }
  }
  // A CDN 404 is not proof that the channel is absent when the API is offline
  // or rate-limited. Only two confirmed missing endpoints disable retry.
  const missing=fallbackStage==='release'&&errors.length===2&&errors.every(e=>e.status===404);
  const message=missing?'安全更新通道尚未开放，可前往官方发布页下载安装包。':'安全更新通道暂时无法连接，请稍后重试或前往官方发布页。';
  return {available:false,configured:true,currentVersion,manualRequired:true,retryable:!missing,manualUrl:links.manual,manualReason:message,error:message};
}
async function readJson(response,{maxBytes=262144,timeoutMs=8000}={}) {
  const cancel=value=>{try{Promise.resolve(value?.cancel?.()).catch(()=>{});}catch{}};
  if(!response.ok){cancel(response.body);const error=Error(`安全更新清单 HTTP ${response.status}`);error.status=response.status;throw error;}
  if(Number(response.headers?.get('content-length'))>maxBytes){cancel(response.body);throw Error('安全更新清单过大');}
  const reader=response.body?.getReader();if(!reader)throw Error('安全更新清单为空');
  const parts=[];let bytes=0,timer,completed=false;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{reject(Error('安全更新清单读取超时'));cancel(reader);},timeoutMs);});
  try{while(true){const part=await Promise.race([reader.read(),timeout]);if(part.done)break;bytes+=part.value.byteLength;if(bytes>maxBytes)throw Error('安全更新清单过大');parts.push(Buffer.from(part.value));}completed=true;return JSON.parse(Buffer.concat(parts).toString('utf8').replace(/^\uFEFF/,''));}
  finally{clearTimeout(timer);if(!completed)cancel(reader);}
}
module.exports={check,validate,urls,readJson,PROTOCOL,CHANNEL};
