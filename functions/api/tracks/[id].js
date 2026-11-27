import {
  json, fail, requireAdmin, cleanText, audioInfo, coverInfo, adjustQuota, adminTrack, TRACK_COLUMNS,
} from '../../../lib/shared.js';

const load = (env, id) => env.DB.prepare(`SELECT ${TRACK_COLUMNS} FROM tracks WHERE id = ?`).bind(id).first();

// PATCH /api/tracks/:id (admin) -> JSON { title?, artist?, published? }
export async function onRequestPatch({ request, env, params }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const track = await load(env, params.id);
  if (!track) return fail('Track not found.', 404);

  let body;
  try { body = await request.json(); } catch { return fail('Send JSON.'); }
  const title = body.title === undefined ? track.title : cleanText(body.title);
  const artist = body.artist === undefined ? track.artist : cleanText(body.artist, 'NEO');
  if (!title) return fail('Title cannot be empty.');
  const published = body.published === undefined ? track.published : (body.published ? 1 : 0);
  // Publishing a draft makes it visible immediately.
  const availableAt = published && !track.published ? Date.now() : track.available_at;

  await env.DB.prepare('UPDATE tracks SET title = ?, artist = ?, published = ?, available_at = ? WHERE id = ?')
    .bind(title, artist, published, availableAt, track.id).run();
  return json({ track: adminTrack(await load(env, track.id)) });
}

// PUT /api/tracks/:id (admin) -> multipart { audio?, cover?, removeCover? } replaces the media files
export async function onRequestPut({ request, env, params }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const track = await load(env, params.id);
  if (!track) return fail('Track not found.', 404);

  let form;
  try { form = await request.formData(); } catch { return fail('Send form data.'); }
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
  let { size_bytes, content_type, extension, audio_version, cover_version } = track;

  if (a) {
    await env.MEDIA.put(`audio:${track.id}`, await audio.arrayBuffer(), { metadata: { type: a.contentType } });
    delta += a.size - track.size_bytes;
    size_bytes = a.size; content_type = a.contentType; extension = a.extension; audio_version = now;
  }
  if (c || removeCover) {
    const old = await env.MEDIA.getWithMetadata(`cover:${track.id}`, { type: 'stream' });
    const oldSize = old?.metadata?.size || 0;
    if (old?.value) await old.value.cancel();
    if (c) {
      await env.MEDIA.put(`cover:${track.id}`, await cover.arrayBuffer(), { metadata: { type: c.contentType, size: c.size } });
      delta += c.size - oldSize;
      cover_version = now;
    } else {
      await env.MEDIA.delete(`cover:${track.id}`);
      delta -= oldSize;
      cover_version = 0;
    }
  }

  await env.DB.prepare(
    'UPDATE tracks SET size_bytes = ?, content_type = ?, extension = ?, audio_version = ?, cover_version = ? WHERE id = ?'
  ).bind(size_bytes, content_type, extension, audio_version, cover_version, track.id).run();
  if (delta) await adjustQuota(env, delta);
  return json({ track: adminTrack(await load(env, track.id)) });
}

// DELETE /api/tracks/:id (admin)
export async function onRequestDelete({ request, env, params }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const track = await load(env, params.id);
  if (!track) return fail('Track not found.', 404);

  const lock = await env.DB.prepare('INSERT OR IGNORE INTO deleting_tracks (track_id, created_at) VALUES (?, ?)')
    .bind(track.id, Date.now()).run();
  if (!lock.meta.changes) return fail('This track is already being deleted.', 409);
  try {
    await Promise.all([env.MEDIA.delete(`audio:${track.id}`), env.MEDIA.delete(`cover:${track.id}`)]);
    await env.DB.prepare('DELETE FROM tracks WHERE id = ?').bind(track.id).run();
    await adjustQuota(env, -track.size_bytes);
  } finally {
    await env.DB.prepare('DELETE FROM deleting_tracks WHERE track_id = ?').bind(track.id).run();
  }
  return json({ deleted: track.id });
}
