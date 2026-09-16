#!/usr/bin/env node
/**
 * Index RusLawOD XML corpus into SQLite FTS5 for lawyer search.
 * Security: only parses local .xml via ElementTree-equivalent (fast-xml-parser disabled;
 * uses regex-light metadata extraction + strip of body text). No code execution from corpus.
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

const ONLY_WIDE = process.env.RUSLAW_ONLY_WIDE === '1';
const MAX_DOCS = Number(process.env.RUSLAW_MAX_DOCS || 0);
const TEXT_LIMIT = Number(process.env.RUSLAW_TEXT_LIMIT || 6000);
const BATCH = 500;

function attr(xml, tag) {
  const re = new RegExp(`<${tag}\\s+[^>]*val="([^"]*)"`, 'i');
  const m = xml.match(re);
  return m ? decodeXml(m[1]) : '';
}

function decodeXml(s) {
  return String(s || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function extractText(xml) {
  const m = xml.match(/<textIPS[^>]*>([\s\S]*?)<\/textIPS>/i);
  if (!m) return '';
  let t = m[1]
    .replace(/<ref[^>]*>/gi, '')
    .replace(/<\/ref>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  t = decodeXml(t);
  if (t.length > TEXT_LIMIT) t = t.slice(0, TEXT_LIMIT);
  return t;
}

function extractKeywords(xml) {
  const vals = [];
  const re = /<(?:keywordByIPS|keywordsByIPS)\s+[^>]*val="([^"]*)"/gi;
  let m;
  while ((m = re.exec(xml))) vals.push(decodeXml(m[1]));
  return vals.join('; ');
}

function assertSafePath(filePath) {
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(CORPUS_DIR) + path.sep) && resolved !== path.resolve(CORPUS_DIR)) {
    throw new Error('path escape blocked: ' + filePath);
  }
  if (!resolved.endsWith('.xml')) throw new Error('non-xml blocked: ' + filePath);
}

function main() {
  if (!fs.existsSync(CORPUS_DIR)) {
    console.error('Corpus missing:', CORPUS_DIR);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  if (fs.existsSync(DB_PATH + '-wal')) fs.unlinkSync(DB_PATH + '-wal');
  if (fs.existsSync(DB_PATH + '-shm')) fs.unlinkSync(DB_PATH + '-shm');

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(`
    CREATE TABLE acts (
      id TEXT PRIMARY KEY,
      heading TEXT,
      doc_type TEXT,
      author TEXT,
      doc_date TEXT,
      doc_number TEXT,
      status TEXT,
      issued_by TEXT,
      signed TEXT,
      widely_used INTEGER,
      keywords TEXT,
      text_excerpt TEXT,
      file_name TEXT
    );
    CREATE VIRTUAL TABLE acts_fts USING fts5(
      heading,
      keywords,
      text_excerpt,
      doc_type,
      author,
      content='acts',
      content_rowid='rowid'
    );
    CREATE TRIGGER acts_ai AFTER INSERT ON acts BEGIN
      INSERT INTO acts_fts(rowid, heading, keywords, text_excerpt, doc_type, author)
      VALUES (new.rowid, new.heading, new.keywords, new.text_excerpt, new.doc_type, new.author);
    END;
  `);

  const insert = db.prepare(`
    INSERT OR REPLACE INTO acts (
      id, heading, doc_type, author, doc_date, doc_number, status,
      issued_by, signed, widely_used, keywords, text_excerpt, file_name
    ) VALUES (
      @id, @heading, @doc_type, @author, @doc_date, @doc_number, @status,
      @issued_by, @signed, @widely_used, @keywords, @text_excerpt, @file_name
    )
  `);

  const files = fs.readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.xml'));
  console.log('Indexing', files.length, 'xml from', CORPUS_DIR);

  let indexed = 0;
  let skipped = 0;
  let errors = 0;
  const t0 = Date.now();

  const tx = db.transaction((rows) => {
    for (const row of rows) insert.run(row);
  });

  let batch = [];
  for (const name of files) {
    if (MAX_DOCS && indexed >= MAX_DOCS) break;
    const fp = path.join(CORPUS_DIR, name);
    try {
      assertSafePath(fp);
      const xml = fs.readFileSync(fp, 'utf8');
      // Reject DOCTYPE / ENTITY (XXE hardening)
      if (/<!DOCTYPE/i.test(xml.slice(0, 2048)) || /<!ENTITY/i.test(xml.slice(0, 2048))) {
        skipped += 1;
        continue;
      }
      const widely = attr(xml, 'is_widely_used') === '1' ? 1 : 0;
      if (ONLY_WIDE && !widely) {
        skipped += 1;
        continue;
      }
      const id = attr(xml, 'pravogovruNd') || name.replace(/\.xml$/i, '');
      const heading = attr(xml, 'headingIPS');
      if (!heading) {
        skipped += 1;
        continue;
      }
      batch.push({
        id,
        heading,
        doc_type: attr(xml, 'doc_typeIPS'),
        author: attr(xml, 'doc_author_normal_formIPS'),
        doc_date: attr(xml, 'docdateIPS'),
        doc_number: attr(xml, 'docNumberIPS'),
        status: attr(xml, 'statusIPS'),
        issued_by: attr(xml, 'issuedByIPS'),
        signed: attr(xml, 'signedIPS'),
        widely_used: widely,
        keywords: extractKeywords(xml),
        text_excerpt: extractText(xml),
        file_name: name
      });
      if (batch.length >= BATCH) {
        tx(batch);
        indexed += batch.length;
        batch = [];
        if (indexed % 5000 === 0) {
          const sec = ((Date.now() - t0) / 1000).toFixed(1);
          console.log(`… ${indexed} docs in ${sec}s`);
        }
      }
    } catch (e) {
      errors += 1;
      if (errors < 10) console.error('parse error', name, e.message);
    }
  }
  if (batch.length) {
    tx(batch);
    indexed += batch.length;
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_acts_wide ON acts(widely_used);
    CREATE INDEX IF NOT EXISTS idx_acts_type ON acts(doc_type);
    CREATE INDEX IF NOT EXISTS idx_acts_date ON acts(doc_date);`);

  const stats = db.prepare('SELECT COUNT(*) AS n, SUM(widely_used) AS w FROM acts').get();
  console.log(JSON.stringify({
    ok: true,
    indexed,
    skipped,
    errors,
    stats,
    db: DB_PATH,
    seconds: Number(((Date.now() - t0) / 1000).toFixed(1)),
    next: 'Run: npm run lawyer:enrich'
  }, null, 2));
  db.close();
}

main();
