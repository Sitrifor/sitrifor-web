#!/usr/bin/env node
/**
 * Publish one daily tattoo-industry editorial post (rotation + grounded draft + optional LLM tips).
 * Goes through publishComposed so daily cannot bypass the editorial gate.
 *
 * Usage:
 *   node scripts/news-daily-post.mjs
 *   node scripts/news-daily-post.mjs --topic stories-hooks
 *   node scripts/news-daily-post.mjs --dry-run
 */
import {
  composeDailyPost,
  rememberDailyPost,
  unloadModel,
  loadState
} from '../../backend/news-daily-writer.js';
import { publishComposed } from '../../backend/news-publish/index.js';
import { newsStats } from '../../backend/news.js';

const dry = process.argv.includes('--dry-run') || process.argv.includes('--dry');
const topicIdx = process.argv.indexOf('--topic');
const forceTopicId = topicIdx >= 0 ? process.argv[topicIdx + 1] : null;

const composed = await composeDailyPost({ forceTopicId });
console.log(
  JSON.stringify(
    {
      day: composed.day,
      topicId: composed.topicId,
      title: composed.title,
      usedLlm: composed.usedLlm,
      research: composed.researchCount,
      bodyLen: composed.body.length,
      score: composed.usefulScore,
      editorialOk: composed.editorialOk,
      publishOk: composed.publishOk,
      dry,
      prevState: loadState()
    },
    null,
    2
  )
);

const pub = await publishComposed(composed, {
  sourceKey: 'sitrifor-daily-ai',
  guid: composed.guid,
  url: `https://sitrifor.ru/news#daily-${composed.day}-${composed.topicId}`,
  imageUrl: composed.imageUrl,
  dry
});

if (pub.status === 'rejected') {
  console.error('REJECTED_EDITORIAL_GATE', {
    usefulReasons: composed.usefulReasons || [],
    gateReasons: pub.gateReasons || [],
    reason: pub.reason
  });
} else if (pub.status === 'dry') {
  console.log('---BODY---');
  console.log((pub.preview || composed.body || '').slice(0, 1200));
} else if (pub.status === 'published') {
  rememberDailyPost(composed);
  console.log('PUBLISHED', pub.slug);
} else if (pub.status === 'exists') {
  console.log('EXISTS', composed.guid, '(already published for this day/topic)');
}

await unloadModel();
console.log(JSON.stringify({ stats: newsStats(), publish: { status: pub.status, reason: pub.reason || null } }, null, 2));
