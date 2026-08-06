/**
 * Marketplace read API helpers.
 */
import { getDb } from './db.js';
import { marketplaceSearchLinks, cleanProductDescription, dedupeOffersByShop } from './normalize.js';

function mapProductRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: cleanProductDescription(row.description, row.title),
    sku: row.sku,
    coverUrl: row.cover_url,
    brand: row.brand_name
      ? { id: row.brand_id, slug: row.brand_slug, name: row.brand_name }
      : null,
    category: row.category_slug
      ? {
          id: row.category_id,
          slug: row.category_slug,
          title: row.category_title,
          imageUrl: row.category_image
        }
      : null,
    minPriceRub: row.min_price != null ? Number(row.min_price) : null,
    offerCount: Number(row.offer_count || 0),
    cheapestShop: row.cheapest_shop || null,
    updatedAt: row.updated_at
  };
}

function normalizeBrandSlugs(brand, brands) {
  const raw = [];
  if (Array.isArray(brands)) raw.push(...brands);
  else if (typeof brands === 'string' && brands.trim()) {
    raw.push(...brands.split(','));
  }
  if (Array.isArray(brand)) raw.push(...brand);
  else if (typeof brand === 'string' && brand.trim()) {
    raw.push(...brand.split(','));
  }
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const slug = String(item || '')
      .trim()
      .toLowerCase();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out;
}

/** Brands that have at least one product (optionally within a category). */
export function listBrands({ category } = {}) {
  const db = getDb();
  const params = {};
  let joinCat = '';
  let where = 'WHERE b.id IS NOT NULL';
  if (category) {
    joinCat = 'JOIN mp_categories c ON c.id = p.category_id';
    where += ' AND c.slug = @category';
    params.category = category;
  }
  return db
    .prepare(
      `SELECT b.slug, b.name, COUNT(p.id) AS product_count
       FROM mp_brands b
       JOIN mp_products p ON p.brand_id = b.id
       ${joinCat}
       ${where}
       GROUP BY b.id
       HAVING product_count > 0
       ORDER BY product_count DESC, b.name COLLATE NOCASE`
    )
    .all(params)
    .map((b) => ({ slug: b.slug, name: b.name, productCount: b.product_count }));
}

