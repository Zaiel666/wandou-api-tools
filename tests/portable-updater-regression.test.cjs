'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {writeProgramManifest}=require('../scripts/write-program-manifest.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
test('program manifest hashes exact package bytes and includes only deterministic public baseline metadata',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wandou-manifest-')),pkg=path.join(dir,'package'),base=path.join(dir,'baselines.json');
 fs.mkdirSync(path.join(pkg,'程序文件/resources/app'),{recursive:true});fs.writeFileSync(path.join(pkg,'程序文件/resources/app/VERSION.txt'),'v2.0.23');fs.writeFileSync(base,JSON.stringify([{version:'2.0.22',files:{'豌豆AI工具.exe':'a'.repeat(64)}}]));
 assert.equal(writeProgramManifest(pkg,'2.0.23',base),1);const name=path.join(pkg,'.wandou-program-manifest.json'),before=fs.readFileSync(name);writeProgramManifest(pkg,'2.0.23',base);assert.deepEqual(fs.readFileSync(name),before);
 const manifest=JSON.parse(before);assert.equal(manifest.schemaVersion,1);assert.equal(manifest.files['程序文件/resources/app/VERSION.txt'],sha(Buffer.from('v2.0.23')));assert.equal(Object.hasOwn(manifest.files,'.wandou-program-manifest.json'),false);
});
test('manifest builder refuses linked package content',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wandou-manifest-link-')),pkg=path.join(dir,'package'),outside=path.join(dir,'outside'),baseline=path.join(dir,'baselines.json');fs.mkdirSync(pkg);fs.mkdirSync(outside);fs.writeFileSync(baseline,'[]');fs.symlinkSync(outside,path.join(pkg,'程序文件'),'junction');assert.throws(()=>writeProgramManifest(pkg,'2.0.23',baseline),/link/);assert.deepEqual(fs.readdirSync(outside),[]);});
