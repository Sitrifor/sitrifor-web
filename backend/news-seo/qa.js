/**
 * SEO QA gate: refuse seo_ready if shell/canonical/title still wrong.
 */

import { shouldNoindexNews } from './fields.js';

const SITE = 'https://sitrifor.ru';

export function qaSeoArticle(article, { htmlSnippet = null } = {}) {
  const reasons = [];
  const seo = article.seo || {};
  const slug = article.slug;
  const canonical = seo.canonical || `${SITE}/news/a/${slug}`;
  const title = seo.title || article.title || '';
  const description = seo.description || article.summary || '';
  const body = String(article.body || article.summary || '');

  if (!slug) reasons.push('missing_slug');
  if (!title || title.length < 8) reasons.push('title_too_short');
  if (/^Новость\s*\|/i.test(title) || title === 'Новость') reasons.push('generic_title');
  if (!description || description.length < 40) reasons.push('description_too_short');
  if (description.length > 170) reasons.push('description_too_long');
  if (!canonical.includes(`/news/a/${slug}`)) reasons.push('canonical_not_article');
  if (canonical === `${SITE}/news` || /\/news\/?$/.test(canonical)) reasons.push('canonical_is_feed');
  if (body.length < 120) reasons.push('body_too_thin');
  if (/Загрузка…|Загрузка\.\.\./i.test(body)) reasons.push('body_is_loading_shell');
  if (seo.robots && !/index/i.test(seo.robots) && !shouldNoindexNews(article)) {
    reasons.push('robots_noindex');
  }
  if (!seo.imageAlt && !article.imageUrl) {
    /* ok - no image */
  } else if (article.imageUrl && !(seo.imageAlt || '').trim()) {
    reasons.push('missing_image_alt');
  }

  if (htmlSnippet) {
    const html = String(htmlSnippet);
    if (/rel="canonical"[^>]*href="https:\/\/sitrifor\.ru\/news"/i.test(html)) {
      reasons.push('html_canonical_is_feed');
    }
    if (!html.includes(`/news/a/${slug}`)) reasons.push('html_missing_article_url');
    if (/Загрузка…/.test(html) && !/<h1[\s>]/i.test(html)) reasons.push('html_loading_shell');
    if (!/<title>[^<]{8,}<\/title>/i.test(html)) reasons.push('html_title_weak');
    if (!/application\/ld\+json/i.test(html)) reasons.push('html_missing_jsonld');
  }

  return {
    ok: reasons.length === 0,
    reasons,
    canonical,
    title,
    descriptionLen: description.length,
    bodyLen: body.length
  };
}
