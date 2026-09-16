#!/usr/bin/env node
/**
 * P1 enrich: code_family + authority on acts, article chunks + FTS.
 * Re-reads XML for cornerstone codes with a larger text window.
 * Safe: local XML only, no network, rejects DOCTYPE/ENTITY.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CORPUS_DIR =
  process.env.RUSLAW_CORPUS_DIR ||
  path.join(ROOT, 'data/ruslawod/extract/corpus_xml_lite');
const DB_PATH =
  process.env.RUSLAW_DB || path.join(ROOT, 'data/ruslawod/laws.db');
const CHUNK_TEXT_LIMIT = Number(process.env.RUSLAW_CHUNK_TEXT_LIMIT || 80000);
const MAX_CHUNKS_PER_ACT = Number(process.env.RUSLAW_MAX_CHUNKS_PER_ACT || 80);

function decodeXml(s) {
  return String(s || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function extractText(xml, limit = CHUNK_TEXT_LIMIT) {
  const m = xml.match(/<textIPS[^>]*>([\s\S]*?)<\/textIPS>/i);
  if (!m) return '';
  let t = m[1]
    .replace(/<ref[^>]*>/gi, '')
    .replace(/<\/ref>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  t = decodeXml(t);
  if (t.length > limit) t = t.slice(0, limit);
  return t;
}

export function inferCodeFamily(heading = '', docType = '') {
  const h = `${heading} ${docType}`.toLowerCase();
  if (/об административных правонарушениях|коап/.test(h)) return 'koap';
  if (/уголовно-процессуальн|упк/.test(h)) return 'upk';
  if (/уголовн\p{L}*\s+кодекс|\bук рф\b/u.test(h)) return 'uk';
  if (/налогов\p{L}*\s+кодекс|упрощенн\p{L}*\s+систем\p{L}*\s+налог|ндс/u.test(h)) return 'nk';
  if (/гражданск\p{L}*\s+кодекс/u.test(h)) return 'gk';
  if (/трудов\p{L}*\s+кодекс|трудов\p{L}*\s+договор/u.test(h)) return 'tk';
  if (/персональн\p{L}*\s+данн/u.test(h)) return 'pd';
  if (/защит\p{L}*\s+прав\p{L}*\s+потребител/u.test(h)) return 'consumer';
  if (/наркотическ|психотроп/u.test(h)) return 'drugs';
  if (/содержани\p{L}*\s+под\s+страж|следственн\p{L}*\s+изолятор/u.test(h)) return 'detention';
  return 'other';
}

export function inferAuthority(docType = '', heading = '', status = '') {
  const t = `${docType}`.toLowerCase();
  const h = `${heading}`.toLowerCase();
  let a = 10;
  if (/кодекс/.test(t) || /^кодекс/.test(h)) a = 100;
  else if (/федеральный закон|^закон/.test(t) || /^федеральный закон/.test(h)) a = 85;
  else if (/^закон/.test(h)) a = 75;
  else if (/указ/.test(t)) a = 55;
  else if (/постановление/.test(t)) a = 45;
  else if (/определение/.test(t)) a = 30;
  else if (/приказ|распоряжение/.test(t)) a = 22;
  else if (/письмо|циркуляр/.test(t)) a = 12;
  if (/^действует/i.test(status || '')) a += 5;
  if (/утратил/i.test(status || '')) a -= 15;
  if (h.length > 220) a -= 8;
  return Math.max(0, Math.min(110, a));
}

export function splitArticleChunks(text, actHeading) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const parts = raw.split(/(?=Статья\s+\d)/i);
  const out = [];
  for (const part of parts) {
    const m = part.match(/^Статья\s+([\d.]+)\.?\s*([\s\S]*)$/i);
    if (!m) continue;
    const article = m[1];
    const body = part.replace(/\s+/g, ' ').trim().slice(0, 1500);
    if (body.length < 50) continue;
    out.push({
      article,
      body,
      heading: `${actHeading} - ст. ${article}`
    });
    if (out.length >= MAX_CHUNKS_PER_ACT) break;
  }
  if (!out.length && raw.length >= 80) {
    out.push({
      article: null,
      body: raw.slice(0, 1500),
      heading: actHeading
    });
  }
  return out;
}

function isCornerstone(heading) {
  const h = String(heading || '');
  return (
    /^Кодекс Российской Федерации об административных правонарушениях$/i.test(h) ||
    /^Гражданский кодекс/i.test(h) ||
    /^Трудовой кодекс/i.test(h) ||
    /^Уголовный кодекс Российской Федерации/i.test(h) ||
    /Уголовно-процессуальный кодекс Российской Федерации/i.test(h) ||
    /^О персональных данных$/i.test(h) ||
    /^О защите прав потребителей$/i.test(h) ||
    /^О наркотических средствах и психотропных веществах$/i.test(h) ||
    /^Об упрощенной системе налогообложения/i.test(h) ||
    /Налоговый кодекс Российской Федерации/i.test(h) ||
    /^О содержании под стражей/i.test(h)
  );
}

function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error('DB missing:', DB_PATH);
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  const cols = db.prepare(`PRAGMA table_info(acts)`).all().map((c) => c.name);
  if (!cols.includes('code_family')) {
    db.exec(`ALTER TABLE acts ADD COLUMN code_family TEXT`);
  }
  if (!cols.includes('authority')) {
    db.exec(`ALTER TABLE acts ADD COLUMN authority INTEGER DEFAULT 0`);
  }

  db.exec(`DROP TABLE IF EXISTS chunks_fts`);
  db.exec(`DROP TABLE IF EXISTS chunks`);
  db.exec(`
    CREATE TABLE chunks (
      id TEXT PRIMARY KEY,
      act_id TEXT NOT NULL,
      article TEXT,
      heading TEXT,
      body TEXT,
      code_family TEXT,
      authority INTEGER,
      FOREIGN KEY(act_id) REFERENCES acts(id)
    );
    CREATE VIRTUAL TABLE chunks_fts USING fts5(
      heading,
      article,
      body,
      code_family,
      content='chunks',
      content_rowid='rowid'
    );
    CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
      INSERT INTO chunks_fts(rowid, heading, article, body, code_family)
      VALUES (new.rowid, new.heading, new.article, new.body, new.code_family);
    END;
    CREATE INDEX idx_chunks_act ON chunks(act_id);
    CREATE INDEX idx_chunks_family ON chunks(code_family);
    CREATE INDEX idx_acts_family ON acts(code_family);
  `);

  const acts = db
    .prepare(
      `SELECT id, heading, doc_type, status, text_excerpt, file_name, widely_used
       FROM acts`
    )
    .all();

  const upd = db.prepare(
    `UPDATE acts SET code_family = ?, authority = ? WHERE id = ?`
  );
  const insChunk = db.prepare(`
    INSERT INTO chunks (id, act_id, article, heading, body, code_family, authority)
    VALUES (@id, @act_id, @article, @heading, @body, @code_family, @authority)
  `);

  const t0 = Date.now();
  let metaN = 0;
  let chunkN = 0;
  let xmlBoost = 0;

  const txMeta = db.transaction((rows) => {
    for (const row of rows) {
      const family = inferCodeFamily(row.heading, row.doc_type);
      const auth = inferAuthority(row.doc_type, row.heading, row.status);
      upd.run(family, auth, row.id);
      metaN += 1;
    }
  });

  // Batch meta update
  for (let i = 0; i < acts.length; i += 1000) {
    txMeta(acts.slice(i, i + 1000));
  }

  const txChunks = db.transaction((chunkRows) => {
    for (const c of chunkRows) insChunk.run(c);
  });

  let batch = [];
  for (const act of acts) {
    const family = inferCodeFamily(act.heading, act.doc_type);
    const auth = inferAuthority(act.doc_type, act.heading, act.status);

    let text = act.text_excerpt || '';
    if (isCornerstone(act.heading) && act.file_name) {
      const fp = path.join(CORPUS_DIR, act.file_name);
      try {
        if (fs.existsSync(fp)) {
          const xml = fs.readFileSync(fp, 'utf8');
          if (!/<!DOCTYPE/i.test(xml.slice(0, 2048)) && !/<!ENTITY/i.test(xml.slice(0, 2048))) {
            const full = extractText(xml, CHUNK_TEXT_LIMIT);
            if (full.length > text.length) {
              text = full;
              xmlBoost += 1;
            }
          }
        }
      } catch {
        /* keep excerpt */
      }
    }

    // Skip chunking empty / tiny
    if (!text || text.length < 80) continue;
    // Prefer codes / tagged families / widely used with articles
    const hasArts = /Статья\s+\d/i.test(text);
    if (
      family === 'other' &&
      !hasArts &&
      !act.widely_used &&
      !isCornerstone(act.heading)
    ) {
      continue;
    }

    const parts = splitArticleChunks(text, act.heading);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      batch.push({
        id: `${act.id}#${p.article || 'body'}-${i}`,
        act_id: act.id,
        article: p.article,
        heading: p.heading,
        body: p.body,
        code_family: family,
        authority: auth
      });
      if (batch.length >= 400) {
        txChunks(batch);
        chunkN += batch.length;
        batch = [];
      }
    }
  }
  if (batch.length) {
    txChunks(batch);
    chunkN += batch.length;
  }

  const stats = {
    ok: true,
    acts: acts.length,
    metaUpdated: metaN,
    chunks: chunkN,
    xmlBoost,
    db: DB_PATH,
    seconds: Number(((Date.now() - t0) / 1000).toFixed(1))
  };
  console.log(JSON.stringify(stats, null, 2));
  db.close();
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
