/**
 * Server-side HTML for /news/a/:slug - crawlable title/canonical/body/JSON-LD.
 * Progressive enhancement: embeds window.__NEWS_SSR__ for client hydrate.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { absoluteImageUrl, normalizeDashes } from './fields.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(__dirname, '../../public');
const SITE = 'https://sitrifor.ru';
const ASSET_V = {
  newsCss: '16',
  magCss: '9',
  articleJs: '24',
  i18nDict: '33',
  i18n: '4',
  landing: 'menu10'
};

let shellCache = null;

function loadShell() {
  if (shellCache) return shellCache;
  const p = path.join(PUBLIC, 'news-article.html');
  shellCache = fs.readFileSync(p, 'utf8');
  return shellCache;
}

export function invalidateShellCache() {
  shellCache = null;
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(s) {
  return esc(s).replace(/'/g, '&#39;');
}

function parseRelatedMdLink(raw) {
  const s = String(raw || '').trim();
  const md = s.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
  if (md && /^(https?:\/\/|\/|#)/i.test(md[2].trim())) {
    return { label: md[1].trim(), href: md[2].trim() };
  }
  return null;
}

function isRelatedHeading(text) {
  return /Ещё на Sitrifor|Еще на Sitrifor|Читайте также|More on Sitrifor|Also on Sitrifor|Auch auf Sitrifor/i.test(
    String(text || '')
  );
}

/** Minimal markdown → HTML for crawlers (paragraphs, headings, lists, links, images). */
export function bodyToHtml(text) {
  const normalized = normalizeDashes(String(text || ''))
    .replace(/\r\n/g, '\n')
    .replace(/^([ \t]*)[•●]\s+/gm, '$1- ');

  const blocks = [];
  let para = [];
  let list = null;
  let pendingRelated = null;

  const flushPara = () => {
    if (!para.length) return;
    const chunk = para.join('\n').trim();
    para = [];
    if (!chunk) return;
    blocks.push(inlineFormat(chunk));
  };
  const flushList = () => {
    if (!list?.length) {
      list = null;
      return;
    }
    if (pendingRelated) {
      const links = list.map(parseRelatedMdLink).filter(Boolean);
      if (links.length) {
        blocks.push(internalLinksHtml(links, pendingRelated));
      } else {
        blocks.push(`<h3>${esc(pendingRelated)}</h3>`);
        blocks.push(`<ul>${list.map((li) => `<li>${inlineFormat(li)}</li>`).join('')}</ul>`);
      }
      pendingRelated = null;
      list = null;
      return;
    }
    blocks.push(`<ul>${list.map((li) => `<li>${inlineFormat(li)}</li>`).join('')}</ul>`);
    list = null;
  };

  for (const line of normalized.split('\n')) {
    const t = line.trim();
    if (!t) {
      flushPara();
      flushList();
      continue;
    }
    const h = t.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      flushPara();
      flushList();
      if (isRelatedHeading(h[2])) {
        pendingRelated = h[2];
        continue;
      }
      pendingRelated = null;
      const level = Math.min(3, h[1].length) + 1; // ## → h3 under article h1
      blocks.push(`<h${level}>${inlineFormat(h[2])}</h${level}>`);
      continue;
    }
    const li = t.match(/^[-*]\s+(.+)$/);
    if (li) {
      flushPara();
      if (!list) list = [];
      list.push(li[1]);
      continue;
    }
    const img = t.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (img) {
      flushPara();
      flushList();
      pendingRelated = null;
      let src = img[2].trim();
      if (src.startsWith('https://sitrifor.ru/')) src = src.slice('https://sitrifor.ru'.length);
      if (src.startsWith('/img/')) {
        blocks.push(
          `<figure class="news-article__shot"><img src="${escAttr(src)}" alt="${escAttr(img[1])}" loading="lazy" decoding="async"></figure>`
        );
      }
      continue;
    }
    flushList();
    pendingRelated = null;
    para.push(t);
  }
  flushPara();
  flushList();

  return blocks
    .map((b) => {
      if (typeof b === 'string' && b.startsWith('<')) return b;
      return `<p>${b}</p>`;
    })
    .join('\n');
}

