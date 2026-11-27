import { checkBindings } from '../../../../lib/shared.js';

// GET /api/media/audio/:id  and  GET /api/media/cover/:id
// Supports HTTP Range requests so the player can seek.
export async function onRequest({ request, env, params }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
  const missing = checkBindings(env);
  if (missing) return missing;
  if (!['audio', 'cover'].includes(params.kind) || !/^[0-9a-f-]{36}$/i.test(params.id)) {
    return new Response('Not found', { status: 404 });
  }

  const item = await env.MEDIA.getWithMetadata(`${params.kind}:${params.id}`, { type: 'arrayBuffer' });
  if (!item.value) return new Response('Not found', { status: 404 });

  const body = item.value;
  const total = body.byteLength;
  const headers = {
    'content-type': item.metadata?.type || (params.kind === 'audio' ? 'audio/mpeg' : 'image/jpeg'),
    'accept-ranges': 'bytes',
    // URLs carry a ?v= version that changes whenever the file is replaced.
    'cache-control': 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  };

  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '');
  if (range && (range[1] || range[2])) {
    let start, end;
    if (range[1]) {
      start = Number(range[1]);
      end = range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
    } else {
      start = Math.max(0, total - Number(range[2]));
      end = total - 1;
    }
    if (start >= total || start > end) {
      return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${total}` } });
    }
    const slice = body.slice(start, end + 1);
    return new Response(request.method === 'HEAD' ? null : slice, {
      status: 206,
      headers: { ...headers, 'content-range': `bytes ${start}-${end}/${total}`, 'content-length': String(slice.byteLength) },
    });
  }

  return new Response(request.method === 'HEAD' ? null : body, {
    headers: { ...headers, 'content-length': String(total) },
  });
}
