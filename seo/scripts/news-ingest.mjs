#!/usr/bin/env node
/**
 * Ingest feeds → usefulness gate → full article + image → locales → Sitrifor AI insights.
 * Usage: node scripts/news-ingest.mjs [--limit 5] [--no-translate] [--no-fetch] [--no-insights]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

const Parser = (await import('rss-parser')).default;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, '../../backend');
const sourcesPath = path.join(BACKEND, 'data/news-sources.json');

const news = await import(path.join(BACKEND, 'news.js'));
const { localizeBundle } = await import(path.join(BACKEND, 'translate.js'));
const { scoreUsefulness, shouldPublish } = await import(path.join(BACKEND, 'news-quality.js'));
const { composeInsights } = await import(path.join(BACKEND, 'news-insights.js'));
const { normalizeImageUrl } = await import(path.join(BACKEND, 'news-images.js'));

const limitIdx = process.argv.indexOf('--limit');
const sourceLimit = limitIdx >= 0 ? Number(process.argv[limitIdx + 1]) : 0;
const noFetch = process.argv.includes('--no-fetch');
const noTranslate = process.argv.includes('--no-translate');
const noInsights = process.argv.includes('--no-insights');

const parser = new Parser({
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 SitriforNewsBot/1.0 (+https://sitrifor.ru/news)',
    Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
  }
});

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/(div|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function absUrl(src, pageUrl) {
  if (!src) return null;
  try {
    return new URL(src, pageUrl).toString();
  } catch {
    return null;
  }
}

function pickImage(item, pageUrl) {
  let raw = null;
  if (item.enclosure?.url && /image|jpg|png|webp|jpeg/i.test(item.enclosure.type || item.enclosure.url)) {
    raw = item.enclosure.url;
  } else {
    const enc = item['media:content'] || item['media:thumbnail'];
    if (enc?.$?.url) raw = enc.$.url;
    else if (enc?.url) raw = enc.url;
    else {
      const m = String(item['content:encoded'] || item.content || '').match(/<img[^>]+src=["']([^"']+)/i);
      raw = m ? absUrl(m[1], pageUrl) : null;
    }
  }
  return normalizeImageUrl(raw);
}

function bodyFromItem(item) {
  const raw = item['content:encoded'] || item.content || item.summary || item.contentSnippet || '';
  return stripHtml(raw).slice(0, 22000);
}

async function fetchArticlePage(url) {
  if (!url || noFetch) return { body: '', imageUrl: null };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 14000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 SitriforNewsBot/1.0 (+https://sitrifor.ru/news)',
        Accept: 'text/html,application/xhtml+xml'
      },
      redirect: 'follow'
    });
    clearTimeout(t);
    if (!res.ok) return { body: '', imageUrl: null };
    const html = await res.text();
    const $ = cheerio.load(html);
    const og =
      $('meta[property="og:image"]').attr('content') ||
      $('meta[name="twitter:image"]').attr('content') ||
      null;
    $('script, style, nav, footer, header, aside, iframe, noscript, form').remove();
    const candidates = [
      'article',
      '[itemprop="articleBody"]',
      '.article-body',
      '.entry-content',
      '.post-content',
      'main'
    ];
    let text = '';
    let img = og;
    for (const sel of candidates) {
      const el = $(sel).first();
      if (el.length) {
        text = stripHtml(el.html() || el.text());
        if (!img) {
          const src = el.find('img').first().attr('src');
          img = absUrl(src, url);
        }
        if (text.length > 280) break;
      }
    }
    if (text.length < 280) text = stripHtml($('body').text());
    if (!img) img = absUrl($('img').first().attr('src'), url);
    return { body: text.slice(0, 22000), imageUrl: normalizeImageUrl(img) };
  } catch {
    return { body: '', imageUrl: null };
  }
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(sourcesPath, 'utf8'));
  let sources = raw;
  if (sourceLimit > 0) sources = sources.slice(0, sourceLimit);

  const keepKeys = sources.map((s) => s.key);
  for (const s of sources) {
    news.upsertSource({
      key: s.key,
      name: s.name,
      url: s.url,
      feedUrl: s.feedUrl,
      region: s.region,
      lang: s.lang,
      enabled: 1
    });
  }
  const disabled = news.disableSourcesNotIn(keepKeys);
  console.log(`sources: ${keepKeys.length} enabled, ${disabled} disabled`);

  const enabled = news.listSources({ enabledOnly: true });
  let inserted = 0;
  let published = 0;
  let skipped = 0;
  let failed = 0;

  for (const src of enabled) {
    if (!src.feed_url) {
      news.markSourceFetch(src.key, 'no_feed');
      continue;
    }
    const meta = sources.find((s) => s.key === src.key) || {};
    const tier = meta.tier || 'core';
    try {
      const feed = await parser.parseURL(src.feed_url);
      let got = 0;
      for (const item of (feed.items || []).slice(0, 15)) {
        const title = stripHtml(item.title || '').slice(0, 300);
        let body = bodyFromItem(item);
        const summary = stripHtml(item.contentSnippet || item.summary || body).slice(0, 500);
        const url = item.link || item.guid;
        if (!title || !url) continue;

        if (!news.isTattooRelevant(title, summary, body, { sourceKey: src.key, tier })) {
          skipped += 1;
          continue;
        }

        let imageUrl = pickImage(item, url);
        if (body.length < 600 || !imageUrl) {
          const page = await fetchArticlePage(url);
          if (page.body.length > body.length) body = page.body;
          if (!imageUrl && page.imageUrl) imageUrl = page.imageUrl;
        }
        if (body.length < 40) body = summary || title;

        if (!news.isTattooRelevant(title, summary, body, { sourceKey: src.key, tier })) {
          skipped += 1;
          continue;
        }

        const categories = news.classifyArticle(title, summary + ' ' + body.slice(0, 500));
        if (tier === 'sketch' && !categories.includes('sketch')) categories.unshift('sketch');
        if (tier === 'gear' && !categories.includes('gear')) categories.unshift('gear');
        if (tier === 'pigments' && !categories.includes('pigments')) categories.unshift('pigments');
        if (tier === 'clients' && !categories.includes('clients')) categories.unshift('clients');
        if (tier === 'tools' && !categories.includes('tools')) categories.unshift('tools');

        const quality = scoreUsefulness({
          title,
          summary,
          body,
          sourceKey: src.key,
          categories
        });
        if (!shouldPublish(quality)) {
          skipped += 1;
          console.log(`SKIP_QUALITY\t${src.key}\t${quality.score}\t${title.slice(0, 60)}`);
          continue;
        }

        let insights = {};
        let finalBody = body;
        if (!noInsights) {
          try {
            insights = await composeInsights(
              { title, summary, body },
              { topic: quality.primaryTopic || categories[0] || 'industry' }
            );
            if (insights.expandedBodyRu && finalBody.length < 900) {
              finalBody = insights.expandedBodyRu;
            }
          } catch (e) {
            console.log(`INSIGHT_ERR\t${title.slice(0, 40)}\t${e.message || e}`);
          }
        }

        let loc = {};
        if (!noTranslate) {
          loc = await localizeBundle({
            title,
            summary,
            body: finalBody,
            sourceLang: src.lang || 'auto'
          });
          if (insights.expandedBodyEn) loc.bodyEn = insights.expandedBodyEn;
          if (insights.expandedBodyDe) loc.bodyDe = insights.expandedBodyDe;
          if (insights.expandedBodyRu) loc.bodyRu = insights.expandedBodyRu;
        }

        const publishedAt = item.isoDate || item.pubDate || new Date().toISOString();
        const res = news.insertArticle({
          sourceId: src.id,
          guid: String(item.guid || url).slice(0, 400),
          title,
          summary,
          body: finalBody,
          url,
          imageUrl,
          publishedAt: new Date(publishedAt).toISOString(),
          categories: [...new Set(categories)].slice(0, 3),
          lang: loc.detectedLang || src.lang,
          region: src.region,
          slugBase: title,
          titleRu: loc.titleRu,
          summaryRu: loc.summaryRu,
          bodyRu: loc.bodyRu || insights.expandedBodyRu || null,
          titleEn: loc.titleEn,
          summaryEn: loc.summaryEn,
          bodyEn: loc.bodyEn || insights.expandedBodyEn || null,
          titleDe: loc.titleDe,
          summaryDe: loc.summaryDe,
          bodyDe: loc.bodyDe || insights.expandedBodyDe || null,
          published: true,
          usefulScore: quality.score,
          usefulReasons: quality.reasons,
          insightsRu: insights.insightsRu || null,
          insightsEn: insights.insightsEn || null,
          insightsDe: insights.insightsDe || null,
          insightsTopic: insights.topic || quality.primaryTopic
        });
        if (res.inserted) {
          inserted += 1;
          published += 1;
          got += 1;
          console.log(`PUB\t${src.key}\t${quality.score}\t${title.slice(0, 70)}`);
        } else skipped += 1;
      }
      news.markSourceFetch(src.key, `ok:${got}`);
      console.log(`OK\t${src.key}\t+${got}`);
    } catch (e) {
      failed += 1;
      news.markSourceFetch(src.key, `err:${String(e.message || e).slice(0, 120)}`);
      console.log(`ERR\t${src.key}\t${e.message || e}`);
    }
  }

  console.log(JSON.stringify({ inserted, published, skipped, failed, stats: news.newsStats() }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
