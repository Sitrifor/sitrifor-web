/**
 * Sitrifor news publish pipeline - public entrypoints.
 */
export { pickMode, hourKey, rotationTotal, describeRotation, MODES, MODE_SLOTS } from './modes.js';
export {
  EDITOR_MIN_INTERVAL_MS,
  slotKey,
  getPublishRateLimit,
  isPublishRateLimited
} from './rate-limit.js';
export {
  loadHourlyState,
  saveHourlyState,
  defaultHourlyState,
  normalizeHourlyState,
  HOURLY_STATE_PATH
} from './hourly-state.js';
export { applyHourlyOutcome } from './outcome.js';
export {
  ensureSource,
  gateAllowsPublish,
  publishComposed,
  composedToArticlePayload
} from './publish.js';
export { runHourly, main as runHourlyMain } from './run-hourly.js';
export { runBirthdayDaily, main as runBirthdayDailyMain } from '../news-birthday-daily.js';
