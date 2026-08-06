/**
 * Magazine layout composer for Sitrifor news articles.
 * Turns markdown body + metadata into typed visual blocks.
 * Deps: marked (AST), local image catalog, optional sharp covers.
 */
import { marked } from 'marked';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, '../public');

const TOPIC_ART = {
  tools: ['/img/news/formats/business-01.jpg', '/img/news/formats/studio-01.jpg'],
  studio: ['/img/news/formats/studio-01.jpg', '/img/news/formats/business-01.jpg'],
  clients: ['/img/news/formats/client-01.jpg', '/img/news/formats/social-01.jpg'],
  social: ['/img/news/formats/social-01.jpg', '/img/news/formats/social-02.jpg', '/img/news/formats/social-03.jpg'],
  gear: ['/img/news/formats/studio-01.jpg', '/img/marketing/card-calc.jpg'],
  pigments: ['/img/news/formats/styles-01.jpg', '/img/news/formats/trends-01.jpg'],
  sketch: ['/img/news/formats/sketch-01.jpg'],
  events: ['/img/news/formats/events-01.jpg'],
  culture: ['/img/news/formats/trends-01.jpg', '/img/news/formats/styles-01.jpg'],
  ideas: ['/img/news/formats/birthday-01.jpg', '/img/news/formats/styles-01.jpg', '/img/news/formats/sketch-01.jpg'],
  for_clients: ['/img/news/formats/birthday-01.jpg', '/img/news/formats/styles-01.jpg', '/img/news/formats/sketch-01.jpg'],
  career: ['/img/news/formats/career-01.jpg'],
  industry: ['/img/news/formats/trends-01.jpg', '/img/marketing/app-card-bg.jpg']
};

const APP_SHOTS = [
  { src: '/img/app/real/home.png?v=2', alt: 'Projects' },
  { src: '/img/app/real/pipette.png?v=2', alt: 'Eyedropper' },
  { src: '/img/app/real/match.png?v=2', alt: 'Pigment match' },
  { src: '/img/app/real/labels.png?v=2', alt: 'Labels' },
  { src: '/img/app/real/dominant.png?v=2', alt: 'Dominant colors' },
  { src: '/img/app/real/inventory.png?v=2', alt: 'Inventory' },
  { src: '/img/app/real/clients.png?v=2', alt: 'Clients' },
  { src: '/img/app/real/calendar.png?v=2', alt: 'Calendar' }
];

const UI = {
  ru: {
    release: 'Релиз',
    review: 'Обзор для мастера',
    editor: 'Колонка главреда',
    social: 'Соцсети · практика',
    birthday: 'Тату по дате рождения',
    for_clients: 'Для клиентов',
    tools: 'Инструменты',
    studio: 'Студия',
    clients: 'Клиенты',
    gear: 'Техника',
    pigments: 'Пигменты',
    culture: 'Культура',
    ideas: 'Идеи для тату',
    editorial: 'Редакция Sitrifor',
    ctaAppTitle: 'Установить 634',
    ctaAppText: 'Бесплатно в App Store для iPhone и iPad.',
    ctaAppLabel: 'Скачать в App Store',
    ctaReviewTitle: 'Где смотреть товар',
    ctaReviewText: 'Карточка на TattooMarket и сравнение в материале выше.',
    ctaReviewLabel: 'Открыть карточку',
    buyTitle: 'Где купить',
    yandex: 'Яндекс Маркет'
  },
  en: {
    release: 'Release',
    review: 'Review for the artist',
    editor: "Editor's column",
    social: 'Social · practice',
    birthday: 'Birthday tattoo ideas',
    for_clients: 'For clients',
    tools: 'Tools',
    studio: 'Studio',
    clients: 'Clients',
    gear: 'Gear',
    pigments: 'Pigments',
    culture: 'Culture',
    ideas: 'Tattoo ideas',
    editorial: 'Sitrifor editorial',
    ctaAppTitle: 'Install 634',
    ctaAppText: 'Free on the App Store for iPhone and iPad.',
    ctaAppLabel: 'Download on the App Store',
    ctaReviewTitle: 'Where to see the product',
    ctaReviewText: 'TattooMarket product card and comparison in the article above.',
    ctaReviewLabel: 'Open product card',
    buyTitle: 'Where to buy',
    yandex: 'Yandex Market'
  },
  de: {
    release: 'Release',
    review: 'Review für Meister',
    editor: 'Kolumne des Chefredakteurs',
    social: 'Social · Praxis',
    birthday: 'Tattoo nach Geburtsdatum',
    for_clients: 'Für Kunden',
    tools: 'Tools',
    studio: 'Studio',
    clients: 'Kunden',
    gear: 'Technik',
    pigments: 'Pigmente',
    culture: 'Kultur',
    ideas: 'Tattoo-Ideen',
    editorial: 'Sitrifor-Redaktion',
    ctaAppTitle: '634 installieren',
    ctaAppText: 'Kostenlos im App Store für iPhone und iPad.',
    ctaAppLabel: 'Im App Store laden',
    ctaReviewTitle: 'Produkt ansehen',
    ctaReviewText: 'TattooMarket-Produktkarte und Vergleich im Artikel oben.',
    ctaReviewLabel: 'Produktkarte öffnen',
    buyTitle: 'Wo kaufen',
    yandex: 'Yandex Market'
  }
};

