/**
 * Translation helper for news (RU / EN / DE).
 * Uses Google gtx endpoint (stable) with MyMemory fallback.
 */
const cache = new Map();
let lastCallAt = 0;
const MIN_GAP_MS = 350;

export async function translateText(text, to, { from = 'auto' } = {}) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const target = String(to || '').slice(0, 2);
  if (!target) return raw;

  if (target === 'ru' && looksRussian(raw)) return raw;
  if (target === 'en' && looksEnglish(raw) && !looksRussian(raw) && !looksGerman(raw)) return raw;
  if (target === 'de' && looksGerman(raw)) return raw;

  const key = `${target}::${from}::${raw.slice(0, 400)}`;
  if (cache.has(key)) return cache.get(key);

  const chunks = chunkText(raw, 900);
  const out = [];
  for (const chunk of chunks) {
    const translated = await translateChunk(chunk, target, from);
    if (!translated) return '';
    out.push(translated);
  }
  const joined = out.join('\n\n').trim();
  if (!joined) return '';
  if (target === 'ru' && !looksRussian(joined) && looksEnglish(raw)) return '';
  cache.set(key, joined);
  return joined;
}

async function translateChunk(chunk, target, from) {
  await throttle();
  try {
    const text = await gtxTranslate(chunk, target, from);
    if (text) return text;
  } catch (e) {
    console.warn('gtx fail:', target, String(e.message || e).slice(0, 120));
  }
  try {
    await throttle();
    return await myMemoryTranslate(chunk, target, from);
  } catch (e) {
    console.warn('mymemory fail:', target, e.message || e);
    return '';
  }
}

async function gtxTranslate(text, to, from) {
  const sl = from === 'auto' ? 'auto' : from;
  const url =
    'https://translate.googleapis.com/translate_a/single?client=gtx&sl=' +
    encodeURIComponent(sl) +
    '&tl=' +
    encodeURIComponent(to) +
    '&dt=t&q=' +
    encodeURIComponent(text);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 SitriforNewsBot/1.0' }
  });
  if (!res.ok) throw new Error('gtx ' + res.status);
  const data = await res.json();
  if (!Array.isArray(data) || !Array.isArray(data[0])) throw new Error('gtx bad payload');
  return data[0].map((part) => part?.[0] || '').join('').trim();
}

async function myMemoryTranslate(text, to, from) {
  const langpair = `${from === 'auto' ? 'en' : from}|${to}`;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 450))}&langpair=${encodeURIComponent(langpair)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'SitriforNewsBot/1.0 (+https://sitrifor.ru/news)' }
  });
  if (!res.ok) throw new Error('mymemory ' + res.status);
  const data = await res.json();
  const out = data?.responseData?.translatedText;
  if (!out || /INVALID|QUERY LENGTH|MYMEMORY WARNING/i.test(out)) {
    throw new Error(out || 'empty');
  }
  return out;
}

async function throttle() {
  const now = Date.now();
  const wait = MIN_GAP_MS - (now - lastCallAt);
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}

/** @deprecated use translateText(text, 'ru') */
export async function translateToRu(text, opts = {}) {
  return translateText(text, 'ru', opts);
}

export async function localizeBundle({ title = '', summary = '', body = '', sourceLang = 'auto' } = {}) {
  const src = detectLang(title + ' ' + summary, sourceLang);
  const from = src === 'auto' ? 'auto' : src;

  const titleBy = { [src]: title };
  const summaryBy = { [src]: summary };
  const bodyBy = { [src]: body };

  for (const lang of ['ru', 'en', 'de']) {
    if (!titleBy[lang]) {
      const t = await translateText(title, lang, { from });
      if (t) titleBy[lang] = t;
    }
    if (!summaryBy[lang]) {
      const t = await translateText(summary, lang, { from });
      if (t) summaryBy[lang] = t;
    }
    if (!bodyBy[lang]) {
      const bodySrc = body.length > 4500 ? body.slice(0, 4500) : body;
      const t = await translateText(bodySrc, lang, { from });
      if (t) bodyBy[lang] = t;
    }
  }

  return {
    titleRu: titleBy.ru || null,
    titleEn: titleBy.en || null,
    titleDe: titleBy.de || null,
    summaryRu: summaryBy.ru || null,
    summaryEn: summaryBy.en || null,
    summaryDe: summaryBy.de || null,
    bodyRu: bodyBy.ru || null,
    bodyEn: bodyBy.en || null,
    bodyDe: bodyBy.de || null,
    detectedLang: src
  };
}

function chunkText(text, size) {
  if (text.length <= size) return [text];
  const parts = [];
  let rest = text;
  while (rest.length) {
    if (rest.length <= size) {
      parts.push(rest);
      break;
    }
    let cut = rest.lastIndexOf('\n', size);
    if (cut < size * 0.5) cut = rest.lastIndexOf('. ', size);
    if (cut < size * 0.5) cut = rest.lastIndexOf(' ', size);
    if (cut < size * 0.3) cut = size;
    parts.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  return parts.filter(Boolean);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function looksRussian(text) {
  const raw = String(text || '');
  const cyr = (raw.match(/[а-яёА-ЯЁ]/g) || []).length;
  return cyr / Math.max(raw.length, 1) > 0.2;
}

export function looksGerman(text) {
  const raw = String(text || '');
  if (looksRussian(raw)) return false;
  const deHits = (raw.match(/\b(der|die|das|und|für|mit|nicht|tätow)\b/gi) || []).length;
  const umlaut = (raw.match(/[äöüßÄÖÜ]/g) || []).length;
  return umlaut >= 2 || deHits >= 3;
}

export function looksEnglish(text) {
  const raw = String(text || '');
  if (looksRussian(raw)) return false;
  const letters = (raw.match(/[a-zA-Z]/g) || []).length;
  return letters / Math.max(raw.length, 1) > 0.4;
}

export function detectLang(text, hint = 'auto') {
  if (hint && hint !== 'auto' && ['ru', 'en', 'de'].includes(hint)) return hint;
  if (looksRussian(text)) return 'ru';
  if (looksGerman(text)) return 'de';
  if (looksEnglish(text)) return 'en';
  return 'en';
}
