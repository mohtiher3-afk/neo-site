import {
  json, fail, checkBindings, requireAdmin, cleanText, audioInfo, coverInfo,
  adjustQuota, publicTrack, adminTrack, TRACK_COLUMNS,
} from '../../../lib/shared.js';

// GET /api/tracks -> public list of published releases (used by the home page)
export async function onRequestGet({ env }) {
  const missing = checkBindings(env);
  if (missing) return missing;
  const { results } = await env.DB.prepare(
    `SELECT ${TRACK_COLUMNS} FROM tracks WHERE published = 1 AND available_at <= ? ORDER BY created_at DESC LIMIT 200`
  ).bind(Date.now()).all();
  return json({ tracks: results.map(publicTrack) });
}

// POST /api/tracks (admin) -> upload a new track as multipart form data
// fields: title, artist, audio (file), cover (optional file), published ("0" to save as draft)
export async function onRequestPost({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  let form;
  try { form = await request.formData(); } catch { return fail('Send the track as form data.'); }

  const audio = form.get('audio');
  const a = audioInfo(audio);
  if (a.error) return fail(a.error);
  const cover = form.get('cover');
  const c = coverInfo(cover);
  if (c?.error) return fail(c.error);

  const title = cleanText(form.get('title'), cleanText(audio.name.replace(/\.[^.]+$/, ''), 'Untitled'));
  const artist = cleanText(form.get('artist'), 'NEO');
  const published = form.get('published') === '0' ? 0 : 1;
  const id = crypto.randomUUID();
  const now = Date.now();

  await env.MEDIA.put(`audio:${id}`, await audio.arrayBuffer(), { metadata: { type: a.contentType } });
  if (c) await env.MEDIA.put(`cover:${id}`, await cover.arrayBuffer(), { metadata: { type: c.contentType, size: c.size } });

  try {
    await env.DB.prepare(
      `INSERT INTO tracks (id, title, artist, size_bytes, content_type, extension, created_at, available_at, published, audio_version, cover_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, title, artist, a.size, a.contentType, a.extension, new Date(now).toISOString(), now, published, now, c ? now : 0).run();
  } catch (error) {
    await Promise.allSettled([env.MEDIA.delete(`audio:${id}`), env.MEDIA.delete(`cover:${id}`)]);
    return fail(`Could not save the track: ${error.message}`, 500);
  }
  await adjustQuota(env, a.size + (c?.size || 0));

  const row = await env.DB.prepare(`SELECT ${TRACK_COLUMNS} FROM tracks WHERE id = ?`).bind(id).first();
  return json({ track: adminTrack(row) }, 201);
}
