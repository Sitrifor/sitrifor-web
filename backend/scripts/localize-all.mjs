#!/usr/bin/env node
import { translateText } from '../translate.js';
import {
  getArticleBySlug,
  listRecentSlugs,
  listArticlesNeedingRu,
  updateArticleLocales,
  newsStats,
  newsDb
} from '../news.js';

const db = newsDb;

db.prepare(`UPDATE articles SET title_en = COALESCE(title_en, title), summary_en = COALESCE(summary_en, summary), body_en = COALESCE(body_en, body)`).run();

const rows = db.prepare(`
  SELECT id, title, summary, body, title_ru, title_de, summary_ru, summary_de, body_ru, body_de
  FROM articles
  WHERE title_ru IS NULL OR title_de IS NULL OR body_ru IS NULL OR body_de IS NULL
  ORDER BY published_at DESC
`).all();

console.log('need', rows.length);

let ok = 0;
for (const r of rows) {
  const titleRu = r.title_ru || (await translateText(r.title, 'ru'));
  const titleDe = r.title_de || (await translateText(r.title, 'de'));
  const summaryRu = r.summary_ru || (r.summary ? await translateText(String(r.summary).slice(0, 900), 'ru') : null);
  const summaryDe = r.summary_de || (r.summary ? await translateText(String(r.summary).slice(0, 900), 'de') : null);
  const short = String(r.body || r.summary || r.title || '').slice(0, 1800);
  const bodyRu = r.body_ru || (await translateText(short, 'ru'));
  const bodyDe = r.body_de || (await translateText(short, 'de'));
  updateArticleLocales(r.id, {
    titleRu: titleRu || null,
    titleDe: titleDe || null,
    summaryRu: summaryRu || null,
    summaryDe: summaryDe || null,
    bodyRu: bodyRu || null,
    bodyDe: bodyDe || null
  });
  ok += 1;
  if (ok % 10 === 0 || ok === rows.length) {
    console.log('progress', ok, '/', rows.length, (titleRu || r.title).slice(0, 60));
  }
}

const stats = db.prepare(`SELECT count(*) total,
  sum(CASE WHEN title_ru IS NOT NULL AND title_ru GLOB '*[А-Яа-яЁё]*' THEN 1 ELSE 0 END) ru_ok,
  sum(title_en IS NOT NULL) en_ok,
  sum(title_de IS NOT NULL) de_ok
FROM articles`).get();
console.log(JSON.stringify({ ok, stats, news: newsStats() }, null, 2));

const slug = listRecentSlugs(3)[0].slug;
for (const lang of ['ru', 'en', 'de']) {
  const a = getArticleBySlug(slug, { lang });
  console.log(lang, '=>', a.title.slice(0, 90));
}
