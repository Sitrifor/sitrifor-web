/**
 * Birthday / luck-tattoo batch publisher (shares 20-min editor rate limit).
 * Prefer mode rotation via news-hourly-post; batch stops after rate limit.
 *
 * Usage:
 *   node backend/news-birthday-daily.js
 *   node backend/news-birthday-daily.js --count 30 --dry-run
 *   node backend/news-birthday-daily.js --count 5 --no-llm
 * Env: NEWS_BIRTHDAY_DAILY_COUNT, NEWS_BIRTHDAY_LLM, NEWS_BIRTHDAY_LOCALIZE=0 (batch default)
 */
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { loadHourlyState, saveHourlyState } from './news-publish/hourly-state.js';
import { publishComposed } from './news-publish/publish.js';
import { getPublishRateLimit, slotKey } from './news-publish/rate-limit.js';
import { composeBirthdayArticle, unloadModel } from './news-birthday-compose.js';
import { newsStats, findRawArticleByBirthdayTopic, updateArticleLocales } from './news.js';
import { buildBirthdayTopic } from './news-birthday-topics.js';

function parseCli(argv = process.argv) {
  const dry = argv.includes('--dry-run') || argv.includes('--dry') || process.env.NEWS_DRY === '1';
  const noLlm = argv.includes('--no-llm') || process.env.NEWS_BIRTHDAY_LLM === '0';
  const refresh = argv.includes('--refresh');
  const countIdx = argv.indexOf('--count');
  const count = Math.max(
    1,
    Number(
      (countIdx >= 0 ? argv[countIdx + 1] : null) ||
        process.env.NEWS_BIRTHDAY_DAILY_COUNT ||
        30
    ) || 30
  );
  const sleepMs = Number(process.env.NEWS_BIRTHDAY_SLEEP_MS || 800);
  const dateIdx = argv.indexOf('--date');
  const dateStr = dateIdx >= 0 ? argv[dateIdx + 1] : null;
  return { dry, noLlm, count, sleepMs, refresh, dateStr };
}

function parseDateRu(str) {
  const m = String(str || '').trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (!m) return null;
  return { day: Number(m[1]), month: Number(m[2]), year: Number(m[3]) };
}

function availableKb() {
  try {
    const text = readFileSync('/proc/meminfo', 'utf8');
    const m = text.match(/MemAvailable:\s+(\d+)/);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(event, payload = {}) {
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...payload }));
}

