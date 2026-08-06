#!/usr/bin/env node
/**
 * Daily birthday luck-tattoo batch (default 30).
 * Thin CLI → backend/news-birthday-daily.js
 *
 *   node scripts/news-birthday-daily.mjs
 *   node scripts/news-birthday-daily.mjs --count 30 --dry-run
 *   node scripts/news-birthday-daily.mjs --no-llm
 */
import { main } from '../../backend/news-birthday-daily.js';

try {
  const summary = await main(process.argv);
  if (summary?.skipped) process.exit(0);
  if ((summary?.published || 0) + (summary?.dry || 0) === 0 && (summary?.errors || 0) > 0) {
    process.exit(1);
  }
} catch (err) {
  console.error(err);
  process.exit(1);
}
