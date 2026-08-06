/**
 * Optimize a published news article for indexing: meta, JSON-LD, links, sitemap, IndexNow.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getArticleBySlug,
  listPublishedForSitemap,
  updateArticleSeo
} from '../news.js';
import { suggestInternalLinks, injectInternalLinksBlock } from './internal-links.js';
import { buildSeoPackage } from './fields.js';
import { qaSeoArticle } from './qa.js';
import { writeNewsSitemap } from './sitemap.js';
import { renderArticleSsr } from './render-ssr.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEO_ROOT = path.resolve(__dirname, '../../seo');

function logEvent(payload) {
  console.log(JSON.stringify({ event: 'news_seo_optimized', ...payload }, null, 2));
}

async function pingIndexNow(paths) {
  if (process.env.NEWS_SEO_INDEXNOW === '0') {
    return { skipped: true, reason: 'NEWS_SEO_INDEXNOW=0' };
  }
  const key = process.env.INDEXNOW_KEY;
  // indexnow.mjs loads seo/.env itself; still try even without env in process
  try {
    const args = ['scripts/indexnow.mjs', ...paths];
    const { stdout, stderr } = await execFileAsync('node', args, {
      cwd: SEO_ROOT,
      env: process.env,
      timeout: 20000
    });
    return { ok: true, stdout: String(stdout || '').slice(0, 500), stderr: String(stderr || '').slice(0, 200) };
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      hint: key ? undefined : 'Set INDEXNOW_KEY in seo/.env or env to enable IndexNow'
    };
  }
}

/**
 * @param {string} slug
 * @param {{ injectLinks?: boolean, skipSitemap?: boolean, skipIndexNow?: boolean, dry?: boolean }} opts
 */
export async function optimizeArticleBySlug(slug, opts = {}) {
  const injectLinks = opts.injectLinks !== false;
  const article = getArticleBySlug(slug, { lang: 'ru', publishedOnly: true });
  if (!article) {
    return { ok: false, status: 'not_found', slug };
  }

  const before = {
    title: article.seo?.title || article.title,
    description: article.seo?.description || article.summary,
    seoReady: article.seo?.ready || false,
    canonical: article.seo?.canonical,
    bodyLen: String(article.body || '').length
  };

  const links = suggestInternalLinks(article, { max: 3 });
  let nextBody = article.body;
  if (injectLinks) {
    nextBody = injectInternalLinksBlock(article.body, links);
  }

  const pack = buildSeoPackage(
    { ...article, body: nextBody },
    { internalLinks: links, injectBody: nextBody !== article.body ? nextBody : null }
  );

  if (!opts.dry) {
    updateArticleSeo(article.id, {
      seoTitle: pack.seoTitle,
      seoDescription: pack.seoDescription,
      seoImageAlt: pack.seoImageAlt,
      seoOptimizedAt: pack.seoOptimizedAt,
      seoReady: 0,
      meta: pack.meta,
      body: pack.body || undefined,
      bodyRu: pack.body ? pack.body : undefined
    });
  }

  const refreshed = opts.dry
    ? {
        ...article,
        body: nextBody,
        seo: {
          title: pack.seoTitle,
          description: pack.seoDescription,
          imageAlt: pack.seoImageAlt,
          ready: false,
          optimizedAt: pack.seoOptimizedAt,
          canonical: pack.meta.canonical,
          robots: pack.meta.robots,
          ogTitle: pack.meta.ogTitle,
          ogDescription: pack.meta.ogDescription,
          ogImage: pack.meta.ogImage,
          twitterCard: pack.meta.twitterCard,
          jsonLd: pack.meta.jsonLd,
          internalLinks: links
        }
      }
    : getArticleBySlug(slug, { lang: 'ru', publishedOnly: true });

  const ssr = renderArticleSsr(refreshed);
  const qa = qaSeoArticle(refreshed, { htmlSnippet: ssr.html });

  if (!opts.dry) {
    updateArticleSeo(article.id, {
      seoReady: qa.ok ? 1 : 0,
      seoOptimizedAt: pack.seoOptimizedAt,
      meta: {
        ...pack.meta,
        qaReasons: qa.reasons,
        qaOk: qa.ok
      }
    });
  }

  let sitemap = null;
  let indexNow = null;
  if (!opts.dry && !opts.skipSitemap) {
    sitemap = writeNewsSitemap();
  }
  if (!opts.dry && !opts.skipIndexNow && qa.ok) {
    indexNow = await pingIndexNow([`/news/a/${slug}`, '/news']);
  }

  const after = {
    title: pack.seoTitle,
    description: pack.seoDescription,
    seoReady: qa.ok,
    canonical: pack.meta.canonical,
    bodyLen: String(refreshed.body || '').length,
    imageAlt: pack.seoImageAlt,
    internalLinks: links
  };

  const result = {
    ok: qa.ok,
    status: qa.ok ? 'seo_ready' : 'seo_qa_failed',
    slug,
    id: article.id,
    before,
    after,
    qa,
    sitemap,
    indexNow,
    dry: Boolean(opts.dry)
  };

  logEvent(result);
  return result;
}

export async function optimizeAllPublished(opts = {}) {
  const rows = listPublishedForSitemap({ limit: opts.limit || 5000 });
  const results = [];
  for (const row of rows) {
    const r = await optimizeArticleBySlug(row.slug, {
      ...opts,
      skipSitemap: true,
      skipIndexNow: true
    });
    results.push(r);
  }
  const sitemap = opts.dry ? null : writeNewsSitemap();
  const ready = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  let indexNow = null;
  if (!opts.dry && !opts.skipIndexNow && ready > 0) {
    const paths = results.filter((r) => r.ok).slice(0, 40).map((r) => `/news/a/${r.slug}`);
    paths.unshift('/news');
    indexNow = await pingIndexNow(paths);
  }
  const summary = {
    event: 'news_seo_optimized_batch',
    total: results.length,
    ready,
    failed: failed.length,
    failReasons: failed.slice(0, 10).map((f) => ({ slug: f.slug, reasons: f.qa?.reasons })),
    sitemap,
    indexNow
  };
  console.log(JSON.stringify(summary, null, 2));
  return { ...summary, results };
}

/**
 * Post-publish hook: optimize + sitemap. Never throws into publish path.
 */
export async function afterPublishSeo(slug, { source = 'publish' } = {}) {
  if (!slug) return { ok: false, status: 'no_slug' };
  try {
    return await optimizeArticleBySlug(slug, { injectLinks: true });
  } catch (err) {
    const fail = {
      event: 'news_seo_optimized',
      ok: false,
      status: 'error',
      slug,
      source,
      error: String(err && err.message ? err.message : err)
    };
    console.error(JSON.stringify(fail, null, 2));
    return fail;
  }
}
