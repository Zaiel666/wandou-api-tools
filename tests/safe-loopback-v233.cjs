'use strict';
const crypto=require('node:crypto');
// Chromium rejects some system-allocated low ports (e.g. 6000). Pick a
// high loopback-only port, retrying genuine bind collisions without changing
// browser security settings. This helper is used only by isolated tests.
module.exports=async function listenSafe(server,{pick=()=>49152+crypto.randomInt(16348),attempts=40}={}){
  for(let index=0;index<attempts;index++){
    const port=pick();if(!Number.isInteger(port)||port<49152||port>65499)throw Error('Test server port outside safe range');
    try{
      await new Promise((resolve,reject)=>{
        const failed=error=>{server.off('listening',ready);reject(error)};
        const ready=()=>{server.off('error',failed);resolve()};
        server.once('error',failed);server.once('listening',ready);server.listen(port,'127.0.0.1');
      });
      return server.address().port;
    }catch(error){if(!['EADDRINUSE','EACCES'].includes(error.code))throw error;}
  }
  throw Error('Unable to bind an isolated test server port');
};
