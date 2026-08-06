/**
 * Normalize and validate news image URLs.
 */
const BAD_IMAGE =
  /s\.w\.org\/images\/core\/emoji|icon_portfolio\.png|1x1\.|pixel\.|spacer\.|blank\.(gif|png)|facebook\.com\/.*\/safe_image/i;

export function normalizeImageUrl(raw) {
  if (!raw) return null;
  let url = String(raw).trim();
  if (!url) return null;
  // Decode common HTML entities from RSS
  url = url
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#38;/g, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
  if (url.startsWith('//')) url = 'https:' + url;
  if (!/^https?:\/\//i.test(url)) return null;
  if (BAD_IMAGE.test(url)) return null;
  if (/^https?:\/\/static\.xx\.fbcdn\.net\/mci_ab\//i.test(url)) return null;
  // Prefer working TattooMarket small preview over missing full-size
  url = url.replace(/\/(\d+)_1\.(jpe?g|webp|png)$/i, '/$1_small_1.$2');
  return url.slice(0, 800);
}

export function isUsableImageUrl(url) {
  const n = normalizeImageUrl(url);
  return Boolean(n);
}
