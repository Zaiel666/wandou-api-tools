(function (root) {
  'use strict';
  // Full-content SHA-256. Synchronous history snapshots also need the same ID
  // as asynchronous persistence; bounded caching avoids hashing unchanged media.
  const K = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ]);
  const rotate = (x,n) => (x >>> n) | (x << (32-n));
  const cache = new Map(); let cachedChars = 0;
  const budget = 32 * 1024 * 1024;
  function remember(value, id) {
    if (value.length > budget) return id;
    while (cache.size && (cachedChars + value.length > budget || cache.size >= 24)) {
      const oldest = cache.keys().next().value; cachedChars -= oldest.length; cache.delete(oldest);
    }
    cache.set(value,id); cachedChars += value.length; return id;
  }
  function sha256(value) {
    const bytes = new TextEncoder().encode(value), length = bytes.length;
    const blocks = Math.ceil((length + 9) / 64), w = new Uint32Array(64);
    const h = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
    for (let block=0;block<blocks;block++) {
      w.fill(0);
      for (let j=0;j<64;j++) {
        const p=block*64+j;
        const byte=p<length?bytes[p]:p===length?128:0;
        w[j>>>2] |= byte << (24-(j%4)*8);
      }
      if (block===blocks-1) { w[14]=Math.floor(length/0x20000000);w[15]=(length*8)>>>0; }
      for (let i=16;i<64;i++) {
        const a=w[i-15],b=w[i-2];
        w[i]=(w[i-16]+(rotate(a,7)^rotate(a,18)^(a>>>3))+w[i-7]+(rotate(b,17)^rotate(b,19)^(b>>>10)))>>>0;
      }
      let [a,b,c,d,e,f,g,hh]=h;
      for (let i=0;i<64;i++) {
        const t1=(hh+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+K[i]+w[i])>>>0;
        const t2=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))>>>0;
        hh=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;
      }
      [a,b,c,d,e,f,g,hh].forEach((v,i)=>h[i]=(h[i]+v)>>>0);
    }
    return Array.from(h,n=>n.toString(16).padStart(8,'0')).join('');
  }
  function id(value) {
    value=String(value);
    if (cache.has(value)) return cache.get(value);
    return remember(value,'sha256-'+sha256(value));
  }
  async function idAsync(value) {
    value=String(value);
    if (cache.has(value)) return cache.get(value);
    if (!root.crypto?.subtle) return id(value);
    const digest = await root.crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
    // Another request may have populated the cache while the native digest ran.
    if (cache.has(value)) return cache.get(value);
    return remember(value,'sha256-'+Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join(''));
  }
  const api={id,idAsync,clear:()=>{cache.clear();cachedChars=0;}};
  root.WandouMediaHash=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);