export function listMeta() {
  const db = getDb();
  const categories = db
    .prepare(
      `SELECT c.*,
        (SELECT COUNT(*) FROM mp_products p WHERE p.category_id = c.id) AS product_count
       FROM mp_categories c
       ORDER BY c.sort_order ASC`
    )
    .all()
    .map((c) => ({
      slug: c.slug,
      title: c.title,
      titleEn: c.title_en,
      titleDe: c.title_de,
      imageUrl: c.image_url,
      productCount: c.product_count
    }));

  const brands = listBrands();

  const shops = db
    .prepare(`SELECT key, name, base_url AS baseUrl, last_scraped_at AS lastScrapedAt FROM mp_shops WHERE enabled = 1 ORDER BY name`)
    .all();

  const stats = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM mp_products) AS products,
        (SELECT COUNT(*) FROM mp_offers) AS offers,
        (SELECT COUNT(*) FROM mp_shops WHERE enabled = 1) AS shops`
    )
    .get();

  return { categories, brands, shops, stats };
}

export function listProducts({ category, brand, brands, q, slugs, limit = 48, offset = 0 } = {}) {
  const db = getDb();
  const where = [];
  const params = {};
  const brandSlugs = normalizeBrandSlugs(brand, brands);
  const slugList = normalizeSlugs(slugs);

  if (slugList.length) {
    const placeholders = slugList.map((_, i) => {
      const key = `slug${i}`;
      params[key] = slugList[i];
      return `@${key}`;
    });
    where.push(`p.slug IN (${placeholders.join(', ')})`);
  } else {
    if (category) {
      where.push('c.slug = @category');
      params.category = category;
    }
    if (brandSlugs.length === 1) {
      where.push('b.slug = @brand0');
      params.brand0 = brandSlugs[0];
    } else if (brandSlugs.length > 1) {
      const placeholders = brandSlugs.map((_, i) => {
        const key = `brand${i}`;
        params[key] = brandSlugs[i];
        return `@${key}`;
      });
      where.push(`b.slug IN (${placeholders.join(', ')})`);
    }
    if (q) {
      where.push('(p.title LIKE @q OR IFNULL(p.description, \'\') LIKE @q OR IFNULL(b.name, \'\') LIKE @q)');
      params.q = `%${q}%`;
    }
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.limit = Math.min(Number(limit) || 48, slugList.length ? 200 : 100);
  params.offset = Math.max(Number(offset) || 0, 0);

  const total = db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM mp_products p
       LEFT JOIN mp_brands b ON b.id = p.brand_id
       LEFT JOIN mp_categories c ON c.id = p.category_id
       ${whereSql}`
    )
    .get(params).n;

  const orderSql = slugList.length
    ? `ORDER BY CASE p.slug ${slugList
        .map((_, i) => `WHEN @slug${i} THEN ${i}`)
        .join(' ')} ELSE 9999 END ASC`
    : `ORDER BY
         CASE
           WHEN EXISTS (
             SELECT 1 FROM mp_images i
             WHERE i.product_id = p.id
               AND i.local_path IS NOT NULL AND length(trim(i.local_path)) > 0
           ) THEN 0
           WHEN p.cover_url IS NOT NULL AND length(trim(p.cover_url)) > 0
             AND p.cover_url LIKE '/img/%' THEN 0
           WHEN p.cover_url IS NOT NULL AND length(trim(p.cover_url)) > 0 THEN 1
           WHEN EXISTS (SELECT 1 FROM mp_images i WHERE i.product_id = p.id LIMIT 1) THEN 1
           ELSE 2
         END ASC,
         (min_price IS NULL),
         min_price ASC,
         p.updated_at DESC`;

  const rows = db
    .prepare(
      `SELECT p.*,
        b.name AS brand_name, b.slug AS brand_slug,
        c.slug AS category_slug, c.title AS category_title, c.image_url AS category_image,
        (SELECT MIN(o.price_rub) FROM mp_offers o WHERE o.product_id = p.id AND o.price_rub IS NOT NULL) AS min_price,
        (SELECT COUNT(DISTINCT o.shop_id) FROM mp_offers o WHERE o.product_id = p.id) AS offer_count,
        (SELECT s.name FROM mp_offers o JOIN mp_shops s ON s.id = o.shop_id
          WHERE o.product_id = p.id AND o.price_rub IS NOT NULL
          ORDER BY o.price_rub ASC LIMIT 1) AS cheapest_shop
       FROM mp_products p
       LEFT JOIN mp_brands b ON b.id = p.brand_id
       LEFT JOIN mp_categories c ON c.id = p.category_id
       ${whereSql}
       ${orderSql}
       LIMIT @limit OFFSET @offset`
    )
    .all(params);

  return {
    total,
    limit: params.limit,
    offset: params.offset,
    brands: slugList.length ? [] : listBrands({ category: category || null }),
    items: rows.map(mapProductRow)
  };
}

