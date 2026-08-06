/**
 * Marketplace SQLite store: unified products + multi-shop offers + images.
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '../data');
mkdirSync(dataDir, { recursive: true });

const dbPath = join(dataDir, 'marketplace.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS mp_shops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_scraped_at TEXT
  );

  CREATE TABLE IF NOT EXISTS mp_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    title_en TEXT,
    title_de TEXT,
    image_url TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS mp_brands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS mp_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    fingerprint TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    brand_id INTEGER REFERENCES mp_brands(id),
    category_id INTEGER REFERENCES mp_categories(id),
    description TEXT,
    sku TEXT,
    attrs_json TEXT,
    cover_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS mp_offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES mp_products(id) ON DELETE CASCADE,
    shop_id INTEGER NOT NULL REFERENCES mp_shops(id),
    source_url TEXT NOT NULL,
    source_sku TEXT,
    title_raw TEXT,
    price_rub REAL,
    currency TEXT NOT NULL DEFAULT 'RUB',
    in_stock INTEGER NOT NULL DEFAULT 1,
    raw_json TEXT,
    scraped_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(shop_id, source_url)
  );

  CREATE TABLE IF NOT EXISTS mp_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES mp_products(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    local_path TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE(product_id, url)
  );

  CREATE INDEX IF NOT EXISTS idx_mp_products_cat ON mp_products(category_id);
  CREATE INDEX IF NOT EXISTS idx_mp_products_brand ON mp_products(brand_id);
  CREATE INDEX IF NOT EXISTS idx_mp_offers_product ON mp_offers(product_id);
  CREATE INDEX IF NOT EXISTS idx_mp_offers_price ON mp_offers(price_rub);
`);

export const CATEGORIES = [
  { slug: 'cartridges', title: 'Картриджи', titleEn: 'Cartridges', titleDe: 'Kartuschen', sort: 10 },
  { slug: 'needles', title: 'Иглы', titleEn: 'Needles', titleDe: 'Nadeln', sort: 20 },
  { slug: 'machines', title: 'Машинки', titleEn: 'Machines', titleDe: 'Maschinen', sort: 30 },
  { slug: 'power', title: 'Блоки питания', titleEn: 'Power supplies', titleDe: 'Netzteile', sort: 40 },
  { slug: 'pigments', title: 'Пигменты', titleEn: 'Pigments', titleDe: 'Pigmente', sort: 50 },
  { slug: 'care', title: 'Уход', titleEn: 'Aftercare', titleDe: 'Pflege', sort: 60 },
  { slug: 'barriers', title: 'Барьерная защита', titleEn: 'Barrier films', titleDe: 'Barriereschutz', sort: 70 },
  { slug: 'consumables', title: 'Расходники', titleEn: 'Consumables', titleDe: 'Verbrauchsmaterial', sort: 80 },
  { slug: 'other', title: 'Прочее', titleEn: 'Other', titleDe: 'Sonstiges', sort: 90 }
];

export const SHOPS = [
  { key: 'tattoomarket', name: 'TattooMarket', baseUrl: 'https://www.tattoomarket.ru' },
  { key: 'tattoomall', name: 'TattooMall', baseUrl: 'https://tattoomall.ru' },
  { key: 'shoptattoo', name: 'ShopTattoo', baseUrl: 'https://shoptattoo.ru' },
  { key: 'tatu-shop', name: 'Tatu-Shop', baseUrl: 'https://tatu-shop.ru' },
  { key: 'tattooport', name: 'TattooPort', baseUrl: 'https://tattooport.ru' },
  { key: 'worldfamous', name: 'World Famous', baseUrl: 'https://www.worldfamoustattooink.com' },
  { key: 'tattoo-store', name: 'Tattoo-Store', baseUrl: 'https://tattoo-store.ru' },
  { key: 'odintattoo', name: 'Odin Tattoo Shop', baseUrl: 'https://shop.odintattoo.ru' },
  { key: 'bdtt', name: 'BDTT', baseUrl: 'https://bdtt.ru' },
  { key: 'gallerytattooink', name: 'Gallery Tattoo Ink', baseUrl: 'https://gallerytattooink.com' },
  { key: '28opt', name: '28opt', baseUrl: 'https://28opt.ru' },
  { key: 'zavisimost', name: 'Zavisimost Ink', baseUrl: 'https://zavisimost-ink.ru' },
  { key: 'profftattoo', name: 'ProffTattoo', baseUrl: 'https://profftattoo.ru' },
  { key: 'fenix', name: 'Fenix Tattoo', baseUrl: 'https://fenix-tattoo.ru' }
];

export function seedDictionaries() {
  const upsertShop = db.prepare(`
    INSERT INTO mp_shops (key, name, base_url, enabled)
    VALUES (@key, @name, @baseUrl, 1)
    ON CONFLICT(key) DO UPDATE SET name = excluded.name, base_url = excluded.base_url
  `);
  const upsertCat = db.prepare(`
    INSERT INTO mp_categories (slug, title, title_en, title_de, image_url, sort_order)
    VALUES (@slug, @title, @titleEn, @titleDe, @imageUrl, @sort)
    ON CONFLICT(slug) DO UPDATE SET
      title = excluded.title,
      title_en = excluded.title_en,
      title_de = excluded.title_de,
      image_url = COALESCE(excluded.image_url, mp_categories.image_url),
      sort_order = excluded.sort_order
  `);

  const tx = db.transaction(() => {
    for (const s of SHOPS) upsertShop.run(s);
    for (const c of CATEGORIES) {
      upsertCat.run({
        ...c,
        imageUrl: `/img/marketplace/categories/${c.slug}.jpg?v=2`
      });
    }
  });
  tx();
}

try {
  seedDictionaries();
} catch (err) {
  console.warn('[marketplace] seedDictionaries skipped:', err.message || err);
}

export function getDb() {
  return db;
}

export function getShopByKey(key) {
  return db.prepare('SELECT * FROM mp_shops WHERE key = ?').get(key);
}

export function getCategoryBySlug(slug) {
  return db.prepare('SELECT * FROM mp_categories WHERE slug = ?').get(slug);
}

export function upsertBrand(name) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const slug = slugify(clean);
  db.prepare(`
    INSERT INTO mp_brands (slug, name) VALUES (?, ?)
    ON CONFLICT(slug) DO UPDATE SET name = excluded.name
  `).run(slug, clean);
  return db.prepare('SELECT * FROM mp_brands WHERE slug = ?').get(slug);
}

export function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-z0-9а-я]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'item';
}

export default db;
