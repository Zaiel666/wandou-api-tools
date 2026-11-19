'use strict';
const {test:baseTest}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const channel=require('../desktop-client/safe-update-channel.cjs'),{download,checksum}=require('../desktop-client/update-download.cjs');
const config={githubOwner:'Zaiel666',githubRepository:'wandou-api-tools',updateChannelTag:'desktop-safe-v1',updateManifestAsset:'update-manifest.json',updaterProtocol:2,assetName:'wandou-ai-tools-windows-x64.zip',checksumAssetName:'wandou-ai-tools-windows-x64.zip.sha256'};
const urls=channel.urls(config),assetUrl='https://api.github.com/repos/Zaiel666/wandou-api-tools/releases/assets/123';
const valid=()=>({schemaVersion:1,updaterProtocol:2,version:'2.0.24',minimumUpdaterVersion:'2.0.23',installationMode:'automatic',downloadUrl:'https://github.com/Zaiel666/wandou-api-tools/releases/download/v2.0.24/wandou-ai-tools-windows-x64.zip',checksumUrl:'https://github.com/Zaiel666/wandou-api-tools/releases/download/v2.0.24/wandou-ai-tools-windows-x64.zip.sha256',releaseUrl:'https://github.com/Zaiel666/wandou-api-tools/releases/tag/v2.0.24'});
const release=()=>({tag_name:'desktop-safe-v1',draft:false,prerelease:false,assets:[{name:'update-manifest.json',id:123,state:'uploaded',browser_download_url:urls.manifest,url:assetUrl}]});
const checks=[];let registered=0;function test(name,fn){registered++;return baseTest(name,async(...args)=>{try{await fn(...args);checks.push({name,passed:true});}catch(e){checks.push({name,passed:false,error:e.message});throw e;}});}test.before=baseTest.before;test.after=baseTest.after;
const pause=ms=>new Promise(r=>setTimeout(r,ms));let tempRoot,initialHashes,startedAt;
async function moduleHashes(){const result={};for(const file of ['safe-update-channel.cjs','update-download.cjs','update-policy.cjs'])result[file]=crypto.createHash('sha256').update(await fs.readFile(path.resolve(__dirname,'../desktop-client',file))).digest('hex');return result;}
test.before(async()=>{startedAt=new Date().toISOString();initialHashes=await moduleHashes();tempRoot=await fs.mkdtemp(path.join(os.tmpdir(),'wandou-update-independent-v223-'));});
test.after(async()=>{const after=await moduleHashes(),runtimeUnchanged=JSON.stringify(initialHashes)===JSON.stringify(after);await fs.writeFile(path.resolve(__dirname,'../../qa/update-channel-independent-v223.json'),JSON.stringify({success:checks.length===registered&&checks.every(x=>x.passed)&&runtimeUnchanged,startedAt,finishedAt:new Date().toISOString(),sourceHashes:initialHashes,sourceHashesAfter:after,runtimeUnchanged,checks,networkRequests:0,syntheticRoot:tempRoot},null,2));assert.equal(runtimeUnchanged,true);});
async function destination(){const folder=await fs.mkdtemp(path.join(tempRoot,'case-'));return{folder,file:path.join(folder,'candidate.zip')};}
async function contents(folder){return(await fs.readdir(folder)).sort();}
function streamResponse(chunks,{declared,status=200,errorAt=-1}={}){let index=0;const body=new ReadableStream({pull(controller){if(index===errorAt){controller.error(Error('synthetic broken connection'));return;}if(index===chunks.length){controller.close();return;}controller.enqueue(Buffer.from(chunks[index++]));}});return new Response(body,{status,headers:declared===undefined?{}:{'Content-Length':String(declared)}});}

