/**
 * Single place to advance hourly rotation after any attempt.
 * Invariant: every finished attempt bumps the mode count (or skip that still rotates)
 * AND sets lastHour/lastSlot, so the publisher cannot stick on one slot overnight.
 * Successful publishes also set lastPublishAt for the shared 20-min rate limit.
 */
import { MODE_COUNT_KEY } from './modes.js';
import { saveHourlyState } from './hourly-state.js';

/**
 * @typedef {'published'|'rejected'|'exists'|'fallback'|'error'|'dry'} OutcomeKind
 */

/**
 * Apply outcome to hourly state. Always rotates the attempted mode.
 *
 * @param {object} state
 * @param {object} opts
 * @param {string} opts.mode - attempted mode
 * @param {string} opts.hour - slotKey() / hourKey()
 * @param {OutcomeKind} opts.kind
 * @param {string} [opts.reason]
 * @param {string} [opts.path] - product path for reviews
 * @param {string|number} [opts.postId] - sarcasm post id
 * @param {number} [opts.bdayCursor]
 * @param {boolean} [opts.countAsPublished=true] - when false, bump skip counter but still rotate mode count
 * @param {boolean} [opts.persist=true]
 */
export function applyHourlyOutcome(state, opts) {
  const {
    mode,
    hour,
    kind,
    reason = null,
    path = null,
    postId = null,
    bdayCursor = null,
    countAsPublished = kind === 'published' || kind === 'exists' || kind === 'fallback',
    persist = true
  } = opts;

  const countKey = MODE_COUNT_KEY[mode];
  if (!countKey) {
    throw new Error(`unknown_mode:${mode}`);
  }

  // Always move the slot forward for this mode attempt
  state[countKey] = (state[countKey] || 0) + 1;
  state.lastHour = hour;
  state.lastSlot = hour;
  const at = new Date().toISOString();
  state.lastOutcome = {
    at,
    hour,
    mode,
    kind,
    reason
  };
  if (kind === 'published') {
    state.lastPublishAt = at;
  }
  state.lastError = kind === 'error' || kind === 'rejected' ? reason : null;

  if (kind === 'rejected' || kind === 'error') {
    const skipKey = `${mode}SkipCount`;
    if (skipKey in state || true) {
      state[skipKey] = (state[skipKey] || 0) + 1;
    }
  }
  if (kind === 'exists') {
    state.existsCount = (state.existsCount || 0) + 1;
  }

  if (path) {
    const paths = new Set(state.reviewedPaths || []);
    paths.add(path);
    state.reviewedPaths = [...paths].slice(-500);
  }
  if (postId != null && postId !== '') {
    state.sarcasmUsedIds = [...(state.sarcasmUsedIds || []), postId].slice(-200);
  }
  if (bdayCursor != null) {
    state.bdayCursor = Number(bdayCursor) || 0;
  }

  // countAsPublished reserved for metrics; rotation already advanced above
  void countAsPublished;

  if (persist) saveHourlyState(state);
  return state;
}
