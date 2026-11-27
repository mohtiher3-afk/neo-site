import { json, requireAdmin, adminTrack, TRACK_COLUMNS, LIMITS, query, listBlob } from '../../lib/vercel/shared.js';

// GET /api/admin/overview (admin) -> every track (drafts too), which audio blobs exist, and stats
export async function GET(req) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const [tracks, visitors, quota, audioKeys] = await Promise.all([
    query(`SELECT ${TRACK_COLUMNS} FROM tracks ORDER BY created_at DESC`),
    query('SELECT COUNT(*) AS n FROM visitors'),
    query('SELECT used_bytes FROM quota WHERE id = 1'),
    listBlob('audio:').then(blobs => new Set(blobs.map(b => b.key))),
  ]);

  return json({
    tracks: tracks.rows.map(row => ({ ...adminTrack(row), audioMissing: !audioKeys.has(`audio:${row.id}`) })),
    stats: {
      visitors: Number(visitors.rows[0]?.n) || 0,
      usedBytes: Number(quota.rows[0]?.used_bytes) || 0,
      freeStorageBytes: LIMITS.freeStorageBytes,
      maxAudioBytes: LIMITS.audioBytes,
    },
  });
}
