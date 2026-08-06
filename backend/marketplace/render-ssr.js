/**
 * SSR HTML for /marketplace/p/:slug - crawlable product pages.
 */
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getProductBySlug } from './api.js';
import { splitDescriptionParagraphs } from './normalize.js';
import { isProductIndexable, buildProductSeoTitle } from './seo-gates.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE = 'https://sitrifor.ru';
const SHELL = join(__dirname, '../../public/marketplace-product.html');
const ASSET_V = { css: 10, js: 2, dict: 40, favs: 1 };

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(s) {
  return esc(s).replace(/'/g, '&#39;');
}

/** UI/SEO copy: only ASCII hyphen (no em/en dashes). */
function plainText(s) {
  return String(s ?? '')
    .replace(/\u2014/g, '-')
    .replace(/\u2013/g, '-')
    .replace(/\u2212/g, '-');
}

function absUrl(u) {
  if (!u) return `${SITE}/img/marketplace/categories/other.jpg`;
  if (/^https?:\/\//i.test(u)) return u;
  return `${SITE}${u.startsWith('/') ? u : `/${u}`}`;
}

export function productPublicPath(slug) {
  return `/marketplace/p/${encodeURIComponent(String(slug || ''))}`;
}

function fmtPrice(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return `${new Intl.NumberFormat('ru-RU').format(Math.round(Number(n)))} ₽`;
}

function pickImages(product) {
  let imgs = Array.isArray(product.images) ? product.images.slice() : [];
  if (!imgs.length && product.coverUrl) imgs = [product.coverUrl];
  const locals = imgs.filter((u) => u && String(u).startsWith('/img/'));
  if (locals.length) imgs = locals;
  return [...new Set(imgs.filter(Boolean))];
}

function loadShell() {
  if (!existsSync(SHELL)) {
    return `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><title>Товар</title></head><body><main></main></body></html>`;
  }
  return readFileSync(SHELL, 'utf8');
}

function productMainHtml(product) {
  const brand = product.brand?.name || '';
  const imgs = pickImages(product);
  const cheap = product.cheapest;
  const title = plainText(product.title);
  const description = plainText(product.description || '');
  const priceLabel = cheap
    ? `Самая низкая цена - ${cheap.shopName} - ${fmtPrice(cheap.priceRub)}`
    : product.minPriceRub != null
      ? `от ${fmtPrice(product.minPriceRub)}`
      : '';

  const gallery =
    imgs.length > 0
      ? imgs
          .map(
            (src, i) =>
              `<img src="${escAttr(src)}" alt="${escAttr(title)}"${i === 0 ? '' : ' loading="lazy"'} width="800" height="800">`
          )
          .join('\n        ')
      : `<span class="mp-product__noimg">Нет фото</span>`;

  const offers = (product.offers || [])
    .map((o) => {
      const price = fmtPrice(o.priceRub) || '-';
      return `<div class="mp-offer${o.isCheapest ? ' is-cheapest' : ''}">
          <span class="mp-offer__shop">${esc(o.shopName)}</span>
          <span class="mp-offer__price">${esc(price)}</span>
          <a class="mp-offer__buy" href="${escAttr(o.url)}" target="_blank" rel="noopener noreferrer">Купить</a>
        </div>`;
    })
    .join('\n        ');

  const markets = (product.marketplaces || [])
    .map(
      (m) =>
        `<a href="${escAttr(m.url)}" target="_blank" rel="noopener noreferrer">${esc(m.name)}</a>`
    )
    .join('\n          ');

  const cat = product.category?.title
    ? `<a href="/marketplace" class="mp-product__crumb">${esc(product.category.title)}</a>`
    : `<a href="/marketplace" class="mp-product__crumb">Каталог товаров</a>`;

  const descParas = splitDescriptionParagraphs(description);
  const desc = descParas.length
    ? `<div class="mp-product__desc">${descParas.map((p) => `<p>${esc(p)}</p>`).join('\n        ')}</div>`
    : '';

  return `
    <nav class="container mp-product__nav" aria-label="Хлебные крошки">
      <a href="/marketplace" class="mp-product__back-link">← В каталог</a>
      <span aria-hidden="true">/</span>
      ${cat}
    </nav>
    <article class="container mp-product" data-mp-product data-slug="${escAttr(product.slug)}">
      <div class="mp-product__gallery${imgs.length > 1 ? ' is-multi' : ''}${imgs.length ? '' : ' is-empty'}">
        <button type="button" class="mp-fav mp-fav--lg" data-mp-fav="${escAttr(product.slug)}" aria-pressed="false" aria-label="В избранное">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
            <path fill="currentColor" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
          </svg>
        </button>
        ${gallery}
      </div>
      <div class="mp-product__body">
        ${brand ? `<p class="mp-product__brand">${esc(brand)}</p>` : ''}
        <h1 class="mp-product__title">${esc(title)}</h1>
        ${priceLabel ? `<p class="mp-product__cheap">${esc(priceLabel)}</p>` : ''}
        ${desc}
        <h2 class="mp-product__h">Цены в магазинах</h2>
        <div class="mp-offers">
        ${offers || '<p>Офферов пока нет</p>'}
        </div>
        <h2 class="mp-product__h">Маркетплейсы</h2>
        <div class="mp-markets">
          ${markets}
        </div>
        <p class="mp-product__note">Информация собрана из публичных источников. Цены и наличие уточняйте у продавца.</p>
        <div class="mp-product__actions">
          <a class="btn btn--brand btn--block mp-product__back-btn" href="/marketplace">← В каталог</a>
        </div>
      </div>
    </article>`;
}

function breadcrumbLd(product, canonical) {
  const items = [
    { '@type': 'ListItem', position: 1, name: 'Главная', item: `${SITE}/` },
    { '@type': 'ListItem', position: 2, name: 'Каталог товаров', item: `${SITE}/marketplace` }
  ];
  if (product.category?.title) {
    items.push({
      '@type': 'ListItem',
      position: 3,
      name: product.category.title,
      item: `${SITE}/marketplace`
    });
    items.push({
      '@type': 'ListItem',
      position: 4,
      name: product.title,
      item: canonical
    });
  } else {
    items.push({
      '@type': 'ListItem',
      position: 3,
      name: product.title,
      item: canonical
    });
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items
  };
}

function jsonLd(product, canonical) {
  const imgs = pickImages(product).map(absUrl);
  const offers = (product.offers || [])
    .filter((o) => o.priceRub != null)
    .map((o) => ({
      '@type': 'Offer',
      price: o.priceRub,
      priceCurrency: 'RUB',
      url: o.url,
      availability: o.inStock === false ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
      seller: { '@type': 'Organization', name: o.shopName }
    }));

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.title,
    description: product.description || product.title,
    image: imgs.length ? imgs : undefined,
    brand: product.brand?.name ? { '@type': 'Brand', name: product.brand.name } : undefined,
    sku: product.sku || undefined,
    url: canonical,
    offers:
      offers.length === 1
        ? offers[0]
        : offers.length
          ? { '@type': 'AggregateOffer', lowPrice: product.minPriceRub, priceCurrency: 'RUB', offerCount: offers.length, offers }
          : undefined
  };
}

function renderNotFound() {
  const html = loadShell()
    .replace(/<title>[^<]*<\/title>/, '<title>Товар не найден | Sitrifor</title>')
    .replace(
      /<meta name="robots" content="[^"]*">/,
      '<meta name="robots" content="noindex, follow">'
    )
    .replace(
      /<main[\s\S]*?<\/main>/,
      `<main class="mp"><div class="container" style="padding:3rem 0;text-align:center">
      <h1>Товар не найден</h1>
      <p><a href="/marketplace">Вернуться в каталог</a></p>
    </div></main>`
    );
  return html;
}

