import { json, checkBindings } from '../../lib/shared.js';

// GET /api/visitors -> counts each browser once (anonymous random cookie id) and returns the total.
export async function onRequestGet({ request, env }) {
  const missing = checkBindings(env);
  if (missing) return missing;

  const cookie = request.headers.get('cookie') || '';
  let id = /(?:^|;\s*)neo_vid=([0-9a-f-]{36})/i.exec(cookie)?.[1];
  const headers = {};
  if (!id) {
    id = crypto.randomUUID();
    headers['set-cookie'] = `neo_vid=${id}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`;
  }

  await env.DB.prepare('INSERT OR IGNORE INTO visitors (visitor_id, first_seen) VALUES (?, ?)')
    .bind(id, new Date().toISOString()).run();
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM visitors').first();
  return json({ visitors: row?.n || 0 }, 200, headers);
}
