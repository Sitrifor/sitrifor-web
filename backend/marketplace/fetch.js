/**
 * Browser-like HTTP client for marketplace scrapers.
 */
import * as cheerio from 'cheerio';
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export const UA = BROWSER_UA;

const cookieJar = new Map();
const __dirname = dirname(fileURLToPath(import.meta.url));

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function browserHeaders(url, extra = {}) {
  const host = hostOf(url);
  const headers = {
    'User-Agent': BROWSER_UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Ch-Ua': '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    ...extra
  };
  const cookie = cookieJar.get(host);
  if (cookie) headers.Cookie = cookie;
  return headers;
}

function storeCookies(url, res) {
  const host = hostOf(url);
  const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const single = res.headers.get('set-cookie');
  const list = raw.length ? raw : single ? [single] : [];
  if (!list.length) return;
  const prev = cookieJar.get(host) || '';
  const map = new Map();
  for (const part of prev.split(';').map((s) => s.trim()).filter(Boolean)) {
    const eq = part.indexOf('=');
    if (eq > 0) map.set(part.slice(0, eq), part.slice(eq + 1));
  }
  for (const sc of list) {
    const first = sc.split(';')[0];
    const eq = first.indexOf('=');
    if (eq > 0) map.set(first.slice(0, eq).trim(), first.slice(eq + 1));
  }
  cookieJar.set(host, [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; '));
}

function looksLikeChallenge(html, status) {
  if (status === 403 || status === 503) return true;
  const s = String(html || '').slice(0, 5000).toLowerCase();
  return (
    s.includes('just a moment') ||
    s.includes('cf-browser-verification') ||
    s.includes('attention required') ||
    s.includes('checking your browser') ||
    (s.includes('captcha') && s.includes('cloudflare')) ||
    s.includes('access denied')
  );
}

async function fetchNative(url, { timeoutMs = 45000, headers } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: headers || browserHeaders(url),
      redirect: 'follow'
    });
    storeCookies(url, res);
    const text = Buffer.from(await res.arrayBuffer()).toString('utf8');
    return { status: res.status, text, ok: res.ok };
  } finally {
    clearTimeout(t);
  }
}

function fetchCurl(url, { timeoutMs = 45000 } = {}) {
  const host = hostOf(url);
  const cookie = cookieJar.get(host);
  const args = [
    '-sS',
    '-L',
    '--compressed',
    '--max-time',
    String(Math.ceil(timeoutMs / 1000)),
    '-A',
    BROWSER_UA,
    '-H',
    'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    '-H',
    'Accept-Language: ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
    '-w',
    '\n__HTTP_STATUS__:%{http_code}'
  ];
  if (cookie) args.push('-H', `Cookie: ${cookie}`);
  args.push(url);
  const r = spawnSync('curl', args, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  if (r.error) throw r.error;
  const out = r.stdout || '';
  const m = out.match(/\n__HTTP_STATUS__:(\d+)\s*$/);
  const status = m ? Number(m[1]) : 0;
  const text = m ? out.slice(0, m.index) : out;
  return { status, text, ok: status >= 200 && status < 400 };
}

let puppeteerMod = null;
async function fetchChromium(url, { timeoutMs = 60000 } = {}) {
  if (!puppeteerMod) {
    try {
      puppeteerMod = await import('puppeteer-core');
    } catch {
      spawnSync('npm', ['install', 'puppeteer-core@23.6.0', '--no-audit', '--no-fund'], {
        cwd: join(__dirname, '..'),
        encoding: 'utf8',
        timeout: 180000
      });
      puppeteerMod = await import('puppeteer-core');
    }
  }
  const executablePath = ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'].find(
    (p) => existsSync(p)
  );
  if (!executablePath) throw new Error('chrome_binary_missing');

  const browser = await puppeteerMod.default.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(BROWSER_UA);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ru-RU,ru;q=0.9' });
    const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: timeoutMs });
    await new Promise((r) => setTimeout(r, 2000));
    const text = await page.content();
    const cookies = await page.cookies();
    if (cookies.length) {
      cookieJar.set(hostOf(url), cookies.map((c) => `${c.name}=${c.value}`).join('; '));
    }
    const status = resp ? resp.status() : 0;
    return { status, text, ok: status >= 200 && status < 400 && !looksLikeChallenge(text, status) };
  } finally {
    await browser.close();
  }
}

