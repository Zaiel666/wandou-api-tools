'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function writeProgramManifest(root, version, baselinesPath) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('Invalid manifest version');
  const files = {};
  const visit = directory => {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name), relative = path.relative(root, file).replaceAll('\\', '/');
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw Error('Program package contains a link');
      if (stat.isDirectory()) visit(file);
      else if (relative !== '.wandou-program-manifest.json') files[relative] = sha(fs.readFileSync(file));
    }
  };
  visit(root);
  const baselines = JSON.parse(fs.readFileSync(baselinesPath, 'utf8').replace(/^\uFEFF/, ''));
  if (!Array.isArray(baselines) || !baselines.length) throw Error('Verified transition baselines missing');
  fs.writeFileSync(path.join(root, '.wandou-program-manifest.json'), JSON.stringify({ schemaVersion: 1, version, files, baselines }, null, 2) + '\n');
  return Object.keys(files).length;
}
module.exports = { writeProgramManifest };
if (require.main === module) console.log(`Managed package files: ${writeProgramManifest(...process.argv.slice(2))}`);
