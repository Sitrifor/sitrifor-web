#!/usr/bin/env node
/**
 * Product / SEO copy QA for masters app block and related surfaces.
 *
 *   node scripts/product-copy-qa.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(__dirname, '../reports/visual');

const FILES = [
  'public/masters.html',
  'public/index.html',
  'public/js/i18n-dict.js',
  'public/634/index.html',
  'seo/content/hubs/app-634.json'
];

/** Hard bans - jargon / calques */
const BANNED = [
  { id: 'u_kresla', re: /у кресла|перед креслом|at the chair|am Stuhl|vor dem Stuhl/i, hint: 'Use «перед сеансом» / «в работе» / «в студии»' },
  { id: 'ne_crm_obryvok', re: /Не CRM записи|Not booking CRM|Kein Buchungs-CRM/i, hint: 'Full sentence about booking/checkout' },
  { id: 'utp_label_ui', re: />УТП:<|>USP:<|>UTP:</, hint: 'No УТП:/USP: labels in UI' },
  { id: 'source_of_truth', re: /источник правды|source of truth|Wahrheitsquelle/i, hint: 'Avoid EN calque' },
  { id: 'workbench_calque', re: /\bworkbench\b|value props/i, hint: 'Avoid EN product jargon' },
  {
    id: 'vague_continuation',
    re: /на продолжение(?! (этой|тату|работ|рукав))|приходит на продолжение|returns for a continuation(?! on)|für eine Fortsetzung(?! )/i,
    hint: 'Say what continues: next session on the same tattoo / sleeve'
  },
  {
    id: 'vague_client_arrives',
    re: /Когда клиент приходит на продолжение|Когда клиент возвращается на продолжение|When a client returns for a continuation(?! on)|Wenn ein Kunde (?:kommt|zurückkommt) für eine Fortsetzung/i,
    hint: 'Name whose client and for which tattoo/session'
  },
  {
    id: 'vague_shift_color',
    re: /войти в колор|перед сменой(?! с)|before a packed shift|vor der Schicht(?! )/i,
    hint: 'Prefer «перед сеансом» + what you prepare'
  },
  {
    id: 'unit_of_work_calque',
    re: /единица работы|unit of work|Arbeitseinheit/i,
    hint: 'Say «проект под татуировку клиента» instead'
  }
];

/** Masters feature bodies must anchor WHO/WHAT */
const MASTERS_ANCHOR_KEYS = [
  'app.feat.projects.text',
  'app.feat.pipette.text',
  'app.feat.match.text',
  'app.feat.labels.text',
  'app.feat.dominant.text',
  'app.feat.inventory.text',
  'app.feat.brands.text',
  'app.feat.share.text'
];

fs.mkdirSync(OUT, { recursive: true });

const checks = [];
function check(id, ok, detail) {
  checks.push({ id, ok: Boolean(ok), detail });
}

