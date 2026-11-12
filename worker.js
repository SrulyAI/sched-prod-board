// Runs only for /video/* (run_worker_first in wrangler.jsonc). Every other path is a free static asset.
// Static Assets answer Range requests with the whole file (200); this answers them with 206 + Content-Range,
// so players that need byte ranges (Safari) can play the recording. No KV, no other bindings.

const RANGE = /^bytes=(\d*)-(\d*)$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/video/') || !['GET', 'HEAD'].includes(request.method)) {
      return env.ASSETS.fetch(request);
    }
    const asset = await env.ASSETS.fetch(new Request(url, { method: 'GET' }));
    if (!asset.ok) return asset;

    const body = await asset.arrayBuffer();
    const size = body.byteLength;
    const headers = new Headers({
      'content-type': asset.headers.get('content-type') || 'video/webm',
      'accept-ranges': 'bytes',
      'cache-control': 'public, max-age=300',
    });
    const etag = asset.headers.get('etag');
    if (etag) headers.set('etag', etag);

    const range = request.headers.get('range');
    const m = range && RANGE.exec(range.trim());
    if (!range || !m || (m[1] === '' && m[2] === '')) {
      // No range, or a form we do not serve (e.g. several ranges): the whole file.
      headers.set('content-length', String(size));
      return new Response(request.method === 'HEAD' ? null : body, { status: 200, headers });
    }

    let start, end;
    if (m[1] === '') {
      const n = Number(m[2]); // suffix: last n bytes
      start = Math.max(0, size - n);
      end = size - 1;
    } else {
      start = Number(m[1]);
      end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
    }
    if (start >= size || start > end) {
      headers.set('content-range', `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    headers.set('content-range', `bytes ${start}-${end}/${size}`);
    headers.set('content-length', String(end - start + 1));
    return new Response(request.method === 'HEAD' ? null : body.slice(start, end + 1), { status: 206, headers });
  },
};
