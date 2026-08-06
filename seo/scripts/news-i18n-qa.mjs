#!/usr/bin/env node
/**
 * News i18n QA gate for Sitrifor.
 *
 * Checks:
 * 1) Required news.* keys exist in ru/en/de dictionaries
 * 2) News frontend JS has no suspicious hardcoded Russian UI leftovers
 * 3) Published articles have real EN/DE title+body (not empty / not leftover RU)
 *
 * Usage:
 *   node seo/scripts/news-i18n-qa.mjs
 *   node seo/scripts/news-i18n-qa.mjs --json
 *   npm run news:i18n-qa   (from seo/)
 *
 * Exit 1 on failures.
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const PUBLIC = join(ROOT, 'public');
const BACKEND = join(ROOT, 'backend');
const asJson = process.argv.includes('--json');

const REQUIRED_KEYS = [
  'news.loadMore',
  'news.today',
  'news.yesterday',
  'news.tagAll',
  'news.views',
  'news.viewsShort',
  'news.viewsShortK',
  'news.minutes',
  'news.materials',
  'news.emptyDay',
  'news.emptyTag',
  'news.notFound',
  'news.backToFeed',
  'news.reactions',
  'news.react.rocket',
  'news.react.smile',
  'news.react.poop',
  'news.badge.review',
  'news.badge.editor',
  'news.badge.social',
  'news.fallbackTitle',
  'news.sourceNote',
  'news.buy.title',
  'news.buy.openSource',
  'news.buy.yandex',
  'news.promo.aria',
  'news.promo.title',
  'news.promo.lead',
  'news.promo.calc',
  'news.promo.calcDesc',
  'news.promo.app',
  'news.promo.appDesc',
  'news.promo.care',
  'news.promo.careDesc',
  'news.insights.reviewTitle',
  'news.insights.title',
  'news.insights.reviewLead',
  'news.insights.lead',
  'news.cta.open',
  'news.cta.appTitle',
  'news.cta.appText',
  'news.cta.appLabel',
  'news.cta.reviewTitle',
  'news.cta.reviewText',
  'news.cta.reviewLabel',
  'news.kicker.release',
  'news.kicker.review',
  'news.kicker.editor',
  'news.kicker.social',
  'news.kicker.editorial'
];

/** Hardcoded RU UI phrases that must go through i18n.t / dict */
const FORBIDDEN_UI = [
  { re: /title=["']Просмотры["']/, label: 'views title="Просмотры"' },
  { re: /К ленте/, label: 'back-to-feed «К ленте»' },
  { re: /aria-label=["']Реакции["']/, label: 'aria-label Реакции' },
  { re: />Ракета</, label: 'reaction label Ракета' },
  { re: />Лайк</, label: 'reaction label Лайк' },
  { re: />Какашка</, label: 'reaction label Какашка' },
  { re: /просм\./, label: 'views suffix просм.' },
  { re: /За этот день пока нет/, label: 'empty day RU' },
  { re: /Нет материалов по выбранному/, label: 'empty tag RU' },
  { re: /Материал не найден/, label: 'not found RU' },
  { re: /Инструменты мастера/, label: 'promo title RU' },
  { re: /Установить 634/, label: 'CTA Install 634 RU' },
  { re: /Скачать в App Store/, label: 'CTA App Store RU' }
];

const SCAN_FILES = [
  'public/js/news.js',
  'public/js/news-article.js',
  'backend/news-magazine.js'
];

function loadDict() {
  const code = readFileSync(join(PUBLIC, 'js/i18n-dict.js'), 'utf8');
  // eslint-disable-next-line no-new-func
  const fn = new Function(`${code}; return window.SitriforI18nDict;`);
  globalThis.window = globalThis.window || {};
  return fn();
}

function checkDictKeys(dict) {
  const issues = [];
  for (const lang of ['ru', 'en', 'de']) {
    const pack = dict[lang] || {};
    for (const key of REQUIRED_KEYS) {
      if (!pack[key] || !String(pack[key]).trim()) {
        issues.push({ type: 'missing_key', lang, key });
      }
    }
  }
  return issues;
}

function checkHardcodedUi() {
  const issues = [];
  for (const rel of SCAN_FILES) {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) {
      issues.push({ type: 'missing_file', file: rel });
      continue;
    }
    const src = readFileSync(abs, 'utf8');
    for (const rule of FORBIDDEN_UI) {
      if (rule.re.test(src)) {
        // Allow RU only inside i18n dictionaries / UI packs for ru locale
        if (rel.endsWith('news-magazine.js')) {
          // magazine UI pack may contain RU under UI.ru - skip matches inside that object by crude check
          const withoutRuPack = src.replace(/ru:\s*\{[\s\S]*?\n\s*\},\s*\n\s*en:/, 'ru:{},\nen:');
          if (!rule.re.test(withoutRuPack)) continue;
        }
        issues.push({ type: 'hardcoded_ui', file: rel, detail: rule.label });
      }
    }
  }
  return issues;
}

function heavyCyr(text) {
  const s = String(text || '');
  if (s.length < 12) return false;
  const cyr = (s.match(/[А-Яа-яЁё]/g) || []).length;
  const lat = (s.match(/[A-Za-z]/g) || []).length;
  return cyr >= 8 && cyr > lat;
}

function checkPublishedLocales() {
  const issues = [];
  try {
    const require = createRequire(import.meta.url);
    const Database = require(join(BACKEND, 'node_modules/better-sqlite3'));
    const dbPath = join(BACKEND, 'data/news.db');
    if (!existsSync(dbPath)) {
      return [{ type: 'db_missing', detail: dbPath }];
    }
    const db = new Database(dbPath, { readonly: true });
    const rows = db
      .prepare(
        `SELECT slug, title_en, body_en, title_de, body_de
         FROM articles WHERE published = 1
         ORDER BY published_at DESC`
      )
      .all();
    for (const r of rows) {
      const missing = [];
      if (!r.title_en || !String(r.title_en).trim() || !r.body_en || !String(r.body_en).trim()) {
        missing.push('missing_en');
      } else if (heavyCyr(r.title_en) || heavyCyr(String(r.body_en).slice(0, 400))) {
        missing.push('en_looks_russian');
      }
      if (!r.title_de || !String(r.title_de).trim() || !r.body_de || !String(r.body_de).trim()) {
        missing.push('missing_de');
      } else if (heavyCyr(r.title_de) || heavyCyr(String(r.body_de).slice(0, 400))) {
        missing.push('de_looks_russian');
      }
      if (missing.length) {
        issues.push({ type: 'article_locale', slug: r.slug, issues: missing });
      }
    }
    db.close();
  } catch (err) {
    issues.push({ type: 'db_error', detail: String(err && err.message ? err.message : err) });
  }
  return issues;
}

function main() {
  const dict = loadDict();
  const report = {
    ok: true,
    missingKeys: checkDictKeys(dict),
    hardcodedUi: checkHardcodedUi(),
    articleLocales: checkPublishedLocales()
  };
  report.ok =
    report.missingKeys.length === 0 &&
    report.hardcodedUi.length === 0 &&
    report.articleLocales.length === 0;

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('=== Sitrifor news i18n QA ===');
    console.log('dict keys:', report.missingKeys.length ? `FAIL (${report.missingKeys.length})` : 'ok');
    for (const i of report.missingKeys.slice(0, 20)) {
      console.log(`  - [${i.lang}] ${i.key}`);
    }
    console.log('hardcoded UI:', report.hardcodedUi.length ? `FAIL (${report.hardcodedUi.length})` : 'ok');
    for (const i of report.hardcodedUi) {
      console.log(`  - ${i.file}: ${i.detail || i.type}`);
    }
    console.log(
      'article locales:',
      report.articleLocales.length ? `FAIL (${report.articleLocales.length})` : 'ok'
    );
    for (const i of report.articleLocales.slice(0, 15)) {
      console.log(`  - ${i.slug || i.type}: ${(i.issues || [i.detail]).join(', ')}`);
    }
    console.log(report.ok ? 'PASS' : 'FAIL');
  }

  process.exit(report.ok ? 0 : 1);
}

main();
