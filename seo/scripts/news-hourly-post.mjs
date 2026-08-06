#!/usr/bin/env node
/**
 * Editor post (≤1 / 20 min): editorial | product review | sarcasm | birthday | soft.
 * Thin CLI → backend/news-publish/run-hourly.js
 *
 * Usage:
 *   node scripts/news-hourly-post.mjs
 *   node scripts/news-hourly-post.mjs --mode editorial|review|sarcasm|birthday|soft
 *   node scripts/news-hourly-post.mjs --topic maps-presence
 *   node scripts/news-hourly-post.mjs --dry-run
 * Env: FORCE_MODE, FORCE_TOPIC, NEWS_DRY=1
 */
import { runHourlyMain } from '../../backend/news-publish/index.js';

try {
  await runHourlyMain(process.argv);
} catch (err) {
  console.error(err);
  process.exit(1);
}