function ui(lang) {
  return UI[lang] || UI.ru;
}

function publicExists(urlPath) {
  const clean = String(urlPath || '').split('?')[0];
  if (!clean.startsWith('/')) return false;
  return existsSync(join(PUBLIC, clean.slice(1)));
}

function pickTopicArt(categories = [], seed = 0) {
  for (const id of categories) {
    const list = TOPIC_ART[id];
    if (list?.length) {
      const src = list[Math.abs(seed) % list.length];
      if (publicExists(src)) return src;
    }
  }
  return '/img/marketing/app-card-bg.jpg';
}

function extractMdImages(text) {
  const out = [];
  const re = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
  let m;
  while ((m = re.exec(text || ''))) {
    let src = m[2].trim();
    if (src.startsWith('https://sitrifor.ru/')) src = src.slice('https://sitrifor.ru'.length);
    out.push({ alt: m[1] || '', src });
  }
  return out;
}

function stripMdImages(text) {
  return String(text || '')
    .replace(/!\[[^\]]*\]\([^)\s]+\)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function inlineMd(text) {
  return String(text || '')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
      const h = String(href).trim();
      const safe = /^(https?:\/\/|\/|#)/i.test(h) ? h : '#';
      const rel = safe.startsWith('http') ? ' target="_blank" rel="noopener noreferrer"' : '';
      // label already escaped by caller when needed; keep plain text here for nested use
      return `<a href="${safe.replace(/"/g, '&quot;')}"${rel}>${label}</a>`;
    })
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function linkifyHtml(html) {
  const healed = healBrokenHttpUrls(String(html || ''));
  return healed.replace(/(https?:\/\/[^\s<&]+)/g, (url) => {
    const clean = url.replace(/[.,;:!?)]+$/, '');
    const trail = url.slice(clean.length);
    return `<a href="${clean}" target="_blank" rel="noopener noreferrer">${clean}</a>${trail}`;
  });
}

