// One-shot Cloudflare -> Vercel data migration.
// GET /api/migrate
//   - Inserts the single owner row, all 15 visitor rows, and ensures quota(1,0)
//   - Idempotent: every insert is ON CONFLICT DO NOTHING
//   - Returns { owner, visitors, quota } with the current Postgres state
// Remove this file once the data is in Postgres.

import { query } from '../lib/vercel/db.js';
import { json } from '../lib/vercel/shared.js';

const OWNER = {
  id: 1,
  email: 'the.real.neo349@gmail.com',
  claimed_at: '2026-11-15T02:09:56.216Z',
};

const VISITORS = [
  ['cdf66a9c-0034-4102-930d-fa2ea515cbc4', '2026-11-22T03:44:45.205Z'],
  ['a297da71-f504-448b-8746-2fbdbc3d6a5b', '2026-11-22T06:09:50.046Z'],
  ['e0b52b43-e9aa-4467-9b30-743ede92998c', '2026-11-22T23:01:50.911Z'],
  ['2acc7aee-f139-4d9e-8582-1199abad3532', '2026-11-27T04:26:40.520Z'],
  ['0c066654-0d05-430f-8b9c-d40fe77ab15e', '2026-11-27T04:47:33.424Z'],
  ['eceeaa50-5d57-4402-a345-ea9aa29fa0bc', '2026-11-27T05:23:02.641Z'],
  ['dbe703cf-755d-4018-9426-8db891011e47', '2026-11-27T10:26:45.526Z'],
  ['915726df-6865-48bc-b224-7e6d41fca2cc', '2026-11-27T10:47:17.800Z'],
  ['0c36f717-b3fa-461e-8178-0c9c18f07026', '2026-11-27T10:59:53.897Z'],
  ['301d8b3f-cdbe-4f66-bdf8-baed5e250173', '2026-11-27T12:38:39.584Z'],
  ['5f4b90b5-84a7-4240-9a55-645416be5073', '2026-11-27T12:51:38.534Z'],
  ['4e136540-3ffc-455f-b802-ad02e67da582', '2026-11-27T12:52:06.768Z'],
  ['c927ab5d-209c-4dca-89b8-7c17b2e0eb13', '2026-11-27T20:34:29.510Z'],
  ['13602c29-e2c8-4fa5-a2b0-a1a878f6136a', '2026-11-27T21:15:19.150Z'],
  ['85baa812-e651-4e6d-aa29-c1cbd3712754', '2026-11-28T00:49:36.773Z'],
];

export async function GET() {
  const check = await query(`
    SELECT
      (SELECT COUNT(*) FROM owner)      AS owner_count,
      (SELECT COUNT(*) FROM visitors)   AS visitor_count,
      (SELECT used_bytes FROM quota WHERE id = 1) AS quota_used
  `);
  const before = check.rows[0];

  await query(
    `INSERT INTO owner (id, email, claimed_at) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [OWNER.id, OWNER.email, OWNER.claimed_at],
  );

  for (const [vid, fs] of VISITORS) {
    await query(
      `INSERT INTO visitors (visitor_id, first_seen) VALUES ($1, $2)
       ON CONFLICT (visitor_id) DO NOTHING`,
      [vid, fs],
    );
  }

  await query(
    `INSERT INTO quota (id, used_bytes) VALUES (1, 0) ON CONFLICT (id) DO NOTHING`,
  );

  const afterCheck = await query(`
    SELECT
      (SELECT COUNT(*) FROM owner)      AS owner_count,
      (SELECT COUNT(*) FROM visitors)   AS visitor_count,
      (SELECT used_bytes FROM quota WHERE id = 1) AS quota_used
  `);
  const after = afterCheck.rows[0];

  return json({
    migrated: {
      owner: { email: OWNER.email, claimedAt: OWNER.claimed_at },
      visitors: VISITORS.map(([id]) => id),
    },
    before,
    after,
  });
}