export async function fetchHtml(url, { timeoutMs = 45000, allowChromium = true } = {}) {
  let lastErr = null;
  try {
    const r = await fetchNative(url, { timeoutMs });
    if (r.ok && !looksLikeChallenge(r.text, r.status)) return r.text;
    lastErr = new Error(`HTTP ${r.status}`);
  } catch (e) {
    lastErr = e;
  }
  try {
    const r = fetchCurl(url, { timeoutMs });
    if (r.ok && !looksLikeChallenge(r.text, r.status)) return r.text;
    lastErr = new Error(`curl HTTP ${r.status}`);
  } catch (e) {
    lastErr = e;
  }
  if (allowChromium) {
    try {
      const r = await fetchChromium(url, { timeoutMs: Math.max(timeoutMs, 60000) });
      if (r.ok && !looksLikeChallenge(r.text, r.status)) return r.text;
      lastErr = new Error(`chromium HTTP ${r.status}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error(`fetch_failed ${url}`);
}

export async function fetchText(url, { timeoutMs = 120000 } = {}) {
  try {
    const r = await fetchNative(url, {
      timeoutMs,
      headers: {
        ...browserHeaders(url),
        Accept: 'application/xml,text/xml,*/*;q=0.8',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors'
      }
    });
    if (r.ok) return r.text;
  } catch {
    /* fall through */
  }
  const r = fetchCurl(url, { timeoutMs });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.text;
}

export function absUrl(base, href) {
  if (!href) return null;
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

export function cleanText(s) {
  return String(s || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function load$(html) {
  return cheerio.load(html);
}

export function extractJsonLdProduct($) {
  const scripts = $('script[type="application/ld+json"]')
    .map((_, el) => $(el).html())
    .get();
  for (const raw of scripts) {
    try {
      const data = JSON.parse(raw);
      const list = Array.isArray(data) ? data : [data];
      for (const item of list) {
        if (!item) continue;
        if (item['@type'] === 'Product' || (Array.isArray(item['@type']) && item['@type'].includes('Product'))) {
          return item;
        }
        if (item['@graph']) {
          const hit = item['@graph'].find(
            (g) =>
              g && (g['@type'] === 'Product' || (Array.isArray(g['@type']) && g['@type'].includes('Product')))
          );
          if (hit) return hit;
        }
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function collectProductLinks(
  $,
  base,
  { patterns = [/\/product/i, /\/catalog\//i, /\/tovar/i, /\/goods/i], limit = 40 } = {}
) {
  const seen = new Set();
  const out = [];
  $('a[href]').each((_, el) => {
    if (out.length >= limit) return;
    const href = ($(el).attr('href') || '').split(/[?#]/)[0];
    const url = absUrl(base, href);
    if (!url || seen.has(url)) return;
    if (!patterns.some((re) => re.test(url))) return;
    const path = new URL(url).pathname.replace(/\/$/, '');
    const parts = path.split('/').filter(Boolean);
    if (parts.length < 2) return;
    seen.add(url);
    out.push({
      url,
      title: cleanText($(el).text()).slice(0, 200) || parts[parts.length - 1]
    });
  });
  return out;
}

export function genericParseProduct(html, pageUrl) {
  const $ = load$(html);
  const ld = extractJsonLdProduct($);
  const name =
    cleanText(ld?.name) ||
    cleanText($('h1').first().text()) ||
    cleanText($('meta[property="og:title"]').attr('content')) ||
    cleanText($('title').text());

  const priceCandidates = [];
  const pushPrice = (v, weight) => {
    if (v == null || v === '') return;
    priceCandidates.push({ raw: v, weight });
  };
  // Visible / microdata first - shop JSON-LD is often stale or promotional
  pushPrice($('[itemprop="price"]').attr('content'), 100);
  pushPrice($('meta[itemprop="price"]').attr('content'), 95);
  pushPrice($('meta[property="product:price:amount"]').attr('content'), 90);
  pushPrice(
    cleanText(
      $(
        '.product__details__price__real, .product__details__price, .ty-price-num, .product-price__value, .price-current'
      )
        .first()
        .text()
    ),
    85
  );
  pushPrice(cleanText($('[itemprop="price"]').first().text()), 80);
  pushPrice(cleanText($('.price, .product-price, .product__price, .ty-price').first().text()), 50);

  const offers = ld?.offers;
  if (offers) {
    const o = Array.isArray(offers) ? offers[0] : offers;
    pushPrice(o?.price ?? o?.lowPrice ?? null, 20);
  }

  let price = null;
  priceCandidates.sort((a, b) => b.weight - a.weight);
  for (const c of priceCandidates) {
    // defer import cycle-free: parse inline lightly; merge uses parsePriceRub
    const n = Number(String(c.raw).replace(/\s/g, '').replace(',', '.'));
    if (Number.isFinite(n) && n > 0 && n < 5_000_000) {
      price = c.raw;
      break;
    }
    if (String(c.raw).match(/\d/)) {
      price = c.raw;
      break;
    }
  }

  const images = [];
  const og = $('meta[property="og:image"]').attr('content');
  if (og) images.push(absUrl(pageUrl, og));
  if (ld?.image) {
    const imgs = Array.isArray(ld.image) ? ld.image : [ld.image];
    for (const im of imgs) {
      const u = typeof im === 'string' ? im : im?.url;
      const abs = absUrl(pageUrl, u);
      if (abs) images.push(abs);
    }
  }
  $('img[itemprop="image"], .product-gallery img, .product-images img, .ty-product-img img').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy');
    const abs = absUrl(pageUrl, src);
    if (abs && !/\.svg($|\?)/i.test(abs)) images.push(abs);
  });

  const uniqImages = [...new Set(images.filter(Boolean))];

  const descCandidates = [
    cleanText($('[itemprop="description"]').first().text()),
    cleanText($('#content_description, #product_description, .product-description, .ty-product-block__description').first().text()),
    cleanText(ld?.description),
    cleanText($('meta[name="description"]').attr('content'))
  ].filter(Boolean);

  let description = '';
  let bestScore = -Infinity;
  for (const d of descCandidates) {
    let score = d.length;
    if (/цена\s*:\s*\d+/i.test(d) || /купить\s+онлайн/i.test(d)) score -= 800;
    if (/интернет[-\s]?магазин/i.test(d) && d.length < 320) score -= 600;
    if (score > bestScore) {
      bestScore = score;
      description = d;
    }
  }

  const brand =
    cleanText(ld?.brand?.name || ld?.brand) ||
    cleanText($('[itemprop="brand"]').first().text()) ||
    null;

  const sku = cleanText(ld?.sku || ld?.mpn || $('[itemprop="sku"]').attr('content') || '') || null;

  let inStock = true;
  if (offers) {
    const o = Array.isArray(offers) ? offers[0] : offers;
    const avail = String(o?.availability || '');
    if (/OutOfStock|SoldOut|Discontinued/i.test(avail)) inStock = false;
  }
  if ($('.product__details__price, .ty-product-block').text().match(/нет\s+в\s+наличии/i)) {
    inStock = false;
  }

  return {
    url: pageUrl,
    title: name,
    brand,
    sku,
    description: description.slice(0, 8000),
    priceRaw: price,
    images: uniqImages.slice(0, 12),
    inStock
  };
}
