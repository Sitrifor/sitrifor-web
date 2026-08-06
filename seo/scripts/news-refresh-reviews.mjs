#!/usr/bin/env node
/**
 * Refresh published TattooMarket reviews with the new article template.
 * Usage: node scripts/news-refresh-reviews.mjs [--limit 10]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, '../../backend');

const news = await import(path.join(BACKEND, 'news.js'));
const { composeProductReview } = await import(path.join(BACKEND, 'news-product-reviews.js'));
const { normalizeImageUrl } = await import(path.join(BACKEND, 'news-images.js'));

const limitIdx = process.argv.indexOf('--limit');
const limit = limitIdx >= 0 ? Number(process.argv[limitIdx + 1] || 20) : 20;

const rows = news
  .listRecentSlugs(200)
  .map((x) => news.getArticleBySlug(x.slug, { lang: 'ru' }))
  .filter((a) => a && (a.sourceKey === 'tattoomarket-reviews' || a.articleType === 'review'))
  .slice(0, limit);

console.log(JSON.stringify({ found: rows.length }, null, 2));

for (const a of rows) {
  if (!a.url) {
    console.log('SKIP no url', a.slug);
    continue;
  }
  try {
    const review = await composeProductReview(a.url, {
      category: (a.categories && a.categories[0]) || 'gear'
    });
    news.updateArticleLocales(a.id, {
      title: review.title,
      summary: review.summary,
      body: review.body,
      imageUrl: normalizeImageUrl(review.imageUrl),
      categories: review.categories,
      titleRu: review.titleRu,
      summaryRu: review.summaryRu,
      bodyRu: review.bodyRu,
      titleEn: review.titleEn,
      summaryEn: review.summaryEn,
      bodyEn: review.bodyEn,
      titleDe: review.titleDe,
      summaryDe: review.summaryDe,
      bodyDe: review.bodyDe,
      insightsRu: review.insightsRu,
      insightsEn: review.insightsEn,
      insightsDe: review.insightsDe,
      insightsTopic: review.insightsTopic,
      usefulScore: review.usefulScore,
      usefulReasons: review.usefulReasons
    });
    console.log('OK', a.slug);
  } catch (e) {
    console.error('FAIL', a.slug, e.message || e);
  }
}

console.log('done');
