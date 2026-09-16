#!/usr/bin/env node
/**
 * Local hashed embeddings for chunk hybrid search (no Ollama --embeddings required).
 * Stores L2-normalized Float32 vectors in chunk_embeddings.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DB_PATH =
  process.env.RUSLAW_DB || path.join(ROOT, 'data/ruslawod/laws.db');

export const EMBED_DIM = Number(process.env.LAWYER_EMBED_DIM || 256);
export const EMBED_VERSION = `hash-v1-d${EMBED_DIM}`;

function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function tokenizeEmbed(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3)
    .slice(0, 80);
}

/** Feature-hashing embedding + L2 normalize. */
export function embedText(text, dim = EMBED_DIM) {
  const vec = new Float32Array(dim);
  const tokens = tokenizeEmbed(text);
  if (!tokens.length) return vec;
  const add = (tok, weight = 1) => {
    const h = hash32(tok);
    const idx = h % dim;
    const sign = hash32(tok + '#s') & 1 ? 1 : -1;
    vec[idx] += sign * weight;
  };
  for (const t of tokens) add(t, 1);
  for (let i = 0; i < tokens.length - 1; i++) add(`${tokens[i]}_${tokens[i + 1]}`, 0.7);
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) vec[i] /= norm;
  return vec;
}

export function cosine(a, b) {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

export function vecToBuffer(vec) {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

export function bufferToVec(buf) {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Float32Array(ab);
}

function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error('DB missing', DB_PATH);
    process.exit(1);
  }
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    DROP TABLE IF EXISTS chunk_embeddings;
    CREATE TABLE chunk_embeddings (
      chunk_id TEXT PRIMARY KEY,
      act_id TEXT NOT NULL,
      code_family TEXT,
      authority INTEGER,
      dim INTEGER NOT NULL,
      version TEXT NOT NULL,
      vector BLOB NOT NULL
    );
    CREATE INDEX idx_ce_family ON chunk_embeddings(code_family);
    CREATE INDEX idx_ce_act ON chunk_embeddings(act_id);
  `);

  const hasChunks = db
    .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='chunks'`)
    .get();
  if (!hasChunks) {
    console.error('chunks table missing - run npm run lawyer:enrich first');
    process.exit(1);
  }

  const rows = db
    .prepare(
      `SELECT id, act_id, heading, body, code_family, authority
       FROM chunks
       WHERE authority >= 40 OR code_family != 'other'
       ORDER BY authority DESC`
    )
    .all();

  const ins = db.prepare(`
    INSERT INTO chunk_embeddings (chunk_id, act_id, code_family, authority, dim, version, vector)
    VALUES (@chunk_id, @act_id, @code_family, @authority, @dim, @version, @vector)
  `);

  const t0 = Date.now();
  let n = 0;
  const tx = db.transaction((batch) => {
    for (const r of batch) ins.run(r);
  });

  let batch = [];
  for (const row of rows) {
    const vec = embedText(`${row.heading || ''}\n${row.body || ''}`, EMBED_DIM);
    batch.push({
      chunk_id: row.id,
      act_id: row.act_id,
      code_family: row.code_family,
      authority: row.authority,
      dim: EMBED_DIM,
      version: EMBED_VERSION,
      vector: vecToBuffer(vec)
    });
    if (batch.length >= 500) {
      tx(batch);
      n += batch.length;
      batch = [];
      if (n % 5000 === 0) console.log('…', n);
    }
  }
  if (batch.length) {
    tx(batch);
    n += batch.length;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        embedded: n,
        dim: EMBED_DIM,
        version: EMBED_VERSION,
        seconds: Number(((Date.now() - t0) / 1000).toFixed(1)),
        db: DB_PATH
      },
      null,
      2
    )
  );
  db.close();
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
