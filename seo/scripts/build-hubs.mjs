#!/usr/bin/env node
/**
 * Build static SEO hub pages from seo/content/hubs/*.json → public/
 * Usage: node seo/scripts/build-hubs.mjs [--sitemap-only]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const HUBS_DIR = path.join(ROOT, 'seo/content/hubs');
const PUBLIC = path.join(ROOT, 'public');
const SITE = 'https://sitrifor.ru';
const ASSET_V = { guidesCss: '7', landing: 'menu15', i18nDict: '36', i18n: '4', seoContent: '13', tokens: 'fonts2' };

const argv = process.argv.slice(2);
const sitemapOnly = argv.includes('--sitemap-only');

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

function normalizeDashes(s) {
  return String(s || '')
    .replace(/\u2014/g, '-')
    .replace(/\u2013/g, '-');
}

function loadManifest() {
  return JSON.parse(fs.readFileSync(path.join(HUBS_DIR, 'manifest.json'), 'utf8'));
}

function loadHub(file) {
  const data = JSON.parse(fs.readFileSync(path.join(HUBS_DIR, file), 'utf8'));
  for (const k of ['title', 'h1', 'description', 'lead', 'eyebrow']) {
    if (data[k]) data[k] = normalizeDashes(data[k]);
  }
  return data;
}

function chromeHeader(activePath) {
  const isGuides = activePath.startsWith('/guides');
  return `<header class="header">
    <div class="container header__inner">
      <a href="/" class="logo" aria-label="Sitrifor - на главную">
        <svg class="logo-s" data-logo-s width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
          <path d="M26 8C26 8 20 6 14 10C8 14 8 22 14 26C20 30 26 28 26 28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
          <path d="M10 18C10 18 14 14 22 14C30 14 30 22 22 22C14 22 10 18 10 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
        </svg>
        <span class="logo__word">Sitrifor</span>
      </a>
      <span class="header__page-title">${isGuides ? 'Гайды' : 'Sitrifor'}</span>
      <div class="header__actions">
        <button class="menu-toggle" type="button" data-menu-toggle aria-label="Меню" aria-expanded="false" aria-controls="nav-drawer">
          <svg class="menu-toggle__svg" viewBox="0 0 22 16" width="22" height="16" aria-hidden="true" focusable="false">
            <line x1="1" y1="2" x2="21" y2="2"></line>
            <line x1="1" y1="8" x2="21" y2="8"></line>
            <line x1="1" y1="14" x2="21" y2="14"></line>
          </svg>
        </button>
      </div>
    </div>
  </header>
  <div class="nav-drawer" id="nav-drawer" data-nav-drawer hidden>
    <div class="nav-drawer__backdrop" data-nav-drawer-close></div>
    <nav class="nav-drawer__panel" aria-label="Навигация">
      <a href="/" class="nav-drawer__link nav-drawer__link--home" data-nav="home"><span>Главная</span></a>
      <a href="/guides/" class="nav-drawer__link" data-nav="guides">Гайды</a>
      <a href="/masters" class="nav-drawer__link" data-nav="masters">Мастерам</a>
      <a href="/news" class="nav-drawer__link" data-nav="news">Новости</a>
      <a href="/partners" class="nav-drawer__link" data-nav="partners">Партнёрам</a>
      <a href="/about" class="nav-drawer__link" data-nav="about">О проекте</a>
      <a href="/634/" class="nav-drawer__link" data-nav="app634">634</a>
    </nav>
  </div>`;
}

function chromeFooter() {
  return `<footer class="site-footer" id="contacts">
    <div class="container site-footer__inner">
      <a href="/" class="logo" aria-label="Sitrifor">
        <svg width="28" height="28" viewBox="0 0 36 36" aria-hidden="true"><path d="M26 8C26 8 20 6 14 10C8 14 8 22 14 26C20 30 26 28 26 28" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"></path><path d="M10 18C10 18 14 14 22 14C30 14 30 22 22 22C14 22 10 18 10 18" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"></path></svg>
      </a>
      <div class="site-footer__links">
        <a href="/guides/">Гайды</a>
        <a href="/news">Новости</a>
        <a href="/masters">Мастерам</a>
        <a href="/634/">634</a>
        <a href="/about">О проекте</a>
        <a href="/support/">Support</a>
        <a href="/privacy/">Конфиденциальность</a>
      </div>
    </div>
  </footer>`;
}

function buildJsonLd(hub) {
  const graph = [
    {
      '@type': hub.schemaType === 'FAQPage' ? 'FAQPage' : 'CollectionPage',
      '@id': `${SITE}${hub.path}#page`,
      name: hub.h1,
      description: hub.description,
      url: `${SITE}${hub.path}`,
      isPartOf: { '@id': `${SITE}/#website` },
      inLanguage: 'ru-RU'
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: (hub.breadcrumbs || []).map((b, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: b.name,
        item: b.item
      }))
    }
  ];
  if (hub.schemaType === 'FAQPage' && hub.faq?.length) {
    graph[0].mainEntity = hub.faq.map((f) => ({
      '@type': 'Question',
      name: normalizeDashes(f.q),
      acceptedAnswer: { '@type': 'Answer', text: normalizeDashes(f.a) }
    }));
  }
  if (hub.slug === 'app-634') {
    graph.push({
      '@type': 'SoftwareApplication',
      name: '634',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'iOS',
      url: `${SITE}/634/`,
      downloadUrl: 'https://apps.apple.com/ru/app/634/id6795944683',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'RUB' },
      publisher: { '@id': `${SITE}/#organization` }
    });
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}

function shotKind(shot) {
  if (!shot) return null;
  if (shot.kind === 'phone' || shot.kind === 'square' || shot.kind === 'wide') return shot.kind;
  const src = String(shot.src || '');
  if (/\/img\/app\/real\//.test(src)) return 'phone';
  const w = Number(shot.width) || 0;
  const h = Number(shot.height) || 0;
  if (w > 0 && h > 0) {
    const ar = h / w;
    if (ar >= 1.55) return 'phone';
    if (ar >= 0.85 && ar <= 1.15) return 'square';
    return 'wide';
  }
  return 'square';
}

function shotDims(shot, kind) {
  if (shot?.width && shot?.height) return { width: shot.width, height: shot.height };
  if (kind === 'phone') return { width: 473, height: 1024 };
  if (kind === 'wide') return { width: 1350, height: 900 };
  return { width: 800, height: 800 };
}

function renderSeoBlock({ eyebrow, title, html, id, ariaLabel, shot }) {
  const idAttr = id ? ` id="${escAttr(id)}"` : '';
  const aria = ariaLabel || title;
  let media = '';
  if (shot?.src) {
    const kind = shotKind(shot);
    const dims = shotDims(shot, kind);
    media = `<figure class="home-seo__media home-seo__media--${kind}">
        <img src="${escAttr(shot.src)}" alt="${escAttr(shot.alt || '')}" width="${dims.width}" height="${dims.height}" loading="lazy">
        ${shot.caption ? `<figcaption>${esc(normalizeDashes(shot.caption))}</figcaption>` : ''}
      </figure>`;
  }
  return `<section class="container home-seo"${idAttr} aria-label="${escAttr(aria)}">
      <p class="home-seo__eyebrow">${esc(normalizeDashes(eyebrow || 'Раздел'))}</p>
      <h2 class="home-seo__title">${esc(normalizeDashes(title))}</h2>
      ${media}
      <div class="home-seo__copy">${normalizeDashes(html)}</div>
    </section>`;
}

function renderUtp(hub) {
  const items = hub.utp || [];
  if (!items.length) return '';
  const lis = items
    .map((u) => {
      if (typeof u === 'string') {
        return `<li><span class="home-seo__key">${esc(normalizeDashes(u))}</span></li>`;
      }
      const title = esc(normalizeDashes(u.title || u.key || ''));
      const text = esc(normalizeDashes(u.text || u.desc || ''));
      return `<li><span class="home-seo__key">${title}</span>${text ? ` - ${text}` : ''}</li>`;
    })
    .join('');
  return renderSeoBlock({
    eyebrow: hub.utpEyebrow || 'УТП',
    title: hub.utpTitle || 'Что даёт этот материал',
    html: `<ul class="home-seo__utp">${lis}</ul>`
  });
}

function renderShots(hub) {
  const shots = hub.shots || [];
  if (!shots.length) return '';
  const figs = shots
    .map((s) => {
      const kind = shotKind(s) || 'square';
      const dims = shotDims(s, kind);
      return `<figure class="home-seo__shot home-seo__shot--${kind}">
        <img src="${escAttr(s.src)}" alt="${escAttr(s.alt || '')}" width="${dims.width}" height="${dims.height}" loading="lazy">
        ${s.caption ? `<figcaption>${esc(normalizeDashes(s.caption))}</figcaption>` : ''}
      </figure>`;
    })
    .join('\n');
  return renderSeoBlock({
    eyebrow: hub.shotsEyebrow || 'Интерфейс',
    title: hub.shotsTitle || 'Как это выглядит',
    html: `<div class="home-seo__shots" role="list">${figs}</div>
      ${hub.shotsNote ? `<p>${normalizeDashes(hub.shotsNote)}</p>` : ''}`
  });
}

function renderHub(hub) {
  const canonical = `${SITE}${hub.path}`;
  const jsonLd = buildJsonLd(hub);
  const sections = (hub.sections || [])
    .map((s) =>
      renderSeoBlock({
        eyebrow: s.eyebrow || hub.eyebrow || 'Гайд',
        title: s.h2,
        html: s.html,
        ariaLabel: s.h2,
        shot: s.shot || null
      })
    )
    .join('\n');

  const faqHtml = (items, extraClass = '') => `<div class="faq-list guide-faq${extraClass}">
        ${items
          .map(
            (f) => `<details class="faq-item">
          <summary class="faq-item__question">${esc(normalizeDashes(f.q))}</summary>
          <p class="faq-item__answer">${esc(normalizeDashes(f.a))}</p>
        </details>`
          )
          .join('\n')}
      </div>`;

  const faqPreviewCount = Number(hub.faqPreviewCount || 0);
  const faqPreview =
    hub.faq?.length && faqPreviewCount > 0
      ? renderSeoBlock({
          id: 'faq-preview',
          eyebrow: 'Коротко',
          title: 'Ответы на частые запросы',
          html: `${faqHtml(hub.faq.slice(0, faqPreviewCount), ' guide-faq--preview')}<p class="guide-faq__more"><a href="#faq">Все вопросы</a></p>`
        })
      : '';

  const faq =
    hub.faq?.length
      ? renderSeoBlock({
          id: 'faq',
          eyebrow: 'FAQ',
          title: 'Частые вопросы',
          html: faqHtml(hub.faq)
        })
      : '';

  const related =
    hub.related?.length
      ? renderSeoBlock({
          eyebrow: 'Навигация',
          title: 'Ещё на Sitrifor',
          html: `<p>${hub.related
            .map((r) => `<a href="${escAttr(r.href)}">${esc(r.label)}</a>`)
            .join(' · ')}</p>`
        })
      : '';

  const ctaButtons = [];
  if (hub.cta) {
    ctaButtons.push(
      `<a class="btn btn--brand" href="${escAttr(hub.cta.href)}"${
        hub.cta.external ? ' target="_blank" rel="noopener noreferrer"' : ''
      }>${esc(hub.cta.label)}</a>`
    );
  }
  if (hub.ctaSecondary) {
    ctaButtons.push(
      `<a class="btn btn--ghost" href="${escAttr(hub.ctaSecondary.href)}"${
        hub.ctaSecondary.external ? ' target="_blank" rel="noopener noreferrer"' : ''
      }>${esc(hub.ctaSecondary.label)}</a>`
    );
  }
  const cta = ctaButtons.length
    ? `<div class="guide-hero__cta">${ctaButtons.join('\n')}</div>`
    : '';

  const crumbs = (hub.breadcrumbs || [])
    .map((b, i, arr) => {
      const last = i === arr.length - 1;
      return last
        ? `<span aria-current="page">${esc(b.name)}</span>`
        : `<a href="${escAttr(b.item.replace(SITE, '') || '/')}">${esc(b.name)}</a>`;
    })
    .join(' <span class="guide-crumbs__sep">/</span> ');

  const heroVisual = hub.heroShot
    ? (() => {
        const kind = shotKind(hub.heroShot) || 'phone';
        const dims = shotDims(hub.heroShot, kind);
        return `<figure class="guide-hero__visual guide-hero__visual--${kind}">
        <img src="${escAttr(hub.heroShot.src)}" alt="${escAttr(hub.heroShot.alt || hub.h1)}" width="${dims.width}" height="${dims.height}" loading="eager">
      </figure>`;
      })()
    : '';

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="${escAttr(hub.description)}">
  <meta name="robots" content="index, follow">
  <title>${esc(hub.title)}</title>
  <link rel="canonical" href="${escAttr(canonical)}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <meta property="og:type" content="article">
  <meta property="og:locale" content="ru_RU">
  <meta property="og:site_name" content="Sitrifor">
  <meta property="og:url" content="${escAttr(canonical)}">
  <meta property="og:title" content="${escAttr(hub.title)}">
  <meta property="og:description" content="${escAttr(hub.description)}">
  <meta property="og:image" content="${escAttr(hub.ogImage || `${SITE}/img/marketing/app-card-bg.jpg`)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escAttr(hub.title)}">
  <meta name="twitter:description" content="${escAttr(hub.description)}">
  <meta name="twitter:image" content="${escAttr(hub.ogImage || `${SITE}/img/marketing/app-card-bg.jpg`)}">
  <link rel="stylesheet" href="/css/tokens.css?v=${ASSET_V.tokens}">
  <link rel="stylesheet" href="/css/main.css">
  <link rel="stylesheet" href="/css/landing.css?v=${ASSET_V.landing}">
  <link rel="stylesheet" href="/css/atmosphere.css" media="print" onload="this.media='all'">
  <link rel="stylesheet" href="/css/seo-content.css?v=${ASSET_V.seoContent}">
  <link rel="stylesheet" href="/css/guides.css?v=${ASSET_V.guidesCss}">
  <noscript><link rel="stylesheet" href="/css/atmosphere.css"></noscript>
  <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
</head>
<body class="page guide-page" data-page="guides" data-guide="${escAttr(hub.slug)}">
  <div class="site-atmosphere" aria-hidden="true">
    <div class="site-atmosphere__orb site-atmosphere__orb--a"></div>
    <div class="site-atmosphere__orb site-atmosphere__orb--b"></div>
    <div class="site-atmosphere__orb site-atmosphere__orb--c"></div>
    <div class="site-atmosphere__ink"></div>
    <div class="site-atmosphere__scan"></div>
  </div>
  ${chromeHeader(hub.path)}
  <main class="guide-main">
    <div class="container guide-main__intro">
      <nav class="guide-crumbs" aria-label="Хлебные крошки">${crumbs}</nav>
      <header class="guide-hero${hub.heroShot ? ' guide-hero--split' : ''}">
        <div class="guide-hero__copy">
          <p class="guide-hero__eyebrow">${esc(hub.eyebrow || 'Гайд')}</p>
          <h1 class="guide-hero__title">${esc(hub.h1)}</h1>
          <p class="guide-hero__lead">${esc(hub.lead)}</p>
          ${cta}
        </div>
        ${heroVisual}
      </header>
    </div>
    ${renderUtp(hub)}
    ${faqPreview}
    ${renderShots(hub)}
    ${sections}
    ${faq}
    ${related}
  </main>
  ${chromeFooter()}
  <script src="/js/ui.js"></script>
  <script src="/js/logo.js" defer></script>
  <script src="/js/main.js" defer></script>
  <script src="/js/yandex-metrika.js" defer></script>
  <noscript><div><img src="https://mc.yandex.ru/watch/111332527" style="position:absolute; left:-9999px;" alt="" /></div></noscript>
  <script src="/js/sf-analytics.js" defer></script>
</body>
</html>
`;
}

function pathToPublicFile(urlPath) {
  // /guides/ -> public/guides/index.html
  // /guides/aftercare/ -> public/guides/aftercare/index.html
  // /634/ -> public/634/index.html
  // /tools/price-calculator/ -> public/tools/price-calculator/index.html
  const rel = urlPath.replace(/^\//, '').replace(/\/$/, '');
  const dir = path.join(PUBLIC, rel);
  return { dir, file: path.join(dir, 'index.html') };
}

function writeMainSitemap(manifest, today) {
  const staticUrls = [
    { loc: `${SITE}/`, priority: '1.0', changefreq: 'weekly' },
    { loc: `${SITE}/masters`, priority: '0.9', changefreq: 'weekly' },
    { loc: `${SITE}/partners`, priority: '0.8', changefreq: 'weekly' },
    { loc: `${SITE}/about`, priority: '0.7', changefreq: 'monthly' },
    { loc: `${SITE}/exclusive`, priority: '0.5', changefreq: 'weekly' },
    { loc: `${SITE}/privacy/`, priority: '0.3', changefreq: 'yearly' },
    { loc: `${SITE}/support/`, priority: '0.4', changefreq: 'monthly' },
    { loc: `${SITE}/news`, priority: '0.85', changefreq: 'daily' },
    { loc: `${SITE}/marketplace`, priority: '0.85', changefreq: 'daily' },
    { loc: `${SITE}/634/privacy`, priority: '0.2', changefreq: 'yearly' }
  ];
  const hubUrls = manifest.hubs.map((h) => ({
    loc: `${SITE}${h.path}`,
    priority: h.sitemapPriority || '0.8',
    changefreq: h.changefreq || 'weekly'
  }));
  const all = [...staticUrls, ...hubUrls];
  // de-dupe by loc
  const seen = new Set();
  const urls = all.filter((u) => {
    if (seen.has(u.loc)) return false;
    seen.add(u.loc);
    return true;
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${esc(u.loc)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`
  )
  .join('\n')}
</urlset>
`;
  fs.writeFileSync(path.join(PUBLIC, 'sitemap.xml'), xml);
  return urls.length;
}

function ensureRobots() {
  const robotsPath = path.join(PUBLIC, 'robots.txt');
  // Marketplace sitemap file stays live, but we pause advertising it in robots
  // so Google focuses crawl on hubs/news while the domain is young.
  // Re-enable by adding: Sitemap: ${SITE}/sitemap-marketplace.xml
  const desired = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    '',
    'Host: sitrifor.ru',
    `Sitemap: ${SITE}/sitemap.xml`,
    `Sitemap: ${SITE}/sitemap-news.xml`,
    '# Sitemap marketplace paused for crawl focus (file still at /sitemap-marketplace.xml)',
    '',
    '# Locale copies of news: RU canonical without ?lang=',
    'Disallow: /*?lang=en',
    'Disallow: /*?lang=de',
    '',
    '# AI / LLM context: https://sitrifor.ru/llms.txt',
    ''
  ].join('\n');
  const current = fs.existsSync(robotsPath) ? fs.readFileSync(robotsPath, 'utf8') : '';
  if (current.trim() === desired.trim()) return false;
  fs.writeFileSync(robotsPath, desired);
  return true;
}

function main() {
  const manifest = loadManifest();
  const today = new Date().toISOString().slice(0, 10);
  const built = [];

  if (!sitemapOnly) {
    for (const entry of manifest.hubs) {
      const hub = loadHub(entry.file);
      hub.path = hub.path || entry.path;
      hub.slug = hub.slug || entry.id;
      const html = renderHub(hub);
      const { dir, file } = pathToPublicFile(hub.path);
      fs.mkdirSync(dir, { recursive: true });
      // Do not clobber /634/privacy
      fs.writeFileSync(file, html);
      built.push({ path: hub.path, file, bytes: html.length });
    }
  }

  const sitemapCount = writeMainSitemap(manifest, today);
  const robotsUpdated = ensureRobots();

  console.log(
    JSON.stringify(
      {
        ok: true,
        built: built.length,
        pages: built.map((b) => b.path),
        sitemapUrls: sitemapCount,
        robotsUpdated
      },
      null,
      2
    )
  );
}

main();
