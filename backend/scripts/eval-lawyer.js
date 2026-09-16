#!/usr/bin/env node
/**
 * Golden-set regression for /lawyer LegalFrame pipeline.
 * Exit 1 if any case fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const GOLDEN =
  process.env.LAWYER_GOLDEN ||
  path.join(ROOT, 'data/lawyer-eval/golden.json');

async function main() {
  const { extractLegalFrame, searchByFrame, consultLaws, retrievalConfidence, lawyerStats } =
    await import(path.join(ROOT, 'lawyer.js'));

  const stats = lawyerStats();
  if (!stats.ready) {
    console.error('FAIL: laws.db not ready');
    process.exit(1);
  }

  const cases = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  const results = [];
  let failed = 0;

  for (const c of cases) {
    const errors = [];
    const frame = extractLegalFrame(c.question, c.context || '');
    const hits = searchByFrame(frame, { limit: 5 });
    const conf = retrievalConfidence(frame, hits);
    const consult = await consultLaws({
      question: c.question,
      context: c.context || '',
      limit: 3
    });

    const exp = c.expect || {};
    const answer = String(consult.answer || '');
    const sources = consult.sources || [];
    const headings = sources.map((s) => `${s.heading || ''}`.toLowerCase()).join('\n');
    const docs = sources.map((s) => s.doc_number);

    if (exp.jurisdiction && frame.jurisdiction !== exp.jurisdiction) {
      errors.push(`jurisdiction ${frame.jurisdiction} != ${exp.jurisdiction}`);
    }
    if (exp.refuse) {
      if (sources.length > (exp.maxSources ?? 0)) {
        errors.push(`refuse expected but sources=${sources.length}`);
      }
      if (!/слишком общий|не удалось|уточните/i.test(answer)) {
        errors.push('refuse answer text missing');
      }
    } else {
      for (const doc of exp.mustDocNumbers || []) {
        if (!docs.includes(doc)) errors.push(`missing doc ${doc} (got ${docs.join(',')})`);
      }
      for (const re of exp.mustHeadingRe || []) {
        if (!new RegExp(re, 'i').test(headings) && !new RegExp(re, 'i').test(hits.map((h) => h.heading).join('\n'))) {
          errors.push(`heading missing /${re}/`);
        }
      }
      for (const re of exp.forbidHeadingRe || []) {
        if (new RegExp(re, 'i').test(headings)) errors.push(`forbidden heading /${re}/`);
      }
      for (const s of exp.answerMustInclude || []) {
        if (!answer.includes(s)) errors.push(`answer missing «${s}»`);
      }
      for (const s of exp.answerMustNotInclude || []) {
        if (answer.includes(s)) errors.push(`answer has forbidden «${s}»`);
      }
      if (typeof exp.minConfidence === 'number' && (consult.confidence ?? conf) < exp.minConfidence) {
        errors.push(`confidence ${(consult.confidence ?? conf).toFixed(2)} < ${exp.minConfidence}`);
      }
    }

    const ok = errors.length === 0;
    if (!ok) failed += 1;
    results.push({
      id: c.id,
      ok,
      errors,
      jurisdiction: frame.jurisdiction,
      confidence: consult.confidence ?? conf,
      docs,
      refuse: Boolean(exp.refuse)
    });
    console.log(ok ? 'PASS' : 'FAIL', c.id, ok ? '' : errors.join('; '));
  }

  const summary = {
    ok: failed === 0,
    total: cases.length,
    failed,
    passed: cases.length - failed,
    embeddings: stats.embeddings || 0,
    chunks: stats.chunks || 0,
    results
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
