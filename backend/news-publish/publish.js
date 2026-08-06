/**
 * Shared publish helpers: gate check, source upsert, insert, structured result.
 */
import { upsertSource, listSources, insertArticle } from '../news.js';
import { afterPublishSeo } from '../news-seo/index.js';

const SOURCE_PRESETS = {
  'sitrifor-daily-ai': {
    key: 'sitrifor-daily-ai',
    name: 'Sitrifor Daily AI',
    url: 'https://sitrifor.ru/news',
    feedUrl: null,
    region: 'RU',
    lang: 'ru',
    enabled: 1
  },
  'tattoomarket-reviews': {
    key: 'tattoomarket-reviews',
    name: 'Sitrifor Tech Reviews',
    url: 'https://www.tattoomarket.ru',
    feedUrl: null,
    region: 'RU',
    lang: 'ru',
    enabled: 1
  },
  'sitrifor-editor': {
    key: 'sitrifor-editor',
    name: 'Sitrifor Главред',
    url: 'https://t.me/notepad_ceo',
    feedUrl: null,
    region: 'RU',
    lang: 'ru',
    enabled: 1
  }
};

export function ensureSource(key) {
  const preset = SOURCE_PRESETS[key];
  if (!preset) throw new Error(`unknown_source:${key}`);
  upsertSource(preset);
  const src = listSources({ enabledOnly: false }).find((s) => s.key === key);
  if (!src) throw new Error(`source_missing_after_upsert:${key}`);
  return src;
}

export function gateAllowsPublish(composed) {
  if (process.env.NEWS_EDITORIAL_GATE === '0') return { ok: true, reason: null };
  if (composed?.publishOk === false) {
    return { ok: false, reason: 'publish_gate_fail' };
  }
  if (composed?.editorialOk === false) {
    return { ok: false, reason: 'editorial_gate_fail' };
  }
  return { ok: true, reason: null };
}

export function composedToArticlePayload(composed, { sourceId, guid, url, imageUrl } = {}) {
  return {
    sourceId,
    guid: guid || composed.guid,
    title: composed.title,
    summary: composed.summary,
    body: composed.body,
    url: url || composed.url,
    imageUrl: imageUrl ?? composed.imageUrl,
    publishedAt: composed.publishedAt || new Date().toISOString(),
    categories: composed.categories,
    lang: composed.lang || 'ru',
    region: composed.region || 'RU',
    slugBase: composed.slugBase || composed.title,
    titleRu: composed.titleRu ?? composed.title,
    summaryRu: composed.summaryRu ?? composed.summary,
    bodyRu: composed.bodyRu ?? composed.body,
    titleEn: composed.titleEn,
    summaryEn: composed.summaryEn,
    bodyEn: composed.bodyEn,
    titleDe: composed.titleDe,
    summaryDe: composed.summaryDe,
    bodyDe: composed.bodyDe,
    published: composed.published !== false,
    usefulScore: composed.usefulScore,
    usefulReasons: composed.usefulReasons,
    insightsRu: composed.insightsRu,
    insightsEn: composed.insightsEn,
    insightsDe: composed.insightsDe,
    insightsTopic: composed.insightsTopic
  };
}

/**
 * Gate + insert. Does NOT mutate hourly state - caller uses applyHourlyOutcome.
 * On successful insert, runs SEO optimize (meta/sitemap/IndexNow) unless skipSeo.
 * @returns {Promise|{ status: 'published'|'rejected'|'exists'|'dry', slug?: string, guid: string, reason?: string, gate?: object, seo?: object }}
 */
export async function publishComposed(composed, {
  sourceKey,
  guid,
  url,
  imageUrl,
  dry = false,
  skipSeo = false
} = {}) {
  const finalGuid = guid || composed.guid;
  if (!finalGuid) throw new Error('missing_guid');

  const gate = gateAllowsPublish(composed);
  console.log(
    JSON.stringify(
      {
        event: 'publish_attempt',
        sourceKey,
        guid: finalGuid,
        title: composed.title,
        articleType: composed.articleType,
        bodyLen: composed.body?.length,
        usefulScore: composed.usefulScore,
        editorialScore: composed.editorialScore,
        editorialOk: composed.editorialOk,
        publishOk: composed.publishOk,
        gateOk: gate.ok,
        gateReason: gate.reason,
        dry
      },
      null,
      2
    )
  );

  if (!gate.ok) {
    return {
      status: 'rejected',
      guid: finalGuid,
      reason: gate.reason,
      gate,
      usefulReasons: composed.usefulReasons || [],
      gateReasons: composed.gateReasons || []
    };
  }

  if (dry) {
    return { status: 'dry', guid: finalGuid, preview: String(composed.body || '').slice(0, 1200) };
  }

  const src = ensureSource(sourceKey);
  const res = insertArticle(
    composedToArticlePayload(composed, {
      sourceId: src.id,
      guid: finalGuid,
      url,
      imageUrl
    })
  );

  if (res.inserted) {
    let seo = null;
    if (!skipSeo && res.slug) {
      seo = await afterPublishSeo(res.slug, { source: sourceKey || 'publish' });
    }
    return {
      status: 'published',
      guid: finalGuid,
      slug: res.slug,
      id: res.id,
      day: res.day,
      seo
    };
  }
  return { status: 'exists', guid: finalGuid, slug: res.slug || null };
}
