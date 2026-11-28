import {
  json, fail, checkConfig, requireAdmin, cleanText, audioInfo, coverInfo,
  adjustQuota, publicTrack, adminTrack, TRACK_COLUMNS, query, batch, putBlob, delBlob, randomUUID,
} from '../../lib/vercel/shared.js';

const load = (id) => query(`SELECT ${TRACK_COLUMNS} FROM tracks WHERE id = $1`, [id]);

// GET /api/tracks -> public list of published releases (used by the home page)
export async function GET(req) {
  const missing = checkConfig();
  if (missing) return missing;
  const { rows } = await query(
    `SELECT ${TRACK_COLUMNS} FROM tracks WHERE published = 1 AND available_at <= $1
     ORDER BY created_at DESC LIMIT 200`,
    [Date.now()]
  );
  const etag = `"${rows.length}-${rows.map(r => r.id).join('-') || '0'}"`;
  if (req.headers.get('if-none-match') === etag) return null;
  return json({ tracks: rows.map(publicTrack) }, 200, { 'etag': etag });
}

// POST /api/tracks (admin) -> upload a new track as multipart form data
// fields: title, artist, audio (file), cover (optional file), published ("0" to save as draft)
export async function POST(req) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  let form;
  try { form = await req.formData(); } catch { return fail('Send the track as form data.'); }

  const audio = form.get('audio');
  const a = audioInfo(audio);
  if (a.error) return fail(a.error);
  const cover = form.get('cover');
  const c = coverInfo(cover);
  if (c?.error) return fail(c.error);

  const title = cleanText(form.get('title'), cleanText(audio.name.replace(/\.[^.]+$/, ''), 'Untitled'));
  const artist = cleanText(form.get('artist'), 'NEO');
  const published = form.get('published') === '0' ? 0 : 1;
  const id = randomUUID();
  const now = Date.now();

  const audioBlob = await putBlob(`audio:${id}`, Buffer.from(await audio.arrayBuffer()), a.contentType);
  let coverBlob = null;
  if (c) coverBlob = await putBlob(`cover:${id}`, Buffer.from(await cover.arrayBuffer()), c.contentType);

  try {
    await query(
      `INSERT INTO tracks
         (id, title, artist, size_bytes, content_type, extension, created_at, available_at,
          published, audio_version, cover_version, audio_url, cover_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [id, title, artist, a.size, a.contentType, a.extension, new Date(now).toISOString(), now,
       published, now, c ? now : 0, audioBlob.url, coverBlob?.url || null]
    );
  } catch (error) {
    await Promise.allSettled([delBlob(`audio:${id}`), coverBlob ? delBlob(`cover:${id}`) : Promise.resolve()]);
    return fail(`Could not save the track: ${error.message}`, 500);
  }
  await adjustQuota(a.size + (c?.size || 0));

  const { rows } = await load(id);
  return json({ track: adminTrack(rows[0]) }, 201);
}
