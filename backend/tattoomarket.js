/**
 * Lightweight scraper for TattooMarket.ru product cards and catalog listings.
 */
import * as cheerio from 'cheerio';

const BASE = 'https://www.tattoomarket.ru';
const UA =
  'Mozilla/5.0 (compatible; SitriforNewsBot/1.0; +https://sitrifor.ru/news; research for tattoo masters)';

/** Default catalogs useful for masters */
export const TM_CATALOGS = [
  { path: '/catalog/kartridzhi-tatuirovochnye', category: 'gear', label: 'Картриджи' },
  { path: '/catalog/igly-tatuirovochnye', category: 'gear', label: 'Иглы' },
  { path: '/catalog/istochniki-pitaniya', category: 'gear', label: 'Блоки питания' },
  { path: '/catalog/pigmenty-dlya-tatuazha', category: 'pigments', label: 'Пигменты' },
  { path: '/catalog/kraska-tattoo-ink', category: 'pigments', label: 'Краска' },
  { path: '/catalog/barernaya-zashita', category: 'studio', label: 'Барьерная защита' },
  { path: '/catalog/dezinfekciya', category: 'studio', label: 'Дезинфекция' }
];

async function fetchHtml(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'ru-RU,ru;q=0.9'
      },
      redirect: 'follow'
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function absUrl(href) {
  if (!href) return null;
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith('//')) return 'https:' + href;
  if (href.startsWith('/')) return BASE + href;
  return BASE + '/' + href;
}

function cleanText(s) {
  return String(s || '')
    .replace(/\u00a0/g, ' ')
    .replace(/([а-яa-z])([A-ZА-Я])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * List product URLs from a catalog page.
 */
export async function listCatalogProducts(catalogPath, { limit = 40 } = {}) {
  const url = absUrl(catalogPath);
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const seen = new Set();
  const out = [];

  $('a[href^="/product/"]').each((_, el) => {
    if (out.length >= limit) return;
    const href = ($(el).attr('href') || '').split(/[?#]/)[0];
    if (!href || seen.has(href)) return;
    seen.add(href);
    const title = cleanText($(el).text()) || href.split('/').pop();
    out.push({ path: href, url: absUrl(href), title: title.slice(0, 200) });
  });

  return out;
}

/**
 * Parse a product page into structured fields.
 */
export async function fetchProduct(productUrlOrPath) {
  const url = absUrl(productUrlOrPath);
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const name =
    cleanText($('h1').first().text()) ||
    cleanText($('meta[property="og:title"]').attr('content')) ||
    cleanText($('title').text());

  const imageUrl =
    absUrl($('meta[property="og:image"]').attr('content')) ||
    absUrl($('img[itemprop="image"]').attr('src')) ||
    null;

  const descriptionMeta = cleanText($('meta[name="description"]').attr('content'));
  let description = '';
  const descCandidates = [
    $('[itemprop="description"]').first(),
    $('.product-description').first(),
    $('.description').first(),
    $('#description').first()
  ];
  for (const el of descCandidates) {
    if (el && el.length) {
      description = cleanText(el.text());
      if (description.length > 40) break;
    }
  }
  if (!description) description = descriptionMeta;

  const prices = [];
  $('table tr').each((_, tr) => {
    const cells = $(tr)
      .find('td, th')
      .map((__, c) => cleanText($(c).text()))
      .get()
      .filter(Boolean);
    if (cells.length >= 2 && /руб|₽|\d/.test(cells[1])) {
      prices.push({ label: cells[0], price: cells[1] });
    }
  });

  const breadcrumbs = [];
  $('nav a, .breadcrumb a, [itemprop="itemListElement"] [itemprop="name"]').each((_, el) => {
    const t = cleanText($(el).text());
    if (t && t.length < 80) breadcrumbs.push(t);
  });

  const slug = url.replace(/\/$/, '').split('/').pop();
  const brandGuess =
    breadcrumbs.find((b) => /kwadron|cheyenne|bishop|eternal|dynamic|panthera|world famous|electrum|allegory/i.test(b)) ||
    (name.match(/\b(KWADRON|Cheyenne|Bishop|Eternal|Dynamic|Panthera)\b/i) || [])[1] ||
    null;

  // Specs-ish lines from description
  const specs = [];
  for (const line of (description || '').split(/[.\n]/)) {
    const l = cleanText(line);
    if (l.length > 15 && l.length < 180 && /:|мм|taper|liner|shader|игл|диаметр|пайк/i.test(l)) {
      specs.push(l);
    }
  }

  return {
    slug,
    url,
    name,
    brand: brandGuess,
    // Keep _small_ CDN path — full-size often 404 on TattooMarket
    imageUrl,
    description: description.slice(0, 2500),
    descriptionMeta,
    prices,
    breadcrumbs: [...new Set(breadcrumbs)].slice(0, 8),
    specs: specs.slice(0, 12)
  };
}

export async function collectProducts({ catalogs = TM_CATALOGS, perCatalog = 12, totalLimit = 30 } = {}) {
  const all = [];
  const seen = new Set();
  for (const cat of catalogs) {
    if (all.length >= totalLimit) break;
    try {
      const list = await listCatalogProducts(cat.path, { limit: perCatalog });
      for (const item of list) {
        if (seen.has(item.path)) continue;
        seen.add(item.path);
        all.push({ ...item, catalogCategory: cat.category, catalogLabel: cat.label });
        if (all.length >= totalLimit) break;
      }
    } catch (e) {
      console.error('[tattoomarket] catalog fail', cat.path, e.message || e);
    }
  }
  return all;
}
