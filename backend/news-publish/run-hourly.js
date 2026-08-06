/**
 * Hourly news orchestrator: pick mode → compose → publishComposed → applyHourlyOutcome.
 * Invariant: every finished attempt (published|rejected|exists|error|dry) advances
 * mode count + lastSlot via applyHourlyOutcome. Rotation cannot stick overnight.
 * Rate: at most 1 successful publish / 20 min (shared with birthday writer).
 */
import { pickMode, describeRotation } from './modes.js';
import { loadHourlyState } from './hourly-state.js';
import { applyHourlyOutcome } from './outcome.js';
import { getPublishRateLimit, slotKey } from './rate-limit.js';
import { publishComposed } from './publish.js';
import {
  composeDailyPost,
  rememberDailyPost,
  unloadModel
} from '../news-daily-writer.js';
import { collectProducts } from '../tattoomarket.js';
import { composeProductReview } from '../news-product-reviews.js';
import { normalizeImageUrl } from '../news-images.js';
import { composeEditorSarcasm } from '../news-editor-sarcasm.js';
import { composeBirthdayArticle } from '../news-birthday-compose.js';
import { newsStats } from '../news.js';

function logEvent(event, payload = {}) {
  console.log(JSON.stringify({ event, ...payload }, null, 2));
}

function parseCli(argv = process.argv) {
  const dry = argv.includes('--dry-run') || argv.includes('--dry') || process.env.NEWS_DRY === '1';
  const modeIdx = argv.indexOf('--mode');
  const forcedMode =
    (modeIdx >= 0 ? argv[modeIdx + 1] : null) || process.env.FORCE_MODE || null;
  const topicIdx = argv.indexOf('--topic');
  const forceTopicId =
    (topicIdx >= 0 ? argv[topicIdx + 1] : null) || process.env.FORCE_TOPIC || null;
  return { dry, forcedMode, forceTopicId };
}

function outcomeFromPublish(status) {
  if (status === 'published') return 'published';
  if (status === 'exists') return 'exists';
  if (status === 'rejected') return 'rejected';
  if (status === 'dry') return 'dry';
  return 'error';
}

function applyOutcome(state, opts) {
  const dry = Boolean(opts.dry);
  const next = applyHourlyOutcome(state, {
    ...opts,
    // Dry-run still exercises the outcome path; do not poison production lastHour.
    persist: opts.persist != null ? opts.persist : !dry
  });
  logEvent('outcome', {
    ...(next.lastOutcome || {}),
    persisted: !dry,
    stats: {
      editorialCount: next.editorialCount,
      reviewCount: next.reviewCount,
      sarcasmCount: next.sarcasmCount,
      birthdayCount: next.birthdayCount,
      softCount: next.softCount,
      existsCount: next.existsCount
    }
  });
  return next;
}

async function publishEditorialMode(state, hour, mode, { dry, forceTopicId = null }) {
  const topicId = forceTopicId || (mode === 'soft' ? 'soft-634-week' : null);
  const composed = await composeDailyPost({ forceTopicId: topicId });
  composed.guid = `hourly:${hour}:${composed.topicId}`;
  composed.url =
    composed.url || `https://sitrifor.ru/news#hourly-${hour}-${composed.topicId || 'x'}`;

  const pub = await publishComposed(composed, {
    sourceKey: 'sitrifor-daily-ai',
    guid: composed.guid,
    url: composed.url,
    imageUrl: composed.imageUrl,
    dry
  });

  if (pub.status === 'rejected') {
    console.error('REJECTED_EDITORIAL_GATE', {
      mode,
      usefulReasons: composed.usefulReasons || [],
      gateReasons: pub.gateReasons || composed.gateReasons || [],
      editorialOk: composed.editorialOk,
      publishOk: composed.publishOk
    });
  } else if (pub.status === 'dry') {
    console.log((composed.body || '').slice(0, 1200));
  } else if (pub.status === 'published') {
    rememberDailyPost(composed);
    console.log('PUBLISHED', pub.slug);
  } else if (pub.status === 'exists') {
    console.log('EXISTS', composed.guid);
  }

  applyOutcome(state, {
    mode,
    hour,
    kind: outcomeFromPublish(pub.status),
    reason: pub.reason || null,
    dry
  });

  return { mode, pub, composed };
}

