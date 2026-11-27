import { json, fail, query, checkConfig, randomUUID } from '../lib/vercel/shared.js';

// GET /api/visitors -> counts each browser once (anonymous random cookie id) and returns the total.
export default async function handler(req) {
  if (req.method !== 'GET') return fail('Method not allowed.', 405);
  const missing = checkConfig();
  if (missing) return missing;

  const cookie = req.headers.get('cookie') || '';
  let id = /(?:^|;\s*)neo_vid=([0-9a-f-]{36})/i.exec(cookie)?.[1];
  const headers = {};
  if (!id) {
    id = randomUUID();
    headers['set-cookie'] = `neo_vid=${id}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`;
  }

  await query(
    'INSERT INTO visitors (visitor_id, first_seen) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [id, new Date().toISOString()]
  );
  const { rows } = await query('SELECT COUNT(*) AS n FROM visitors');
  return json({ visitors: Number(rows[0]?.n) || 0 }, 200, headers);
}
