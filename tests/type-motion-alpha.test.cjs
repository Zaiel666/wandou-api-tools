const test=require('node:test'),assert=require('node:assert/strict'),zlib=require('node:zlib');
const {encoder}=require('../app/type-motion-alpha.js');
function png(rgba){const header=Buffer.alloc(13);header.writeUInt32BE(1,0);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;const ch=(name,data)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(name,4);data.copy(b,8);return b;};return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch('IHDR',header),ch('IDAT',zlib.deflateSync(Buffer.from([0,...rgba]))),ch('IEND',Buffer.alloc(0))]);}
test('APNG preserves alpha, delay, sequence, SOURCE blending and valid CRCs',async()=>{
 const w=encoder(2,.25);w.add(png([255,0,0,128]));w.add(png([0,255,0,0]));const b=Buffer.from(await w.finish().arrayBuffer()),chunks=[];
 for(let p=8;p<b.length;){const n=b.readUInt32BE(p),type=b.toString('ascii',p+4,p+8),data=b.subarray(p+8,p+8+n);let crc=0xffffffff;for(const x of b.subarray(p+4,p+8+n)){crc^=x;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}assert.equal(b.readUInt32BE(p+8+n),(crc^0xffffffff)>>>0);chunks.push({type,data});p+=n+12;}
 assert.deepEqual(chunks.map(c=>c.type),['IHDR','acTL','fcTL','IDAT','fcTL','fdAT','IEND']);
 assert.equal(chunks[1].data.readUInt32BE(0),2);assert.equal(chunks[1].data.readUInt32BE(4),0);
 assert.deepEqual(chunks.filter(c=>['fcTL','fdAT'].includes(c.type)).map(c=>c.data.readUInt32BE(0)),[0,1,2]);
 for(const c of chunks.filter(c=>c.type==='fcTL')){assert.equal(c.data.readUInt16BE(20),250);assert.equal(c.data.readUInt16BE(22),1000);assert.equal(c.data[25],0);}
 assert.deepEqual([...zlib.inflateSync(chunks[3].data)],[0,255,0,0,128]);assert.deepEqual([...zlib.inflateSync(chunks[5].data.subarray(4))],[0,0,255,0,0]);
 assert.throws(()=>encoder(1,.1).finish(),/未完成/);
});
