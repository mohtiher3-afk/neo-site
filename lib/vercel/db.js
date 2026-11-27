// Postgres access layer for the NEO Vercel stack (replaces the Cloudflare D1 binding "DB").
// Uses the standard "pg" driver against the Vercel Postgres pooler connection string.
import { Pool } from 'pg';

let pool;
const getPool = () => {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Serverless: keep the pool small and idle-free so the function scale-to-zero.
      max: 5,
      idleTimeoutMillis: 30_000,
    });
  }
  return pool;
};

// Runs a parameterised query, returns { rows } (pg shape). Callers read rows[0].
export async function query(text, params = []) {
  const client = await getPool().connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

// Runs several statements in one transaction (replaces D1's "env.DB.batch").
export async function batch(statements) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    for (const { text, params } of statements) await client.query(text, params);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
