// Shared helpers for the NEO Vercel stack (ported from the Cloudflare Pages Functions).
//   Vercel Postgres (DATABASE_URL)        -> track metadata, visitors, quota, delete-locks
//   Vercel Blob   (BLOB_READ_WRITE_TOKEN) -> audio files  "audio:<id>"  and covers  "cover:<id>"
// Media is served by redirecting (307) to the blob's own S3-backed URL, so HTTP Range
// seeking reaches the storage layer directly instead of streaming through a function.

import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { put as blobPut, list as blobList, del as blobDel } from '@vercel/blob';
import { query, batch } from './db.js';

export { randomUUID, query, batch };

export const LIMITS = {
  audioBytes: 25 * 1024 * 1024, // keep the 25 MB cap as a sensible upload guard
  coverBytes: 5 * 1024 * 1024,
  // Display-only headroom for the admin dashboard. Set to your Vercel Blob allowance.
  freeStorageBytes: 10 * 1024 * 1024 * 1024,
};

const AUDIO_TYPES = { mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav' };
const COVER_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

export const fail = (message, status = 400) => json({ error: message }, status);

export function checkConfig() {
  if (!process.env.DATABASE_URL)
    return fail('DATABASE_URL is not set. Provision Vercel Postgres and set the DATABASE_URL environment variable.', 503);
  if (!process.env.BLOB_READ_WRITE_TOKEN)
    return fail('BLOB_READ_WRITE_TOKEN is not set. Enable Vercel Blob storage on this project.', 503);
  return null;
}

// Returns a Response when the request is NOT authorised, otherwise null.
export async function requireAdmin(request) {
  const expected = process.env.ADMIN_KEY || '';
  if (expected.length < 12) {
    return fail('ADMIN_KEY is not set (or shorter than 12 characters) in the Vercel project settings.', 503);
  }
  const header = request.headers.get('authorization') || '';
  const given = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const digest = (s) => createHash('sha256').update(s).digest();
  if (!timingSafeEqual(digest(given), digest(expected))) return fail('Wrong admin key.', 401);
  return checkConfig();
}

export function cleanText(value, fallback = '') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
  return text || fallback;
}

export function audioInfo(file) {
  if (!file || typeof file === 'string') return { error: 'Choose an audio file.' };
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const fromType = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'm4a', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav' }[file.type];
  const extension = AUDIO_TYPES[ext] ? ext : fromType;
  if (!extension) return { error: 'Audio must be MP3, M4A or WAV.' };
  if (file.size <= 0) return { error: 'The audio file is empty.' };
  if (file.size > LIMITS.audioBytes) return { error: 'Audio files must be 25 MB or smaller.' };
  return { extension, contentType: AUDIO_TYPES[extension], size: file.size };
}

export function coverInfo(file) {
  if (!file || typeof file === 'string' || file.size === 0) return null;
  if (!COVER_TYPES.includes(file.type)) return { error: 'Cover must be PNG, JPG or WEBP.' };
  if (file.size > LIMITS.coverBytes) return { error: 'Cover artwork must be 5 MB or smaller.' };
  return { contentType: file.type, size: file.size };
}

// --- Blob storage (Vercel Blob) ------------------------------------------------
const blobToken = () => process.env.BLOB_READ_WRITE_TOKEN;

// Writes the object and returns the BlobInfo (its .url is stored on the track row).
export async function putBlob(key, buffer, contentType) {
  return blobPut(key, buffer, { contentType, cacheControl: 'public, max-age=31536000', token: blobToken() });
}

// @vercel/blob exposes no single-key `get` in this version, so resolve metadata
// via a prefix `list` and pick the exact key. Callers read { size, url, type }.
export async function getBlob(key) {
  const matches = await listBlob(key);
  return matches.find((blob) => blob.key === key) || null;
}

export async function listBlob(prefix) {
  const out = [];
  let cursor;
  do {
    const page = await blobList({ prefix, cursor, token: blobToken() });
    out.push(...page.blobs);
    cursor = page.nextCursor;
  } while (cursor);
  return out; // [{ url, key, size, type }]
}

// Vercel Blob `del` is a no-op-ish on missing keys; swallow the 404 to mirror KV.
export async function delBlob(key) {
  try { await blobDel(key, { token: blobToken() }); } catch {}
}

// --- Quota ledger (Postgres transaction, replaces D1's batch) -----------------
export async function adjustQuota(deltaBytes) {
  await batch([
    { text: 'INSERT INTO quota (id, used_bytes) VALUES (1, 0) ON CONFLICT DO NOTHING' },
    { text: 'UPDATE quota SET used_bytes = GREATEST(0, used_bytes + $1) WHERE id = 1', params: [deltaBytes] },
  ]);
}

// --- Track shapes --------------------------------------------------------------
// node-pg returns BIGINT columns (OID 20) as strings to avoid float precision loss,
// so normalise the numeric fields before they reach JSON.
const NUMERIC_FIELDS = ['size_bytes', 'available_at', 'audio_version', 'cover_version'];
export function coerceTrack(row) {
  if (!row) return null;
  const out = { ...row };
  for (const key of NUMERIC_FIELDS) if (out[key] != null) out[key] = Number(out[key]);
  return out;
}

// Appends a "?v=" cache-buster to a blob URL without clobbering an existing query string.
function versioned(url, version) {
  if (!url) return null;
  if (!version) return url;
  return `${url}${url.includes('?') ? '&' : '?'}v=${version}`;
}

export function publicTrack(rawRow) {
  const row = coerceTrack(rawRow);
  const v = Number(row.audio_version || 1);
  const cv = Number(row.cover_version || 0);
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    audioUrl: versioned(row.audio_url, v),
    coverUrl: cv ? versioned(row.cover_url, cv) : null,
    createdAt: row.created_at,
  };
}

export function adminTrack(rawRow) {
  const row = coerceTrack(rawRow);
  return {
    ...publicTrack(row),
    sizeBytes: row.size_bytes,
    published: Number(row.published) === 1,
    availableAt: row.available_at,
  };
}

export const TRACK_COLUMNS =
  'id, title, artist, size_bytes, content_type, extension, created_at, available_at, published, audio_version, cover_version, audio_url, cover_url';
