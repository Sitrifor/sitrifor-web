/**
 * Persistent hourly publisher state (JSON file).
 * Always merges with defaults so missing fields cannot break rotation.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const HOURLY_STATE_PATH = join(__dirname, '../data/hourly-writer-state.json');

export function defaultHourlyState() {
  return {
    version: 2,
    lastHour: null,
    lastSlot: null,
    lastPublishAt: null,
    editorialCount: 0,
    reviewCount: 0,
    sarcasmCount: 0,
    birthdayCount: 0,
    softCount: 0,
    editorialSkipCount: 0,
    reviewSkipCount: 0,
    sarcasmSkipCount: 0,
    birthdaySkipCount: 0,
    softSkipCount: 0,
    existsCount: 0,
    reviewedPaths: [],
    sarcasmUsedIds: [],
    bdayCursor: 0,
    lastOutcome: null,
    lastError: null
  };
}

export function normalizeHourlyState(raw = {}) {
  const base = defaultHourlyState();
  const out = { ...base, ...raw };
  out.reviewedPaths = Array.isArray(out.reviewedPaths) ? out.reviewedPaths : [];
  out.sarcasmUsedIds = Array.isArray(out.sarcasmUsedIds) ? out.sarcasmUsedIds : [];
  out.bdayCursor = Number(out.bdayCursor || 0) || 0;
  out.version = 2;
  for (const k of Object.keys(base)) {
    if (typeof base[k] === 'number' && k !== 'bdayCursor') {
      out[k] = Number(out[k] || 0) || 0;
    }
  }
  // lastHour / lastSlot / lastPublishAt / lastOutcome / lastError stay as-is
  out.lastHour = raw.lastHour ?? null;
  out.lastSlot = raw.lastSlot ?? raw.lastHour ?? null;
  out.lastPublishAt = raw.lastPublishAt ?? null;
  out.lastOutcome = raw.lastOutcome ?? null;
  out.lastError = raw.lastError ?? null;
  return out;
}

export function loadHourlyState(path = HOURLY_STATE_PATH) {
  if (!existsSync(path)) return defaultHourlyState();
  try {
    return normalizeHourlyState(JSON.parse(readFileSync(path, 'utf8')));
  } catch (err) {
    console.error('[hourly-state] corrupt file, using defaults', err.message || err);
    return defaultHourlyState();
  }
}

export function saveHourlyState(state, path = HOURLY_STATE_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  const normalized = normalizeHourlyState(state);
  writeFileSync(path, JSON.stringify(normalized, null, 2));
  return normalized;
}
