#!/usr/bin/env node
/**
 * Re-polish published RU bodies/insights for readability.
 * Usage: node scripts/news-polish-published.mjs [--limit 50]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, '../../backend');
const news = await import(path.join(BACKEND, 'news.js'));
const { polishEditorialText } = await import(path.join(BACKEND, 'news-text-polish.js'));

const limIdx = process.argv.indexOf('--limit');
const limit = limIdx >= 0 ? Number(process.argv[limIdx + 1]) : 100;

const rows = news.listAllArticlesRaw({ limit: 800 }).filter((r) => r.published === 1).slice(0, limit);
let changed = 0;

for (const row of rows) {
  const body = polishEditorialText(row.body || '', { deep: true }).text;
  const bodyRu = polishEditorialText(row.body_ru || body, { deep: true }).text;
  const insightsRu = polishEditorialText(row.insights_ru || '', { deep: true }).text;
  const summary = polishEditorialText(row.summary || '', { soft: true, deep: true }).text;
  const summaryRu = polishEditorialText(row.summary_ru || summary, { soft: true, deep: true }).text;

  const dirty =
    body !== (row.body || '') ||
    bodyRu !== (row.body_ru || '') ||
    insightsRu !== (row.insights_ru || '') ||
    summary !== (row.summary || '') ||
    summaryRu !== (row.summary_ru || '');

  if (!dirty) continue;

  news.updateArticleLocales(row.id, {
    body,
    bodyRu,
    insightsRu,
    // summary fields via direct SQL — updateArticleLocales may not include summary
  });

  // summary columns
  news.newsDb
    .prepare(
      `UPDATE articles SET summary = COALESCE(?, summary), summary_ru = COALESCE(?, summary_ru),
       insights_ru = COALESCE(?, insights_ru) WHERE id = ?`
    )
    .run(summary || null, summaryRu || null, insightsRu || null, row.id);

  changed += 1;
  console.log('POLISH', row.slug);
}

console.log(JSON.stringify({ scanned: rows.length, changed, stats: news.newsStats() }, null, 2));
