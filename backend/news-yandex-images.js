/**
 * Yandex Images parser for birthday tattoo galleries.
 * Fetches SERP HTML, extracts image URLs, downloads and caches under public/img/news/birthday/.
 * Bing Images used as fallback when Yandex returns nothing (captcha / empty).
 */
import { createHash } from 'crypto';
import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, '../public');
const CACHE_ROOT = join(PUBLIC, 'img/news/birthday');

const UA =
  'Mozilla/5.0 (compatible; SitriforNewsBot/1.0; +https://sitrifor.ru/news) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';

const MAX_BYTES = Number(process.env.NEWS_BIRTHDAY_IMG_MAX_BYTES || 2_200_000);
/** Skip tiny / heavily compressed junk photos */
const MIN_BYTES = Number(process.env.NEWS_BIRTHDAY_IMG_MIN_BYTES || 48_000);
const MIN_WIDTH = Number(process.env.NEWS_BIRTHDAY_IMG_MIN_W || 640);
const MIN_HEIGHT = Number(process.env.NEWS_BIRTHDAY_IMG_MIN_H || 720);
const MIN_PIXELS = Number(process.env.NEWS_BIRTHDAY_IMG_MIN_PX || 520_000);
/** Hamming distance on 64-bit aHash – below = near-duplicate */
const PHASH_DUP_DIST = Number(process.env.NEWS_BIRTHDAY_PHASH_DIST || 8);
/** Drop soft / amateur portfolio rejects below this score */
const MIN_STYLE_SCORE = Number(process.env.NEWS_BIRTHDAY_IMG_MIN_SCORE || 5);

const BAD_URL =
  /clipart|stock[-_]?vector|shutterstock|dreamstime|istockphoto|gettyimages|depositphotos|freepik|pngtree|vectorstock|cartoon|emoji|sticker|wallpaper|zodiac[-_]?sign(?!.*tattoo)|horoscope[-_]?symbol|chinese[-_]?zodiac(?!.*tattoo)|illustration[-_]?only|pinterest\.com\/pin|pinimg\.com\/236|pinimg\.com\/474|tattoo[-_]?ideas|ideas[-_]?for|collage|moodboard|meta\.ai|oaidalle|\/th\/id\/OIG|bing\.com\/images\/create|chatgpt|midjourney|stablediffusion|ai[-_]?generated|generated[-_]?by[-_]?ai/i;

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function hashKey(s) {
  return createHash('sha1').update(String(s)).digest('hex').slice(0, 16);
}

function publicUrl(absPath) {
  const rel = absPath.replace(PUBLIC, '').replace(/\\/g, '/');
  return rel.startsWith('/') ? rel : `/${rel}`;
}

