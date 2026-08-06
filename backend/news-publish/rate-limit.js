/**
 * Shared LLM editor publish rate limit across hourly + birthday writers.
 * Default: at most 1 successful publish per 20 minutes.
 */
import { loadHourlyState } from './hourly-state.js';

export const EDITOR_MIN_INTERVAL_MS = Math.max(
  60_000,
  Number(process.env.NEWS_EDITOR_MIN_INTERVAL_MS || 20 * 60 * 1000) || 20 * 60 * 1000
);

/** Floored UTC slot id for guids / dedupe (e.g. 2026-08-04T16:00). */
export function slotKey(d = new Date(), intervalMs = EDITOR_MIN_INTERVAL_MS) {
  const t = d instanceof Date ? d.getTime() : Number(d);
  const floored = new Date(Math.floor(t / intervalMs) * intervalMs);
  return floored.toISOString().slice(0, 16);
}

/**
 * @param {object} [state]
 * @param {number|Date} [now]
 * @returns {{ limited: boolean, reason: string|null, lastPublishAt: string|null, waitMs: number, intervalMs: number, slot: string }}
 */
export function getPublishRateLimit(state = null, now = Date.now()) {
  const st = state || loadHourlyState();
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const intervalMs = EDITOR_MIN_INTERVAL_MS;
  const slot = slotKey(new Date(nowMs), intervalMs);
  const lastPublishAt = st.lastPublishAt || null;

  if (lastPublishAt) {
    const lastMs = Date.parse(lastPublishAt);
    if (Number.isFinite(lastMs)) {
      const elapsed = nowMs - lastMs;
      if (elapsed < intervalMs) {
        return {
          limited: true,
          reason: 'rate_limited_20min',
          lastPublishAt,
          waitMs: Math.max(0, intervalMs - elapsed),
          intervalMs,
          slot
        };
      }
    }
  }

  // Same 20-min window already attempted (works with legacy lastHour "YYYY-MM-DDTHH")
  const attemptIso =
    (st.lastOutcome && st.lastOutcome.at) ||
    st.lastSlot ||
    st.lastHour ||
    null;
  if (attemptIso) {
    const attemptMs = Date.parse(attemptIso);
    if (Number.isFinite(attemptMs)) {
      if (slotKey(new Date(attemptMs), intervalMs) === slot) {
        return {
          limited: true,
          reason: 'already_attempted_this_slot',
          lastPublishAt,
          waitMs: 0,
          intervalMs,
          slot
        };
      }
    } else if (st.lastSlot === slot || st.lastHour === slot) {
      return {
        limited: true,
        reason: 'already_attempted_this_slot',
        lastPublishAt,
        waitMs: 0,
        intervalMs,
        slot
      };
    }
  }

  return {
    limited: false,
    reason: null,
    lastPublishAt,
    waitMs: 0,
    intervalMs,
    slot
  };
}

export function isPublishRateLimited(state = null, now = Date.now()) {
  return getPublishRateLimit(state, now).limited;
}
