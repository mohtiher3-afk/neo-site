// Shared helpers for the NEO Pages Functions.
// Storage layout (all on Cloudflare's free plan):
//   D1  (binding DB)    -> track metadata, visitors, quota
//   KV  (binding MEDIA) -> audio files  "audio:<id>"  and covers  "cover:<id>"

export const LIMITS = {
  audioBytes: 25 * 1024 * 1024, // KV's maximum value size is 25 MiB
  coverBytes: 5 * 1024 * 1024,
  freeStorageBytes: 1024 * 1024 * 1024, // KV free plan: 1 GB
};

const AUDIO_TYPES = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
};
const COVER_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

export const fail = (message, status = 400) => json({ error: message }, status);

export function checkBindings(env) {
  if (!env.DB) return fail('The D1 database (binding "DB") is not connected to this Pages project.', 503);
  if (!env.MEDIA) return fail('The KV namespace (binding "MEDIA") is not connected to this Pages project.', 503);
  return null;
}

// Returns a Response when the request is NOT authorised, otherwise null.
export async function requireAdmin(request, env) {
  const expected = env.ADMIN_KEY || '';
  if (expected.length < 12) {
    return fail('ADMIN_KEY is not set (or shorter than 12 characters) in the Pages project settings.', 503);
  }
  const header = request.headers.get('authorization') || '';
  const given = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ]);
  if (!crypto.subtle.timingSafeEqual(a, b)) return fail('Wrong admin key.', 401);
  return checkBindings(env);
}

export function cleanText(value, fallback = '') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
  return text || fallback;
}

export function audioInfo(file) {
  if (!file || typeof file === 'string') return { error: 'Choose an audio file.' };
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const fromType = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'm4a', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav' }[file.type];
  const extension = AUDIO_TYPES[ext] ? ext : fromType;
  if (!extension) return { error: 'Audio must be MP3, M4A or WAV.' };
  if (file.size <= 0) return { error: 'The audio file is empty.' };
  if (file.size > LIMITS.audioBytes) return { error: 'Audio files must be 25 MB or smaller (free plan limit).' };
  return { extension, contentType: AUDIO_TYPES[extension], size: file.size };
}

export function coverInfo(file) {
  if (!file || typeof file === 'string' || file.size === 0) return null;
  if (!COVER_TYPES.includes(file.type)) return { error: 'Cover must be PNG, JPG or WEBP.' };
  if (file.size > LIMITS.coverBytes) return { error: 'Cover artwork must be 5 MB or smaller.' };
  return { contentType: file.type, size: file.size };
}

export async function adjustQuota(env, deltaBytes) {
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO quota (id, used_bytes) VALUES (1, 0)'),
    env.DB.prepare('UPDATE quota SET used_bytes = MAX(0, used_bytes + ?) WHERE id = 1').bind(deltaBytes),
  ]);
}

export function publicTrack(row) {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    audioUrl: `/api/media/audio/${row.id}?v=${row.audio_version || 1}`,
    coverUrl: row.cover_version ? `/api/media/cover/${row.id}?v=${row.cover_version}` : null,
    createdAt: row.created_at,
  };
}

export function adminTrack(row) {
  return {
    ...publicTrack(row),
    sizeBytes: row.size_bytes,
    published: row.published === 1,
    availableAt: row.available_at,
  };
}

export const TRACK_COLUMNS =
  'id, title, artist, size_bytes, content_type, extension, created_at, available_at, published, audio_version, cover_version';
