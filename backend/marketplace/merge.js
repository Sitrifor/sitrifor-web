/**
 * Upsert scraped offers into unified products.
 */
import {
  getDb,
  getShopByKey,
  getCategoryBySlug,
  upsertBrand,
  slugify
} from './db.js';
import { parsePriceRub, productFingerprint, guessCategory, cleanProductDescription } from './normalize.js';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const imgRoot = join(__dirname, '../../public/img/marketplace/products');
mkdirSync(imgRoot, { recursive: true });

async function downloadImage(url) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const hash = createHash('sha1').update(url).digest('hex').slice(0, 16);
    const ext = (url.match(/\.(jpe?g|png|webp|gif)/i) || [, 'jpg'])[1].toLowerCase().replace('jpeg', 'jpg');
    const localRel = `/img/marketplace/products/${hash}.${ext}`;
    const localAbs = join(__dirname, '../../public', localRel);
    if (existsSync(localAbs)) return localRel;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'SitriforMarketplaceBot/1.0' }
      });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 500) return null;
      writeFileSync(localAbs, buf);
      return localRel;
    } finally {
      clearTimeout(t);
    }
  } catch {
    return null;
  }
}

function firstRemoteImage(images) {
  if (!Array.isArray(images)) return null;
  for (const u of images) {
    if (u && /^https?:\/\//i.test(String(u))) return String(u);
  }
  return null;
}

/**
 * @param {object} offer
 * @param {string} offer.shopKey
 * @param {string} offer.url
 * @param {string} offer.title
 * @param {string} [offer.brand]
 * @param {string} [offer.sku]
 * @param {string} [offer.description]
 * @param {string|number} [offer.priceRaw]
 * @param {string[]} [offer.images]
 * @param {string} [offer.categorySlug]
 * @param {boolean} [offer.inStock]
 * @param {boolean} [offer.skipImageDownload] - keep remote URLs as cover, do not mirror files
 */
export async function upsertOffer(offer) {
  const db = getDb();
  const shop = getShopByKey(offer.shopKey);
  if (!shop) throw new Error(`unknown_shop:${offer.shopKey}`);

  const priceRub = parsePriceRub(offer.priceRaw);
  // Always re-guess from title/url so sticky wrong categories can heal on re-scrape.
  // Shop categoryHint only fills gaps when guess is inconclusive.
  let catSlug = guessCategory(offer.title, offer.url) || 'other';
  if (catSlug === 'other' && offer.categorySlug) catSlug = offer.categorySlug;
  const cat = getCategoryBySlug(catSlug) || getCategoryBySlug('other');
  const brand = upsertBrand(offer.brand || guessBrandFromTitle(offer.title));
  const description = cleanProductDescription(offer.description, offer.title);
  const fingerprint = productFingerprint({
    title: offer.title,
    brand: brand?.name,
    sku: offer.sku
  });

  let product = db.prepare('SELECT * FROM mp_products WHERE fingerprint = ?').get(fingerprint);
  if (!product) {
    let baseSlug = slugify(`${brand?.name || 'item'}-${offer.title}`).slice(0, 80);
    let slug = baseSlug;
    let n = 2;
    while (db.prepare('SELECT id FROM mp_products WHERE slug = ?').get(slug)) {
      slug = `${baseSlug}-${n++}`;
    }
    const info = db
      .prepare(
        `INSERT INTO mp_products (slug, fingerprint, title, brand_id, category_id, description, sku, cover_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        slug,
        fingerprint,
        offer.title,
        brand?.id || null,
        cat?.id || null,
        description,
        offer.sku || null,
        null
      );
    product = db.prepare('SELECT * FROM mp_products WHERE id = ?').get(info.lastInsertRowid);
  } else {
    const nextDesc = description;
    const curDesc = product.description || '';
    const preferNew =
      nextDesc &&
      (!curDesc ||
        (nextDesc.length >= 24 &&
          (curDesc.includes('телефон') ||
            curDesc.includes('8-800') ||
            curDesc.includes('интернет-магазин') ||
            nextDesc.length > curDesc.length)));
    db.prepare(
      `UPDATE mp_products SET
        title = COALESCE(?, title),
        description = CASE WHEN ? = 1 THEN ? ELSE description END,
        brand_id = COALESCE(?, brand_id),
        category_id = ?,
        sku = COALESCE(?, sku),
        updated_at = datetime('now')
      WHERE id = ?`
    ).run(
      offer.title,
      preferNew ? 1 : 0,
      nextDesc,
      brand?.id || null,
      cat?.id || null,
      offer.sku || null,
      product.id
    );
    product = db.prepare('SELECT * FROM mp_products WHERE id = ?').get(product.id);
  }

  const images = Array.isArray(offer.images) ? offer.images.filter(Boolean) : [];
  db.prepare(
    `INSERT INTO mp_offers (product_id, shop_id, source_url, source_sku, title_raw, price_rub, in_stock, raw_json, scraped_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(shop_id, source_url) DO UPDATE SET
       product_id = excluded.product_id,
       source_sku = excluded.source_sku,
       title_raw = excluded.title_raw,
       price_rub = excluded.price_rub,
       in_stock = excluded.in_stock,
       raw_json = excluded.raw_json,
       scraped_at = datetime('now')`
  ).run(
    product.id,
    shop.id,
    offer.url,
    offer.sku || null,
    offer.title,
    priceRub,
    offer.inStock === false ? 0 : 1,
    JSON.stringify({ images, priceRaw: offer.priceRaw })
  );

  let cover = product.cover_url;
  const skipDownload = !!offer.skipImageDownload;
  const maxImg = Number(offer.maxImages ?? process.env.MP_MAX_IMAGES ?? 2);

  if (skipDownload) {
    const remote = firstRemoteImage(images);
    if (remote) {
      db.prepare(
        `INSERT INTO mp_images (product_id, url, local_path, sort_order)
         VALUES (?, ?, NULL, 0)
         ON CONFLICT(product_id, url) DO NOTHING`
      ).run(product.id, remote);
      if (!cover) cover = remote;
    }
  } else {
    for (let i = 0; i < Math.min(images.length, maxImg); i++) {
      const remote = images[i];
      if (!remote) continue;
      const local = (await downloadImage(remote)) || remote;
      db.prepare(
        `INSERT INTO mp_images (product_id, url, local_path, sort_order)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(product_id, url) DO UPDATE SET local_path = COALESCE(excluded.local_path, mp_images.local_path)`
      ).run(product.id, remote, local?.startsWith('/') ? local : null, i);
      if (!cover) cover = local || remote;
    }
  }

  if (!cover) cover = firstRemoteImage(images);
  if (cover && cover !== product.cover_url) {
    db.prepare('UPDATE mp_products SET cover_url = ? WHERE id = ?').run(cover, product.id);
  }

  db.prepare('UPDATE mp_shops SET last_scraped_at = datetime(\'now\') WHERE id = ?').run(shop.id);
  return { productId: product.id, fingerprint, priceRub, categorySlug: catSlug };
}

/**
 * Re-assign category_id for all products from title + primary offer URL.
 */
export function reclassifyAllProducts() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.id, p.title,
        (SELECT o.source_url FROM mp_offers o WHERE o.product_id = p.id ORDER BY o.id ASC LIMIT 1) AS url
       FROM mp_products p`
    )
    .all();
  const upd = db.prepare('UPDATE mp_products SET category_id = ?, updated_at = datetime(\'now\') WHERE id = ?');
  const counts = {};
  const tx = db.transaction(() => {
    for (const r of rows) {
      const slug = guessCategory(r.title, r.url || '') || 'other';
      const cat = getCategoryBySlug(slug) || getCategoryBySlug('other');
      counts[slug] = (counts[slug] || 0) + 1;
      upd.run(cat.id, r.id);
    }
  });
  tx();
  return { total: rows.length, byCategory: counts };
}

/**
 * Set cover_url from offer raw_json.images or mp_images when cover is empty.
 */
export function backfillCoversFromStoredImages() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.id,
        (SELECT COALESCE(i.local_path, i.url) FROM mp_images i WHERE i.product_id = p.id ORDER BY i.sort_order ASC, i.id ASC LIMIT 1) AS img,
        (SELECT o.raw_json FROM mp_offers o WHERE o.product_id = p.id AND o.raw_json LIKE '%http%' LIMIT 1) AS raw
       FROM mp_products p
       WHERE p.cover_url IS NULL OR p.cover_url = ''`
    )
    .all();
  const upd = db.prepare('UPDATE mp_products SET cover_url = ?, updated_at = datetime(\'now\') WHERE id = ?');
  let updated = 0;
  const tx = db.transaction(() => {
    for (const r of rows) {
      let cover = r.img || null;
      if (!cover && r.raw) {
        try {
          const images = JSON.parse(r.raw).images || [];
          cover = firstRemoteImage(images);
        } catch {
          cover = null;
        }
      }
      if (cover) {
        upd.run(cover, r.id);
        updated += 1;
      }
    }
  });
  tx();
  return { scanned: rows.length, updated };
}

/** Re-clean all product descriptions (phones, shop CRM fluff). */
export function sanitizeAllDescriptions() {
  const db = getDb();
  const rows = db.prepare('SELECT id, title, description FROM mp_products').all();
  const upd = db.prepare(
    `UPDATE mp_products SET description = ?, updated_at = datetime('now') WHERE id = ?`
  );
  let cleaned = 0;
  let cleared = 0;
  const tx = db.transaction(() => {
    for (const r of rows) {
      const next = cleanProductDescription(r.description, r.title);
      const prev = r.description || null;
      if (next === prev) continue;
      if (!prev && !next) continue;
      if ((prev || '') === (next || '')) continue;
      upd.run(next, r.id);
      cleaned += 1;
      if (prev && !next) cleared += 1;
    }
  });
  tx();
  return { scanned: rows.length, cleaned, cleared };
}

/**
 * Prefer local mirrored images as cover_url when available.
 * Drops cover pointing at broken remote when a local file exists.
 */
export function repairCoversFromLocalImages() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.id, p.cover_url AS cover,
        (SELECT i.local_path FROM mp_images i
          WHERE i.product_id = p.id
            AND i.local_path IS NOT NULL AND length(trim(i.local_path)) > 0
          ORDER BY i.sort_order ASC, i.id ASC LIMIT 1) AS localPath
       FROM mp_products p`
    )
    .all();
  const upd = db.prepare(
    `UPDATE mp_products SET cover_url = ?, updated_at = datetime('now') WHERE id = ?`
  );
  let updated = 0;
  const tx = db.transaction(() => {
    for (const r of rows) {
      if (!r.localPath) continue;
      if (r.cover === r.localPath) continue;
      upd.run(r.localPath, r.id);
      updated += 1;
    }
  });
  tx();
  return { scanned: rows.length, updated };
}

function guessBrandFromTitle(title) {
  const m = String(title || '').match(
    /\b(KWADRON|Cheyenne|Bishop|Eternal|Dynamic|Panthera|World Famous|Electrum|Allegory|Critical|FK Irons|Spektra|InkMachines|EZ|Mast|Ambition|Dragonhawk|CNC|MTM|Intenze|Solid Ink|Perma Blend)\b/i
  );
  return m ? m[1] : null;
}