/**
 * @returns {{ status: number, html: string, contentType: string }}
 */
export function renderProductSsr(slug) {
  const product = getProductBySlug(decodeURIComponent(String(slug || '')));
  if (!product) {
    return {
      status: 404,
      contentType: 'text/html; charset=utf-8',
      html: renderNotFound()
    };
  }

  const canonical = `${SITE}${productPublicPath(product.slug)}`;
  const titlePlain = plainText(product.title);
  const descPlain = plainText(product.description || '');
  const indexable = isProductIndexable({
    ...product,
    title: titlePlain,
    description: descPlain,
    images: pickImages(product)
  });
  const title = buildProductSeoTitle(titlePlain);
  const desc = (
    descPlain ||
    `${titlePlain}${product.minPriceRub != null ? ` - от ${fmtPrice(product.minPriceRub)}` : ''}. Сравнение цен в каталоге Sitrifor. Информация из публичных источников.`
  ).slice(0, 160);
  const ogImage = absUrl(pickImages(product)[0] || product.coverUrl);
  const main = productMainHtml(product);
  const productLd = jsonLd({ ...product, title: titlePlain, description: descPlain || titlePlain }, canonical);
  const crumbsLd = breadcrumbLd({ ...product, title: titlePlain }, canonical);
  const ldBundle = [productLd, crumbsLd];
  const payload = JSON.stringify(product).replace(/</g, '\\u003c');

  let html = loadShell();
  html = html
    .replace(/marketplace\.css\?v=\d+/, `marketplace.css?v=${ASSET_V.css}`)
    .replace(/marketplace-favs\.js\?v=\d+/, `marketplace-favs.js?v=${ASSET_V.favs}`)
    .replace(/marketplace-product\.js\?v=\d+/, `marketplace-product.js?v=${ASSET_V.js}`)
    .replace(/i18n-dict\.js\?v=\d+/, `i18n-dict.js?v=${ASSET_V.dict}`);

  html = html.replace(
    /<meta name="robots" content="[^"]*">/,
    `<meta name="robots" content="${indexable ? 'index, follow' : 'noindex, follow'}">`
  );
  html = html.replace(
    /<meta name="description" content="[^"]*">/,
    `<meta name="description" content="${escAttr(desc)}">`
  );
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  html = html.replace(
    /<link rel="canonical" href="[^"]*">/,
    `<link rel="canonical" href="${escAttr(canonical)}">`
  );
  html = html.replace(
    /<meta property="og:url" content="[^"]*">/,
    `<meta property="og:url" content="${escAttr(canonical)}">`
  );
  html = html.replace(
    /<meta property="og:title" content="[^"]*">/,
    `<meta property="og:title" content="${escAttr(titlePlain)}">`
  );
  html = html.replace(
    /<meta property="og:description" content="[^"]*">/,
    `<meta property="og:description" content="${escAttr(desc)}">`
  );
  html = html.replace(
    /<meta property="og:image" content="[^"]*">/,
    `<meta property="og:image" content="${escAttr(ogImage)}">
  <script type="application/ld+json">${JSON.stringify(ldBundle).replace(/</g, '\\u003c')}</script>`
  );

  html = html.replace(
    /<main class="mp"[\s\S]*?<\/main>/,
    `<main class="mp" data-ssr="1">${main}\n  </main>`
  );

  html = html.replace(
    /<script src="\/js\/marketplace-product\.js[^"]*"><\/script>/,
    `<script>window.__MP_PRODUCT__=${payload};</script>\n  <script src="/js/marketplace-product.js?v=${ASSET_V.js}" defer></script>`
  );

  // Truncate long title in header
  html = html.replace(
    /(<p class="header__page-title"[^>]*>)[^<]*(<\/p>)/,
    `$1${esc((titlePlain || '').slice(0, 48))}$2`
  );

  return {
    status: 200,
    contentType: 'text/html; charset=utf-8',
    html
  };
}

export function renderProductNotFoundSsr() {
  return {
    status: 404,
    contentType: 'text/html; charset=utf-8',
    html: renderNotFound()
  };
}
