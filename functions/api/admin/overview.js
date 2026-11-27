import { json, requireAdmin, adminTrack, TRACK_COLUMNS, LIMITS } from '../../../lib/shared.js';

// GET /api/admin/overview (admin) -> every track (drafts too), which files exist in KV, and stats
export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  const [tracks, visitors, quota, audioKeys] = await Promise.all([
    env.DB.prepare(`SELECT ${TRACK_COLUMNS} FROM tracks ORDER BY created_at DESC`).all(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM visitors').first(),
    env.DB.prepare('SELECT used_bytes FROM quota WHERE id = 1').first(),
    listKeys(env, 'audio:'),
  ]);

  return json({
    tracks: tracks.results.map(row => ({ ...adminTrack(row), audioMissing: !audioKeys.has(`audio:${row.id}`) })),
    stats: {
      visitors: visitors?.n || 0,
      usedBytes: quota?.used_bytes || 0,
      freeStorageBytes: LIMITS.freeStorageBytes,
      maxAudioBytes: LIMITS.audioBytes,
    },
  });
}

async function listKeys(env, prefix) {
  const keys = new Set();
  let cursor;
  do {
    const page = await env.MEDIA.list({ prefix, cursor });
    page.keys.forEach(k => keys.add(k.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return keys;
}
