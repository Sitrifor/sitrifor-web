#!/usr/bin/env node
/**
 * Generate TattooMarket product reviews → published news articles.
 * Usage: node scripts/news-tattoomarket-reviews.mjs [--limit 2] [--slug kwadron-round-liner-30-5rllt]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, '../../backend');
const news = await import(path.join(BACKEND, 'news.js'));
const { collectProducts, fetchProduct, TM_CATALOGS } = await import(path.join(BACKEND, 'tattoomarket.js'));
const { composeProductReview } = await import(path.join(BACKEND, 'news-product-reviews.js'));
const { unloadModel, isLlmAvailable, getLlmConfig } = await import(path.join(BACKEND, 'news-llm.js'));

const limitIdx = process.argv.indexOf('--limit');
const limit = limitIdx >= 0 ? Number(process.argv[limitIdx + 1]) : 2;
const slugIdx = process.argv.indexOf('--slug');
const onlySlug = slugIdx >= 0 ? process.argv[slugIdx + 1] : null;

console.log(JSON.stringify({ llm: getLlmConfig(), available: await isLlmAvailable() }, null, 2));

news.upsertSource({
  key: 'tattoomarket-reviews',
  name: 'Sitrifor Tech Reviews',
  url: 'https://www.tattoomarket.ru',
  feedUrl: null,
  region: 'RU',
  lang: 'ru',
  enabled: 1
});
const src = news.listSources({ enabledOnly: false }).find((s) => s.key === 'tattoomarket-reviews');

let targets = [];
if (onlySlug) {
  const product = await fetchProduct(`/product/${onlySlug}`);
  targets = [{ path: `/product/${onlySlug}`, url: product.url, catalogCategory: 'gear', product }];
} else {
  targets = await collectProducts({
    catalogs: TM_CATALOGS.slice(0, 3),
    perCatalog: Math.max(limit, 8),
    totalLimit: limit * 4
  });
}

let inserted = 0;
let skipped = 0;
let errors = 0;

for (const item of targets) {
  if (inserted >= limit) break;
  const guid = `tm:${item.path || item.product?.slug || item.url}`;
  try {
    const review = await composeProductReview(item.product || item, {
      category: item.catalogCategory || 'gear'
    });
    const res = news.insertArticle({
      sourceId: src.id,
      guid,
      title: review.title,
      summary: review.summary,
      body: review.body,
      url: review.product.url,
      imageUrl: review.imageUrl,
      publishedAt: new Date().toISOString(),
      categories: review.categories,
      lang: 'ru',
      region: 'RU',
      slugBase: review.title,
      titleRu: review.titleRu,
      summaryRu: review.summaryRu,
      bodyRu: review.bodyRu,
      titleEn: review.titleEn,
      summaryEn: review.summaryEn,
      bodyEn: review.bodyEn,
      titleDe: review.titleDe,
      summaryDe: review.summaryDe,
      bodyDe: review.bodyDe,
      published: true,
      usefulScore: review.usefulScore,
      usefulReasons: review.usefulReasons,
      insightsRu: review.insightsRu,
      insightsEn: review.insightsEn,
      insightsDe: review.insightsDe,
      insightsTopic: review.insightsTopic
    });
    if (res.inserted) {
      inserted += 1;
      console.log('REVIEW', res.slug, { usedLlm: review.usedLlm, research: review.researchCount });
    } else {
      skipped += 1;
      console.log('EXISTS', guid);
    }
  } catch (e) {
    errors += 1;
    console.error('ERR', item.path || item.url, e.message || e);
  }
}

await unloadModel();
console.log(JSON.stringify({ inserted, skipped, errors, stats: news.newsStats() }, null, 2));