function inlineFormat(chunk) {
  let s = esc(chunk);
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const h = String(href).trim();
    const safe = /^(https?:\/\/|\/)/i.test(h) ? h : '#';
    const rel = safe.startsWith('http') ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a href="${escAttr(safe)}"${rel}>${label}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(https?:\/\/[^\s<&]+)/g, (url) => {
    const clean = url.replace(/[.,;:!?)]+$/, '');
    const trail = url.slice(clean.length);
    return `<a href="${escAttr(clean)}" target="_blank" rel="noopener noreferrer">${esc(clean)}</a>${trail}`;
  });
  return s;
}

function internalLinksHtml(links, title = 'Ещё на Sitrifor') {
  if (!links?.length) return '';
  return `<nav class="news-article__related" aria-label="${escAttr(title)}">
      <h2 class="news-article__related-title">${esc(title)}</h2>
      <div class="news-article__related-row">
        ${links
          .map((l) => {
            const href = String(l.href || '#');
            const ext = /^https?:\/\//i.test(href);
            return `<a class="news-article__related-btn" href="${escAttr(href)}"${
              ext ? ' target="_blank" rel="noopener noreferrer"' : ''
            }>${esc(l.label || href)}</a>`;
          })
          .join('\n')}
      </div>
    </nav>`;
}

