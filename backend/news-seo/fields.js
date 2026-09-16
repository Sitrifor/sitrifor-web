/**
 * Rules-based SEO field builders for news articles (no heavy LLM).
 */

const SITE = 'https://sitrifor.ru';
const DEFAULT_OG = `${SITE}/img/marketing/app-card-bg.jpg`;

function clip(s, max) {
  const t = String(s || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.55 ? cut.slice(0, sp) : cut).trim() + '…';
}

/** Prefer short hyphen in RU editorial strings. */
export function normalizeDashes(text) {
  return String(text || '')
    .replace(/\u2014/g, '-') // em
    .replace(/\u2013/g, '-'); // en
}

export function buildSeoTitle(article) {
  const raw = normalizeDashes(article.title || article.titleOriginal || 'Новость');
  // Keep brand in <title> via SSR template; stored field is H1-aligned headline
  return clip(raw, 60);
}

export function buildSeoDescription(article) {
  const raw = normalizeDashes(
    article.summary || article.body || article.title || 'Новость для тату-мастеров на Sitrifor.'
  );
  // Strip markdown noise for meta
  const plain = raw
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#+\s+/gm, '')
    .replace(/[*_`]/g, '');
  return clip(plain, 160);
}

export function buildImageAlt(article) {
  const title = normalizeDashes(article.title || 'Статья Sitrifor');
  const cats = Array.isArray(article.categories) ? article.categories : [];
  const hint =
    cats.includes('gear')
      ? 'техника для тату'
      : cats.includes('pigments')
        ? 'пигменты'
        : cats.includes('clients')
          ? 'тату-мастер и клиенты'
          : 'тату-индустрия';
  return clip(`${title} - ${hint}`, 120);
}

export function absoluteImageUrl(imageUrl) {
  const u = String(imageUrl || '').trim();
  if (!u) return DEFAULT_OG;
  if (u.startsWith('http')) return u;
  if (u.startsWith('/')) return SITE + u;
  return DEFAULT_OG;
}

export function buildJsonLd(article, seo, links) {
  const url = `${SITE}/news/a/${article.slug}`;
  const published = article.publishedAt || new Date().toISOString();
  const modified = seo.optimizedAt || published;
  const image = absoluteImageUrl(article.imageUrl || seo.ogImage);
  return {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: seo.title || article.title,
    description: seo.description,
    image: [image],
    datePublished: published,
    dateModified: modified,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    author: {
      '@type': 'Organization',
      name: article.sourceName || 'Sitrifor',
      url: article.sourceUrl || SITE
    },
    publisher: {
      '@type': 'Organization',
      name: 'Sitrifor',
      url: SITE,
      logo: {
        '@type': 'ImageObject',
        url: `${SITE}/favicon.svg`
      }
    },
    articleSection: Array.isArray(article.categories) ? article.categories.join(', ') : 'industry',
    inLanguage: article.displayLang || article.lang || 'ru',
    isAccessibleForFree: true,
    about: links.slice(0, 3).map((l) => ({
      '@type': 'Thing',
      name: l.label,
      url: l.href.startsWith('http') ? l.href : SITE + l.href
    }))
  };
}

/** Thin / duplicate news that should not compete with hubs in search. */
export function shouldNoindexNews(article = {}) {
  const lang = String(article.displayLang || article.lang || 'ru').slice(0, 2);
  if (lang && lang !== 'ru') return true;
  const title = String(article.title || article.titleOriginal || '');
  if (/принесут удачу|родившимся\s*\d{2}\.\d{2}|гороскоп/i.test(title)) return true;
  const type = String(article.articleType || '');
  if (type === 'birthday_tattoo' || type === 'birthday') return true;
  const reasons = Array.isArray(article.usefulReasons)
    ? article.usefulReasons.join(' ')
    : String(article.usefulReasons || article.useful_reasons || '');
  if (/format:birthday|birthday_tattoo|bday-\d{2}-\d{2}/i.test(reasons)) return true;
  return false;
}

export function buildSeoPackage(article, { internalLinks = [], injectBody = null } = {}) {
  const title = buildSeoTitle(article);
  const description = buildSeoDescription(article);
  const imageAlt = buildImageAlt(article);
  const ogImage = absoluteImageUrl(article.imageUrl);
  const optimizedAt = new Date().toISOString();
  const seoBase = {
    title,
    description,
    imageAlt,
    ogImage,
    optimizedAt,
    robots: shouldNoindexNews(article) ? 'noindex, follow' : 'index, follow',
    ogTitle: title,
    ogDescription: description,
    twitterCard: 'summary_large_image',
    internalLinks
  };
  const jsonLd = buildJsonLd(article, seoBase, internalLinks);
  return {
    seoTitle: title,
    seoDescription: description,
    seoImageAlt: imageAlt,
    seoReady: false, // set after QA
    seoOptimizedAt: optimizedAt,
    body: injectBody,
    meta: {
      robots: shouldNoindexNews(article) ? 'noindex, follow' : 'index, follow',
      ogTitle: title,
      ogDescription: description,
      ogImage,
      twitterCard: 'summary_large_image',
      jsonLd,
      internalLinks,
      canonical: `${SITE}/news/a/${article.slug}`
    }
  };
}
