import {
  json, fail, requireAdmin, cleanText, audioInfo, coverInfo,
  adjustQuota, adminTrack, TRACK_COLUMNS, query, batch,
  putBlob, getBlob, delBlob,
} from '../../lib/vercel/shared.js';

const load = (id) => query(`SELECT ${TRACK_COLUMNS} FROM tracks WHERE id = $1`, [id]);
const notFound = () => fail('Track not found.', 404);

// PATCH /api/tracks/:id (admin) -> JSON { title?, artist?, published? }
export async function PATCH(req, { params }) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const { rows } = await load(params.id);
  if (!rows[0]) return notFound();
  const track = rows[0];

  let body;
  try { body = await req.json(); } catch { return fail('Send JSON.'); }
  const title = body.title === undefined ? track.title : cleanText(body.title);
  const artist = body.artist === undefined ? track.artist : cleanText(body.artist, 'NEO');
  if (!title) return fail('Title cannot be empty.');
  const published = body.published === undefined ? track.published : (body.published ? 1 : 0);
  // Publishing a draft makes it visible immediately.
  const availableAt = published && !track.published ? Date.now() : Number(track.available_at);

  await query(
    'UPDATE tracks SET title = $1, artist = $2, published = $3, available_at = $4 WHERE id = $5',
    [title, artist, published, availableAt, track.id]
  );
  const { rows: fresh } = await load(track.id);
  return json({ track: adminTrack(fresh[0]) });
}

// PUT /api/tracks/:id (admin) -> multipart { audio?, cover?, removeCover? } replaces the media files
export async function PUT(req, { params }) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const { rows } = await load(params.id);
  if (!rows[0]) return notFound();
  const track = rows[0];

  let form;
  try { form = await req.formData(); } catch { return fail('Send form data.'); }
  const audio = form.get('audio');
  const cover = form.get('cover');
  const hasAudio = audio && typeof audio !== 'string' && audio.size > 0;
  const a = hasAudio ? audioInfo(audio) : null;
  if (a?.error) return fail(a.error);
  const c = coverInfo(cover);
  if (c?.error) return fail(c.error);
  const removeCover = form.get('removeCover') === '1' && !c;
  if (!a && !c && !removeCover) return fail('Choose a new audio file or cover.');

  const now = Date.now();
  let delta = 0;
  let { size_bytes, content_type, extension, audio_version, cover_version, cover_url } = track;
  size_bytes = Number(size_bytes); audio_version = Number(audio_version); cover_version = Number(cover_version);

  if (a) {
    const blob = await putBlob(`audio:${track.id}`, Buffer.from(await audio.arrayBuffer()), a.contentType);
    // Replacing a blob in Vercel Blob keeps the key but a new URL/version — store the fresh one.
    track.audio_url = blob.url;
    delta += a.size - size_bytes;
    size_bytes = a.size; content_type = a.contentType; extension = a.extension; audio_version = now;
  }
  if (c || removeCover) {
    let oldSize = 0;
    if (cover_url) {
      try { const old = await getBlob(`cover:${track.id}`); oldSize = old?.size || 0; } catch { oldSize = 0; }
      await delBlob(`cover:${track.id}`);
    }
    if (c) {
      const blob = await putBlob(`cover:${track.id}`, Buffer.from(await cover.arrayBuffer()), c.contentType);
      track.cover_url = blob.url;
      delta += c.size - oldSize;
      cover_version = now;
    } else {
      delta -= oldSize;
      cover_version = 0;
      track.cover_url = null;
    }
  }

  await batch([
    {
      text: `UPDATE tracks SET size_bytes = $1, content_type = $2, extension = $3, audio_version = $4,
              cover_version = $5, audio_url = $6, cover_url = $7 WHERE id = $8`,
      params: [size_bytes, content_type, extension, audio_version, cover_version,
               track.audio_url, track.cover_url || null, track.id],
    },
    ...(delta ? [{ text: 'UPDATE quota SET used_bytes = GREATEST(0, used_bytes + $1) WHERE id = 1', params: [delta] }] : []),
  ]);
  const { rows: fresh } = await load(track.id);
  return json({ track: adminTrack(fresh[0]) });
}

// DELETE /api/tracks/:id (admin)
export async function DELETE(req, { params }) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const { rows } = await load(params.id);
  if (!rows[0]) return notFound();
  const track = rows[0];

  // INSERT ... ON CONFLICT DO NOTHING + rowCount is the Postgres form of D1's
  // "INSERT OR IGNORE" + meta.changes check (409 when someone is already deleting).
  const lock = await query(
    'INSERT INTO deleting_tracks (track_id, created_at) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [track.id, Date.now()]
  );
  if (lock.rowCount === 0) return fail('This track is already being deleted.', 409);
  try {
    await Promise.all([delBlob(`audio:${track.id}`), delBlob(`cover:${track.id}`)]);
    await batch([
      { text: 'DELETE FROM tracks WHERE id = $1', params: [track.id] },
      { text: 'UPDATE quota SET used_bytes = GREATEST(0, used_bytes + $1) WHERE id = 1', params: [-Number(track.size_bytes)] },
    ]);
  } finally {
    await query('DELETE FROM deleting_tracks WHERE track_id = $1', [track.id]);
  }
  return json({ deleted: track.id });
}