function listCached(slug, limit = 8) {
  const dir = join(CACHE_ROOT, slug);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
    .map((f) => {
      const abs = join(dir, f);
      let mtime = 0;
      try {
        mtime = statSync(abs).mtimeMs;
      } catch {
        /* ignore */
      }
      return { abs, mtime, src: publicUrl(abs), alt: '' };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)
    .map(({ src, alt }) => ({ src, alt }));
}

/**
 * Heuristic: reject clipart / plain illustrations on white-beige parchment.
 * Prefer photos with midtones (skin + ink), not >55% near-white canvas.
 */
async function looksLikeTattooPhoto(buf) {
  try {
    const { data, info } = await sharp(buf)
      .resize(72, 72, { fit: 'cover' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const n = info.width * info.height;
    let white = 0;
    let skin = 0;
    let darkInk = 0;
    let sat = 0;
    for (let i = 0; i < data.length; i += 3) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (r > 235 && g > 230 && b > 220) white += 1;
      // rough skin-ish
      if (r > g + 8 && g > b && r > 90 && r < 230 && g > 60 && b > 40) skin += 1;
      if (max < 70) darkInk += 1;
      if (max - min > 40) sat += 1;
    }
    const whiteRatio = white / n;
    const skinRatio = skin / n;
    const inkRatio = darkInk / n;
    // Clipart / parchment card: huge white/beige field
    if (whiteRatio > 0.52) return false;
    // Flat digital painting on solid color: very saturated, almost no skin
    if (sat / n > 0.55 && skinRatio < 0.04 && inkRatio < 0.08) return false;
    // Need some structure: either skin tones or dark ink mass (blackwork on body)
    if (skinRatio + inkRatio < 0.08) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Reject Pinterest/blog collages: title bars, white captions, before/after splits.
 */
async function hasPromoOverlay(buf) {
  try {
    const { data, info } = await sharp(buf)
      .resize(80, 120, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const w = info.width;
    const h = info.height;
    const analyze = (y0, y1) => {
      const counts = new Map();
      let n = 0;
      let satSum = 0;
      let nearWhite = 0;
      let pureWhite = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 3;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          satSum += max - min;
          if (r > 235 && g > 235 && b > 235) nearWhite += 1;
          if (r > 248 && g > 248 && b > 248) pureWhite += 1;
          const key = `${r >> 4},${g >> 4},${b >> 4}`;
          counts.set(key, (counts.get(key) || 0) + 1);
          n += 1;
        }
      }
      let top = 0;
      for (const v of counts.values()) top = Math.max(top, v);
      return {
        dom: top / n,
        sat: satSum / n,
        white: nearWhite / n,
        pure: pureWhite / n,
        unique: counts.size / Math.max(1, n)
      };
    };
    const top = analyze(0, Math.max(2, Math.floor(h * 0.18)));
    const bot = analyze(Math.floor(h * 0.82), h);
    const mid = analyze(Math.floor(h * 0.4), Math.floor(h * 0.78));

    if (top.dom > 0.3 && top.sat > 55) return true;
    if (bot.dom > 0.3 && bot.sat > 50) return true;
    // Flat chrome only when a single color also dominates the strip
    if (top.unique < 0.08 && top.sat > 40 && top.dom > 0.25) return true;
    if (bot.unique < 0.08 && bot.sat > 35 && bot.dom > 0.25) return true;
    if (mid.white > 0.1 && mid.pure > 0.035) return true;
    if (bot.white > 0.14 && top.sat > 25) return true;

    // Soft white typography on story/Pinterest templates (anti-aliased ≠ pure white)
    let brightMid = 0;
    let brightN = 0;
    const y0 = Math.floor(h * 0.4);
    const y1 = Math.floor(h * 0.78);
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        if (r > 200 && g > 200 && b > 200) brightMid += 1;
        brightN += 1;
      }
    }
    const brightRatio = brightMid / Math.max(1, brightN);
    const meta = await sharp(buf).metadata();
    const aspect = (meta.height || 1) / Math.max(1, meta.width || 1);
    // Story/Pinterest templates are very tall + caption typography
    if (brightRatio > 0.045 && aspect > 1.65) return true;

    // Colored listicle headlines (pink/yellow «FINE LINE TATTOOS IN 2025»)
    let loud = 0;
    let loudN = 0;
    for (let y = Math.floor(h * 0.35); y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const sat = max - min;
        const skin = r > g + 8 && g > b && r > 90 && r < 230;
        if (sat > 70 && !skin) loud += 1;
        loudN += 1;
      }
    }
    if (loud / Math.max(1, loudN) > 0.03) return true;

    // Moodboard / multi-tile collage: saturated title strip across the middle
    const bandH = Math.max(3, Math.floor(h * 0.07));
    for (let y0 = Math.floor(h * 0.28); y0 < Math.floor(h * 0.72) - bandH; y0 += 2) {
      const band = analyze(y0, y0 + bandH);
      if (band.dom > 0.42 && band.sat > 22) return true;
    }

    // Maroon/red listicle title plate over collage («20 FINE LINE TATTOOS»)
    let crimson = 0;
    let crimsonN = 0;
    for (let y = Math.floor(h * 0.3); y < Math.floor(h * 0.7); y++) {
      for (let x = Math.floor(w * 0.2); x < Math.floor(w * 0.8); x++) {
        const i = (y * w + x) * 3;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const sat = Math.max(r, g, b) - Math.min(r, g, b);
        if (r > 100 && sat > 55 && r > g + 35 && r > b + 35 && g < 120) crimson += 1;
        crimsonN += 1;
      }
    }
    if (crimson / Math.max(1, crimsonN) > 0.35) return true;

    const gray = await sharp(buf).greyscale().resize(64, 64, { fit: 'fill' }).raw().toBuffer();
    let diff = 0;
    let n = 0;
    let seam = 0;
    for (let y = 8; y < 56; y++) {
      seam += Math.abs(gray[y * 64 + 31] - gray[y * 64 + 33]);
      for (let x = 0; x < 32; x++) {
        diff += Math.abs(gray[y * 64 + x] - gray[y * 64 + x + 32]);
        n += 1;
      }
    }
    const splitLike = diff / n < 24;
    const chrome = top.sat > 40 || bot.sat > 40 || mid.white > 0.06 || top.dom > 0.28 || bot.dom > 0.28;
    if (splitLike && chrome) return true;
    // Strong vertical discontinuity ≈ side-by-side educational collage
    if (seam / 48 > 55) return true;

    return false;
  } catch {
    return false;
  }
}

