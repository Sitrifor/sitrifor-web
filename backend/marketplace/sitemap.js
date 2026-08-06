/**
 * Sitemap discovery: follow sitemap indexes and collect product URLs.
 */
import { fetchText } from './fetch.js';

function extractLocs(xml) {
  const out = [];
  const re = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(xml))) {
    out.push(m[1].trim());
  }
  return out;
}

function isSitemapIndex(xml) {
  return /<sitemapindex[\s>]/i.test(xml);
}

function defaultProductFilter(url) {
  const u = url.toLowerCase();
  if (/\/(blog|news|article|page|brand|category|catalog|collection|tag|search|cart|login|account|wishlist)\b/.test(u)) {
    // still allow /catalog/X/product style below
    if (!/\/product\//.test(u) && !/\/products\//.test(u) && !/\/tovar\//.test(u)) return false;
  }
  return (
    /\/product\//i.test(u) ||
    /\/products\//i.test(u) ||
    /\/tovar\//i.test(u) ||
    /\/goods\//i.test(u) ||
    /\/p\//i.test(u)
  );
}

/**
 * @param {string|string[]} sitemapUrl
 * @param {{ limit?: number, filter?: (url: string) => boolean, maxSitemaps?: number }} opts
 */
export async function listFromSitemap(sitemapUrl, opts = {}) {
  const limit = Number(opts.limit || 5000);
  const filter = opts.filter || defaultProductFilter;
  const maxSitemaps = Number(opts.maxSitemaps || 40);
  const seeds = Array.isArray(sitemapUrl) ? sitemapUrl : [sitemapUrl];
  const queue = [...seeds];
  const seenMaps = new Set();
  const products = [];
  const seenProd = new Set();

  while (queue.length && products.length < limit && seenMaps.size < maxSitemaps) {
    const mapUrl = queue.shift();
    if (!mapUrl || seenMaps.has(mapUrl)) continue;
    seenMaps.add(mapUrl);
    let xml;
    try {
      xml = await fetchText(mapUrl, { timeoutMs: 120000 });
    } catch (err) {
      console.warn('[sitemap] fail', mapUrl, err.message || err);
      continue;
    }
    const locs = extractLocs(xml);
    if (isSitemapIndex(xml)) {
      for (const loc of locs) {
        if (/sitemap|\.xml(\.gz)?$/i.test(loc)) queue.push(loc);
      }
      continue;
    }
    for (const loc of locs) {
      const url = loc.split(/[?#]/)[0];
      if (!filter(url) || seenProd.has(url)) continue;
      seenProd.add(url);
      products.push({ url, title: url.split('/').filter(Boolean).pop() });
      if (products.length >= limit) break;
    }
  }

  return products;
}

export { defaultProductFilter };