test('trusted direct manifest yields only protocol-2 newer automatic update, without latest lookup',async()=>{
 const called=[];const info=await channel.check({config,currentVersion:'2.0.23',fetchJson:async url=>{called.push(url);return valid();}});
 assert.equal(info.available,true);assert.equal(info.manualRequired,false);assert.equal(info.latestVersion,'2.0.24');assert.deepEqual(called,[urls.manifest]);assert.ok(called.every(u=>!u.includes('/latest')));
});
test('protocol minimum and explicit manual modes route to exact official version installer',()=>{
 for(const manifest of [{...valid(),minimumUpdaterVersion:'2.0.24'},{...valid(),installationMode:'manual'}]){const r=channel.validate(manifest,config,'2.0.23');assert.equal(r.available,false);assert.equal(r.manualRequired,true);assert.equal(r.manualUrl,manifest.releaseUrl);}
 for(const version of ['2.0.24','2.0.25']){const r=channel.validate(valid(),config,version);assert.equal(r.available,false);assert.equal(r.manualRequired,false);}
});
for(const field of ['protocol','foreign-package','http-checksum','wrong-version-asset','foreign-release','bad-schema'])test('invalid direct manifest is rejected without fallback: '+field,async()=>{
 const m=valid();if(field==='protocol')m.updaterProtocol=1;if(field==='foreign-package')m.downloadUrl=m.downloadUrl.replace('Zaiel666','Attacker');if(field==='http-checksum')m.checksumUrl=m.checksumUrl.replace('https:','http:');if(field==='wrong-version-asset')m.downloadUrl=m.downloadUrl.replace('v2.0.24/','v2.0.23/');if(field==='foreign-release')m.releaseUrl='https://example.invalid/release';if(field==='bad-schema')m.schemaVersion=2;
 const called=[];const r=await channel.check({config,currentVersion:'2.0.23',fetchJson:async url=>{called.push(url);return m;}});assert.equal(r.available,false);assert.equal(r.manualRequired,true);assert.equal(r.retryable,false);assert.deepEqual(called,[urls.manifest]);assert.equal(r.manualUrl,urls.manual);
});
test('fallback fetches only the identical channel asset from trusted API metadata',async()=>{
 const called=[];const r=await channel.check({config,currentVersion:'2.0.23',fetchJson:async(url,options)=>{called.push({url,options});if(url===urls.manifest)throw Error('synthetic direct failure');if(url===urls.release)return release();if(url===assetUrl)return valid();throw Error('unexpected URL');}});assert.equal(r.available,true);assert.deepEqual(called,[{url:urls.manifest,options:undefined},{url:urls.release,options:undefined},{url:assetUrl,options:{asset:true}}]);
});
for(const field of ['wrong-tag','draft','prerelease','duplicate','foreign-asset-url','wrong-download-url','unuploaded'])test('fallback rejects untrusted or ambiguous channel metadata: '+field,async()=>{
 const r=release();if(field==='wrong-tag')r.tag_name='latest';if(field==='draft')r.draft=true;if(field==='prerelease')r.prerelease=true;if(field==='duplicate')r.assets.push({...r.assets[0]});if(field==='foreign-asset-url')r.assets[0].url=r.assets[0].url.replace('Zaiel666','Attacker');if(field==='wrong-download-url')r.assets[0].browser_download_url=r.assets[0].browser_download_url.replace('desktop-safe-v1','latest');if(field==='unuploaded')r.assets[0].state='new';
 const called=[];const info=await channel.check({config,currentVersion:'2.0.23',fetchJson:async url=>{called.push(url);if(url===urls.manifest)throw Error('direct offline');return r;}});assert.equal(info.available,false);assert.equal(info.manualRequired,true);assert.deepEqual(called,[urls.manifest,urls.release]);assert.ok(called.every(u=>!u.endsWith('/latest')));
});
test('unpublished channel and connection failure remain manual/retryable without unsafe latest fallback',async()=>{
 for(const status of [404,503]){const called=[];const r=await channel.check({config,currentVersion:'2.0.23',fetchJson:async url=>{called.push(url);throw Object.assign(Error('synthetic network failure'),{status});}});assert.equal(r.available,false);assert.equal(r.manualRequired,true);assert.equal(r.retryable,status!==404);assert.equal(r.manualUrl,urls.manual);assert.deepEqual(called,[urls.manifest,urls.release]);}
});
test('manifest stream bounds bytes and rejects empty/truncated/invalid JSON',async()=>{
 assert.deepEqual(await channel.readJson(streamResponse(['\uFEFF{"ok":','true}'])),{ok:true});
 await assert.rejects(channel.readJson(streamResponse([])),SyntaxError);await assert.rejects(channel.readJson(streamResponse(['{"ok":'])),SyntaxError);
 await assert.rejects(channel.readJson(streamResponse(['x'],{declared:300000})),/过大/);await assert.rejects(channel.readJson(streamResponse(['12345','67890']),{maxBytes:8}),/过大/);
 const denied=await channel.readJson(streamResponse([],{status:404})).then(()=>null,e=>e);assert.equal(denied.status,404);
});
test('manifest slow stream obeys overall body deadline',async()=>{
 let canceled=false;const body=new ReadableStream({async pull(c){await pause(20);if(!canceled)c.enqueue(Buffer.from(' '));},cancel(){canceled=true;}});const start=Date.now();await assert.rejects(channel.readJson(new Response(body),{timeoutMs:65}),/超时/);assert.ok(Date.now()-start<500);assert.equal(canceled,true);
});
test('successful streamed download publishes complete bytes only and refuses an existing candidate',async()=>{
 const{folder,file}=await destination();const progress=[];const result=await download({url:'https://synthetic.invalid/package',destination:file,fetchResponse:async()=>streamResponse(['abc','defg'],{declared:7}),onProgress:p=>progress.push(p)});assert.equal(result.bytes,7);assert.equal(await fs.readFile(file,'utf8'),'abcdefg');assert.deepEqual(progress,[{bytes:3,total:7},{bytes:7,total:7}]);assert.deepEqual(await contents(folder),['candidate.zip']);
 await assert.rejects(download({url:'https://synthetic.invalid/package',destination:file,fetchResponse:async()=>streamResponse(['new candidate'])}),{code:'EEXIST'});assert.equal(await fs.readFile(file,'utf8'),'abcdefg');assert.deepEqual(await contents(folder),['candidate.zip']);
});
for(const kind of ['empty','truncated','too-large-declared','too-large-stream','read-error','callback-error','http-error'])test('failed download preserves existing candidate and removes only its own partial: '+kind,async()=>{
 const{folder,file}=await destination();await fs.writeFile(file,'old candidate');await fs.writeFile(path.join(folder,'keep.partial-other'),'unrelated partial');
 const options={url:'https://synthetic.invalid/package',destination:file,fetchResponse:async()=>kind==='empty'?streamResponse([]):kind==='truncated'?streamResponse(['abc'],{declared:9}):kind==='too-large-declared'?streamResponse(['abc'],{declared:100}):kind==='read-error'?streamResponse(['abc','def'],{errorAt:1}):kind==='http-error'?streamResponse([],{status:503}):streamResponse(['abc','def']),maxBytes:kind.startsWith('too-large')?4:100,onProgress:()=>{if(kind==='callback-error')throw Error('synthetic callback failure');}};
 await assert.rejects(download(options));assert.equal(await fs.readFile(file,'utf8'),'old candidate');assert.equal(await fs.readFile(path.join(folder,'keep.partial-other'),'utf8'),'unrelated partial');assert.deepEqual(await contents(folder),['candidate.zip','keep.partial-other']);
});
test('slow trickle hits overall deadline and stalled stream hits idle deadline without replacing candidate',async()=>{
 for(const idle of [true,false]){const{folder,file}=await destination();await fs.writeFile(file,'old candidate');let canceled=false;
  const body=new ReadableStream({async pull(c){await pause(idle?300:15);if(!canceled)c.enqueue(Buffer.from('x'));},cancel(){canceled=true;}});const start=Date.now();await assert.rejects(download({url:'https://synthetic.invalid/package',destination:file,fetchResponse:async()=>new Response(body),idleMs:idle?40:200,totalMs:idle?500:70}),/超时/);assert.ok(Date.now()-start<1000);assert.equal(canceled,true);assert.equal(await fs.readFile(file,'utf8'),'old candidate');assert.deepEqual(await contents(folder),['candidate.zip']);
 }
});
test('filesystem open/rename failures do not remove existing data or leave partial files',async()=>{
 const{folder,file}=await destination();await fs.mkdir(file);await fs.writeFile(path.join(file,'note.txt'),'keep directory');await assert.rejects(download({url:'https://synthetic.invalid/package',destination:file,fetchResponse:async()=>streamResponse(['valid data'])}));assert.equal(await fs.readFile(path.join(file,'note.txt'),'utf8'),'keep directory');assert.deepEqual(await contents(folder),['candidate.zip']);
 const missing=path.join(folder,'missing','candidate.zip');await assert.rejects(download({url:'https://synthetic.invalid/package',destination:missing,fetchResponse:async()=>streamResponse(['valid data'])}));assert.deepEqual(await contents(folder),['candidate.zip']);
});
test('checksum binds one SHA256 record to its exact package filename',()=>{
 const digest='a'.repeat(64),filename=config.assetName;assert.equal(checksum(digest+'  '+filename,filename),digest);assert.equal(checksum(digest+' *'+filename,filename),digest);assert.equal(checksum(digest,filename),digest);
 for(const text of [digest+'  different.zip',digest+'\n'+digest,digest.slice(1),'z'.repeat(64)])assert.throws(()=>checksum(text,filename));assert.throws(()=>checksum(digest,'../candidate.zip'));
});

