#!/usr/bin/env node
/**
 * Re-score existing articles, publish useful ones, attach Sitrifor AI insights + expand bodies.
 * Usage: node scripts/news-enrich.mjs [--limit 20]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, '../../backend');
const news = await import(path.join(BACKEND, 'news.js'));
const { scoreUsefulness, shouldPublish } = await import(path.join(BACKEND, 'news-quality.js'));
const { composeInsights } = await import(path.join(BACKEND, 'news-insights.js'));
const { localizeBundle } = await import(path.join(BACKEND, 'translate.js'));

const limitIdx = process.argv.indexOf('--limit');
const limit = limitIdx >= 0 ? Number(process.argv[limitIdx + 1]) : 25;

const rows = news.listAllArticlesRaw({ limit: 400 });
let published = 0;
let unpublished = 0;
let enriched = 0;

for (const row of rows) {
  const categories = JSON.parse(row.categories || '[]');
  const quality = scoreUsefulness({
    title: row.title,
    summary: row.summary || '',
    body: row.body || '',
    sourceKey: row.source_key || '',
    categories
  });

  if (!shouldPublish(quality)) {
    news.updateArticleLocales(row.id, {
      published: 0,
      usefulScore: quality.score,
      usefulReasons: quality.reasons
    });
    unpublished += 1;
    continue;
  }

  // Only auto-publish trusted editorial / reviews / daily AI.
  // External RSS must stay draft unless already curated published with insights.
  const trusted = /sitrifor-editorial|sitrifor-daily-ai|tattoomarket-reviews/i.test(row.source_key || '');
  const publishFlag = trusted || (row.published && quality.score >= 90 && quality.reasons.includes('actionable') && quality.reasons.includes('tattoo_context'));

  if (!publishFlag) {
    news.updateArticleLocales(row.id, {
      published: 0,
      usefulScore: quality.score,
      usefulReasons: [...quality.reasons, 'rss_held_as_draft']
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

  if (!insightsRu && enriched < limit) {
    try {
      const insights = await composeInsights(
        { title: row.title, summary: row.summary || '', body: row.body || '' },
        { topic: quality.primaryTopic || categories[0] || 'industry' }
      );
      insightsRu = insights.insightsRu;
      insightsEn = insights.insightsEn;
      insightsDe = insights.insightsDe;
      if (insights.expandedBodyRu && (!body || body.length < 900)) {
        body = insights.expandedBodyRu;
        bodyRu = insights.expandedBodyRu;
        bodyEn = insights.expandedBodyEn;
        bodyDe = insights.expandedBodyDe;
        const loc = await localizeBundle({
          title: row.title,
          summary: row.summary || '',
          body,
          sourceLang: row.lang || 'auto'
        });
        bodyRu = loc.bodyRu || bodyRu;
        bodyEn = loc.bodyEn || bodyEn;
        bodyDe = loc.bodyDe || bodyDe;
      }
      enriched += 1;
      console.log('ENRICH', row.slug, quality.score);
    } catch (e) {
      console.log('ERR', row.slug, e.message || e);
    }
  }

  news.updateArticleLocales(row.id, {
    published: publishFlag ? 1 : 0,
    usefulScore: quality.score,
    usefulReasons: quality.reasons,
    insightsRu,
    insightsEn,
    insightsDe,
    insightsTopic: quality.primaryTopic,
    body,
    bodyRu,
    bodyEn,
    bodyDe
  });
  if (publishFlag) published += 1;
  else unpublished += 1;
}

console.log(JSON.stringify({ published, unpublished, enriched, stats: news.newsStats() }, null, 2));
