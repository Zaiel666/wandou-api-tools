'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),crypto=require('node:crypto'),path=require('node:path'),os=require('node:os');
const safeListen=require('./safe-loopback-v233.cjs'),{download}=require('../desktop-client/update-resume.cjs');
const contents=crypto.createHash('sha256').update('synthetic repeatable payload').digest();const data=Buffer.alloc(262144);for(let i=0;i<data.length;i++)data[i]=contents[i%contents.length];const sha=crypto.createHash('sha256').update(data).digest('hex'),split=65536,etag='"stable-fixture"';
for(const mode of ['resume','wrong-etag','ignore-range'])test('real loopback HTTP: '+mode,async()=>{
 const requests=[],sockets=new Set(),dir=await fs.mkdtemp(path.join(os.tmpdir(),'wandou-resume-http-')),destination=path.join(dir,'update.zip');
 const server=http.createServer((req,res)=>{requests.push({range:req.headers.range||null,ifRange:req.headers['if-range']||null});if(requests.length===1){res.writeHead(200,{'Content-Length':data.length,ETag:etag});res.write(data.subarray(0,split),()=>setTimeout(()=>res.destroy(),80));return;}
  if(mode==='ignore-range'){res.writeHead(200,{'Content-Length':data.length,ETag:etag});res.end(data);return;}
  const m=/^bytes=(\d+)-$/.exec(req.headers.range||'');if(!m||req.headers['if-range']!==etag){res.writeHead(400);res.end();return;}const at=Number(m[1]),body=data.subarray(at);res.writeHead(206,{'Content-Length':body.length,'Content-Range':`bytes ${at}-${data.length-1}/${data.length}`,ETag:mode==='wrong-etag'?'"changed"':etag});res.end(body);
 });server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 try{const port=await safeListen(server),url=`http://127.0.0.1:${port}/synthetic.zip`;const fetchResponse=(u,opts)=>fetch(u,{signal:opts.signal,headers:opts.start===null?{}:{Range:`bytes=${opts.start}-`,'If-Range':opts.etag}});const action=()=>download({url,destination,expectedSha256:sha,fetchResponse,idleMs:1000,totalMs:8000});
  if(mode==='resume'){const r=await action();assert.equal(r.attempts,2);assert.equal(r.bytes,data.length);assert.deepEqual(await fs.readFile(destination),data);assert.equal(requests[1].range,`bytes=${split}-`);assert.equal(requests[1].ifRange,etag);}else{await assert.rejects(action());assert.deepEqual(await fs.readdir(dir),[]);}assert.equal(requests.length,2);
 }finally{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}
});
