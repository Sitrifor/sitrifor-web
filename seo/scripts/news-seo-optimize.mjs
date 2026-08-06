#!/usr/bin/env node
/**
 * SEO-optimize news articles for indexing (meta, JSON-LD, sitemap, IndexNow).
 *
 * Usage:
 *   node scripts/news-seo-optimize.mjs --slug как-лучше-снимать-видео-тату-процесса
 *   node scripts/news-seo-optimize.mjs --all
 *   node scripts/news-seo-optimize.mjs --all --dry-run
 *   node scripts/news-seo-optimize.mjs --sitemap-only
 *
 * Env:
 *   INDEXNOW_KEY          - seo/.env or process (optional ping)
 *   NEWS_SEO_INDEXNOW=0   - skip IndexNow
 *   NEWS_SEO_INJECT_LINKS=0 - do not append "Ещё на Sitrifor" block
 */
import {
  optimizeArticleBySlug,
  optimizeAllPublished,
  writeNewsSitemap
} from '../../backend/news-seo/index.js';

const argv = process.argv.slice(2);
const dry = argv.includes('--dry-run') || argv.includes('--dry');
const all = argv.includes('--all');
const sitemapOnly = argv.includes('--sitemap-only');
const slugIdx = argv.indexOf('--slug');
const slug = slugIdx >= 0 ? argv[slugIdx + 1] : null;
const injectLinks = process.env.NEWS_SEO_INJECT_LINKS !== '0';

if (sitemapOnly) {
  const sm = writeNewsSitemap();
  console.log(JSON.stringify({ ok: true, sitemap: sm }, null, 2));
  process.exit(0);
}

if (all) {
  const out = await optimizeAllPublished({ dry, injectLinks });
  process.exit(out.failed > 0 && !dry ? 1 : 0);
}

if (!slug) {
  console.error('Usage: --slug <slug> | --all | --sitemap-only');
  process.exit(2);
}

const out = await optimizeArticleBySlug(slug, { dry, injectLinks });
process.exit(out.ok || dry ? 0 : 1);