// Cancel itself is asynchronous. A transport that never completes cancellation
// must not hold the user-facing failure (and cleanup) indefinitely.
for(const kind of ['manifest','download'])test('timeout settles even when transport cancellation stalls: '+kind,async()=>{
 let finishCancel;const gate=new Promise(r=>finishCancel=r);const body=new ReadableStream({cancel(){return gate;}});const{folder,file}=await destination();await fs.writeFile(file,'old candidate');
 const operation=kind==='manifest'?channel.readJson(new Response(body),{timeoutMs:25}):download({url:'https://synthetic.invalid/package',destination:file,fetchResponse:async()=>new Response(body),idleMs:25,totalMs:200});
 const outcome=await Promise.race([operation.then(()=>({success:true}),error=>({error:error.message})),pause(180).then(()=>({hung:true}))]);finishCancel();await operation.catch(()=>{});
 assert.equal(outcome.hung,undefined,'Timeout must settle independently of cancellation completion');assert.match(outcome.error,/超时/);assert.equal(await fs.readFile(file,'utf8'),'old candidate');assert.deepEqual(await contents(folder),['candidate.zip']);
});
for(const kind of ['manifest','download'])for(const failure of ['http-error','oversize-header'])for(const cancel of ['stalls','throws'])test('early '+failure+' settles even when transport cancellation '+cancel+': '+kind,async()=>{
 let finishCancel;const gate=new Promise(r=>finishCancel=r),body=new ReadableStream({cancel(){if(cancel==='throws')throw Error('synthetic cancel error');return gate;}}),response=new Response(body,{status:failure==='http-error'?503:200,headers:failure==='oversize-header'?{'content-length':'99'}:{}});const{folder,file}=await destination();await fs.writeFile(file,'old candidate');
 const operation=kind==='manifest'?channel.readJson(response,{timeoutMs:25,maxBytes:8}):download({url:'https://synthetic.invalid/package',destination:file,fetchResponse:async()=>response,maxBytes:8,idleMs:25,totalMs:100});
 const outcome=await Promise.race([operation.then(()=>({success:true}),error=>({error:error.message})),pause(180).then(()=>({hung:true}))]);finishCancel();await operation.catch(()=>{});
 assert.equal(outcome.hung,undefined,'Known failure must not wait indefinitely for body cancellation');assert.match(outcome.error,failure==='http-error'?/HTTP 503/:/过大|超过/);assert.equal(await fs.readFile(file,'utf8'),'old candidate');assert.deepEqual(await contents(folder),['candidate.zip']);
});