async function publishBirthday(state, hour, { dry }) {
  const { composed, nextCursor } = await composeBirthdayArticle(state, {
    hour,
    localize: true,
    useLlm: process.env.NEWS_BIRTHDAY_LLM !== '0'
  });
  const pub = await publishComposed(composed, {
    sourceKey: 'sitrifor-daily-ai',
    guid: composed.guid,
    url: `https://sitrifor.ru/news#hourly-${hour}-${composed.topicId}`,
    imageUrl: composed.imageUrl,
    dry
  });

  if (pub.status === 'rejected') {
    console.error('REJECTED_EDITORIAL_GATE_BIRTHDAY', {
      usefulReasons: composed.usefulReasons || [],
      editorialOk: composed.editorialOk,
      usedLlm: composed.usedLlm
    });
  } else if (pub.status === 'dry') {
    console.log((composed.body || '').slice(0, 1600));
  } else if (pub.status === 'published') {
    console.log('PUBLISHED', pub.slug, {
      usedLlm: composed.usedLlm,
      gallery: (composed.galleryImages || []).length
    });
  } else if (pub.status === 'exists') {
    console.log('EXISTS', composed.guid);
  }

  applyOutcome(state, {
    mode: 'birthday',
    hour,
    kind: outcomeFromPublish(pub.status),
    reason: pub.reason || null,
    bdayCursor: nextCursor,
    dry
  });

  return { mode: 'birthday', pub, composed };
}

async function publishSarcasm(state, hour, { dry }) {
  process.env.NEWS_LLM_SARCASM = process.env.NEWS_LLM_SARCASM || '0';
  const column = await composeEditorSarcasm({ usedIds: state.sarcasmUsedIds || [] });
  const guid = `editor:${column.postId}`;

  const pub = await publishComposed(column, {
    sourceKey: 'sitrifor-editor',
    guid,
    url: column.postUrl || column.channelUrl,
    imageUrl: column.imageUrl,
    dry
  });

  if (pub.status === 'rejected') {
    console.error('REJECTED_EDITORIAL_GATE_SARCASM', column.usefulReasons || []);
  } else if (pub.status === 'dry') {
    console.log(column.title);
    console.log((column.body || '').slice(0, 1200));
  } else {
    console.log(pub.status === 'published' ? 'SARCASM' : 'EXISTS', pub.slug || guid, {
      usedLlm: column.usedLlm
    });
  }

  applyOutcome(state, {
    mode: 'sarcasm',
    hour,
    kind: outcomeFromPublish(pub.status),
    reason: pub.reason || null,
    postId: column.postId,
    dry
  });

  return { mode: 'sarcasm', pub, composed: column };
}

/**
 * Review attempt. On gate reject / no products: mark path (if any), advance review,
 * then try editorial once. Both outcomes always go through applyHourlyOutcome.
 */