export async function runBirthdayDaily(opts = {}) {
  const dry = Boolean(opts.dry);
  const count = Number(opts.count || 30);
  const useLlm = opts.useLlm !== false && process.env.NEWS_BIRTHDAY_LLM !== '0';
  const sleepMs = Number(opts.sleepMs || 800);
  // Batch: skip full EN/DE body localize (title/summary still translated lightly)
  if (process.env.NEWS_BIRTHDAY_LOCALIZE == null) {
    process.env.NEWS_BIRTHDAY_LOCALIZE = '0';
  }

  const minKb = Number(process.env.NEWS_BIRTHDAY_MIN_MEM_KB || 900000);
  const mem = availableKb();
  if (mem != null && mem < minKb && !dry) {
    log('skip', { reason: 'low_memory', memKb: mem, minKb });
    return { skipped: true, reason: 'low_memory', memKb: mem };
  }

  const state = loadHourlyState();
  const day = new Date().toISOString().slice(0, 10);
  const summary = {
    day,
    target: count,
    published: 0,
    exists: 0,
    rejected: 0,
    errors: 0,
    dry: 0,
    usedLlm: 0,
    galleries: 0
  };

  log('start', { day, count, dry, useLlm, bdayCursor: state.bdayCursor || 0 });

  // Single-date refresh bypasses the 20-min editor slot (images / body fixups)
  const bypassRate = Boolean(opts.date && opts.refresh);

  if (!dry && !bypassRate) {
    const rl = getPublishRateLimit(state);
    if (rl.limited) {
      log('skip', {
        reason: rl.reason,
        lastPublishAt: rl.lastPublishAt,
        waitMs: rl.waitMs,
        intervalMs: rl.intervalMs,
        slot: rl.slot
      });
      return { skipped: true, reason: rl.reason, waitMs: rl.waitMs, ...summary };
    }
  }

  // Single-date refresh / publish
  if (opts.date) {
    const { month, day: d, year } = opts.date;
    const topic = buildBirthdayTopic(month, d, year);
    const { composed } = await composeBirthdayArticle(state, {
      hour: `${day}Trefresh`,
      month,
      day: d,
      year,
      localize: process.env.NEWS_BIRTHDAY_LOCALIZE !== '0',
      useLlm,
      forceImages: Boolean(opts.refresh)
    });

    const existing = findRawArticleByBirthdayTopic(topic.id);
    if (existing && (opts.refresh || true)) {
      if (dry) {
        log('item', { status: 'dry_refresh', topicId: topic.id, slug: existing.slug, bodyLen: composed.body?.length });
        console.log((composed.body || '').slice(0, 1600));
        return { ...summary, dry: 1, refreshed: 0 };
      }
      updateArticleLocales(existing.id, {
        title: composed.title,
        summary: composed.summary,
        body: composed.body,
        imageUrl: composed.imageUrl,
        categories: composed.categories || ['for_clients'],
        titleRu: composed.titleRu,
        summaryRu: composed.summaryRu,
        bodyRu: composed.bodyRu,
        titleEn: composed.titleEn || undefined,
        summaryEn: composed.summaryEn || undefined,
        bodyEn: composed.bodyEn || undefined,
        titleDe: composed.titleDe || undefined,
        summaryDe: composed.summaryDe || undefined,
        bodyDe: composed.bodyDe || undefined,
        published: 1,
        usefulScore: composed.usefulScore,
        usefulReasons: composed.usefulReasons,
        insightsRu: composed.insightsRu,
        insightsEn: composed.insightsEn,
        insightsDe: composed.insightsDe,
        insightsTopic: composed.insightsTopic || 'for_clients'
      });
      log('item', {
        status: 'refreshed',
        slug: existing.slug,
        topicId: topic.id,
        usedLlm: composed.usedLlm,
        gallery: (composed.galleryImages || []).length
      });
      await unloadModel().catch(() => {});
      return { ...summary, published: 0, refreshed: 1 };
    }

    const pub = await publishComposed(composed, {
      sourceKey: 'sitrifor-daily-ai',
      guid: composed.guid,
      url: `https://sitrifor.ru/news#birthday-${composed.topicId}`,
      imageUrl: composed.imageUrl,
      dry
    });
    log('item', { status: pub.status, slug: pub.slug, topicId: topic.id });
    await unloadModel().catch(() => {});
    return { ...summary, published: pub.status === 'published' ? 1 : 0, dry: pub.status === 'dry' ? 1 : 0 };
  }

  for (let i = 0; i < count; i++) {
    if (!dry) {
      const rl = getPublishRateLimit(state);
      if (rl.limited) {
        log('stop_early', {
          reason: rl.reason,
          i,
          lastPublishAt: rl.lastPublishAt,
          waitMs: rl.waitMs,
          intervalMs: rl.intervalMs
        });
        break;
      }
    }

    const memNow = availableKb();
    if (memNow != null && memNow < minKb && !dry) {
      log('stop_early', { reason: 'low_memory', i, memKb: memNow });
      break;
    }

    try {
      const hour = slotKey();
      const { composed, nextCursor } = await composeBirthdayArticle(state, {
        hour,
        localize: process.env.NEWS_BIRTHDAY_LOCALIZE !== '0',
        useLlm,
        deepPolish: process.env.NEWS_BIRTHDAY_DEEP_POLISH !== '0'
      });

      const pub = await publishComposed(composed, {
        sourceKey: 'sitrifor-daily-ai',
        guid: composed.guid,
        url: `https://sitrifor.ru/news#birthday-${composed.topicId}`,
        imageUrl: composed.imageUrl,
        dry,
        skipSeo: i < count - 1
      });

      state.bdayCursor = nextCursor;
      if (pub.status === 'published') {
        state.birthdayCount = (state.birthdayCount || 0) + 1;
        const at = new Date().toISOString();
        state.lastPublishAt = at;
        state.lastSlot = hour;
        state.lastHour = hour;
        state.lastOutcome = {
          at,
          hour,
          mode: 'birthday',
          kind: 'published',
          reason: 'birthday_daily'
        };
      }
      if (!dry) saveHourlyState(state);

      if (composed.usedLlm) summary.usedLlm += 1;
      summary.galleries += (composed.galleryImages || []).length;

      if (pub.status === 'published') summary.published += 1;
      else if (pub.status === 'exists') summary.exists += 1;
      else if (pub.status === 'rejected') summary.rejected += 1;
      else if (pub.status === 'dry') summary.dry += 1;

      log('item', {
        i: i + 1,
        status: pub.status,
        slug: pub.slug || null,
        topicId: composed.topicId,
        usedLlm: composed.usedLlm,
        gallery: (composed.galleryImages || []).length,
        profile: composed.birthdayProfile || null
      });
    } catch (err) {
      summary.errors += 1;
      log('item_error', { i: i + 1, error: String(err && err.message ? err.message : err) });
    }

    if (sleepMs > 0 && i < count - 1) await sleep(sleepMs);
  }

  await unloadModel().catch(() => {});
  log('done', { ...summary, stats: newsStats(), bdayCursor: state.bdayCursor || 0 });
  return summary;
}

export async function main(argv = process.argv) {
  const cli = parseCli(argv);
  return runBirthdayDaily({
    dry: cli.dry,
    count: cli.count,
    useLlm: !cli.noLlm,
    sleepMs: cli.sleepMs,
    refresh: cli.refresh,
    date: cli.dateStr ? parseDateRu(cli.dateStr) : null
  });
}

const isDirect =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirect) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
