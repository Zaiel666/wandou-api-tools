// Isolated desktop test entry: does not expose the production wandouShell APIs.
const {app,BrowserWindow,ipcMain,Menu}=require('electron');
const path=require('node:path');
const {fileURLToPath}=require('node:url');
const {convertBlend}=require('./director-converter.cjs');
app.setPath('userData',path.join(app.getPath('appData'),'Wandou-Director-Test'));
const page=path.resolve(__dirname,'../app/ai-node-canvas-test.html');
let win,job;
function trusted(event){
  if(!win||event.sender!==win.webContents||event.senderFrame!==event.sender.mainFrame)return false;
  try{return path.resolve(fileURLToPath(event.senderFrame.url)).toLowerCase()===page.toLowerCase();}catch{return false;}
}
ipcMain.handle('director:convert-blend',async(event,payload={})=>{
  if(!trusted(event))return {success:false,error:'仅允许本地导演台测试页转换。'};
  if(job)return {success:false,error:'已有转换正在进行，请稍候。'};
  if(!/^[a-zA-Z0-9-]{1,80}$/.test(payload.requestId||''))return {success:false,error:'无效请求。'};
  let complete;
  const current={id:payload.requestId,controller:new AbortController(),done:new Promise(resolve=>{complete=resolve;})};job=current;
  try{return await convertBlend(payload.source,{signal:current.controller.signal});}
  catch(error){return {success:false,error:error.message||'转换失败。'};}
  finally{if(job===current)job=null;complete();}
});
ipcMain.on('director:cancel-blend',(event,payload={})=>{if(trusted(event)&&job?.id===payload.requestId)job.controller.abort();});
app.whenReady().then(()=>{
  Menu.setApplicationMenu(null);
  win=new BrowserWindow({width:1450,height:950,title:'豌豆 AI · 导演台独立测试版',webPreferences:{preload:path.join(__dirname,'director-test-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  win.webContents.on('render-process-gone',()=>job?.controller.abort());
  win.on('closed',()=>{job?.controller.abort();win=null;});
  win.loadFile(page);
});
app.on('before-quit',event=>{if(job){event.preventDefault();const current=job;current.controller.abort();current.done.then(()=>app.quit());}});
app.on('window-all-closed',()=>app.quit());
