#!/usr/bin/env node
/**
 * Re-score all articles, unpublish junk, fix image URLs, refresh insights for keepers.
 * Usage: node scripts/news-quality-cleanup.mjs [--insights-limit 20]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, '../../backend');
const news = await import(path.join(BACKEND, 'news.js'));
const { scoreUsefulness, shouldPublish, isBadAiText, mergePreservedReasons } = await import(path.join(BACKEND, 'news-quality.js'));
const { normalizeImageUrl } = await import(path.join(BACKEND, 'news-images.js'));
const { composeInsights } = await import(path.join(BACKEND, 'news-insights.js'));
const { composeProductReview } = await import(path.join(BACKEND, 'news-product-reviews.js'));

const limIdx = process.argv.indexOf('--insights-limit');
const insightsLimit = limIdx >= 0 ? Number(process.argv[limIdx + 1]) : 25;

const HARD_UNPUBLISH_SLUGS = new Set([
  'benkei-sleeve-done-by-lars-walkling-shinou-tattoo',
  'japanese-traditional-sleeve-done-by-liluniverse',
  'kaeru-party-ideas',
  'looking-for-blackwork-artists-similar-to-this-in-la',
  'panayiotis-panayi',
  'george-baradim',
  'santiago-iriarte',
  'shimizu',
  'piew-choquette',
  'inked-tattoos-of-the-week',
  'government-social-media-in-2026-best-practices-strategy',
  'social-media-okrs-for-executives-a-complete-framework-for-2026',
  'how-to-do-a-social-media-audit-in-2026-free-template',
  'we-rebuilt-buffer-s-analytics-meet-insights',
  'how-dustin-kuhns-uses-buffer-insights-to-let-taste-lead',
  'how-winning-hearts-before-peak-season-boosts-carts-when-it-matters-most',
  'bodysuit-appreciation-horiuno-ii',
  'raijin-and-dragon-full-back',
  'ama-with-manami-okazaki',
  'design-review-approach'
]);

const rows = news.listAllArticlesRaw({ limit: 800 });
let unpublished = 0;
let kept = 0;
let imagesFixed = 0;
let insightsRefreshed = 0;
let reviewsFixed = 0;

for (const row of rows) {
  const categories = JSON.parse(row.categories || '[]');
  const quality = scoreUsefulness({
    title: row.title,
    summary: row.summary || '',
    body: row.body || '',
    sourceKey: row.source_key || '',
    categories
  });

  let imageUrl = normalizeImageUrl(row.image_url);
  if (imageUrl !== row.image_url) imagesFixed += 1;

  const trusted = /sitrifor-editorial|sitrifor-daily-ai|tattoomarket-reviews/i.test(row.source_key || '');
  const hardDrop = HARD_UNPUBLISH_SLUGS.has(row.slug);
  const pass = !hardDrop && trusted && shouldPublish(quality);

  const prevReasons = (() => {
    try {
      return JSON.parse(row.useful_reasons || '[]');
    } catch {
      return [];
    }
  })();

  if (!pass) {
    news.updateArticleLocales(row.id, {
      published: 0,
      usefulScore: quality.score,
      usefulReasons: [
        ...mergePreservedReasons(prevReasons, quality.reasons),
        hardDrop ? 'hard_unpublish' : 'rescored_fail'
      ],
      imageUrl
    });
    unpublished += 1;
    continue;
  }

  let insightsRu = row.insights_ru;
  let insightsEn = row.insights_en;
  let insightsDe = row.insights_de;
  let body = row.body;
  let bodyRu = row.body_ru;
  let bodyEn = row.body_en;
  let bodyDe = row.body_de;

  // Fix bad LLM product review
  if (row.source_key === 'tattoomarket-reviews' && (isBadAiText(body) || isBadAiText(insightsRu))) {
    try {
      const pathMatch = (row.url || '').match(/\/product\/[^/?#]+/);
      if (pathMatch) {
        const review = await composeProductReview(pathMatch[0], {
          category: categories[0] || 'gear'
        });
        body = review.body;
        bodyRu = review.bodyRu;
        bodyEn = review.bodyEn;
        bodyDe = review.bodyDe;
        insightsRu = review.insightsRu;
        insightsEn = review.insightsEn;
        insightsDe = review.insightsDe;
        imageUrl = normalizeImageUrl(review.imageUrl) || imageUrl;
        reviewsFixed += 1;
        console.log('FIXED_REVIEW', row.slug);
      }
    } catch (e) {
      console.error('REVIEW_ERR', row.slug, e.message || e);
    }
  } else if (
    insightsRefreshed < insightsLimit &&
    (isBadAiText(insightsRu) ||
      !insightsRu ||
      /Рост охватов и записи через соцсети/.test(insightsRu || '') ||
      /веб-исследование \+ отраслевые|локальная модель/.test(insightsRu || ''))
  ) {
    try {
      const insights = await composeInsights(
        { title: row.title, summary: row.summary || '', body: row.body || '' },
        { topic: quality.primaryTopic || categories[0] || 'industry' }
      );
      insightsRu = insights.insightsRu;
      insightsEn = insights.insightsEn;
      insightsDe = insights.insightsDe;
      insightsRefreshed += 1;
      console.log('INSIGHTS', row.slug, quality.primaryTopic);
    } catch (e) {
      console.error('INSIGHTS_ERR', row.slug, e.message || e);
    }
  }

  news.updateArticleLocales(row.id, {
    published: 1,
    usefulScore: quality.score,
    usefulReasons: mergePreservedReasons(prevReasons, quality.reasons),
    imageUrl,
    insightsRu,
    insightsEn,
    insightsDe,
    insightsTopic: quality.primaryTopic,
    body,
    bodyRu,
    bodyEn,
    bodyDe
  });
  kept += 1;
}

console.log(
  JSON.stringify(
    {
      kept,
      unpublished,
      imagesFixed,
      insightsRefreshed,
      reviewsFixed,
      stats: news.newsStats()
    },
    null,
    2
  )
);
