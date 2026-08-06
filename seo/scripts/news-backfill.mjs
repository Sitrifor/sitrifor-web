#!/usr/bin/env node
/**
 * Backfill bodies + RU/EN/DE locales for tattoo-relevant articles.
 * Usage: node scripts/news-backfill.mjs [--limit 40]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, '../../backend');
const news = await import(path.join(BACKEND, 'news.js'));
const { localizeBundle } = await import(path.join(BACKEND, 'translate.js'));

const limitIdx = process.argv.indexOf('--limit');
const limit = limitIdx >= 0 ? Number(process.argv[limitIdx + 1]) : 40;

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

async function fetchArticleBody(url) {
  if (!url) return '';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 SitriforNewsBot/1.0 (+https://sitrifor.ru/news)',
        Accept: 'text/html,application/xhtml+xml'
      },
      redirect: 'follow'
    });
    clearTimeout(t);
    if (!res.ok) return '';
    const html = await res.text();
    const $ = cheerio.load(html);
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
    for (const sel of candidates) {
      const el = $(sel).first();
      if (el.length) {
        text = stripHtml(el.html() || el.text());
        if (text.length > 280) break;
      }
    }
    if (text.length < 280) text = stripHtml($('body').text());
    return text.slice(0, 18000);
  } catch {
    return '';
  }
}

async function main() {
  let filled = 0;
  let translated = 0;
  let failed = 0;

  const needBody = news.listArticlesNeedingBody({ limit });
  for (const row of needBody) {
    try {
      let body = await fetchArticleBody(row.url);
      if (body.length < 40) body = row.summary || row.title;
      news.updateArticleLocales(row.id, { body });
      filled += 1;
      console.log(`BODY\t${row.slug}\t${body.length}`);
    } catch (e) {
      failed += 1;
      console.log(`ERR_BODY\t${row.slug}\t${e.message || e}`);
    }
  }

  const needLoc = news.listArticlesNeedingRu({ limit });
  for (const row of needLoc) {
    try {
      const title = row.title || '';
      const summary = row.summary || '';
      const body = row.body || summary || title;
      const loc = await localizeBundle({
        title,
        summary,
        body,
        sourceLang: row.lang || 'auto'
      });
      news.updateArticleLocales(row.id, loc);
      translated += 1;
      console.log(`LOC\t${row.slug}\tru/en/de`);
    } catch (e) {
      failed += 1;
      console.log(`ERR_LOC\t${row.slug}\t${e.message || e}`);
    }
  }

  console.log(JSON.stringify({ filled, translated, failed, stats: news.newsStats() }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
