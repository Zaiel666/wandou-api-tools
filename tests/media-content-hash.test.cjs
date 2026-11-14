const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const hash=require('../app/media-content-hash.js');
test('full media digest equals native SHA256 across padding boundaries, Unicode and large data URLs',async()=>{
 for(const size of [0,1,55,56,63,64,65,1000,4096,1000000]){
  const value='图😀abc'.repeat(size), expected='sha256-'+crypto.createHash('sha256').update(value).digest('hex');
  assert.equal(hash.id(value),expected);hash.clear();assert.equal(await hash.idAsync(value),expected);
 }
});
test('equal-length valid BMPs differing outside the former sample positions have separate IDs',()=>{
 const b=Buffer.alloc(54+300*100);b.write('BM');b.writeUInt32LE(b.length,2);b.writeUInt32LE(54,10);b.writeUInt32LE(40,14);b.writeInt32LE(100,18);b.writeInt32LE(100,22);b.writeUInt16LE(1,26);b.writeUInt16LE(24,28);
 const a='data:image/bmp;base64,'+b.toString('base64'), stride=Math.floor(a.length/4096);let p=121;while(p%stride===0)p++;
 const changed=a.slice(0,p)+(a[p]==='A'?'B':'A')+a.slice(p+1);
 assert.equal(a.length,changed.length);assert.notEqual(hash.id(a),hash.id(changed));assert.equal(hash.id(a),hash.id(a));
});
