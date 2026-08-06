/**
 * Price parsing + product fingerprint for cross-shop merge.
 */

/** Reject obviously broken scrapes (concatenated old/new prices etc.). */
const MAX_REASONABLE_PRICE_RUB = 5_000_000;

export function parsePriceRub(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw <= 0 || raw > MAX_REASONABLE_PRICE_RUB) return null;
    return Math.round(raw * 100) / 100;
  }

  let s = String(raw).replace(/\u00a0/g, ' ').trim();
  if (!s) return null;

  // "82 690 ₽ 97 300 ₽" / "цена 64 руб купить" -> first monetary chunk only
  const currencyParts = s.split(/(?:₽|руб\.?|rub\b)/i);
  if (currencyParts.length > 1 && /\d/.test(currencyParts[0])) {
    s = currencyParts[0];
  } else {
    // strip trailing marketing after first number group
    s = s.replace(/(?:можно\s+купить|купить|в\s+кредит).*$/i, ' ');
  }

  s = s.replace(/[^\d.,\s]/g, ' ').trim();
  if (!s) return null;

  // Keep spaces as thousand separators until normalized
  s = s.replace(/\s+/g, '');
  if (/,/.test(s) && /\./.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/,/.test(s)) {
    const parts = s.split(',');
    if (parts[1] && parts[1].length <= 2) s = parts.join('.');
    else s = s.replace(/,/g, '');
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_REASONABLE_PRICE_RUB) return null;
  return Math.round(n * 100) / 100;
}

export function isSeoDescription(text = '') {
  const s = String(text || '');
  if (!s) return true;
  if (/цена\s*:\s*\d+/i.test(s)) return true;
  if (/купить\s+онлайн/i.test(s)) return true;
  if (/интернет[-\s]?магазин/i.test(s) && s.length < 320) return true;
  if (/большой\s+выбор/i.test(s) && /низкие\s+цены/i.test(s)) return true;
  return false;
}

