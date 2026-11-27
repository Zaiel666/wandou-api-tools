'use strict';
const { Readable } = require('node:stream');

// Electron fetch rejects a manual redirect instead of exposing its response.
// ClientRequest exposes the redirect before following it, so every target can
// still be checked without trusting Chromium's automatic redirect handling.
module.exports = function createUpdateTransport({ net, session, policy }) {
  return async function fetchUpdate(url, options = {}, timeoutMs = 8000) {
    policy.initial(url);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw Error('更新请求超时设置无效');
    if (options.method && options.method !== 'GET') throw Error('更新仅允许读取官方资源');
    const headers = { ...options.headers };
    if (Object.keys(headers).some(name => /^(authorization|proxy-authorization|cookie|range|if-range|accept-encoding|host)$/i.test(name))) throw Error('更新请求不能携带凭据或自行指定部分下载请求');
    // Only the trusted main-process downloader supplies these structured
    // values; callers cannot inject raw range or conditional headers.
    if (options.rangeStart != null || options.ifRange != null) {
      const etag=options.ifRange;
      if (!Number.isSafeInteger(options.rangeStart) || options.rangeStart < 1 || options.rangeStart > 1024*1024*1024 || typeof etag !== 'string' || etag.length>512 || !/^"[\x21\x23-\x7e\x80-\xff]*"$/.test(etag)) throw Error('更新续传参数无效');
      headers.Range=`bytes=${options.rangeStart}-`;
      headers['If-Range']=etag;
    }
    headers['Accept-Encoding']='identity';
    if (options.signal?.aborted) throw options.signal.reason || Error('更新请求已取消');
    return new Promise((resolve, reject) => {
      let request, response, timer, settled = false, ended = false, failed = false, redirects = 0;
      const removeAbort = () => options.signal?.removeEventListener('abort', abort);
      const fail = error => {
        if (failed || ended) return;
        failed = true;
        clearTimeout(timer);
        removeAbort();
        if (!settled) { settled = true; reject(error); }
        if (response && !response.destroyed) response.destroy(error);
        try { request?.abort(); } catch { /* Failure remains the original error. */ }
      };
      const abort = () => fail(options.signal.reason || Error('更新请求已取消'));
      try {
        request = net.request({ url, method: 'GET', session, headers, redirect: 'manual',
          credentials: 'omit', useSessionCookies: false, cache: 'no-store' });
        request.on('error', error => {
          if (!ended) fail(error);
        });
        request.on('redirect', (_status, _method, target) => {
          if (settled) return;
          try {
            // Same limit as the previous six-request loop: at most five hops.
            if (++redirects > 5) throw Error('更新服务器重定向次数过多');
            policy.redirect(target);
            request.followRedirect();
          } catch (error) { fail(error); }
        });
        request.once('response', incoming => {
          response = incoming;
          incoming.once('error', () => { removeAbort(); try { request.abort(); } catch {} });
          if (settled) { incoming.destroy(); return; }
          try {
            const status = incoming.statusCode;
            if (!Number.isInteger(status) || status < 100 || status > 599) throw Error('更新服务器响应无效');
            incoming.once('end', () => { ended = true; removeAbort(); });
            incoming.once('aborted', () => fail(Error('更新响应被中断，原程序未被替换')));
            const body = Readable.toWeb(incoming, { strategy: { highWaterMark: 65536, size: chunk => chunk.byteLength } });
            // Cancel must stop the underlying network request as well as its stream.
            const reader = body.getReader();
            const stream = new ReadableStream({
              async pull(controller) {
                try { const part = await reader.read(); if (part.done) controller.close(); else controller.enqueue(part.value); }
                catch (error) { controller.error(error); }
              },
              async cancel(reason) { ended = true; removeAbort(); try { await reader.cancel(reason); } finally { request.abort(); } }
            }, { highWaterMark: 65536, size: chunk => chunk.byteLength });
            clearTimeout(timer);
            settled = true;
            resolve({ status, ok: status >= 200 && status < 300, body: stream,
              headers: { get(name) { const value = incoming.headers[String(name).toLowerCase()]; return value == null ? null : Array.isArray(value) ? value.join(', ') : String(value); } } });
          } catch (error) { fail(error); }
        });
        request.once('close', () => {
          // Electron 45's Writable autoDestroy emits close after the GET body
          // finishes, while its URLLoader is still waiting for response headers.
          // Only premature writable closure is a failed request; the shared
          // header timer and error event still cover a response that never arrives.
          if (!settled && !request.writableFinished) fail(Error('更新连接提前关闭，原程序未被替换'));
        });
        timer = setTimeout(() => fail(Error('更新请求超时，原程序未被替换')), timeoutMs);
        options.signal?.addEventListener('abort', abort, { once: true });
        request.end();
      } catch (error) { fail(error); }
    });
  };
};