function extractI18nValue(dictText, locale, key) {
  // Find locale block then key
  const locRe = new RegExp(`"${locale}"\\s*:\\s*\\{`);
  const locM = locRe.exec(dictText);
  if (!locM) return null;
  const start = locM.index;
  const nextLoc = dictText.slice(start + 1).search(/"(?:en|de|ru)"\s*:\s*\{/);
  const block =
    nextLoc >= 0 && locale !== 'de'
      ? dictText.slice(start, start + 1 + nextLoc)
      : dictText.slice(start);
  const keyRe = new RegExp(`"${key.replace(/\./g, '\\.')}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`);
  const km = keyRe.exec(block);
  if (!km) return null;
  return km[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

for (const rel of FILES) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    check(`${rel}:exists`, false, 'missing file');
    continue;
  }
  const text = fs.readFileSync(abs, 'utf8');
  for (const ban of BANNED) {
    const m = text.match(ban.re);
    check(`${rel}:${ban.id}`, !m, m ? `Found «${m[0]}» - ${ban.hint}` : 'clean');
  }
}

// Referential clarity on RU masters feature strings in i18n
const dictAbs = path.join(ROOT, 'public/js/i18n-dict.js');
const dictText = fs.readFileSync(dictAbs, 'utf8');
for (const key of MASTERS_ANCHOR_KEYS) {
  const val = extractI18nValue(dictText, 'ru', key);
  if (!val) {
    check(`anchor:${key}:exists`, false, 'RU key missing');
    continue;
  }
  const hasTattooOrProject = /татуировк|проект|эскиз|сеанс|флакон|клиент/.test(val);
  const hasVagueBareContinuation = /на продолжение(?! (этой|тату|работ|рукав))/.test(val);
  check(
    `anchor:${key}:concrete`,
    hasTattooOrProject && !hasVagueBareContinuation,
    hasTattooOrProject
      ? hasVagueBareContinuation
        ? 'Contains bare «на продолжение»'
        : 'ok'
      : 'Feature text must name tattoo/project/session/client/ink concretely'
  );
  // Prefer explicit same-work wording for projects/labels/share/match
  if (/projects|labels|share|match/.test(key)) {
    const hasSameWork =
      /этой же татуировк|этой же работ|той же работ|по этой же|того же тон|согласованн|утвержд[её]нн|с прошлой сессии|продолжении рукава/.test(
        val
      );
    check(
      `anchor:${key}:same_work`,
      hasSameWork,
      hasSameWork ? 'ok' : 'Tie the sentence to the same tattoo / approved sketch / same tone'
    );
  }
}

// HTML fallback: no vague projects line; concrete tattoo wording lives in i18n anchors above
const mastersHtml = fs.readFileSync(path.join(ROOT, 'public/masters.html'), 'utf8');
check(
  'masters:html_no_old_projects_line',
  !/Когда клиент приходит на продолжение/.test(mastersHtml),
  'Old vague projects sentence must be removed from masters.html'
);

// Structural integrity of /masters (tabs must stay a full document)
const MASTERS_STRUCTURE = [
  { id: 'masters:struct_html_closed', ok: /<\/html>\s*$/i.test(mastersHtml.trim()), detail: 'masters.html must end with </html>' },
  { id: 'masters:struct_footer', ok: /<footer[\s>]/.test(mastersHtml), detail: 'masters.html must include <footer>' },
  {
    id: 'masters:struct_tabs',
    ok: ['app', 'care', 'calculator'].every((t) =>
      new RegExp(`data-service-tab="${t}"`).test(mastersHtml)
    ),
    detail: 'Need three data-service-tab: app, care, calculator'
  },
  {
    id: 'masters:struct_panel_care',
    ok: /data-service-panel="care"/.test(mastersHtml) && /id="care"/.test(mastersHtml),
    detail: 'Need care tab panel (data-service-panel + id="care")'
  },
  {
    id: 'masters:struct_panel_calculator',
    ok: /data-service-panel="calculator"/.test(mastersHtml) && /id="calculator"/.test(mastersHtml),
    detail: 'Need calculator tab panel (data-service-panel + id="calculator")'
  },
  {
    id: 'masters:struct_care_flow',
    ok: /data-care-flow/.test(mastersHtml),
    detail: 'Care panel must mount data-care-flow'
  },
  {
    id: 'masters:struct_calc_form',
    ok: /data-calc-form/.test(mastersHtml),
    detail: 'Calculator panel must mount data-calc-form'
  },
  {
    id: 'masters:struct_script_service_tabs',
    ok: /service-tabs\.js/.test(mastersHtml),
    detail: 'Must load service-tabs.js'
  },
  {
    id: 'masters:struct_script_care_flow',
    ok: /care-flow\.js/.test(mastersHtml),
    detail: 'Must load care-flow.js'
  },
  {
    id: 'masters:struct_script_tattoo_calculator',
    ok: /tattoo-calculator\.js/.test(mastersHtml),
    detail: 'Must load tattoo-calculator.js'
  }
];
for (const row of MASTERS_STRUCTURE) {
  check(row.id, row.ok, row.ok ? 'ok' : row.detail);
}

const failed = checks.filter((c) => !c.ok);
const report = {
  generatedAt: new Date().toISOString(),
  passed: failed.length === 0,
  failedCount: failed.length,
  failed: failed.map((f) => ({ id: f.id, detail: f.detail })),
  checks
};

fs.writeFileSync(path.join(OUT, 'product-copy-qa-latest.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: report.passed, failedCount: report.failedCount, failed: report.failed }, null, 2));
process.exit(failed.length ? 2 : 0);
