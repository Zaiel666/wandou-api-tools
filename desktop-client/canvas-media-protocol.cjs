const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Worker } = require('node:worker_threads');

const scheme = 'wandou-media';
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const workerCode = String.raw`
const { parentPort } = require('node:worker_threads');
const fs = require('node:fs/promises');
parentPort.on('message', async ({id, file}) => {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Invalid media file');
    const value = await fs.readFile(file, 'utf8');
    const comma = value.indexOf(',');
    const header = value.slice(0, comma);
    const mime = /^data:(image\/[a-z0-9.+-]+)(?:;[^,]*)?$/i.exec(header)?.[1];
    if (!mime || comma < 0 || comma > 1024) throw Error('Unsupported image data');
    const body = value.slice(comma + 1);
    const bytes = /;base64(?:;|$)/i.test(header)
      ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body), 'utf8');
    if (!bytes.length) throw Error('Empty image');
    const output = new Uint8Array(bytes.length); output.set(bytes);
    parentPort.postMessage({id, mime: mime.toLowerCase(), bytes: output}, [output.buffer]);
  } catch (error) { parentPort.postMessage({id, error: error.message}); }
});`;

module.exports = function createCanvasMediaProtocol({ directory }) {
  const token = crypto.randomBytes(32).toString('hex');
  let worker, sequence = 0, current, queue = Promise.resolve(), disposed = false;
  const inflight = new Map();
  const fileFor = id => path.join(directory(), `${id}.data`);
  async function getUrl(id) {
    if (!validId(id)) return { success: false, error: 'Invalid media id' };
    let handle;
    try {
      const stat = await fs.lstat(fileFor(id));
      if (!stat.isFile() || stat.isSymbolicLink()) return { success: false, error: 'Invalid media file' };
      handle = await fs.open(fileFor(id), 'r');
      const prefix = Buffer.alloc(1025);
      const { bytesRead } = await handle.read(prefix, 0, prefix.length, 0);
      const header = prefix.toString('utf8', 0, bytesRead).split(',')[0];
      if (!/^data:image\/[a-z0-9.+-]+(?:;[^,]*)?$/i.test(header) || !prefix.subarray(0, bytesRead).includes(44)) {
        return { success: false, unsupported: true };
      }
      return { success: true, url: `${scheme}://${token}/${id}` };
    } catch (error) {
      return { success: false, missing: error.code === 'ENOENT', error: error.message };
    } finally { await handle?.close().catch(() => {}); }
  }
  function decode(id) {
    if (inflight.has(id)) return inflight.get(id);
    const task = queue.catch(() => {}).then(() => new Promise((resolve, reject) => {
      if (disposed) { reject(new Error('Application closing')); return; }
      if (!worker) {
        worker = new Worker(workerCode, { eval: true });
        const decoder = worker;
        worker.unref();
        worker.on('message', message => {
          if (current?.id !== message.id) return;
          const active = current; current = null;
          if (message.error) active.reject(new Error(message.error)); else active.resolve(message);
        });
        worker.on('error', error => { if (worker !== decoder) return; const active = current; current = null; worker = null; active?.reject(error); });
        worker.on('exit', () => { if (worker !== decoder) return; const active = current; current = null; worker = null; active?.reject(new Error('Image decoder stopped')); });
      }
      current = { id: ++sequence, resolve, reject };
      worker.postMessage({ id: sequence, file: fileFor(id) });
    }));
    queue = task.catch(() => {});
    inflight.set(id, task);
    task.finally(() => inflight.delete(id)).catch(() => {});
    return task;
  }
  async function handle(request) {
    let url;
    try { url = new URL(request.url); } catch (_) { return new Response(null, { status: 400 }); }
    const id = url.pathname.slice(1);
    if (url.protocol !== `${scheme}:` || url.hostname !== token || url.port || url.username || url.password
      || url.search || url.hash || !validId(id) || url.pathname !== `/${id}`) return new Response(null, { status: 404 });
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
    const info = await getUrl(id);
    if (!info.success) return new Response(null, { status: 404 });
    try {
      const decoded = await decode(id);
      return new Response(request.method === 'HEAD' ? null : decoded.bytes, { headers: {
        'Content-Type': decoded.mime, 'Content-Length': String(decoded.bytes.length),
        'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store'
      } });
    } catch (_) { return new Response(null, { status: 404 }); }
  }
  return { getUrl, handle, dispose() { disposed = true; const active = current; current = null; active?.reject(new Error('Application closing')); void worker?.terminate(); worker = null; } };
};
module.exports.scheme = scheme;
