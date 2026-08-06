#!/usr/bin/env node
/**
 * CLI: scrape marketplace shops into SQLite.
 *
 * Examples:
 *   node seo/scripts/marketplace-scrape.mjs --shop tattoomarket --full
 *   node seo/scripts/marketplace-scrape.mjs --full --concurrency 3
 *   node seo/scripts/marketplace-scrape.mjs --shops tattoomarket,profftattoo --limit 500
 *   node seo/scripts/marketplace-scrape.mjs --full --skip-images
 *   node seo/scripts/marketplace-scrape.mjs --reclassify
 *   node seo/scripts/marketplace-scrape.mjs --backfill-covers --limit 300
 */
import {
  scrapeMarketplace,
  reclassifyAllProducts,
  backfillCoversFromStoredImages,
  backfillMissingCovers,
  publishMarketplaceSeo
} from '../../backend/marketplace/index.js';

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  if (i === -1) return null;
  return args[i + 1] && !String(args[i + 1]).startsWith('--') ? args[i + 1] : true;
}

if (args.includes('--reclassify')) {
  const r = reclassifyAllProducts();
  const c = backfillCoversFromStoredImages();
  console.log(JSON.stringify({ reclassify: r, coversFromStored: c }, null, 2));
  process.exit(0);
}

if (args.includes('--backfill-covers')) {
  const limit = Number(flag('--limit') || 400);
  const concurrency = Number(flag('--concurrency') || 3);
  const delayMs = Number(flag('--delay') || 120);
  console.log(JSON.stringify({ mode: 'backfill-covers', limit, concurrency, delayMs }, null, 2));
  const summary = await backfillMissingCovers({
    limit,
    concurrency,
    delayMs,
    skipImageDownload: true
  });
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

const shop = flag('--shop');
const shops = flag('--shops');
const full = args.includes('--full');
const skipImages = args.includes('--skip-images');
const limit = Number(flag('--limit') || (full ? 100000 : 500));
const concurrency = Number(flag('--concurrency') || process.env.MP_CONCURRENCY || 4);
const delayMs = Number(flag('--delay') || process.env.MP_DELAY_MS || (full ? 120 : 150));

const shopKeys = shop
  ? [shop]
  : shops
    ? String(shops)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

console.log(
  JSON.stringify(
    { shopKeys: shopKeys || 'ALL', limit, concurrency, delayMs, skipImages, full },
    null,
    2
  )
);

const summary = await scrapeMarketplace({
  shopKeys,
  limitPerShop: limit,
  delayMs,
  concurrency,
  skipImages
});

console.log(JSON.stringify(summary, null, 2));

if (!args.includes('--skip-seo')) {
  try {
    const seo = await publishMarketplaceSeo({
      skipIndexNow: args.includes('--skip-indexnow')
    });
    console.log(JSON.stringify({ marketplaceSeo: seo }, null, 2));
  } catch (err) {
    console.warn('[marketplace] seo publish failed:', err.message || err);
  }
}