function articleMainHtml(article) {
  const seo = article.seo || {};
  const date = (article.publishedAt || '').slice(0, 10);
  const title = normalizeDashes(seo.title || article.title || 'Новость');
  let body = article.body || article.summary || '';
  const img = article.imageUrl ? absoluteImageUrl(article.imageUrl) : '';
  const alt = seo.imageAlt || title;
  const links = seo.internalLinks || [];
  const isReview =
    article.articleType === 'review' ||
    article.sourceKey === 'tattoomarket-reviews' ||
    /product_review/i.test(JSON.stringify(article.usefulReasons || []));
  // Avoid duplicating related block if already in body
  const showLinks = links.length && !/Ещё на Sitrifor|Читайте также/i.test(body);

  let productTop = '';
  if (isReview) {
    body = String(body)
      .replace(/\n##\s*(Где купить|Where to buy|Wo kaufen)[\s\S]*?(?=\n##\s|\n_[^\n]*$|$)/gi, '\n')
      .replace(/\n##\s*Цены[^\n]*\n[\s\S]*?(?=\n##\s|\n_[^\n]*$|$)/gi, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    // Lightweight SSR product card (client magazine replaces on hydrate)
    const name = title.replace(/^(Обзор для мастера|Review for the artist|Review für Meister):\s*/i, '');
    const desc = String(article.summary || '')
      .replace(/\s*(?:Цены|Prices|Preise):\s*[^\n]+/i, '')
      .trim()
      .slice(0, 320);
    const buyMatch = String(article.body || '').match(
      /##\s*(Где купить|Where to buy|Wo kaufen)([\s\S]*?)(?=\n##\s|\n_|$)/i
    );
    const buyChunk = buyMatch ? buyMatch[2] : '';
    const buyLinks = [];
    const re =
      /(?:^|\n)\s*(?:[-•*])?\s*(TattooMarket|Ozon|Wildberries|Яндекс Маркет|Yandex Market)\s*:\s*(https?:\/\/[^\s\n]+)/gi;
    let m;
    while ((m = re.exec(buyChunk || article.body || ''))) {
      buyLinks.push({ label: m[1], href: m[2], primary: /tattoomarket/i.test(m[1]) });
    }
    if (article.url && /tattoomarket/i.test(article.url) && !buyLinks.some((l) => /tattoomarket/i.test(l.label))) {
      buyLinks.unshift({ label: 'TattooMarket', href: article.url, primary: true });
    }
    productTop = `<section class="news-product-card" aria-label="${escAttr(name)}">
      ${
        img
          ? `<div class="news-product-card__media"><figure class="news-product-card__shot"><img src="${escAttr(
              img.startsWith('http') && img.includes('sitrifor.ru')
                ? img.replace(/^https?:\/\/sitrifor\.ru/, '')
                : img
            )}" alt="${escAttr(alt)}" loading="eager" decoding="async" referrerpolicy="no-referrer"></figure></div>`
          : ''
      }
      <div class="news-product-card__copy">
        <h2 class="news-product-card__name">${esc(name)}</h2>
        ${desc ? `<p class="news-product-card__desc">${esc(desc)}</p>` : ''}
        ${
          buyLinks.length
            ? `<div class="news-product-card__buy"><h3 class="news-buy__title">Где купить</h3><div class="news-buy__row">${buyLinks
                .map(
                  (l) =>
                    `<a class="news-buy__btn${l.primary ? ' news-buy__btn--primary' : ''}" href="${escAttr(
                      l.href
                    )}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a>`
                )
                .join('')}</div></div>`
            : ''
        }
      </div>
    </section>`;
  }

  return `
    <a class="news-article__back" href="/news?date=${escAttr(date)}">← К ленте</a>
    <div class="news-article__meta">
      <span>${esc(article.sourceName || 'Sitrifor')}</span>
      <span>${esc(date)}</span>
      <span class="news-views" data-news-views>${esc(String(article.views || 0))}</span>
    </div>
    <h1 class="news-article__title">${esc(title)}</h1>
    ${productTop}
    ${
      !isReview && img
        ? `<figure class="news-article__figure"><img src="${escAttr(img.startsWith('http') && img.includes('sitrifor.ru') ? img.replace(/^https?:\/\/sitrifor\.ru/, '') : img)}" alt="${escAttr(alt)}" loading="eager" decoding="async" referrerpolicy="no-referrer"></figure>`
        : ''
    }
    <div class="news-article__body" data-ssr-body>${bodyToHtml(body)}</div>
    ${showLinks ? internalLinksHtml(links) : ''}
    <p class="news-article__source">Источник: ${esc(article.sourceName || 'Sitrifor')}</p>
  `.trim();
}

function hreflangTags(article, canonical) {
  const avail = article.localeAvailability || {};
  // Only emit alternates when real EN/DE translations exist (no fake locales).
  if (!avail.en && !avail.de) return '';
  const base = canonical.split('?')[0];
  const tags = [
    `<link rel="alternate" hreflang="ru" href="${escAttr(base)}">`,
    `<link rel="alternate" hreflang="x-default" href="${escAttr(base)}">`
  ];
  if (avail.en) {
    tags.push(`<link rel="alternate" hreflang="en" href="${escAttr(`${base}?lang=en`)}">`);
  }
  if (avail.de) {
    tags.push(`<link rel="alternate" hreflang="de" href="${escAttr(`${base}?lang=de`)}">`);
  }
  return `\n  ${tags.join('\n  ')}`;
}

function headTags(article) {
  const seo = article.seo || {};
  const title = normalizeDashes(seo.title || article.title || 'Новость');
  const pageTitle = `${title} | Sitrifor`;
  const desc = normalizeDashes(seo.description || article.summary || title).slice(0, 160);
  const canonical = seo.canonical || `${SITE}/news/a/${article.slug}`;
  const ogImage = absoluteImageUrl(seo.ogImage || article.imageUrl);
  const robots = seo.robots || 'index, follow';
  const jsonLd = seo.jsonLd || {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: title,
    description: desc,
    datePublished: article.publishedAt,
    mainEntityOfPage: canonical
  };

  return {
    pageTitle,
    desc,
    canonical,
    ogImage,
    robots,
    jsonLd,
    ogTitle: seo.ogTitle || title,
    ogDescription: seo.ogDescription || desc,
    twitterCard: seo.twitterCard || 'summary_large_image',
    imageAlt: seo.imageAlt || title,
    hreflang: hreflangTags(article, canonical)
  };
}

/**
 * @returns {{ status: number, html: string, contentType: string }}
 */
export function renderArticleSsr(article) {
  if (!article) {
    return {
      status: 404,
      contentType: 'text/html; charset=utf-8',
      html: renderNotFound()
    };
  }

  const head = headTags(article);
  const main = articleMainHtml(article);
  const payload = JSON.stringify(article).replace(/</g, '\\u003c');

  let html = loadShell();

  // Bump assets in SSR output
  html = html
    .replace(/news\.css\?v=\d+/, `news.css?v=${ASSET_V.newsCss}`)
    .replace(/news-magazine\.css\?v=\d+/, `news-magazine.css?v=${ASSET_V.magCss}`)
    .replace(/news-article\.js\?v=\d+/, `news-article.js?v=${ASSET_V.articleJs}`);

  html = html.replace(
    /<meta name="description" content="[^"]*">/,
    `<meta name="description" content="${escAttr(head.desc)}">`
  );
  html = html.replace(
    /<meta name="robots" content="[^"]*">/,
    `<meta name="robots" content="${escAttr(head.robots)}">`
  );
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(head.pageTitle)}</title>`);
  html = html.replace(
    /<link rel="canonical" href="[^"]*">/,
    `<link rel="canonical" href="${escAttr(head.canonical)}">${head.hreflang || ''}`
  );

  // OG / Twitter
  const avail = article.localeAvailability || {};
  const ogLocaleAlts = [];
  if (avail.en) ogLocaleAlts.push('<meta property="og:locale:alternate" content="en_US">');
  if (avail.de) ogLocaleAlts.push('<meta property="og:locale:alternate" content="de_DE">');
  const ogBlock = `
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="Sitrifor">
  <meta property="og:title" content="${escAttr(head.ogTitle)}">
  <meta property="og:description" content="${escAttr(head.ogDescription)}">
  <meta property="og:url" content="${escAttr(head.canonical)}">
  <meta property="og:image" content="${escAttr(head.ogImage)}">
  <meta property="og:locale" content="ru_RU">
  ${ogLocaleAlts.join('\n  ')}
  <meta name="twitter:card" content="${escAttr(head.twitterCard)}">
  <meta name="twitter:title" content="${escAttr(head.ogTitle)}">
  <meta name="twitter:description" content="${escAttr(head.ogDescription)}">
  <meta name="twitter:image" content="${escAttr(head.ogImage)}">
  <meta name="twitter:image:alt" content="${escAttr(head.imageAlt)}">
  <script type="application/ld+json">${JSON.stringify(head.jsonLd).replace(/</g, '\\u003c')}</script>`;

  html = html.replace(
    /<meta property="og:type" content="article">\s*<meta property="og:site_name" content="Sitrifor">\s*<meta property="og:image" content="[^"]*">/,
    ogBlock.trim()
  );

  html = html.replace(
    /<main class="container news-article" data-news-article>[\s\S]*?<\/main>/,
    `<main class="container news-article" data-news-article data-ssr="1">\n${main}\n  </main>`
  );

  // Inject hydrate payload before article script
  html = html.replace(
    /<script src="\/js\/news-article\.js[^"]*"><\/script>/,
    `<script>window.__NEWS_SSR__=${payload};</script>\n  <script src="/js/news-article.js?v=${ASSET_V.articleJs}" defer></script>`
  );

  return {
    status: 200,
    contentType: 'text/html; charset=utf-8',
    html
  };
}

function renderNotFound() {
  const notFoundPath = path.join(PUBLIC, '404.html');
  let base = '';
  try {
    base = fs.readFileSync(notFoundPath, 'utf8');
  } catch {
    base = `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><title>404 | Sitrifor</title></head><body><h1>Страница не найдена</h1></body></html>`;
  }
  // Prefer noindex for soft misses
  if (!/name="robots"/i.test(base)) {
    base = base.replace(
      /<head>/i,
      '<head>\n  <meta name="robots" content="noindex, follow">'
    );
  } else {
    base = base.replace(
      /<meta name="robots" content="[^"]*">/i,
      '<meta name="robots" content="noindex, follow">'
    );
  }
  return base;
}

export function renderNotFoundSsr() {
  return {
    status: 404,
    contentType: 'text/html; charset=utf-8',
    html: renderNotFound()
  };
}
