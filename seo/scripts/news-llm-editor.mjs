#!/usr/bin/env node
/**
 * Offline LLM editor: enrich published/useful articles with local Qwen insights + body expand + polish.
 * Usage: node scripts/news-llm-editor.mjs [--limit 5] [--force] [--polish-only]
 *
 * Safe for 6GB hosts: sequential jobs, Ollama MemoryMax=2.5G, num_thread=2.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, '../../backend');
const news = await import(path.join(BACKEND, 'news.js'));
const { scoreUsefulness, shouldPublish, mergePreservedReasons } = await import(path.join(BACKEND, 'news-quality.js'));
const { composeInsights } = await import(path.join(BACKEND, 'news-insights.js'));
const { localizeBundle } = await import(path.join(BACKEND, 'translate.js'));
const { isLlmAvailable, unloadModel, getLlmConfig } = await import(path.join(BACKEND, 'news-llm.js'));
const { polishEditorialText, passesEditorialGate } = await import(path.join(BACKEND, 'news-text-polish.js'));

const limitIdx = process.argv.indexOf('--limit');
const limit = limitIdx >= 0 ? Number(process.argv[limitIdx + 1]) : 5;
const force = process.argv.includes('--force');
const polishOnly = process.argv.includes('--polish-only');

const cfg = getLlmConfig();
const available = polishOnly ? true : await isLlmAvailable();
console.log(JSON.stringify({ llm: cfg, available, polishOnly }, null, 2));
if (!available) {
  console.error('Ollama/model unavailable - abort');
  process.exit(1);
}

const rows = news.listAllArticlesRaw({ limit: 500 });
let enriched = 0;
let polished = 0;
let skipped = 0;

for (const row of rows) {
  if (enriched >= limit) break;
  const categories = JSON.parse(row.categories || '[]');
  const quality = scoreUsefulness({
    title: row.title,
    summary: row.summary || '',
    body: row.body || '',
    sourceKey: row.source_key || '',
    categories
  });
  if (!shouldPublish(quality) && !row.published) {
    skipped += 1;
    continue;
  }

  try {
    let body = row.body;
    let bodyRu = row.body_ru;
    let bodyEn = row.body_en;
    let bodyDe = row.body_de;
    let insightsRu = row.insights_ru;
    let insightsEn = row.insights_en;
    let insightsDe = row.insights_de;
    let usedLlm = false;
    let research = 0;
    let didInsights = false;

    if (!polishOnly && (!row.insights_ru || force)) {
      const insights = await composeInsights(
        { title: row.title, summary: row.summary || '', body: row.body || '' },
        { topic: quality.primaryTopic || categories[0] || 'industry' }
      );
      usedLlm = Boolean(insights.usedLlm);
      research = insights.researchCount || 0;
      insightsRu = insights.insightsRu;
      insightsEn = insights.insightsEn;
      insightsDe = insights.insightsDe;
      didInsights = true;

      if (insights.expandedBodyRu && (!body || body.length < 900 || force)) {
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
    } else if (!polishOnly && row.insights_ru && !force) {
      skipped += 1;
      continue;
    }

    const srcBody = bodyRu || body || '';
    let polishedBody = false;
    if (srcBody.length >= 80) {
      const p = polishEditorialText(srcBody, { deep: true });
      if (p.text && p.text !== srcBody && (passesEditorialGate(p) || force)) {
        body = p.text;
        bodyRu = p.text;
        polishedBody = true;
        polished += 1;
      }
    }
    if (insightsRu && String(insightsRu).length >= 40) {
      const ip = polishEditorialText(String(insightsRu), { deep: true, soft: true });
      if (ip.text && passesEditorialGate(ip)) insightsRu = ip.text;
    }

    if (polishOnly && !polishedBody && !force) {
      skipped += 1;
      continue;
    }
    if (!didInsights && !polishedBody && !polishOnly) {
      skipped += 1;
      continue;
    }

    news.updateArticleLocales(row.id, {
      published: 1,
      usefulScore: quality.score,
      usefulReasons: mergePreservedReasons(
        (() => {
          try {
            return JSON.parse(row.useful_reasons || '[]');
          } catch {
            return [];
          }
        })(),
        quality.reasons
      ),
      insightsRu,
      insightsEn,
      insightsDe,
      insightsTopic: quality.primaryTopic || categories[0] || 'industry',
      body,
      bodyRu,
      bodyEn,
      bodyDe
    });
    enriched += 1;
    console.log('LLM_EDIT', row.slug, { usedLlm, research, polishedBody });
  } catch (e) {
    console.error('ERR', row.slug, e.message || e);
  }
}

if (!polishOnly) await unloadModel();
console.log(JSON.stringify({ enriched, polished, skipped, stats: news.newsStats() }, null, 2));
