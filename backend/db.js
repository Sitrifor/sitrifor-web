import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, 'data');
mkdirSync(dataDir, { recursive: true });

const dbPath = join(dataDir, 'promo.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS promo_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    email TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    client_ip TEXT,
    user_agent TEXT
  );
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    client_ip TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_promo_created_at ON promo_codes(created_at);
  CREATE INDEX IF NOT EXISTS idx_promo_client_ip ON promo_codes(client_ip);
  CREATE INDEX IF NOT EXISTS idx_leads_type ON leads(type);
  CREATE INDEX IF NOT EXISTS idx_leads_ip ON leads(client_ip);
`);

const migrations = [
  'ALTER TABLE promo_codes ADD COLUMN email TEXT',
  'ALTER TABLE promo_codes ADD COLUMN name TEXT',
  'ALTER TABLE promo_codes ADD COLUMN phone TEXT',
  "ALTER TABLE promo_codes ADD COLUMN status TEXT NOT NULL DEFAULT 'issued'",
  'ALTER TABLE promo_codes ADD COLUMN amount_kop INTEGER',
  'ALTER TABLE promo_codes ADD COLUMN paid_at TEXT',
  'ALTER TABLE promo_codes ADD COLUMN payment_ref TEXT'
];

for (const sql of migrations) {
  try {
    db.exec(sql);
  } catch {
    /* column may already exist */
  }
}

const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generatePromoCode() {
  let suffix = '';
  for (let i = 0; i < 8; i += 1) {
    suffix += CHARSET[Math.floor(Math.random() * CHARSET.length)];
  }
  return `634-${suffix}`;
}

export function insertPromoCode({
  code,
  clientIp,
  userAgent,
  email = null,
  name = null,
  phone = null,
  status = 'issued',
  amountKop = null,
  paymentRef = null
}) {
  const paidAt = status === 'paid' ? new Date().toISOString() : null;
  const stmt = db.prepare(`
    INSERT INTO promo_codes (
      code, email, name, phone, status, amount_kop, paid_at, payment_ref, client_ip, user_agent
    ) VALUES (
      @code, @email, @name, @phone, @status, @amountKop, @paidAt, @paymentRef, @clientIp, @userAgent
    )
  `);
  const result = stmt.run({
    code,
    email,
    name,
    phone,
    status,
    amountKop,
    paidAt,
    paymentRef,
    clientIp,
    userAgent
  });
  return getPromoById(result.lastInsertRowid);
}

export function getPromoById(id) {
  return db.prepare(`
    SELECT id, code, email, name, phone, status, amount_kop, paid_at, payment_ref, created_at
    FROM promo_codes WHERE id = ?
  `).get(id);
}

export function getPromoByCode(code) {
  return db.prepare(`
    SELECT id, code, email, name, phone, status, amount_kop, paid_at, created_at
    FROM promo_codes WHERE code = ?
  `).get(code);
}

export function countRecentByIp(clientIp, hours = 24) {
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM promo_codes
    WHERE client_ip = ?
      AND datetime(created_at) > datetime('now', ?)
  `).get(clientIp, `-${hours} hours`);
  return row.count;
}

export function countRecentLeadsByIp(clientIp, hours = 24) {
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM leads
    WHERE client_ip = ?
      AND datetime(created_at) > datetime('now', ?)
  `).get(clientIp, `-${hours} hours`);
  return row.count;
}

export function createUniquePromoCode(opts = {}) {
  const maxAttempts = opts.maxAttempts || 10;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const code = generatePromoCode();
    try {
      return insertPromoCode({ ...opts, code });
    } catch (err) {
      if (!String(err.message).includes('UNIQUE')) throw err;
    }
  }
  throw new Error('Failed to generate unique promo code');
}

export function insertLead({ type, payload, clientIp }) {
  const stmt = db.prepare(`
    INSERT INTO leads (type, payload, client_ip)
    VALUES (@type, @payload, @clientIp)
  `);
  const result = stmt.run({
    type,
    payload: JSON.stringify(payload),
    clientIp
  });
  return { id: result.lastInsertRowid, type };
}

export const PROMO_PRICE_KOP = Number(process.env.PROMO_PRICE_KOP || 99000);
