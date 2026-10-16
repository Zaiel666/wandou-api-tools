const {contextBridge,ipcRenderer,webUtils}=require('electron');
contextBridge.exposeInMainWorld('wandouDirectorNative',{
  convertBlend(file,requestId){
    const source=webUtils.getPathForFile(file);
    if(!source)return Promise.resolve({success:false,error:'请选择本机磁盘上的 Blender 文件。'});
    return ipcRenderer.invoke('director:convert-blend',{source,requestId});
  },
  cancel(requestId){ipcRenderer.send('director:cancel-blend',{requestId});}
});
