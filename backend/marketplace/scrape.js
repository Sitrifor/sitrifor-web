/**
 * Marketplace scrape orchestrator with YML fast-path + concurrency.
 */
import { ALL_SHOPS, getShopAdapter } from './shops/index.js';
import { upsertOffer } from './merge.js';
import { seedDictionaries } from './db.js';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function mapPool(items, concurrency, fn) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

/**
 * @param {{ shopKeys?: string[], limitPerShop?: number, delayMs?: number, concurrency?: number, skipImages?: boolean }} opts
 */
export async function scrapeMarketplace(opts = {}) {
  seedDictionaries();
  const limitPerShop = Number(opts.limitPerShop || process.env.MP_LIMIT || 5000);
  const delayMs = Number(opts.delayMs ?? process.env.MP_DELAY_MS ?? 150);
  const concurrency = Number(opts.concurrency || process.env.MP_CONCURRENCY || 4);
  const keys = opts.shopKeys?.length ? opts.shopKeys : ALL_SHOPS.map((s) => s.key);

  const summary = { shops: {}, productsUpserted: 0, offers: 0, errors: [] };

  for (const key of keys) {
    const adapter = getShopAdapter(key);
    if (!adapter) {
      summary.errors.push({ shop: key, error: 'adapter_missing' });
      continue;
    }
    const shopStat = { listed: 0, parsed: 0, failed: 0, mode: 'html' };
    summary.shops[key] = shopStat;
    console.log(`[marketplace] scrape ${key} limit=${limitPerShop}`);

    // Fast path: YML with prices+images (no per-page crawl)
    if (typeof adapter.listYmlOffers === 'function' && adapter.ymlUrls?.length) {
      try {
        const ymlOffers = await adapter.listYmlOffers({ limit: limitPerShop });
        if (ymlOffers.length) {
          shopStat.mode = 'yml';
          shopStat.listed = ymlOffers.length;
          for (const o of ymlOffers) {
            try {
              await upsertOffer({
                shopKey: key,
                url: o.url,
                title: o.title,
                brand: o.brand,
                sku: o.sku,
                description: o.description,
                priceRaw: o.priceRaw,
                images: o.images || [],
                skipImageDownload: !!opts.skipImages,
                categorySlug: o.categorySlug,
                inStock: o.inStock !== false
              });
              shopStat.parsed += 1;
              summary.offers += 1;
              summary.productsUpserted += 1;
            } catch (err) {
              shopStat.failed += 1;
              summary.errors.push({ shop: key, url: o.url, error: String(err.message || err) });
            }
            if (delayMs) await sleep(Math.min(delayMs, 50));
          }
          continue;
        }
      } catch (err) {
        console.warn(`[marketplace] ${key} yml path failed, fallback sitemap/html`, err.message || err);
      }
    }

    let list = [];
    try {
      list = await adapter.listProducts({ limit: limitPerShop });
      shopStat.listed = list.length;
      shopStat.mode = 'sitemap/html';
    } catch (err) {
      summary.errors.push({ shop: key, error: String(err.message || err) });
      continue;
    }

    await mapPool(list, concurrency, async (item) => {
      try {
        const parsed = await adapter.parseProduct(item.url);
        if (!parsed?.title) {
          shopStat.failed += 1;
          return;
        }
        await upsertOffer({
          shopKey: key,
          url: parsed.url || item.url,
          title: parsed.title,
          brand: parsed.brand,
          sku: parsed.sku,
          description: parsed.description,
          priceRaw: parsed.priceRaw,
          images: parsed.images || [],
          skipImageDownload: !!opts.skipImages,
          categorySlug: parsed.categorySlug,
          inStock: parsed.inStock !== false
        });
        shopStat.parsed += 1;
        summary.offers += 1;
        summary.productsUpserted += 1;
      } catch (err) {
        shopStat.failed += 1;
        if (summary.errors.length < 200) {
          summary.errors.push({ shop: key, url: item.url, error: String(err.message || err) });
        }
      }
      if (delayMs) await sleep(delayMs);
    });
  }

  return summary;
}

/**
 * Re-fetch product pages for items without cover_url and store remote image URLs.
 * @param {{ limit?: number, concurrency?: number, delayMs?: number, skipImageDownload?: boolean }} opts
 */
export async function backfillMissingCovers(opts = {}) {
  const { getDb } = await import('./db.js');
  const db = getDb();
  const limit = Number(opts.limit || 500);
  const concurrency = Number(opts.concurrency || 3);
  const delayMs = Number(opts.delayMs ?? 100);
  const skipImageDownload = opts.skipImageDownload !== false;

  const rows = db
    .prepare(
      `SELECT p.id AS productId, o.source_url AS url, s.key AS shopKey
       FROM mp_products p
       JOIN mp_offers o ON o.product_id = p.id
       JOIN mp_shops s ON s.id = o.shop_id
       WHERE (p.cover_url IS NULL OR p.cover_url = '')
       GROUP BY p.id
       ORDER BY p.id DESC
       LIMIT ?`
    )
    .all(limit);

  const summary = { scanned: rows.length, updated: 0, failed: 0 };
  await mapPool(rows, concurrency, async (row) => {
    try {
      const adapter = getShopAdapter(row.shopKey);
      if (!adapter?.parseProduct) {
        summary.failed += 1;
        return;
      }
      const parsed = await adapter.parseProduct(row.url);
      if (!parsed?.images?.length) {
        summary.failed += 1;
        return;
      }
      await upsertOffer({
        shopKey: row.shopKey,
        url: parsed.url || row.url,
        title: parsed.title,
        brand: parsed.brand,
        sku: parsed.sku,
        description: parsed.description,
        priceRaw: parsed.priceRaw,
        images: parsed.images,
        skipImageDownload,
        categorySlug: parsed.categorySlug,
        inStock: parsed.inStock !== false
      });
      summary.updated += 1;
    } catch {
      summary.failed += 1;
    }
    if (delayMs) await sleep(delayMs);
  });
  return summary;
}
