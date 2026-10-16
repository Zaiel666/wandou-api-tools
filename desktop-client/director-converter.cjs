// Narrow native conversion service: only .blend -> GLB, no shell commands from UI.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {spawn} = require('node:child_process');
const MAX_SOURCE = 64 * 1024 * 1024;
const MAX_OUTPUT = 20 * 1024 * 1024;
async function findBlender() {
  const root = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Blender Foundation');
  const entries = await fs.readdir(root, {withFileTypes:true}).catch(()=>[]);
  for (const entry of entries.filter(item=>item.isDirectory()).sort((a,b)=>b.name.localeCompare(a.name,undefined,{numeric:true}))) {
    const exe = path.join(root,entry.name,'blender.exe');
    if ((await fs.stat(exe).catch(()=>null))?.isFile()) return exe;
  }
  throw new Error('没有找到 Blender，请先安装 Blender 到默认位置，再重新导入。');
}
function runBlender(exe, args, signal, timeoutMs) {
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(new Error('转换已取消。'));return;}
    const child=spawn(exe,args,{windowsHide:true,shell:false,stdio:'ignore'});
    let timedOut=false,finished=false;
    const cancel=()=>child.kill();
    const timer=setTimeout(()=>{timedOut=true;child.kill();},timeoutMs);
    signal?.addEventListener('abort',cancel,{once:true});
    function finish(error) {if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);error?reject(error):resolve();}
    child.once('error',()=>finish(new Error('无法启动 Blender，请检查安装状态。')));
    child.once('close',code=>finish(signal?.aborted?new Error('转换已取消。'):timedOut?new Error('转换超过两分钟，已停止。请精简模型后重试。'):code!==0?new Error('Blender 转换失败，请确认工程可在 Blender 中打开。'):null));
  });
}
async function convertBlend(source, {signal, blender, timeoutMs=120000, tempRoot=os.tmpdir()}={}) {
  if(typeof source!=='string'||path.extname(source).toLowerCase()!=='.blend')throw new Error('请选择磁盘上的 .blend 文件。');
  const real=await fs.realpath(source);
  if(path.extname(real).toLowerCase()!=='.blend')throw new Error('文件类型无效。');
  const stat=await fs.stat(real);
  if(!stat.isFile()||stat.size===0||stat.size>MAX_SOURCE)throw new Error('Blender 工程必须大于 0 且不超过 64 MB。');
  if(signal?.aborted)throw new Error('转换已取消。');
  const exe=blender||await findBlender();
  const directory=await fs.mkdtemp(path.join(tempRoot,'wandou-director-blend-'));
  try {
    const output=path.join(directory,'converted.glb');
    const script=path.resolve(__dirname,'../tools/director-blender/convert-blend.py');
    await runBlender(exe,['--background','--factory-startup','--disable-autoexec','--python-exit-code','1','--python',script,'--',real,output],signal,timeoutMs);
    if(signal?.aborted)throw new Error('转换已取消。');
    const result=await fs.stat(output);
    if(result.size<12||result.size>MAX_OUTPUT)throw new Error('转换后的模型超过 20 MB 或结果无效，请精简模型后重试。');
    const bytes=await fs.readFile(output);
    if(bytes.toString('ascii',0,4)!=='glTF')throw new Error('转换结果不是有效的 GLB 文件。');
    return {success:true,dataUrl:'data:model/gltf-binary;base64,'+bytes.toString('base64'),name:path.basename(real),kind:'glb'};
  } finally {
    // Only the exact mkdtemp-created child is eligible for removal.
    const resolved=path.resolve(directory),parent=path.resolve(tempRoot);
    if(path.dirname(resolved)===parent&&path.basename(resolved).startsWith('wandou-director-blend-'))await fs.rm(resolved,{recursive:true,force:true});
  }
}
module.exports={convertBlend,findBlender,MAX_SOURCE,MAX_OUTPUT};
