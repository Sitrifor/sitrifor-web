/**
 * Shop adapters: YML (preferred) → sitemap → HTML catalog crawl.
 */
import {
  fetchHtml,
  load$,
  absUrl,
  cleanText,
  collectProductLinks,
  genericParseProduct
} from '../fetch.js';
import { guessCategory } from '../normalize.js';
import { listFromSitemap } from '../sitemap.js';
import { fetchYmlOffers } from '../yml.js';

function makeShop({
  key,
  baseUrl,
  ymlUrls = [],
  sitemapUrls = [],
  listPaths = ['/'],
  linkPatterns,
  productFilter,
  categoryHint
}) {
  return {
    key,
    baseUrl,
    ymlUrls,
    sitemapUrls,
    /** Fast path: full catalog with prices from YML */
    async listYmlOffers({ limit = 100000 } = {}) {
      const out = [];
      for (const yml of ymlUrls) {
        try {
          const offers = await fetchYmlOffers(yml, { limit: limit - out.length });
          for (const o of offers) {
            out.push({
              ...o,
              categorySlug: categoryHint || guessCategory(o.title, o.url)
            });
            if (out.length >= limit) return out;
          }
        } catch (err) {
          console.warn(`[mp:${key}] yml fail ${yml}:`, err.message || err);
        }
      }
      return out;
    },
    async listProducts({ limit = 5000 } = {}) {
      const out = [];
      const seen = new Set();

      // 1) sitemap
      if (sitemapUrls.length) {
        try {
          const links = await listFromSitemap(sitemapUrls, {
            limit,
            filter: productFilter
          });
          for (const l of links) {
            if (seen.has(l.url)) continue;
            seen.add(l.url);
            out.push(l);
          }
        } catch (err) {
          console.warn(`[mp:${key}] sitemap fail:`, err.message || err);
        }
      }

      if (out.length >= Math.min(limit, 50)) return out.slice(0, limit);

      // 2) HTML fallback
      for (const path of listPaths) {
        if (out.length >= limit) break;
        try {
          const url = absUrl(baseUrl, path);
          const html = await fetchHtml(url);
          const $ = load$(html);
          const links = collectProductLinks($, baseUrl, {
            patterns: linkPatterns || [/\/(product|products|tovar|goods)\//i],
            limit: limit - out.length + 20
          });
          for (const l of links) {
            if (seen.has(l.url)) continue;
            seen.add(l.url);
            out.push(l);
            if (out.length >= limit) break;
          }
          // follow pagination ?page=2..N lightly
          for (let page = 2; page <= 30 && out.length < limit; page++) {
            const pageUrl = absUrl(baseUrl, `${path}${path.includes('?') ? '&' : path.endsWith('/') ? '' : '/'}?page=${page}`);
            try {
              const html2 = await fetchHtml(pageUrl);
              const $2 = load$(html2);
              const more = collectProductLinks($2, baseUrl, {
                patterns: linkPatterns || [/\/(product|products|tovar|goods)\//i],
                limit: 200
              });
              let added = 0;
              for (const l of more) {
                if (seen.has(l.url)) continue;
                seen.add(l.url);
                out.push(l);
                added += 1;
                if (out.length >= limit) break;
              }
              if (!added) break;
            } catch {
              break;
            }
          }
        } catch (err) {
          console.warn(`[mp:${key}] list fail ${path}:`, err.message || err);
        }
      }
      return out.slice(0, limit);
    },
    async parseProduct(url) {
      const html = await fetchHtml(url);
      const raw = genericParseProduct(html, url);
      return {
        ...raw,
        categorySlug: categoryHint || guessCategory(raw.title, url)
      };
    }
  };
}

export const tattoomarket = makeShop({
  key: 'tattoomarket',
  baseUrl: 'https://www.tattoomarket.ru',
  ymlUrls: ['https://www.tattoomarket.ru/export/yml'],
  sitemapUrls: ['https://www.tattoomarket.ru/sitemap.xml'],
  listPaths: [
    '/catalog/kartridzhi-tatuirovochnye',
    '/catalog/pigmenty-dlya-tatuazha',
    '/catalog/igly-tatuirovochnye',
    '/catalog/istochniki-pitaniya',
    '/catalog'
  ],
  linkPatterns: [/\/product\//i],
  productFilter: (u) => /\/product\//i.test(u)
});

export const tattoomall = makeShop({
  key: 'tattoomall',
  baseUrl: 'https://tattoomall.ru',
  sitemapUrls: ['https://tattoomall.ru/sitemap.xml'],
  listPaths: ['/', '/catalog/'],
  productFilter: (u) => {
    if (!u.includes('tattoomall.ru')) return false;
    if (/\/(blog|news|brand|catalog|category|page|cart|login)\b/i.test(u)) return false;
    const parts = new URL(u).pathname.split('/').filter(Boolean);
    return parts.length >= 1 && !['', 'catalog'].includes(parts[0]);
  }
});

export const shoptattoo = makeShop({
  key: 'shoptattoo',
  baseUrl: 'https://shoptattoo.ru',
  sitemapUrls: ['https://shoptattoo.ru/sitemap.xml'],
  listPaths: ['/', '/catalog/'],
  linkPatterns: [/shoptattoo\.ru\/.+/i]
});

export const tatuShop = makeShop({
  key: 'tatu-shop',
  baseUrl: 'https://tatu-shop.ru',
  sitemapUrls: ['https://tatu-shop.ru/sitemap.xml'],
  listPaths: ['/'],
  linkPatterns: [/tatu-shop\.ru\/.+/i]
});

export const tattooport = makeShop({
  key: 'tattooport',
  baseUrl: 'https://tattooport.ru',
  sitemapUrls: ['https://tattooport.ru/sitemap.xml'],
  listPaths: ['/'],
  linkPatterns: [/tattooport\.ru\/.+/i]
});

export const worldfamous = makeShop({
  key: 'worldfamous',
  baseUrl: 'https://www.worldfamoustattooink.com',
  sitemapUrls: [
    'https://www.worldfamoustattooink.com/sitemap.xml',
    'https://www.worldfamoustattooink.com/sitemap_products_1.xml'
  ],
  listPaths: ['/collections/all'],
  linkPatterns: [/\/products\//i],
  productFilter: (u) => /\/products\//i.test(u),
  categoryHint: 'pigments'
});

export const tattooStore = makeShop({
  key: 'tattoo-store',
  baseUrl: 'https://tattoo-store.ru',
  sitemapUrls: ['https://tattoo-store.ru/sitemap.xml'],
  listPaths: ['/'],
  linkPatterns: [/tattoo-store\.ru\/.+/i]
});

export const odintattoo = makeShop({
  key: 'odintattoo',
  baseUrl: 'https://shop.odintattoo.ru',
  sitemapUrls: ['https://shop.odintattoo.ru/sitemap.xml'],
  listPaths: ['/'],
  productFilter: (u) => {
    if (!/odintattoo\.ru/i.test(u)) return false;
    return /\/(product|tovar|shop)\//i.test(u) || /odintattoo\.ru\/[^/]+-\d+\.html/i.test(u);
  }
});

export const bdtt = makeShop({
  key: 'bdtt',
  baseUrl: 'https://bdtt.ru',
  sitemapUrls: ['https://bdtt.ru/sitemap.xml'],
  listPaths: ['/'],
  linkPatterns: [/bdtt\.ru\/.+/i]
});

export const gallerytattooink = makeShop({
  key: 'gallerytattooink',
  baseUrl: 'https://gallerytattooink.com',
  sitemapUrls: ['https://gallerytattooink.com/sitemap.xml'],
  listPaths: ['/', '/collections/all'],
  productFilter: (u) => /\/products\//i.test(u),
  categoryHint: 'pigments'
});

export const shop28opt = makeShop({
  key: '28opt',
  baseUrl: 'https://28opt.ru',
  sitemapUrls: ['https://28opt.ru/sitemap.xml', 'https://28opt.ru/sitemap-iblock-products.xml'],
  listPaths: ['/'],
  linkPatterns: [/28opt\.ru\/.+/i]
});

export const zavisimost = makeShop({
  key: 'zavisimost',
  baseUrl: 'https://zavisimost-ink.ru',
  sitemapUrls: ['https://zavisimost-ink.ru/sitemap.xml'],
  listPaths: ['/'],
  categoryHint: 'pigments'
});

export const profftattoo = makeShop({
  key: 'profftattoo',
  baseUrl: 'https://profftattoo.ru',
  sitemapUrls: ['https://profftattoo.ru/sitemap.xml'],
  listPaths: ['/catalog/'],
  productFilter: (u) => /profftattoo\.ru\/.+/i.test(u) && !/\/(blog|news|page|brand)\b/i.test(u)
});

export const fenix = makeShop({
  key: 'fenix',
  baseUrl: 'https://fenix-tattoo.ru',
  sitemapUrls: ['https://fenix-tattoo.ru/sitemap.xml'],
  listPaths: ['/']
});

export const ALL_SHOPS = [
  tattoomarket,
  tattoomall,
  shoptattoo,
  tatuShop,
  tattooport,
  worldfamous,
  tattooStore,
  odintattoo,
  bdtt,
  gallerytattooink,
  shop28opt,
  zavisimost,
  profftattoo,
  fenix
];

export function getShopAdapter(key) {
  return ALL_SHOPS.find((s) => s.key === key) || null;
}
