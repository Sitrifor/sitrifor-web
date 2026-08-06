/**
 * Marketplace SEO helpers: indexability gate, sitemap publish, IndexNow.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listProductSlugsForSitemap, listProducts } from './api.js';
import { writeMarketplaceSitemap } from './write-sitemap.js';
import { isProductIndexable } from './seo-gates.js';

export { isProductIndexable, buildProductSeoTitle } from './seo-gates.js';
export { INDEX_MIN_PRICE, INDEX_MIN_TITLE, INDEX_MIN_DESC } from './seo-gates.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEO_ROOT = path.resolve(__dirname, '../../seo');
const PUBLIC = path.resolve(__dirname, '../../public');
const SITE = 'https://sitrifor.ru';

function productPublicPath(slug) {
  return `/marketplace/p/${encodeURIComponent(String(slug || ''))}`;
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function productCardSeedHtml(p) {
  const img = p.coverUrl || '/img/marketplace/categories/other.jpg';
  const href = productPublicPath(p.slug);
  const price =
    p.minPriceRub != null
      ? `от ${new Intl.NumberFormat('ru-RU').format(Math.round(Number(p.minPriceRub)))} ₽`
      : '-';
  return (
    `<article class="mp-card">` +
    `<a class="mp-card__link" href="${escHtml(href)}">` +
    `<img class="mp-card__img" src="${escHtml(img)}" alt="${escHtml(p.title || '')}" width="400" height="400" loading="lazy" decoding="async">` +
    `<div class="mp-card__body">` +
    `<p class="mp-card__brand">${escHtml((p.brand && p.brand.name) || '')}</p>` +
    `<h2 class="mp-card__title">${escHtml(p.title || '')}</h2>` +
    `<div class="mp-card__meta"><span class="mp-card__price">${escHtml(price)}</span>` +
    `<span class="mp-card__shops">${Number(p.offerCount || 0)} магаз.</span></div>` +
    `</div></a></article>`
  );
}

/**
 * Inject CollectionPage JSON-LD + first product cards into marketplace.html for crawlers.
 */
export function refreshCatalogSeoHtml({ limit = 24 } = {}) {
  const htmlPath = path.join(PUBLIC, 'marketplace.html');
  if (!fs.existsSync(htmlPath)) return { ok: false, reason: 'missing_marketplace_html' };

  const listed = listProducts({ limit: Math.max(limit * 4, 80), offset: 0 });
  const items = (listed.items || []).filter(isProductIndexable).slice(0, limit);

  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Каталог товаров Sitrifor',
    description:
      'Сравнение цен на картриджи, пигменты и расходники. Информация собрана из публичных источников.',
    url: `${SITE}/marketplace`,
    isPartOf: { '@type': 'WebSite', name: 'Sitrifor', url: SITE },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: items.length,
      itemListElement: items.map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${SITE}${productPublicPath(p.slug)}`,
        name: p.title
      }))
    }
  };

  const ldBlock = `<script type="application/ld+json">${JSON.stringify(itemList).replace(/</g, '\\u003c')}</script>`;
  const gridHtml = items.map(productCardSeedHtml).join('\n      ');

  let html = fs.readFileSync(htmlPath, 'utf8');

  if (!html.includes('<!--mp-seo-jsonld-->')) {
    html = html.replace(
      '</head>',
      `  <!--mp-seo-jsonld-->\n  ${ldBlock}\n  <!--/mp-seo-jsonld-->\n</head>`
    );
  } else {
    html = html.replace(
      /<!--mp-seo-jsonld-->[\s\S]*?<!--\/mp-seo-jsonld-->/,
      `<!--mp-seo-jsonld-->\n  ${ldBlock}\n  <!--/mp-seo-jsonld-->`
    );
  }

  if (!html.includes('<!--mp-seo-grid-->')) {
    html = html.replace(
      /(<section class="container mp-grid"[^>]*>)([\s\S]*?)(<\/section>)/,
      `$1\n      <!--mp-seo-grid-->\n      ${gridHtml}\n      <!--/mp-seo-grid-->\n    $3`
    );
  } else {
    html = html.replace(
      /<!--mp-seo-grid-->[\s\S]*?<!--\/mp-seo-grid-->/,
      `<!--mp-seo-grid-->\n      ${gridHtml}\n      <!--/mp-seo-grid-->`
    );
  }

  fs.writeFileSync(htmlPath, html);
  return { ok: true, seeded: items.length, path: htmlPath };
}

async function pingIndexNow(paths) {
  if (process.env.MP_SEO_INDEXNOW === '0' || process.env.NEWS_SEO_INDEXNOW === '0') {
    return { skipped: true, reason: 'indexnow_disabled' };
  }
  try {
    const args = ['scripts/indexnow.mjs', ...paths];
    const { stdout, stderr } = await execFileAsync('node', args, {
      cwd: SEO_ROOT,
      env: process.env,
      timeout: 25000
    });
    return { ok: true, stdout: String(stdout || '').slice(0, 500), stderr: String(stderr || '').slice(0, 200) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Regenerate sitemap + catalog crawl seed + optional IndexNow ping.
 */
export async function publishMarketplaceSeo(opts = {}) {
  const pingLimit = Math.min(Number(opts.pingLimit || 40), 100);
  const sitemap = writeMarketplaceSitemap({ limit: opts.sitemapLimit || 20000 });
  const catalog = refreshCatalogSeoHtml({ limit: opts.seedLimit || 24 });

  let indexNow = null;
  if (!opts.skipIndexNow && !opts.dry) {
    const recent = listProductSlugsForSitemap({ limit: pingLimit });
    const paths = ['/marketplace', ...recent.map((p) => productPublicPath(p.slug))];
    indexNow = await pingIndexNow(paths);
  } else if (opts.skipIndexNow || opts.dry) {
    indexNow = { skipped: true, reason: opts.dry ? 'dry' : 'skipIndexNow' };
  }

  return { sitemap, catalog, indexNow };
}
