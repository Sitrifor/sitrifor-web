/**
 * Yandex Market YML parser (full catalog + prices + pictures in one file).
 */
import { fetchText, cleanText } from './fetch.js';

function cdata(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))</${tag}>`, 'i');
  const m = block.match(re);
  if (!m) return '';
  return cleanText(m[1] || m[2] || '');
}

function allTags(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))</${tag}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(block))) {
    const v = cleanText(m[1] || m[2] || '');
    if (v) out.push(v);
  }
  return out;
}

/**
 * Parse YML XML text into offer objects.
 */
export function parseYml(xml) {
  const offers = [];
  const re = /<offer\b([^>]*)>([\s\S]*?)<\/offer>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = m[1] || '';
    const body = m[2] || '';
    const id = (attrs.match(/\bid="([^"]+)"/i) || [])[1] || null;
    const available = !/\bavailable="false"/i.test(attrs);
    const url = cdata(body, 'url');
    if (!url) continue;
    const vendor = cdata(body, 'vendor');
    const model = cdata(body, 'model');
    const name = cdata(body, 'name') || [vendor, model].filter(Boolean).join(' ').trim();
    const typePrefix = cdata(body, 'typePrefix');
    const title = cleanText([typePrefix, name].filter(Boolean).join(' ')) || name;
    const price = cdata(body, 'price') || cdata(body, 'oldprice');
    const description = cdata(body, 'description');
    const pictures = allTags(body, 'picture');
    const params = {};
    const paramRe = /<param\b[^>]*name="([^"]+)"[^>]*>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/param>/gi;
    let pm;
    while ((pm = paramRe.exec(body))) {
      params[cleanText(pm[1])] = cleanText(pm[2] || pm[3] || '');
    }
    offers.push({
      sku: id,
      url,
      title,
      brand: vendor || null,
      description,
      priceRaw: price,
      images: pictures,
      inStock: available,
      attrs: params
    });
  }
  return offers;
}

export async function fetchYmlOffers(ymlUrl, { limit = 100000 } = {}) {
  const xml = await fetchText(ymlUrl, { timeoutMs: 180000 });
  return parseYml(xml).slice(0, limit);
}