async function publishReview(state, hour, { dry }) {
  const reviewed = new Set(state.reviewedPaths || []);
  let products = [];
  try {
    products = await collectProducts({ perCatalog: 15, totalLimit: 60 });
  } catch (err) {
    applyOutcome(state, {
      mode: 'review',
      hour,
      kind: 'error',
      reason: `collect_products:${err.message || err}`,
      dry
    });
    logEvent('review_fallback', { reason: 'collect_products_error' });
    return publishEditorialMode(state, hour, 'editorial', { dry });
  }

  const next = products.find((p) => !reviewed.has(p.path));
  if (!next) {
    applyOutcome(state, {
      mode: 'review',
      hour,
      kind: 'rejected',
      reason: 'no_new_products',
      dry
    });
    logEvent('review_fallback', { reason: 'no_new_products_fallback_editorial' });
    return publishEditorialMode(state, hour, 'editorial', { dry });
  }

  if (dry) {
    console.log('Would review', next.path, next.catalogCategory);
    applyOutcome(state, {
      mode: 'review',
      hour,
      kind: 'dry',
      path: next.path,
      reason: 'dry_review_preview',
      dry
    });
    return { mode: 'review', pub: { status: 'dry', guid: `tm:${next.path}` }, product: next };
  }

  process.env.NEWS_LLM_REVIEWS = process.env.NEWS_LLM_REVIEWS || '0';
  const review = await composeProductReview(next, { category: next.catalogCategory || 'gear' });
  const guid = `tm:${next.path}`;
  const pub = await publishComposed(review, {
    sourceKey: 'tattoomarket-reviews',
    guid,
    url: review.product?.url,
    imageUrl: normalizeImageUrl(review.imageUrl),
    dry: false
  });

  if (pub.status === 'rejected') {
    console.error('REJECTED_EDITORIAL_GATE_REVIEW', {
      path: next.path,
      editorialOk: review.editorialOk,
      publishOk: review.publishOk,
      polishOk: review.polishOk,
      gateReasons: review.gateReasons,
      usefulReasons: review.usefulReasons
    });
    applyOutcome(state, {
      mode: 'review',
      hour,
      kind: 'rejected',
      reason: pub.reason || 'editorial_gate_fail',
      path: next.path,
      dry: false
    });
    logEvent('review_fallback', { reason: 'editorial_after_review_reject', path: next.path });
    return publishEditorialMode(state, hour, 'editorial', { dry: false });
  }

  applyOutcome(state, {
    mode: 'review',
    hour,
    kind: outcomeFromPublish(pub.status),
    reason: pub.reason || null,
    path: next.path,
    dry: false
  });
  console.log(pub.status === 'published' ? 'REVIEW' : 'EXISTS', pub.slug || guid, {
    usedLlm: review.usedLlm,
    editorialScore: review.editorialScore
  });
  return { mode: 'review', pub, composed: review };
}

/**
 * @param {{ dry?: boolean, forcedMode?: string|null, forceTopicId?: string|null, skipUnload?: boolean }} opts
 */
export async function runHourly(opts = {}) {
  const dry = Boolean(opts.dry);
  const forcedMode = opts.forcedMode || null;
  const forceTopicId = opts.forceTopicId || null;

  const state = loadHourlyState();
  const hour = slotKey();

  if (!dry && !forceTopicId && !forcedMode) {
    const rl = getPublishRateLimit(state);
    if (rl.limited) {
      const skipped = {
        skipped: true,
        reason: rl.reason,
        hour,
        slot: rl.slot,
        lastPublishAt: rl.lastPublishAt,
        waitMs: rl.waitMs,
        intervalMs: rl.intervalMs
      };
      logEvent('skip', skipped);
      return skipped;
    }
  }

  const mode = pickMode(state, { forcedMode, forceTopicId });
  logEvent('mode_pick', {
    hour,
    mode,
    dry,
    forcedMode,
    forceTopicId,
    rotation: describeRotation(state)
  });

  let result;
  try {
    if (mode === 'editorial' || mode === 'soft') {
      result = await publishEditorialMode(state, hour, mode, { dry, forceTopicId });
    } else if (mode === 'birthday') {
      result = await publishBirthday(state, hour, { dry });
    } else if (mode === 'sarcasm') {
      result = await publishSarcasm(state, hour, { dry });
    } else {
      result = await publishReview(state, hour, { dry });
    }
  } catch (err) {
    applyOutcome(state, {
      mode,
      hour,
      kind: 'error',
      reason: String(err && err.message ? err.message : err),
      dry
    });
    if (!opts.skipUnload) await unloadModel().catch(() => {});
    throw err;
  }

  if (!opts.skipUnload) await unloadModel().catch(() => {});
  logEvent('done', {
    hour,
    mode: result?.mode || mode,
    status: result?.pub?.status || null,
    stats: newsStats()
  });
  return result;
}

export async function main(argv = process.argv) {
  const cli = parseCli(argv);
  return runHourly(cli);
}
