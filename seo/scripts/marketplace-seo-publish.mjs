#!/usr/bin/env node
/**
 * Publish marketplace SEO artifacts: filtered sitemap, catalog JSON-LD/grid seed, IndexNow.
 *
 *   node seo/scripts/marketplace-seo-publish.mjs
 *   node seo/scripts/marketplace-seo-publish.mjs --skip-indexnow
 */
import { publishMarketplaceSeo } from '../../backend/marketplace/index.js';

const args = process.argv.slice(2);
const skipIndexNow = args.includes('--skip-indexnow') || args.includes('--dry');

const result = await publishMarketplaceSeo({
  skipIndexNow,
  dry: args.includes('--dry')
});
console.log(JSON.stringify(result, null, 2));
