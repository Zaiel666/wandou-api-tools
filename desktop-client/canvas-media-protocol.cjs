const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Worker } = require('node:worker_threads');

const scheme = 'wandou-media';
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const workerCode = String.raw`
const { parentPort } = require('node:worker_threads');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
parentPort.on('message', async ({id, file, mediaId}) => {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Invalid media file');
    const value = await fs.readFile(file, 'utf8');
    if (mediaId.startsWith('sha256-') && mediaId !== 'sha256-' + crypto.createHash('sha256').update(value, 'utf8').digest('hex')) throw Error('Image content checksum mismatch');
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
  const aborted = () => new DOMException('Image request cancelled', 'AbortError');
  function ensureWorker() {
    if (worker) return;
    const decoder = new Worker(workerCode, { eval: true });
    worker = decoder;
    decoder.unref();
    // These long-lived listeners must not close over a decode entry or its
    // fulfilled promise; that would retain the first full image until shutdown.
    decoder.on('message', message => {
      if (worker !== decoder || current?.id !== message.id) return;
      const active = current; current = null;
      if (message.error) active.reject(new Error(message.error)); else active.resolve(message);
    });
    decoder.on('error', error => { if (worker !== decoder) return; const active = current; current = null; worker = null; active?.reject(error); });
    decoder.on('exit', () => { if (worker !== decoder) return; const active = current; current = null; worker = null; active?.reject(new Error('Image decoder stopped')); });
  }
  function decode(id, signal) {
    if (disposed || signal?.aborted) return Promise.reject(aborted());
    let entry = inflight.get(id);
    if (!entry) {
      entry = { consumers: new Set(), cancelled: false };
      const task = queue.then(() => new Promise((resolve, reject) => {
        if (disposed || entry.cancelled || !entry.consumers.size) { reject(aborted()); return; }
        try {
          ensureWorker();
          current = { id: ++sequence, entry, resolve, reject };
          worker.postMessage({ id: sequence, file: fileFor(id), mediaId: id });
        } catch (error) { if (current?.entry === entry) current = null; reject(error); }
      }));
      entry.task = task;
      // Keep ordering only. A fulfilled promise otherwise retains the last full
      // decoded original for the entire application session.
      queue = task.then(() => undefined, () => undefined);
      inflight.set(id, entry);
      task.finally(() => { if (inflight.get(id) === entry) inflight.delete(id); }).catch(() => {});
    }
    return new Promise((resolve, reject) => {
      const consumer = {};
      entry.consumers.add(consumer);
      let settled = false;
      const finish = () => {
        settled = true;
        entry.consumers.delete(consumer);
        signal?.removeEventListener('abort', cancel);
      };
      const cancel = () => {
        if (settled) return;
        finish(); reject(aborted());
        // A shared read remains alive while another image/export needs it.
        if (!entry.consumers.size) {
          entry.cancelled = true;
          if (inflight.get(id) === entry) inflight.delete(id);
          if (current?.entry === entry) {
            const active = current, decoder = worker;
            current = null; worker = null;
            active.reject(aborted());
            void decoder?.terminate();
          }
        }
      };
      signal?.addEventListener('abort', cancel, { once: true });
      entry.task.then(value => { if (!settled) { finish(); resolve(value); } }, error => { if (!settled) { finish(); reject(error); } });
      if (signal?.aborted) cancel();
    });
  }
  async function handle(request) {
    if (disposed || request.signal?.aborted) return new Response(null, { status: 499 });
    let url;
    try { url = new URL(request.url); } catch (_) { return new Response(null, { status: 400 }); }
    const id = url.pathname.slice(1);
    if (url.protocol !== `${scheme}:` || url.hostname !== token || url.port || url.username || url.password
      || url.search || url.hash || !validId(id) || url.pathname !== `/${id}`) return new Response(null, { status: 404 });
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
    const info = await getUrl(id);
    if (!info.success) return new Response(null, { status: 404 });
    try {
      const decoded = await decode(id, request.signal);
      return new Response(request.method === 'HEAD' ? null : decoded.bytes, { headers: {
        'Content-Type': decoded.mime, 'Content-Length': String(decoded.bytes.length),
        'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store'
      } });
    } catch (error) { return new Response(null, { status: error.name === 'AbortError' ? 499 : 404 }); }
  }
  return { getUrl, handle, dispose() { disposed = true; const active = current, decoder = worker; current = null; worker = null; active?.reject(aborted()); void decoder?.terminate(); } };
};
module.exports.scheme = scheme;