function contentHash(buf) {
  return createHash('sha1').update(buf).digest('hex');
}

/** 64-bit average hash for near-duplicate detection */
async function averageHash(input) {
  const raw = await sharp(input).greyscale().resize(8, 8, { fit: 'fill' }).raw().toBuffer();
  let sum = 0;
  for (let i = 0; i < raw.length; i++) sum += raw[i];
  const avg = sum / raw.length;
  let bits = 0n;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] >= avg) bits |= 1n << BigInt(i);
  }
  return bits;
}

function hamming64(a, b) {
  let x = a ^ b;
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

function isNearDuplicate(phash, seenPhashes) {
  for (const prev of seenPhashes) {
    if (hamming64(phash, prev) <= PHASH_DUP_DIST) return true;
  }
  return false;
}

/**
 * Reject low-res / soft / tiny portfolio rejects.
 * @returns {Promise<{ok:boolean, score:number, width:number, height:number, reason?:string}>}
 */
async function assessImageQuality(buf) {
  try {
    const meta = await sharp(buf).metadata();
    const width = meta.width || 0;
    const height = meta.height || 0;
    const pixels = width * height;
    if (width < MIN_WIDTH || height < MIN_HEIGHT) {
      return { ok: false, score: 0, width, height, reason: 'small-dims' };
    }
    if (pixels < MIN_PIXELS) {
      return { ok: false, score: 0, width, height, reason: 'few-pixels' };
    }
    if (buf.length < MIN_BYTES) {
      return { ok: false, score: 0, width, height, reason: 'tiny-file' };
    }

    // Edge energy – soft phone snaps / heavy compress score low
    const { data, info } = await sharp(buf)
      .greyscale()
      .resize(96, 96, { fit: 'inside' })
      .raw()
      .toBuffer({ resolveWithObject: true });
    let edge = 0;
    const w = info.width;
    const h = info.height;
    for (let y = 1; y < h; y++) {
      for (let x = 1; x < w; x++) {
        const i = y * w + x;
        edge += Math.abs(data[i] - data[i - 1]) + Math.abs(data[i] - data[i - w]);
      }
    }
    const edgeAvg = edge / ((w - 1) * (h - 1) * 2);
    // Soft / blurry / heavily compressed amateur snaps
    if (edgeAvg < 8) {
      return { ok: false, score: 0, width, height, reason: 'soft' };
    }

    let score = 0;
    if (pixels >= 900_000) score += 3;
    else if (pixels >= 600_000) score += 2;
    else score += 1;
    if (buf.length >= 120_000) score += 2;
    else if (buf.length >= 70_000) score += 1;
    if (edgeAvg >= 16) score += 2;
    else if (edgeAvg >= 11) score += 1;
    // Prefer portrait tattoo shots (common studio framing)
    if (height >= width * 1.05) score += 1;
    // Very small files relative to pixels → overcompressed junk
    if (buf.length < pixels * 0.08) {
      return { ok: false, score: 0, width, height, reason: 'overcompress' };
    }
    return { ok: true, score, width, height };
  } catch {
    return { ok: false, score: 0, width: 0, height: 0, reason: 'meta-fail' };
  }
}

/**
 * Non-skin color ratio – neo-trad / watercolor must not be B&W linework.
 * @returns {Promise<{colorRatio:number, satAvg:number}>}
 */
async function colorfulnessStats(buf) {
  try {
    const { data, info } = await sharp(buf)
      .resize(72, 72, { fit: 'cover' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const n = info.width * info.height;
    let colorful = 0;
    let satSum = 0;
    for (let i = 0; i < data.length; i += 3) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max - min;
      satSum += sat;
      const skin = r > g + 8 && g > b && r > 90 && r < 230 && g > 60 && b > 40 && sat < 90;
      // Ink / paint color distinct from skin and grey
      if (!skin && sat > 48 && max > 70) colorful += 1;
    }
    return { colorRatio: colorful / n, satAvg: satSum / n };
  } catch {
    return { colorRatio: 0, satAvg: 0 };
  }
}

/** @param {'color'|'mono'|'any'|string} palette */
function matchesStylePalette(palette, stats) {
  const p = String(palette || 'any');
  if (p === 'color') {
    // Need visible chromatic ink (reds/yellows/greens…), not only B&W lines
    return stats.colorRatio >= 0.055 && stats.satAvg >= 26;
  }
  if (p === 'mono') {
    // Soft preference: do not hard-reject slight color; hard-reject very loud color plates
    if (stats.colorRatio > 0.28) return false;
    return true;
  }
  return true;
}

async function fingerprintBuffer(buf) {
  const ch = contentHash(buf);
  const ph = await averageHash(buf);
  const quality = await assessImageQuality(buf);
  return { contentHash: ch, phash: ph, quality };
}

function extractYandexUrls(html) {
  const urls = [];
  const seen = new Set();
  const push = (u) => {
    if (!u || typeof u !== 'string') return;
    let clean = u.trim();
    if (clean.startsWith('//')) clean = `https:${clean}`;
    if (!/^https?:\/\//i.test(clean)) return;
    if (/yandex\.(ru|net|com)|yastatic|avatar|captcha|favicon|logo/i.test(clean)) return;
    if (BAD_URL.test(clean)) return;
    if (seen.has(clean)) return;
    seen.add(clean);
    urls.push(clean);
  };

  // serp-item data-bem JSON
  const bemRe = /data-bem=["']({[^"']*serp-item[^"']*})["']/gi;
  let m;
  while ((m = bemRe.exec(html))) {
    try {
      const raw = m[1].replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&amp;/g, '&');
      const json = JSON.parse(raw);
      const item = json['serp-item'] || json;
      push(item.img_href || item.dups?.[0]?.url || item.preview?.[0]?.url);
      if (Array.isArray(item.dups)) {
        for (const d of item.dups.slice(0, 3)) push(d.url || d.img_href);
      }
    } catch {
      /* ignore bad json */
    }
  }

  // img_url / origUrl in embedded JSON
  const urlRe =
    /(?:img_href|img_url|origUrl|originUrl|originalImageUrl|murl|mediaurl)\s*[=:]\s*["'](https?:[^"']+)["']/gi;
  while ((m = urlRe.exec(html))) push(m[1]);

  // unescape \/
  return urls.map((u) => u.replace(/\\u002F/g, '/').replace(/\\\//g, '/'));
}

function extractBingUrls(html) {
  const urls = [];
  const seen = new Set();
  const $ = cheerio.load(html);
  $('a.iusc').each((_, el) => {
    const m = $(el).attr('m');
    if (!m) return;
    try {
      const data = JSON.parse(m);
      const u = data.murl || data.turl;
      if (!u || seen.has(u)) return;
      if (!/^https?:\/\//i.test(u)) return;
      seen.add(u);
      urls.push(u);
    } catch {
      /* ignore */
    }
  });
  return urls;
}

async function fetchHtml(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 18000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.5'
      },
      redirect: 'follow'
    });
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

async function searchYandexImages(query, { limit = 10 } = {}) {
  // Force photo-like SERP; query already includes «татуировка / tattoo skin»
  const url = `https://yandex.ru/images/search?text=${encodeURIComponent(query)}&itype=photo&nomisspell=1`;
  const html = await fetchHtml(url);
  if (!html || /captcha|SmartCaptcha|showcaptcha/i.test(html)) return [];
  return extractYandexUrls(html).slice(0, limit);
}

async function searchBingImages(query, { limit = 10 } = {}) {
  const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&qft=+filterui:photo-photo+filterui:aspect-tall&form=HDRSC2`;
  const html = await fetchHtml(url);
  if (!html) return [];
  return extractBingUrls(html).slice(0, limit);
}

async function downloadImage(url, destPath, { seenContent, seenPhash, palette = 'any' } = {}) {
  if (BAD_URL.test(url)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': UA,
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        Referer: 'https://yandex.ru/'
      },
      redirect: 'follow'
    });
    if (!res.ok) return null;
    const ctype = String(res.headers.get('content-type') || '');
    if (ctype && !/^image\//i.test(ctype) && !/octet-stream/i.test(ctype)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < MIN_BYTES || buf.length > MAX_BYTES) return null;
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50;
    const isWebp = buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
    if (!isJpeg && !isPng && !isWebp) return null;
    if (!(await looksLikeTattooPhoto(buf))) return null;
    if (await hasPromoOverlay(buf)) return null;
    const fp = await fingerprintBuffer(buf);
    if (!fp.quality.ok) return null;
    const cstat = await colorfulnessStats(buf);
    if (!matchesStylePalette(palette, cstat)) return null;
    if (palette === 'color') fp.quality.score += Math.min(3, Math.floor(cstat.colorRatio * 20));
    if (seenContent?.has(fp.contentHash)) return null;
    if (seenPhash && isNearDuplicate(fp.phash, seenPhash)) return null;

    const ext = isPng ? '.png' : isWebp ? '.webp' : '.jpg';
    const finalPath = destPath.replace(/\.(jpe?g|png|webp)$/i, '') + ext;
    let outPath = finalPath;
    if (isJpeg) {
      writeFileSync(finalPath, buf);
    } else {
      outPath = finalPath.replace(/\.(png|webp)$/i, '.jpg');
      await sharp(buf).jpeg({ quality: 88, mozjpeg: true }).toFile(outPath);
    }
    seenContent?.add(fp.contentHash);
    seenPhash?.add(fp.phash);
    return { path: outPath, ...fp };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Re-validate cached file; delete if not tattoo-like or below quality bar.
 * @returns {Promise<null|{src:string,abs:string,contentHash:string,phash:bigint,score:number}>}
 */
async function acceptCachedImage(absPath, { seenContent, seenPhash, palette = 'any' } = {}) {
  try {
    const buf = await sharp(absPath).jpeg({ quality: 90 }).toBuffer();
    if (!(await looksLikeTattooPhoto(buf))) {
      try {
        unlinkSync(absPath);
      } catch {
        /* ignore */
      }
      return null;
    }
    if (await hasPromoOverlay(buf)) {
      try {
        unlinkSync(absPath);
      } catch {
        /* ignore */
      }
      return null;
    }
    const fp = await fingerprintBuffer(buf);
    if (!fp.quality.ok) {
      try {
        unlinkSync(absPath);
      } catch {
        /* ignore */
      }
      return null;
    }
    const cstat = await colorfulnessStats(buf);
    if (!matchesStylePalette(palette, cstat)) {
      // Drop mislabeled cache (e.g. B&W under neo-trad)
      if (palette === 'color' || palette === 'mono') {
        try {
          unlinkSync(absPath);
        } catch {
          /* ignore */
        }
      }
      return null;
    }
    if (palette === 'color') fp.quality.score += Math.min(3, Math.floor(cstat.colorRatio * 20));
    if (seenContent?.has(fp.contentHash)) return null;
    if (seenPhash && isNearDuplicate(fp.phash, seenPhash)) return null;
    seenContent?.add(fp.contentHash);
    seenPhash?.add(fp.phash);
    return {
      abs: absPath,
      src: publicUrl(absPath),
      contentHash: fp.contentHash,
      phash: fp.phash,
      score: fp.quality.score
    };
  } catch {
    return null;
  }
}

/** @deprecated keep name for callers that only need boolean */
async function cachedIsTattoo(absPath) {
  const ok = await acceptCachedImage(absPath);
  return Boolean(ok);
}

/**
 * Collect tattoo example images for a zodiac / motif query set.
 * @returns {Promise<Array<{src:string,alt:string,query?:string}>>}
 */
export async function fetchTattooGalleryImages({
  queries = [],
  slug = 'misc',
  limit = 6,
  force = false
} = {}) {
  ensureDir(join(CACHE_ROOT, slug));
  const seenContent = new Set();
  const seenPhash = new Set();
  const collected = [];

  if (!force) {
    for (const img of listCached(slug, limit * 3)) {
      if (collected.length >= limit) break;
      const abs = join(PUBLIC, img.src.replace(/^\//, ''));
      const accepted = await acceptCachedImage(abs, { seenContent, seenPhash });
      if (!accepted) continue;
      collected.push({
        src: accepted.src,
        alt: img.alt || `Пример тату ${collected.length + 1}`,
        score: accepted.score
      });
    }
    if (collected.length >= Math.min(4, limit)) {
      return collected.slice(0, limit);
    }
  } else {
    for (const img of listCached(slug, 40)) {
      const abs = join(PUBLIC, img.src.replace(/^\//, ''));
      await acceptCachedImage(abs); // purge soft/non-tattoo
    }
  }

  const seenUrl = new Set();
  const qList = (queries || []).filter(Boolean).slice(0, 5);

  for (const query of qList) {
    if (collected.length >= limit) break;
    const perQuery = Math.max(2, Math.ceil(limit / Math.max(1, qList.length)) + 1);
    let urls = await searchYandexImages(query, { limit: perQuery + 8 });
    if (!urls.length) urls = await searchBingImages(query, { limit: perQuery + 8 });
    let got = 0;
    for (const url of urls) {
      if (collected.length >= limit || got >= perQuery) break;
      if (seenUrl.has(url)) continue;
      seenUrl.add(url);
      const name = `${hashKey(url)}`;
      const dest = join(CACHE_ROOT, slug, `${name}.jpg`);
      const existing = [dest, dest.replace(/\.jpg$/, '.png'), dest.replace(/\.jpg$/, '.webp')].find((p) =>
        existsSync(p)
      );
      if (existing) {
        const accepted = await acceptCachedImage(existing, { seenContent, seenPhash });
        if (!accepted) continue;
        collected.push({
          src: accepted.src,
          alt: `Пример тату (${query.replace(/^тату\s+/i, '')})`,
          query,
          score: accepted.score
        });
        got += 1;
        continue;
      }
      const saved = await downloadImage(url, dest, { seenContent, seenPhash });
      if (!saved) continue;
      collected.push({
        src: publicUrl(saved.path),
        alt: `Пример тату (${query.replace(/^тату\s+/i, '')})`,
        query,
        score: saved.quality?.score || 0
      });
      got += 1;
    }
  }

  collected.sort((a, b) => (b.score || 0) - (a.score || 0));
  return collected.slice(0, limit);
}

/**
 * Collect tattoo examples matched to article styles (1+ image per style).
 * Captions: "Стиль: blackwork · Козерог"
 * Guarantees unique content across styles (content hash + near-dup aHash).
 *
 * @param {{ styleQueries: Array<{styleId,caption,queries,studio,label}>, slug: string, perStyle?: number, force?: boolean }} opts
 * @returns {Promise<Array<{src:string,alt:string,styleId?:string,query?:string}>>}
 */
export async function fetchStyleMatchedGallery({
  styleQueries = [],
  slug = 'misc',
  perStyle = 2,
  force = false
} = {}) {
  const list = (styleQueries || []).filter((s) => s && (s.queries || []).length);
  if (!list.length) {
    return fetchTattooGalleryImages({ queries: [`professional tattoo on skin portfolio`], slug, limit: 4, force });
  }

  const collected = [];
  const seenUrl = new Set();
  const seenSrc = new Set();
  const seenContent = new Set();
  const seenPhash = new Set();

  for (const pack of list) {
    const styleSlug = String(pack.styleId || 'style')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-');
    const dirSlug = `${slug}/${styleSlug}`;
    ensureDir(join(CACHE_ROOT, dirSlug));

    // On force: keep high-quality cache as candidates; soft/promo files are unlinked by acceptCachedImage
    const candidates = [];
    const localContent = new Set(seenContent);
    const localPhash = new Set(seenPhash);
    const palette = pack.palette || 'any';

    // Prefer style-specific cache (re-validate tattoo-likeness + uniqueness)
    {
      const cached = listCached(dirSlug, force ? 24 : perStyle + 6);
      for (const img of cached) {
        const abs = join(PUBLIC, img.src.replace(/^\//, ''));
        const accepted = await acceptCachedImage(abs, {
          seenContent: localContent,
          seenPhash: localPhash,
          palette
        });
        if (!accepted) continue;
        candidates.push({
          src: accepted.src,
          score: accepted.score,
          contentHash: accepted.contentHash,
          phash: accepted.phash,
          query: 'cache',
          fromCache: true
        });
      }
    }

    let need = perStyle - collected.filter((c) => c.styleId === pack.styleId).length;
    const bestCached = [...candidates].sort((a, b) => b.score - a.score)[0];
    const wantFetch = need > 0 && (force || !bestCached || bestCached.score < 4 || candidates.length < perStyle);

    if (wantFetch) {
      for (const query of pack.queries.slice(0, 4)) {
        if (candidates.length >= perStyle + 6) break;
        let urls = await searchYandexImages(query, { limit: need + 12 });
        if (!urls.length) urls = await searchBingImages(query, { limit: need + 12 });
        for (const url of urls) {
          if (candidates.length >= perStyle + 6) break;
          if (seenUrl.has(url)) continue;
          seenUrl.add(url);
          const name = `${hashKey(url)}`;
          const dest = join(CACHE_ROOT, dirSlug, `${name}.jpg`);
          const existing = [dest, dest.replace(/\.jpg$/, '.png'), dest.replace(/\.jpg$/, '.webp')].find((p) =>
            existsSync(p)
          );
          if (existing) {
            const accepted = await acceptCachedImage(existing, {
              seenContent: localContent,
              seenPhash: localPhash,
              palette
            });
            if (!accepted) continue;
            candidates.push({
              src: accepted.src,
              score: accepted.score,
              contentHash: accepted.contentHash,
              phash: accepted.phash,
              query,
              fromCache: true
            });
            continue;
          }
          const saved = await downloadImage(url, dest, {
            seenContent: localContent,
            seenPhash: localPhash,
            palette
          });
          if (!saved) continue;
          candidates.push({
            src: publicUrl(saved.path),
            score: saved.quality?.score || 0,
            contentHash: saved.contentHash,
            phash: saved.phash,
            query,
            fromCache: false
          });
        }
      }
    }

    // Pick best unique candidate(s) for this style – portfolio bar
    candidates.sort((a, b) => b.score - a.score);
    const strong = candidates.filter((c) => (c.score || 0) >= MIN_STYLE_SCORE);
    const pool = strong.length ? strong : candidates.slice(0, 1);
    for (const cand of pool) {
      if (collected.filter((c) => c.styleId === pack.styleId).length >= perStyle) break;
      if (seenSrc.has(cand.src)) continue;
      if (seenContent.has(cand.contentHash)) continue;
      if (isNearDuplicate(cand.phash, seenPhash)) continue;
      if ((cand.score || 0) < MIN_STYLE_SCORE && strong.length) continue;
      seenSrc.add(cand.src);
      seenContent.add(cand.contentHash);
      seenPhash.add(cand.phash);
      collected.push({
        src: cand.src,
        alt: pack.caption || `Стиль: ${pack.studio || pack.label}`,
        styleId: pack.styleId,
        studio: pack.studio,
        query: cand.query,
        score: cand.score
      });
    }
  }

  // If some styles failed, fill without lying about style
  if (collected.length < list.length) {
    for (const img of listCached(slug, 20)) {
      if (seenSrc.has(img.src)) continue;
      const abs = join(PUBLIC, img.src.replace(/^\//, ''));
      const accepted = await acceptCachedImage(abs, { seenContent, seenPhash });
      if (!accepted) continue;
      collected.push({
        src: accepted.src,
        alt: img.alt || `Пример татуировки · ${slug}`,
        query: 'fallback',
        score: accepted.score
      });
      if (collected.length >= Math.max(list.length, 4)) break;
    }
  }

  return collected;
}

/**
 * Markdown image block for article body (picked up by magazine gallery).
 */
export function galleryToMarkdown(images = [], heading = 'Примеры татуировок по стилям') {
  if (!images.length) return '';
  const lines = ['', `## ${heading}`, ''];
  for (const img of images) {
    const alt = (img.alt || 'Пример тату').replace(/[[\]]/g, '');
    lines.push(`![${alt}](${img.src})`);
    lines.push('');
  }
  return lines.join('\n');
}

export function birthdayImageCacheDir(slug) {
  return join(CACHE_ROOT, slug);
}