export function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/["'«»„“]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Stable merge key: brand + core title tokens (drop shop fluff) */
export function productFingerprint({ title, brand, sku } = {}) {
  const skuPart = String(sku || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/gi, '');
  if (skuPart && skuPart.length >= 4) return `sku:${skuPart}`;

  const brandPart = normalizeTitle(brand || '').replace(/[^a-z0-9а-я]+/gi, '');
  let t = normalizeTitle(title);
  t = t
    .replace(/\b(купить|цена|шт|уп|набор|set|pack)\b/gi, ' ')
    .replace(/[^a-z0-9а-я.\-/]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = t.split(' ').filter((w) => w.length > 1).slice(0, 12);
  return `t:${brandPart}|${tokens.join('-')}`.slice(0, 200);
}

/**
 * Strip shop CRM / SEO noise from product descriptions (phones, "buy in store", etc.).
 * Returns null when nothing useful remains.
 */
export function cleanProductDescription(raw, title = '') {
  if (raw == null || raw === '') return null;
  let s = String(raw)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return null;

  s = s.replace(/&nbsp;|&#160;/gi, ' ').replace(/\s+/g, ' ').trim();

  // Contact / CRM (avoid matching RPM like "8-8000 об/мин"; do not match "тело")
  s = s.replace(/(?:телефон|тел\.|тел:|phone|whats?app|viber|telegram)\s*[:.]?\s*/gi, ' ');
  s = s.replace(/(?:\+7|8)[\s\-()]*(?:\d[\s\-()]*){9,14}/g, ' ');
  s = s.replace(/\b8[\s\-]*800(?:[\s\-]?\d{2,3}){3,4}\b/g, ' ');
  s = s.replace(/\S+@\S+\.\S+/g, ' ');
  s = s.replace(/https?:\/\/\S+/gi, ' ');
  s = s.replace(/\bwww\.\S+/gi, ' ');

  // Marketplace SEO fluff
  s = s.replace(/купить\s+в\s+интернет[-\s]?магазине\s+[\w«»"'-]+/gi, ' ');
  s = s.replace(/в\s+интернет[-\s]?магазине\s+[\w«»"'-]+/gi, ' ');
  s = s.replace(/купить\s+онлайн(?:\s+в\s+интернет[-\s]?магазине)?(?:\s+[\w«»"'-]+)*/gi, ' ');
  s = s.replace(/цена\s*:\s*[\d\s.,]+(?:\s*(?:₽|руб\.?|rub))?/gi, ' ');
  s = s.replace(/по\s+доступной\s+цене\.?/gi, ' ');
  s = s.replace(/большой\s+выбор[,.]?\s*(низкие\s+цены)?\.?/gi, ' ');
  s = s.replace(/низкие\s+цены\.?/gi, ' ');
  s = s.replace(/с\s+доставкой(?:\s+по\s+\S+)?\.?/gi, ' ');
  s = s.replace(/официальный\s+дилер[^.!]*/gi, ' ');
  s = s.replace(/звоните[^.!]*/gi, ' ');
  s = s.replace(/оставьте\s+заявк[^.!]*/gi, ' ');
  s = s.replace(/\b(?:tattoo\s*)?mall\b/gi, ' ');

  s = s
    .replace(/\s*[|·•]+\s*/g, ' ')
    .replace(/\s*([,.;:])\s*/g, '$1 ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s.,;:!?«»"'-]+|[\s.,;:!?«»"'-]+$/g, '')
    .trim();

  if (!s) return null;

  const nt = normalizeTitle(title);
  const nd = normalizeTitle(s);
  if (!nd) return null;
  if (isSeoDescription(s) && s.length < 360) return null;
  if (nt && (nd === nt || nd === `${nt} купить`)) return null;
  // Description is only title + leftover fluff crumbs
  if (nt && nd.startsWith(nt) && nd.length <= nt.length + 24) return null;
  if (nd.length < 24) return null;

  return s.slice(0, 2000);
}

const SPEC_LINE_RE =
  /^(вес|размеры?|габариты|диаметр|длина|высота|ширина|толщина|объ[её]м|материал|состав|в комплекте|комплектация|цвет|упаковка|размер упаковки|артикул|мощность|напряжение|ход(?:\s+иглы)?|stroke|sku|код)(?![а-яёa-z0-9])/i;

/**
 * Split solid product description into readable paragraphs.
 * Keeps existing blank-line structure; otherwise groups sentences and isolates specs.
 * @param {string|null|undefined} raw
 * @returns {string[]}
 */
export function splitDescriptionParagraphs(raw) {
  if (raw == null || raw === '') return [];
  let s = String(raw)
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\u2014|\u2013|\u2212/g, '-')
    .trim();
  if (!s) return [];

  // Already structured by blank lines
  if (/\n\s*\n/.test(s)) {
    return s
      .split(/\n\s*\n+/)
      .map((p) => p.replace(/[ \t]+/g, ' ').replace(/\n+/g, ' ').trim())
      .filter(Boolean);
  }

  // Soft line breaks inside one block → spaces
  s = s.replace(/\n+/g, ' ');

  // Glue fixes: "ммГабариты", "шт.Вес" (\b is ASCII-only in JS - use lookarounds)
  s = s.replace(/([а-яёa-z0-9)])([А-ЯЁA-Z«"])/g, '$1 $2');
  s = s.replace(
    /(?<![а-яёa-z0-9])(мм|см|кг|мл|шт|Вт|мАч|г)\.?(?![а-яёa-z0-9])\s+(?=[А-ЯЁ])/gi,
    '$1. '
  );
  s = s.replace(/\s{2,}/g, ' ').trim();

  const sentences = splitIntoSentences(s);
  if (!sentences.length) return [s];

  const paragraphs = [];
  let narrative = [];

  const flushNarrative = () => {
    if (!narrative.length) return;
    // Group ~2 sentences or ~320 chars per paragraph
    let buf = [];
    let len = 0;
    for (const sent of narrative) {
      const nextLen = len + sent.length + (buf.length ? 1 : 0);
      if (buf.length >= 2 || (buf.length >= 1 && nextLen > 320)) {
        paragraphs.push(buf.join(' '));
        buf = [];
        len = 0;
      }
      buf.push(sent);
      len += sent.length + (buf.length > 1 ? 1 : 0);
    }
    if (buf.length) paragraphs.push(buf.join(' '));
    narrative = [];
  };

  for (const sent of sentences) {
    if (SPEC_LINE_RE.test(sent)) {
      flushNarrative();
      paragraphs.push(sent);
    } else {
      narrative.push(sent);
    }
  }
  flushNarrative();

  return paragraphs.length ? paragraphs : [s];
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function splitIntoSentences(text) {
  const s = String(text || '').trim();
  if (!s) return [];

  // Protect abbreviations only when the period is not a sentence end
  const protectedText = s.replace(
    /(?<![а-яёa-z0-9])(шт|мм|см|кг|мл|руб|ул|пр|др|ед|рис|стр|кор|уп|гг)\.(?!\s+[А-ЯЁA-Z«"0-9])/gi,
    (m) => m.replace(/\./g, '\u0001')
  );

  const parts = [];
  let buf = '';
  const re = /[.!?…]+(?:["»”')\]]+)?(?=\s|$)/g;
  let last = 0;
  let m;
  while ((m = re.exec(protectedText))) {
    const end = m.index + m[0].length;
    const chunk = protectedText.slice(last, end).trim();
    last = end;
    if (!chunk) continue;
    const rest = protectedText.slice(end).replace(/^\s+/, '');
    const nextOk = !rest || /^[А-ЯЁA-Z«"0-9(]/.test(rest);
    if (!nextOk && !/[!?…]/.test(m[0])) {
      buf += (buf ? ' ' : '') + chunk;
      continue;
    }
    const full = ((buf ? `${buf} ` : '') + chunk)
      .replace(/\u0001/g, '.')
      .replace(/\s+/g, ' ')
      .trim();
    buf = '';
    if (full) parts.push(full);
  }
  const tail = (buf + ' ' + protectedText.slice(last))
    .replace(/\u0001/g, '.')
    .replace(/\s+/g, ' ')
    .trim();
  if (tail) parts.push(tail);

  // Merge tiny fragments into previous
  const merged = [];
  for (const p of parts) {
    if (
      merged.length &&
      p.length < 28 &&
      !SPEC_LINE_RE.test(p) &&
      (/^[а-яёa-z0-9]/.test(p) || !/[.!?…]$/.test(merged[merged.length - 1]))
    ) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${p}`.trim();
    } else {
      merged.push(p);
    }
  }
  return merged;
}

/**
 * One offer row per shop: keep cheapest in-stock when possible.
 */
export function dedupeOffersByShop(offers = []) {
  const byShop = new Map();
  for (const o of offers) {
    if (!o) continue;
    const key = String(o.shopKey || o.shopName || o.url || '').toLowerCase();
    if (!key) continue;
    const prev = byShop.get(key);
    if (!prev) {
      byShop.set(key, o);
      continue;
    }
    const prevPrice = prev.priceRub == null ? Infinity : Number(prev.priceRub);
    const nextPrice = o.priceRub == null ? Infinity : Number(o.priceRub);
    const prevStock = prev.inStock === false ? 0 : 1;
    const nextStock = o.inStock === false ? 0 : 1;
    if (nextPrice < prevPrice) {
      byShop.set(key, o);
    } else if (nextPrice === prevPrice && nextStock > prevStock) {
      byShop.set(key, o);
    }
  }
  return [...byShop.values()].sort((a, b) => {
    const ap = a.priceRub == null ? Infinity : Number(a.priceRub);
    const bp = b.priceRub == null ? Infinity : Number(b.priceRub);
    return ap - bp;
  });
}

/**
 * Needle/cartridge configuration like 3RL, 5 RS, 7RM, 9M1.
 * Must NOT use bare rl/rs/rm/m1 - those match Colors, warm, url, etc.
 */
const NEEDLE_CONFIG_RE = /\b\d{1,2}\s*[-./]?\s*(rl|rs|rm|m1|cm|mg)\b/i;

/**
 * Guess marketplace category from product title + URL.
 * Prefer strong lexical signals; never use trailing-letter traps (rs\b on "Colors").
 */
export function guessCategory(title = '', path = '') {
  const titleN = normalizeTitle(title);
  const pathN = String(path || '')
    .toLowerCase()
    .replace(/ё/g, 'е');
  const s = `${titleN} ${pathN}`;

  const hasCartridgeWord = /картридж|катридж|cartridge|cartridges|модул[ьия]|modules?\b/.test(s);
  const hasNeedleWord = /тату[- ]?игл|игл[аыи]\b|needles?\b|пины\b/.test(s);
  const hasConfig = NEEDLE_CONFIG_RE.test(titleN) || NEEDLE_CONFIG_RE.test(pathN);
  const cartridgeAsProduct =
    /^(картридж|катридж|cartridges?\b|модул)/i.test(titleN) ||
    /картридж\w*\s+для/i.test(titleN) ||
    /модул\w*\s+для/i.test(titleN);
  const machineAsProduct = /тату[- ]?машин|машинк|tattoo\s*machines?|ротац|\brotary\b|\bcoil\b/.test(
    titleN
  );

  // Machines that merely mention "cartridge version" stay machines
  if (machineAsProduct && !cartridgeAsProduct) return 'machines';

  // 1) Explicit cartridges
  if (hasCartridgeWord || cartridgeAsProduct) return 'cartridges';
  if (/\bsemmt\b/.test(s) && hasConfig) return 'cartridges';

  // 2) Explicit needles (loose bars / traditional needles)
  if (hasNeedleWord && !hasCartridgeWord) return 'needles';

  // 3) Config codes without explicit word: path hint, else needles (bars more common bare)
  if (hasConfig) {
    if (/\/(cartridge|cartridges|modul)/i.test(pathN)) return 'cartridges';
    if (/\/(needle|needles|igl)/i.test(pathN)) return 'needles';
    return 'needles';
  }

  // 4) Machines (path / weak signals)
  if (/тату[- ]?машин|машинк|tattoo\s*machines?|\brotary\b|\bcoil\b|ротац|машинка/.test(s)) {
    return 'machines';
  }
  if (/\b(pen|машин)\b/.test(titleN) && /тату|tattoo|spektra|bishop|cheyenne|fk\s*irons|dragonhawk|ambition|mast\b/.test(s)) {
    return 'machines';
  }

  // 5) Power supplies
  if (/блок.?питан|power.?suppl|источник.?питан|\bcritical\b|блок\s*питания/.test(s)) {
    return 'power';
  }

  // 6) Pigments / inks
  if (/пигмент|краск|чернил|tattoo\s*ink|\binks?\b|world\s*famous|eternal|dynamic|panthera|allegory|intenze|solid\s*ink/.test(s)) {
    return 'pigments';
  }

  // 7) Aftercare
  if (/уход|aftercare|мазь|крем|заживл|bepanthen|пантенол|вазелин/.test(s)) return 'care';

  // 8) Barriers
  if (/барьер|плёнк|пленк|suprasorb|barrier|рукав|clip.?cord.?cover|барьерн/.test(s)) {
    return 'barriers';
  }

  // 9) Consumables
  if (/перчат|стакан|антисепт|дезинф|расход|салфет|маск|nitrile|cups?\b/.test(s)) {
    return 'consumables';
  }

  return 'other';
}

export function marketplaceSearchLinks(title) {
  const q = encodeURIComponent(String(title || '').slice(0, 120));
  return [
    {
      key: 'wildberries',
      name: 'Wildberries',
      url: `https://www.wildberries.ru/catalog/0/search.aspx?search=${q}`
    },
    {
      key: 'ozon',
      name: 'Ozon',
      url: `https://www.ozon.ru/search/?text=${q}`
    }
  ];
}
