const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const desktop=process.env.WANDOU_TEST_DESKTOP_ROOT||path.resolve(__dirname,'../artifacts/reliability-fix-20261025/desktop');
const makeGuard=require(path.join(desktop,'canvas-backup-guard.cjs')),fingerprint=makeGuard.fingerprint;
const shell=fs.readFileSync(path.join(desktop,'shell.js'),'utf8');
const start=shell.indexOf('function tabIdentity('),end=shell.indexOf('\nfunction ',start+1);
const env={URL,homeUrl:'file:///C:/app/index.html'};vm.runInNewContext(shell.slice(start,end),env);
test('opening either legacy desktop entry loads the corrected production canvas and preserves folder/hash',()=>{
 const from=shell.indexOf('function normalizedUrl('),to=shell.indexOf('function tabIdentity(',from);
 const context={URL,homeUrl:'file:///C:/app/index.html'};vm.runInNewContext(shell.slice(from,to),context);
 for(const entry of ['ai-node-canvas.html','ai-node-canvas-v2.html']){
  const result=new URL(context.normalizedUrl(entry+'?project=A%26B&theme=dark&workspace=old#node-2'));
  assert.equal(result.pathname,'/C:/app/ai-node-canvas-test.html');assert.equal(result.searchParams.get('workspace'),'production');
  assert.equal(result.searchParams.get('project'),'A&B');assert.equal(result.searchParams.get('theme'),'dark');assert.equal(result.hash,'#node-2');
 }
 for(const entry of ['ai-node-canvas-test.html?workspace=isolated','https://example.test/ai-node-canvas.html?project=remote']){
  assert.equal(context.normalizedUrl(entry),new URL(entry,context.homeUrl).href);
 }
});
test('production entry aliases and query order reuse a folder, isolated test and other folders remain separate',()=>{
 const key=env.tabIdentity;
 const production=key('ai-node-canvas-v2.html?project=folder1');
 for(const url of ['ai-node-canvas.html?project=folder1','ai-node-canvas-test.html?workspace=production&project=folder1','ai-node-canvas-test.html?project=folder1&theme=dark&workspace=production#node-2','ai-node-canvas-v2.html?workspace=other&project=folder1'])assert.equal(key(url),production,url);
 for(const url of ['ai-node-canvas-test.html?project=folder1','ai-node-canvas-test.html?project=folder1&workspace=other','ai-node-canvas-v2.html?project=folder2','file:///C:/other/ai-node-canvas-v2.html?project=folder1','https://example.test/ai-node-canvas-v2.html?project=folder1'])assert.notEqual(key(url),production,url);
 assert.equal(key('ai-node-canvas-v2.html?project=A%26B'),key('ai-node-canvas.html?project=A%26B'));
});
function fixture(){
 const disk=new Map(),writes=[],failed=new Set();let clock=1,active=0,max=0;
 const keyFor=p=>`${p.folderId}/${p.projectId}`;
 const guard=makeGuard({keyFor,latest:async p=>disk.get(keyFor(p))||null,write:async p=>{
  max=Math.max(max,++active);await new Promise(r=>setTimeout(r,2));active--;
  if(failed.has(p.state.nodes[0]?.title))return {success:false,error:'disk full'};
  const result={success:true,fingerprint:fingerprint(p.state),path:'snapshot-'+clock++,savedAt:p.state.savedAt};
  disk.set(keyFor(p),{...result,state:structuredClone(p.state)});writes.push(structuredClone(p));return result;
 }});
 const payload=(title,folderId='folder',projectId='project')=>({folderId,projectId,state:{savedAt:clock++,folderId,projectId,nodes:[{id:'1',title}],links:[],nodeId:2,view:{zoom:1,x:0,y:0}}});
 const read=(owner,p)=>guard.rememberRead(owner,p,{success:true,states:disk.get(keyFor(p))?[disk.get(keyFor(p)).state]:[]});
 return{guard,payload,read,disk,writes,failed,maximum:()=>max};
}
test('unchanged stale close skips older content repeatedly, subsequent dirty save conflicts until actual reload',async()=>{
 const f=fixture(),original=f.payload('original');assert.equal((await f.guard.save('A',original)).success,true);f.read('B',original);
 const newer=f.payload('newer');await f.guard.save('A',newer);
 for(let i=0;i<2;i++){const result=await f.guard.save('B',{...original,state:{...original.state,savedAt:100+i}});assert.equal(result.newerVersionPreserved,true)}
 const dirty=f.payload('old-reader-edit');const rejected=await f.guard.save('B',dirty);assert.equal(rejected.conflict,true);assert.match(rejected.error,/先导出/);assert.equal(f.writes.length,2);assert.equal(f.disk.get('folder/project').state.nodes[0].title,'newer');
 f.read('B',newer);assert.equal((await f.guard.save('B',dirty)).success,true);assert.equal(f.writes.length,3);
});
test('project queues serialize concurrent writers; exactly one stale dirty edit commits',async()=>{
 const f=fixture(),original=f.payload('original');await f.guard.save('seed',original);f.read('A',original);f.read('B',original);
 const results=await Promise.all([f.guard.save('A',f.payload('edit-A')),f.guard.save('B',f.payload('edit-B'))]);
 assert.equal(results.filter(x=>x.success).length,1);assert.equal(results.filter(x=>x.conflict).length,1);assert.equal(f.maximum(),1);
});
test('failed write does not advance a baseline; new/legacy callers without a baseline stay writable',async()=>{
 const f=fixture(),p=f.payload('original');await f.guard.save('A',p);f.read('B',p);f.failed.add('broken');
 assert.equal((await f.guard.save('B',f.payload('broken'))).success,false);await f.guard.save('A',f.payload('newer'));
 assert.equal((await f.guard.save('B',p)).newerVersionPreserved,true);
 assert.equal((await f.guard.save('legacy-first-write',f.payload('legacy'))).success,true);
});
test('queued pagehide writes keep their stale baseline after the renderer is destroyed',async()=>{
 const f=fixture(),p=f.payload('original');await f.guard.save('A',p);f.read('B',p);
 const newer=f.guard.save('A',f.payload('newer'));
 const closing=f.guard.save('B',p);f.guard.disposeOwner('B');
 await newer;assert.equal((await closing).newerVersionPreserved,true);assert.equal(f.disk.get('folder/project').state.nodes[0].title,'newer');
});
test('folder identity separates equal project IDs and catalog reads select the newest state',async()=>{
 const f=fixture(),p=f.payload('old');await f.guard.save('A',p);const n=f.payload('new');await f.guard.save('A',n);
 f.guard.rememberRead('B',{folderId:'folder',allProjects:true},{success:true,projectStates:[{projectId:'project',states:[p.state,n.state]}]});
 assert.equal((await f.guard.save('B',f.payload('B-edit'))).success,true);
 assert.equal((await f.guard.save('C',f.payload('other','another-folder','project'))).success,true);
 assert.equal(f.disk.size,2);
});
test('canonical fingerprints match stored refs, runtime URLs, inline media and optional restore defaults',()=>{
 const data='data:image/png;base64,AA==';const id='sha256-'+require('node:crypto').createHash('sha256').update(data).digest('hex');
 const a={savedAt:1,nodes:[{id:'1',mediaUrl:`indexed-media:${id}`}],links:[]};
 const b={nodes:[{mediaUrl:`wandou-media://${'a'.repeat(64)}/${id}`,id:'1',sourceUrl:'',references:[],promptRefineLoading:false,promptOptimizeOpen:false,mediaSaveWarnings:[{retryAfter:999,error:'HTTP 404'}]}],savedAt:99};
 assert.equal(fingerprint(a),fingerprint(b));b.nodes[0].mediaUrl=data;assert.equal(fingerprint(a),fingerprint(b));b.nodes[0].title='edit';assert.notEqual(fingerprint(a),fingerprint(b));
});
