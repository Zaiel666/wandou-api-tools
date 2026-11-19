const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const page=fs.readFileSync(require('node:path').join(process.env.WANDOU_TEST_APP_ROOT||require('node:path').join(__dirname,'../app'),'ai-node-canvas-test.html'),'utf8');
const start=page.indexOf('    window.wandouSaveBeforeClose = async () => {');
const code=page.slice(start,page.indexOf('    document.addEventListener("visibilitychange"',start));
function fixture({ready=true,present=true,durable=true,backup=true,recovery=false,archiving=false,busy=false,apiBusy=false}={}){
 const writes=[];
 const state={nodes:[{id:'existing-node'}],savedAt:123};
 const context={projectId:'existing',state,browserBackupSaved:true};
 const env={apiConfigBusy:apiBusy,window:{wandouShell:{writeCanvasBackup:()=>{}}},document:{body:{dataset:{canvasReady:String(ready)}},querySelector:()=>present?{}:null},clearTimeout:()=>{},setTimeout:()=>{},saveTimer:null,projects:[{id:'existing',name:'原项目'}],activeProjectId:'existing',canvasRecoveryBlocked:recovery,canvasSaveQueue:Promise.resolve(),createCanvasSaveContext:()=>context,saveCanvasStateImmediate:()=>writes.push('local'),saveCanvasStateNow:async()=>{writes.push('durable');return durable},writeDesktopCanvasBackup:async()=>{writes.push('desktop');return {success:backup,path:'backup'}},verifyCanvasStateSaved:()=>true};
 env.deletedResultArchiveJobs=new Map(archiving?[['synthetic-archive',{}]]:[]);
 env.canvasHasActiveTasks=()=>busy;
 vm.runInNewContext(code,env);return {save:env.window.wandouSaveBeforeClose,writes};
}
for(const settings of [{ready:false},{present:false},{recovery:true}])test('unready or recovery-blocked canvas never writes '+JSON.stringify(settings),async()=>{const f=fixture(settings);assert.equal((await f.save()).success,false);assert.deepEqual(f.writes,[])});
test('initialized production canvas saves locally and to desktop before allowing close',async()=>{const f=fixture();const result=await f.save();assert.equal(result.success,true);assert.equal(result.projectId,'existing');assert.equal(result.nodeCount,1);assert.deepEqual(f.writes,['local','durable','desktop'])});
for(const settings of [{durable:false},{backup:false}])test('failed persistence blocks close and update '+JSON.stringify(settings),async()=>{const f=fixture(settings);assert.equal((await f.save()).success,false)});
test('failed media persistence never commits an incomplete desktop snapshot',async()=>{const f=fixture({durable:false});assert.equal((await f.save()).success,false);assert.deepEqual(f.writes,['local','durable'])});
test('active deleted-original archive refuses close before starting another snapshot',async()=>{const f=fixture({archiving:true});const result=await f.save();assert.equal(result.success,false);assert.equal(result.busy,true);assert.deepEqual(f.writes,[])});
test('other active work still refuses close after a successful progress snapshot',async()=>{const f=fixture({busy:true});const result=await f.save();assert.equal(result.success,false);assert.equal(result.busy,true);assert.deepEqual(f.writes,['local','durable','desktop'])});

test('pending API settings refuse close before any project write',async()=>{const f=fixture({apiBusy:true});const result=await f.save();assert.equal(result.success,false);assert.equal(result.busy,true);assert.match(result.error,/API/);assert.deepEqual(f.writes,[])});