function normalizeSlugs(slugs) {
  const raw = Array.isArray(slugs)
    ? slugs
    : typeof slugs === 'string'
      ? slugs.split(',')
      : [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const s = String(item || '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= 200) break;
  }
  return out;
}

export function listProductSlugsForSitemap({ limit = 20000, indexableOnly = true } = {}) {
  const db = getDb();
  const lim = Math.min(Math.max(Number(limit) || 20000, 1), 50000);
  const indexSql = indexableOnly
    ? `AND length(trim(p.title)) >= 15
       AND p.description IS NOT NULL AND length(trim(p.description)) > 40
       AND EXISTS (
         SELECT 1 FROM mp_offers o
         WHERE o.product_id = p.id AND o.price_rub IS NOT NULL AND o.price_rub >= 50
       )
       AND (
         (p.cover_url IS NOT NULL AND length(trim(p.cover_url)) > 0)
         OR EXISTS (
           SELECT 1 FROM mp_images i
           WHERE i.product_id = p.id
             AND (
               (i.local_path IS NOT NULL AND length(trim(i.local_path)) > 0)
               OR (i.url IS NOT NULL AND length(trim(i.url)) > 0)
             )
         )
       )`
    : '';
  return db
    .prepare(
      `SELECT p.slug, p.updated_at AS updatedAt
       FROM mp_products p
       WHERE p.slug IS NOT NULL AND length(trim(p.slug)) > 0
       ${indexSql}
       ORDER BY p.updated_at DESC, p.id DESC
       LIMIT ?`
    )
    .all(lim);
}

export function getProductBySlug(slug) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT p.*,
        b.name AS brand_name, b.slug AS brand_slug,
        c.slug AS category_slug, c.title AS category_title, c.image_url AS category_image,
        (SELECT MIN(o.price_rub) FROM mp_offers o WHERE o.product_id = p.id AND o.price_rub IS NOT NULL) AS min_price,
        (SELECT COUNT(DISTINCT o.shop_id) FROM mp_offers o WHERE o.product_id = p.id) AS offer_count,
        (SELECT s.name FROM mp_offers o JOIN mp_shops s ON s.id = o.shop_id
          WHERE o.product_id = p.id AND o.price_rub IS NOT NULL
          ORDER BY o.price_rub ASC LIMIT 1) AS cheapest_shop
       FROM mp_products p
       LEFT JOIN mp_brands b ON b.id = p.brand_id
       LEFT JOIN mp_categories c ON c.id = p.category_id
       WHERE p.slug = ?`
    )
    .get(slug);
  if (!row) return null;

  const offers = db
    .prepare(
      `SELECT o.price_rub AS priceRub, o.source_url AS url, o.in_stock AS inStock,
              o.title_raw AS titleRaw, o.scraped_at AS scrapedAt,
              s.key AS shopKey, s.name AS shopName
       FROM mp_offers o
       JOIN mp_shops s ON s.id = o.shop_id
       WHERE o.product_id = ?
       ORDER BY (o.price_rub IS NULL), o.price_rub ASC`
    )
    .all(row.id);

  const deduped = dedupeOffersByShop(
    offers.map((o) => ({
      ...o,
      inStock: !!o.inStock
    }))
  );
  const minPrice = deduped.filter((o) => o.priceRub != null).reduce((m, o) => Math.min(m, o.priceRub), Infinity);
  const offersOut = deduped.map((o) => ({
    ...o,
    isCheapest: o.priceRub != null && o.priceRub === minPrice
  }));

  const imageRows = db
    .prepare(
      `SELECT url, local_path AS localPath, sort_order AS sortOrder
       FROM mp_images
       WHERE product_id = ?
       ORDER BY
         CASE WHEN local_path IS NOT NULL AND length(trim(local_path)) > 0 THEN 0 ELSE 1 END,
         sort_order ASC,
         id ASC`
    )
    .all(row.id);

  const images = [];
  const seen = new Set();
  for (const rowImg of imageRows) {
    const preferred =
      rowImg.localPath && String(rowImg.localPath).trim()
        ? String(rowImg.localPath).trim()
        : rowImg.url && String(rowImg.url).trim()
          ? String(rowImg.url).trim()
          : null;
    if (!preferred || seen.has(preferred)) continue;
    // Prefer local; skip remote twin if we already have a local for this product
    if (!preferred.startsWith('/') && images.some((u) => u.startsWith('/'))) continue;
    seen.add(preferred);
    images.push(preferred);
  }

  const product = mapProductRow(row);
  const localCover = images.find((u) => u.startsWith('/'));
  if (localCover && product) {
    product.coverUrl = localCover;
  } else if (!product.coverUrl && images[0]) {
    product.coverUrl = images[0];
  }

  return {
    ...product,
    offers: offersOut,
    images: images.length ? images : product.coverUrl ? [product.coverUrl] : [],
    cheapest: offersOut.find((o) => o.isCheapest) || null,
    marketplaces: marketplaceSearchLinks(product.title)
  };
}
