/**
 * Hourly mode rotation for Sitrifor news publisher.
 * Rotation advances on every completed attempt (published | rejected | exists),
 * never only on successful inserts - that was the overnight stuck-review bug.
 */
export const MODES = Object.freeze(['editorial', 'review', 'sarcasm', 'birthday', 'soft']);

/** 8-slot schedule: denser editorial, regular reviews, sparse specialty modes */
export const MODE_SLOTS = Object.freeze([
  'editorial',
  'editorial',
  'review',
  'sarcasm',
  'editorial',
  'birthday',
  'review',
  'soft'
]);

export const MODE_COUNT_KEY = Object.freeze({
  editorial: 'editorialCount',
  review: 'reviewCount',
  sarcasm: 'sarcasmCount',
  birthday: 'birthdayCount',
  soft: 'softCount'
});

/** UTC hour bucket (legacy / logs). Prefer slotKey from rate-limit.js for publish guids. */
export function hourKey(d = new Date()) {
  return d.toISOString().slice(0, 13);
}

export function rotationTotal(state = {}) {
  return MODES.reduce((sum, mode) => sum + Number(state[MODE_COUNT_KEY[mode]] || 0), 0);
}

/**
 * Pick next content mode.
 * @param {object} state hourly state
 * @param {{ forcedMode?: string|null, forceTopicId?: string|null }} opts
 */
export function pickMode(state, { forcedMode = null, forceTopicId = null } = {}) {
  if (forcedMode && MODES.includes(forcedMode)) return forcedMode;
  if (forceTopicId) return 'editorial';
  const slot = rotationTotal(state) % MODE_SLOTS.length;
  return MODE_SLOTS[slot];
}

export function describeRotation(state) {
  const total = rotationTotal(state);
  return {
    total,
    slot: total % MODE_SLOTS.length,
    nextMode: MODE_SLOTS[total % MODE_SLOTS.length]
  };
}
