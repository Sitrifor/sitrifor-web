/**
 * Marketplace indexability + SERP title helpers (no DB / SSR deps).
 */

export const INDEX_MIN_PRICE = 50;
export const INDEX_MIN_TITLE = 15;
export const INDEX_MIN_DESC = 40;

/**
 * Whether a product page should be indexed (sitemap + robots).
 * @param {{ title?: string, description?: string|null, minPriceRub?: number|null, coverUrl?: string|null, images?: string[] }} product
 */
export function isProductIndexable(product) {
  if (!product) return false;
  const title = String(product.title || '').trim();
  if (title.length < INDEX_MIN_TITLE) return false;
  const price = product.minPriceRub != null ? Number(product.minPriceRub) : null;
  if (price == null || !Number.isFinite(price) || price < INDEX_MIN_PRICE) return false;
  const desc = String(product.description || '').trim();
  if (desc.length < INDEX_MIN_DESC) return false;
  const hasImg =
    (Array.isArray(product.images) && product.images.some(Boolean)) ||
    !!(product.coverUrl && String(product.coverUrl).trim());
  if (!hasImg) return false;
  return true;
}

/**
 * Compact SERP title: keep under ~60 chars with brand suffix.
 */
export function buildProductSeoTitle(titlePlain) {
  const suffix = ' | Sitrifor';
  const max = 60;
  let t = String(titlePlain || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return `Товар${suffix}`;
  if (t.length + suffix.length <= max) return t + suffix;
  const cut = Math.max(24, max - suffix.length - 1);
  return `${t.slice(0, cut).replace(/[\s,.;:/\-]+$/u, '')}...${suffix}`;
}
