import { fail, query, checkConfig } from '../../../lib/vercel/shared.js';

// GET/HEAD /api/media/audio/:id  and  /api/media/cover/:id
// Redirects (307) to the Vercel Blob URL stored on the track row. S3 honours HTTP
// Range requests directly, so the player can seek without proxying bytes here.
// The "?v=N" cache-buster on the /api/media URL is ignored; the blob is rewritten
// in place at the same key when replaced.
export default async function handler(req, { params }) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return fail('Method not allowed.', 405);
  const missing = checkConfig();
  if (missing) return missing;
  if (!['audio', 'cover'].includes(params.kind) || !/^[0-9a-f-]{36}$/i.test(params.id)) {
    return new Response('Not found', { status: 404 });
  }

  const { rows } = await query(
    'SELECT audio_url, cover_url FROM tracks WHERE id = $1',
    [params.id]
  );
  const row = rows[0];
  const url = params.kind === 'audio' ? row?.audio_url : row?.cover_url;
  if (!url) return new Response('Not found', { status: 404 });

  return new Response(null, {
    status: 307,
    headers: {
      location: url,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
}