/** Parse `[label](href)` or plain URL from a list line. */
export function parseRelatedLink(raw) {
  const s = String(raw || '').trim();
  const md = s.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
  if (md) {
    const href = md[2].trim();
    if (!/^(https?:\/\/|\/|#)/i.test(href)) return null;
    return { label: md[1].trim(), href };
  }
  const html = s.match(/^<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>$/i);
  if (html) {
    return { label: html[2].replace(/<[^>]+>/g, '').trim(), href: html[1].trim() };
  }
  return null;
}

export function isRelatedSectionTitle(text) {
  return /Ещё на Sitrifor|Еще на Sitrifor|Читайте также|More on Sitrifor|Also on Sitrifor|Auch auf Sitrifor/i.test(
    String(text || '')
  );
}

/** marked does not treat «•» as list markers - normalize to «- ». */
function normalizeMdLists(text) {
  return String(text || '').replace(/^([ \t]*)[•●]\s+/gm, '$1- ');
}

function stripBuySectionMd(body) {
  return String(body || '')
    .replace(/\n##\s*(Где купить|Where to buy|Wo kaufen)[\s\S]*?(?=\n##\s|\n_[^\n]*$|$)/gi, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Drop price section from body when shown in the top product card. */
function stripPriceSectionMd(body) {
  return String(body || '')
    .replace(/\n##\s*Цены[^\n]*\n[\s\S]*?(?=\n##\s|\n_[^\n]*$|$)/gi, '\n')
    .replace(/\n##\s*(Prices|Preise)[^\n]*\n[\s\S]*?(?=\n##\s|\n_[^\n]*$|$)/gi, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Parse price rows from review summary / body.
 * Examples: «Цены: 5 шт: 210 руб.; 10 шт: 420 руб.» or «- 5 шт - 210 руб.»
 */
export function parseReviewPrices(article = {}) {
  const text = `${article.summary || ''}\n${article.body || ''}`;
  const out = [];
  const seen = new Set();
  const push = (label, price) => {
    const l = String(label || '').trim();
    const p = String(price || '')
      .trim()
      .replace(/\.{2,}$/g, '.')
      .replace(/\s+/g, ' ');
    if (!l || !p || seen.has(l.toLowerCase())) return;
    seen.add(l.toLowerCase());
    out.push({ label: l, price: p });
  };

  const line = text.match(/(?:Цены|Prices|Preise):\s*([^\n]+)/i);
  if (line) {
    for (const part of line[1].split(/;\s*/)) {
      const m = part.match(/^(.+?):\s*(.+)$/);
      if (m) push(m[1], m[2]);
    }
  }

  const sec = text.match(/##\s*Цены[^\n]*\n([\s\S]*?)(?=\n##\s|\n_[^\n]*$|$)/i);
  if (sec) {
    for (const raw of sec[1].split('\n')) {
      const row = raw.replace(/^[-•*]\s*/, '').trim();
      if (!row) continue;
      const m = row.match(/^(.+?)\s+[–\-—]\s+(.+)$/) || row.match(/^(.+?):\s*(.+)$/);
      if (m) push(m[1], m[2]);
    }
  }
  return out.slice(0, 8);
}

function productDisplayName(article = {}, lang = 'ru') {
  const raw = String(article.title || '').trim();
  return raw
    .replace(/^(Обзор для мастера|Review for the artist|Review für Meister):\s*/i, '')
    .trim() || raw;
}

function productShortDescription(article = {}) {
  let s = String(article.summary || '').trim();
  s = s.replace(/\s*(?:Цены|Prices|Preise):\s*[^\n]+/i, '').trim();
  if (s.length >= 40) return s.slice(0, 320);
  const body = stripBuySectionMd(stripPriceSectionMd(String(article.body || '')));
  const first = body
    .split(/\n+/)
    .map((l) => l.trim())
    .find((l) => l && !/^#/.test(l) && !/^[-•*]/.test(l));
  return (first || s || '').slice(0, 320);
}

function productCardImages(article = {}) {
  const imgs = [];
  const push = (src, alt = '') => {
    if (!src || imgs.some((i) => i.src === src)) return;
    imgs.push({ src, alt });
  };
  if (article.imageUrl && !/placeholder/i.test(String(article.imageUrl))) {
    push(String(article.imageUrl), productDisplayName(article));
  }
  for (const im of extractMdImages(article.body || '')) {
    if (/^https?:\/\//i.test(im.src) || im.src.startsWith('/img/')) push(im.src, im.alt || '');
  }
  return imgs.slice(0, 4);
}

/**
 * Extract shop CTAs. Body format:
 *   - Label: https://...
 * Also heals spaced domains from older polish bugs.
 */
function extractBuyLinksFromArticle(article = {}, lang = 'ru') {
  const pack = ui(lang);
  const links = [];
  const seen = new Set();
  const push = (label, url, primary) => {
    const healed = healBrokenHttpUrls(String(url || '').trim()).replace(/[.,;)]+$/, '');
    if (!healed || !/^https?:\/\//i.test(healed) || seen.has(healed)) return;
    seen.add(healed);
    links.push({ label, url: healed, primary: Boolean(primary) });
  };

  if (article.url && /tattoomarket\.ru/i.test(article.url)) {
    push('TattooMarket', article.url, true);
  }

  const body = healBrokenHttpUrls(String(article.body || ''));
  const shopSection = body.match(/##\s*(Где купить|Where to buy|Wo kaufen)([\s\S]*?)(?=\n##\s|\n_|$)/i);
  const chunk = shopSection ? shopSection[2] : body;
  const re = /(?:^|\n)\s*(?:[-•*])?\s*(TattooMarket|Ozon|Wildberries|Яндекс Маркет|Yandex Market)\s*:\s*(https?:\/\/[^\s\n]+(?:[ \t]+[^\s\n]+)*)/gi;
  let m;
  while ((m = re.exec(chunk))) {
    push(m[1], m[2], /tattoomarket/i.test(m[1]));
  }

  const q = encodeURIComponent(
    String(article.title || '')
      .replace(/^(Обзор для мастера|Review for the artist|Review für Meister):\s*/i, '')
      .slice(0, 100)
  );
  if (!links.some((l) => /ozon/i.test(l.label))) {
    push('Ozon', `https://www.ozon.ru/search/?text=${q}`);
  }
  if (!links.some((l) => /wildberries/i.test(l.label))) {
    push('Wildberries', `https://www.wildberries.ru/catalog/0/search.aspx?search=${q}`);
  }
  if (!links.some((l) => /яндекс|yandex/i.test(l.label))) {
    push(pack.yandex, `https://market.yandex.ru/search?text=${q}`);
  }
  return links;
}

function healBrokenHttpUrls(text = '') {
  return String(text || '').replace(
    /https?:\/\/(?:[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%\-]| (?=[A-Za-z0-9%._~+\-?=&#/]))+/g,
    (raw) => {
      const compact = raw.replace(/ /g, '');
      try {
        const u = new URL(compact);
        u.hostname = u.hostname.toLowerCase();
        return u.toString();
      } catch {
        return compact;
      }
    }
  );
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function detectTheme(article) {
  const type = String(article.articleType || '');
  const reasons = Array.isArray(article.usefulReasons) ? article.usefulReasons.join(' ') : '';
  const key = `${article.sourceKey || ''} ${type} ${article.title || ''} ${article.guid || ''} ${reasons}`;

  if (
    type === 'birthday_tattoo' ||
    /birthday_tattoo|format:birthday|bday-\d{2}-\d{2}/i.test(key) ||
    /татуировки принесут удачу|идеи тату для даты|родившимся \d{2}\.\d{2}/i.test(article.title || '')
  ) {
    return 'birthday';
  }
  // App theme: only explicit 634 / app-store cues – not all sitrifor-daily-ai posts
  if (
    /app.?store|приложение 634|sitrifor-daily(?!-ai)/i.test(key) ||
    /\/img\/app\//.test(article.body || '') ||
    (type === 'editorial' && /634|app store/i.test(article.title || ''))
  ) {
    return 'app';
  }
  if (type === 'review' || article.sourceKey === 'tattoomarket-reviews') return 'review';
  if (type === 'editor_sarcasm' || article.sourceKey === 'sitrifor-editor') return 'editor';
  if (type === 'social_playbook' || /social/i.test(type)) return 'social';
  return 'editorial';
}

function kickerFor(theme, article, lang = 'ru') {
  const pack = ui(lang);
  if (theme === 'app') return pack.release;
  if (theme === 'review') return pack.review;
  if (theme === 'editor') return pack.editor;
  if (theme === 'social') return pack.social;
  if (theme === 'birthday') return pack.birthday;
  const cat = (article.categories || [])[0];
  const map = {
    tools: pack.tools,
    studio: pack.studio,
    clients: pack.clients,
    for_clients: pack.for_clients || pack.birthday,
    gear: pack.gear,
    pigments: pack.pigments,
    culture: pack.culture,
    ideas: pack.ideas
  };
  return map[cat] || pack.editorial;
}

function findPullQuote(tokens) {
  const paras = tokens.filter((t) => t.type === 'paragraph').map((t) => t.text || '');
  for (const p of paras.slice(1)) {
    const plain = stripMdImages(p).replace(/\*\*/g, '').trim();
    if (plain.length >= 70 && plain.length <= 180 && !/^https?:/.test(plain) && !plain.includes('•')) {
      return plain;
    }
  }
  return null;
}

/**
 * Compose magazine layout JSON for an article payload (mapped article).
 */
export function composeMagazineLayout(article = {}) {
  const theme = detectTheme(article);
  const lang = article.displayLang || 'ru';
  const pack = ui(lang);
  const rawBody = String(article.body || article.summary || '');
  const bodyForLex =
    theme === 'review'
      ? stripPriceSectionMd(stripBuySectionMd(rawBody))
      : rawBody;
  const body = normalizeMdLists(healBrokenHttpUrls(bodyForLex));
  const bodyClean = stripMdImages(body);
  const inlineImgs = extractMdImages(rawBody)
    .filter((i) => i.src.startsWith('/img/') || /^https?:\/\/sitrifor\.ru\/img\//i.test(i.src))
    .map((i) => ({
      ...i,
      src: String(i.src).replace(/^https?:\/\/sitrifor\.ru/i, '')
    }))
    .filter((i) => publicExists(i.src));
  const tokens = marked.lexer(bodyClean);
  const seed = Number(article.id || 0) || String(article.slug || '').length;
  const topicArt = pickTopicArt(article.categories || [], seed);

  const blocks = [];
  const birthdayFrames =
    theme === 'birthday'
      ? inlineImgs.slice(0, 4).map((img) => ({ src: img.src, alt: img.alt || '' }))
      : [];

  // Prefer generated Sitrifor collage banner when present on disk / in imageUrl
  let heroSrc =
    theme === 'app' && publicExists('/img/news/covers/634-app-store.jpg')
      ? '/img/news/covers/634-app-store.jpg'
      : article.imageUrl && !String(article.imageUrl).includes('placeholder')
        ? article.imageUrl
        : topicArt;

  if (theme === 'birthday') {
    const reasons = Array.isArray(article.usefulReasons) ? article.usefulReasons : [];
    const slugHint = reasons.find((r) => String(r).startsWith('topic:bday-'));
    const topicId = slugHint ? String(slugHint).slice(6) : null;
    if (topicId && publicExists(`/img/news/birthday/banners/${topicId}.jpg`)) {
      heroSrc = `/img/news/birthday/banners/${topicId}.jpg`;
    } else if (article.imageUrl && /\/img\/news\/birthday\/banners\//.test(String(article.imageUrl))) {
      heroSrc = String(article.imageUrl).replace(/^https?:\/\/sitrifor\.ru/i, '');
    }

    const heroOk = heroSrc && publicExists(String(heroSrc).replace(/^https?:\/\/sitrifor\.ru/i, ''));
    if (!heroOk || birthdayFrames.length < 2) {
      // Prefer generated service banner, else static care card / app cover
      if (topicId && publicExists(`/img/news/birthday/banners/${topicId}.jpg`)) {
        heroSrc = `/img/news/birthday/banners/${topicId}.jpg`;
      } else if (publicExists('/img/marketing/card-care.jpg')) {
        heroSrc = '/img/marketing/card-care.jpg';
      } else if (publicExists('/img/news/covers/634-app-store.jpg')) {
        heroSrc = '/img/news/covers/634-app-store.jpg';
      }
    }
  }

  const birthdayCareFallback = theme === 'birthday' && birthdayFrames.length < 2;

  if (theme !== 'review') {
    blocks.push({
      type: 'hero',
      variant:
        theme === 'app'
          ? 'phones'
          : theme === 'birthday'
            ? 'birthday'
            : 'editorial',
      image: heroSrc,
      phones: theme === 'app' ? APP_SHOTS.slice(0, 4) : undefined,
      frames: birthdayFrames.length >= 2 ? birthdayFrames : undefined,
      brand: theme === 'birthday' ? 'SITRIFOR' : undefined,
      kickerOverlay: theme === 'birthday'
        ? birthdayCareFallback
          ? pack.careHeroKicker ||
            (lang === 'en'
              ? 'Care & prep before your session'
              : lang === 'de'
                ? 'Pflege & Vorbereitung'
                : 'Уход и подготовка к тату')
          : kickerFor(theme, article, lang)
        : undefined,
      href: birthdayCareFallback ? '/masters#care' : undefined,
      promoCare: birthdayCareFallback
    });
  }

  blocks.push({ type: 'kicker', text: kickerFor(theme, article, lang) });
  blocks.push({ type: 'title', text: article.title || '' });
  if (article.summary && theme !== 'review') blocks.push({ type: 'deck', text: article.summary });
  blocks.push({
    type: 'byline',
    source: article.sourceName || 'Sitrifor',
    date: (article.publishedAt || '').slice(0, 10),
    views: article.views || 0
  });

  // Review: product card (photo, short desc, prices, buy) sits above the longform article
  if (theme === 'review') {
    const buyLinks = extractBuyLinksFromArticle(article, lang);
    const prices = parseReviewPrices(article);
    const images = productCardImages(article);
    blocks.push({
      type: 'productCard',
      name: productDisplayName(article, lang),
      description: productShortDescription(article),
      image: images[0]?.src || article.imageUrl || null,
      images,
      prices,
      buyTitle: pack.buyTitle,
      links: buyLinks,
      href: article.url || buyLinks.find((l) => l.primary)?.url || null
    });
  }

  let leadDone = false;
  let chapterCount = 0;
  let pullInserted = false;
  let relatedPending = null;
  const pull = findPullQuote(tokens);
  const midChapter = Math.max(1, Math.floor(tokens.filter((t) => t.type === 'heading').length / 2));

  for (const tok of tokens) {
    if (tok.type === 'heading') {
      if (isRelatedSectionTitle(tok.text)) {
        relatedPending = tok.text;
        continue;
      }
      relatedPending = null;
      chapterCount += 1;
      blocks.push({ type: 'chapter', text: tok.text, level: tok.depth || 2 });

      // Insert gallery after first visual chapter for app theme
      if (theme === 'app' && /выглядит|screens|экран/i.test(tok.text) && inlineImgs.length) {
        blocks.push({
          type: 'gallery',
          variant: 'phones',
          images: inlineImgs.length >= 4 ? inlineImgs : APP_SHOTS
        });
        continue;
      }

      // Birthday tattoo gallery under the examples heading
      if (theme === 'birthday' && /примеры|референс|examples|galerie|подготовка и уход|care & prep/i.test(tok.text)) {
        if (inlineImgs.length >= 2 && !blocks.some((b) => b.type === 'gallery')) {
          blocks.push({
            type: 'gallery',
            variant: 'tattoos',
            images: inlineImgs.filter((i) => !/card-care/i.test(i.src))
          });
        } else if (
          (inlineImgs.length < 2 || /подготовка и уход|care/i.test(tok.text)) &&
          !blocks.some((b) => b.type === 'cta' && b.variant === 'care')
        ) {
          // Empty examples – promote care / prep instead of blank gallery
          blocks.push({
            type: 'cta',
            variant: 'care',
            title:
              lang === 'en'
                ? 'Prepare for the session with Sitrifor'
                : lang === 'de'
                  ? 'Vorbereitung mit Sitrifor'
                  : 'Подготовка и уход с Sitrifor',
            text:
              lang === 'en'
                ? 'No matching photo examples this time – use checklists for prep and aftercare in the app and on the site.'
                : lang === 'de'
                  ? 'Keine passenden Foto-Beispiele – Checklisten für Vorbereitung und Pflege in der App und auf der Website.'
                  : 'Подходящих фото-примеров сейчас нет – возьмите чек-листы подготовки к сеансу и ухода после в приложении и на сайте.',
            href: '/masters#care',
            label:
              lang === 'en' ? 'Open care guides' : lang === 'de' ? 'Zur Pflege' : 'Открыть блок ухода',
            image: publicExists('/img/marketing/card-care.jpg') ? '/img/marketing/card-care.jpg' : undefined
          });
        }
        continue;
      }

      // Mid-article atmospheric figure for editorial
      if (
        theme === 'editorial' &&
        chapterCount === midChapter &&
        topicArt &&
        topicArt !== heroSrc
      ) {
        blocks.push({
          type: 'figure',
          src: topicArt,
          caption: '',
          variant: 'bleed'
        });
      }
      continue;
    }

    if (tok.type === 'paragraph') {
      relatedPending = null;
      const text = stripMdImages(tok.text || '').trim();
      if (!text) continue;
      // Review product card already shows the short pitch – skip duplicate lead
      if (theme === 'review' && !leadDone) {
        const cardDesc = productShortDescription(article);
        if (cardDesc && text.slice(0, 72) === cardDesc.slice(0, 72)) {
          leadDone = true;
          continue;
        }
      }
      if (!leadDone) {
        blocks.push({ type: 'lead', text, html: linkifyHtml(inlineMd(esc(text))), dropCap: true });
        leadDone = true;
        continue;
      }
      blocks.push({ type: 'prose', text, html: linkifyHtml(inlineMd(esc(text))) });

      if (!pullInserted && pull && chapterCount >= 1 && text !== pull) {
        blocks.push({ type: 'pullquote', text: pull });
        pullInserted = true;
      }
      continue;
    }

    if (tok.type === 'list') {
      const items = (tok.items || []).map((it) => stripMdImages(it.text || '').trim()).filter(Boolean);
      if (!items.length) {
        relatedPending = null;
        continue;
      }
      if (relatedPending) {
        const links = items.map(parseRelatedLink).filter(Boolean);
        if (links.length) {
          blocks.push({
            type: 'related',
            title: relatedPending,
            links
          });
        } else {
          // Fallback: keep as list with real anchors
          blocks.push({ type: 'chapter', text: relatedPending, level: 2 });
          blocks.push({
            type: 'list',
            ordered: Boolean(tok.ordered),
            items: items.map((t) => ({ text: t, html: linkifyHtml(inlineMd(esc(t))) }))
          });
        }
        relatedPending = null;
        continue;
      }
      blocks.push({
        type: 'list',
        ordered: Boolean(tok.ordered),
        items: items.map((t) => ({ text: t, html: linkifyHtml(inlineMd(esc(t))) }))
      });
      continue;
    }

    if (tok.type === 'blockquote') {
      const q = stripMdImages(tok.text || tok.raw || '').replace(/^>\s?/gm, '').trim();
      if (q) blocks.push({ type: 'pullquote', text: q });
      continue;
    }

    if (tok.type === 'hr') {
      blocks.push({ type: 'divider' });
    }
  }

  // If app theme and no gallery yet, append phone gallery
  if (theme === 'app' && !blocks.some((b) => b.type === 'gallery')) {
    const imgs = inlineImgs.length >= 3 ? inlineImgs : APP_SHOTS;
    // insert before last outro-ish blocks
    const ctaIdx = blocks.findIndex((b) => b.type === 'chapter' && /начать|скачать|зачем/i.test(b.text || ''));
    const gallery = { type: 'gallery', variant: 'phones', images: imgs };
    if (ctaIdx > 0) blocks.splice(ctaIdx, 0, gallery);
    else blocks.push(gallery);
  }

  // Birthday: ensure swipe gallery from inline images
  if (theme === 'birthday' && inlineImgs.length >= 2 && !blocks.some((b) => b.type === 'gallery')) {
    const discussIdx = blocks.findIndex(
      (b) => b.type === 'chapter' && /обсудить|мастер|важно|how to|Wichtig/i.test(b.text || '')
    );
    const gallery = { type: 'gallery', variant: 'tattoos', images: inlineImgs };
    if (discussIdx > 0) blocks.splice(discussIdx, 0, gallery);
    else {
      const importantIdx = blocks.findIndex((b) => b.type === 'chapter' && /важно|important|Wichtig/i.test(b.text || ''));
      if (importantIdx > 0) blocks.splice(importantIdx, 0, gallery);
      else blocks.push(gallery);
    }
  }

  // Birthday without photos: care CTA near the end if not already inserted
  if (
    theme === 'birthday' &&
    inlineImgs.length < 2 &&
    !blocks.some((b) => b.type === 'cta' && b.variant === 'care')
  ) {
    const discussIdx = blocks.findIndex(
      (b) => b.type === 'chapter' && /обсудить|мастер|важно|how to|Wichtig/i.test(b.text || '')
    );
    const careCta = {
      type: 'cta',
      variant: 'care',
      title: lang === 'en' ? 'Care & prep with Sitrifor' : 'Уход и подготовка с Sitrifor',
      text:
        lang === 'en'
          ? 'Checklists before the session and aftercare tips – in the app and on the site.'
          : 'Чек-листы до сеанса и уход после – в приложении и на сайте Sitrifor.',
      href: '/masters#care',
      label: lang === 'en' ? 'Open care guides' : 'Открыть блок ухода',
      image: publicExists('/img/marketing/card-care.jpg') ? '/img/marketing/card-care.jpg' : undefined
    };
    if (discussIdx > 0) blocks.splice(discussIdx, 0, careCta);
    else blocks.push(careCta);
  }

  // CTA / buy band
  if (theme === 'app') {
    blocks.push({
      type: 'cta',
      title: pack.ctaAppTitle,
      text: pack.ctaAppText,
      href: 'https://apps.apple.com/ru/app/634/id6795944683',
      label: pack.ctaAppLabel
    });
  } else if (theme === 'review') {
    // Buy CTAs live in the top productCard – do not duplicate at the bottom
  }

  // Hub links as buttons (from body «Ещё на Sitrifor» or SEO internalLinks)
  if (!blocks.some((b) => b.type === 'related')) {
    const seoLinks = article.seo?.internalLinks || article.internalLinks || [];
    if (seoLinks.length) {
      blocks.push({
        type: 'related',
        title:
          lang === 'en' ? 'More on Sitrifor' : lang === 'de' ? 'Auch auf Sitrifor' : 'Ещё на Sitrifor',
        links: seoLinks.map((l) => ({ label: l.label, href: l.href })).filter((l) => l.label && l.href)
      });
    }
  }

  return {
    version: 1,
    theme,
    readingMinutes: Math.max(1, Math.round((bodyClean.split(/\s+/).filter(Boolean).length || 1) / 160)),
    blocks
  };
}

export function magazineEnabled() {
  return process.env.NEWS_MAGAZINE !== '0';
}
