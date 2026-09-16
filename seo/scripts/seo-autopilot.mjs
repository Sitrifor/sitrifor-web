#!/usr/bin/env node
/**
 * Sitrifor SEO Autopilot - recurring improvement loop.
 *
 * Usage:
 *   node seo/scripts/seo-autopilot.mjs
 *   node seo/scripts/seo-autopilot.mjs --dry-run
 *   node seo/scripts/seo-autopilot.mjs --skip-indexnow
 *
 * Env:
 *   SEO_AUTOPILOT_DRY=1
 *   SEO_AUTOPILOT_INDEXNOW=0
 *   SEO_AUTOPILOT_OPTIMIZE=0   - skip news re-optimize
 *   SEO_AUTOPILOT_HUBS=0       - skip hub rebuild
 *   SITE_ORIGIN / INDEXNOW_KEY - via seo/.env
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  optimizeAllPublished,
  writeNewsSitemap,
  renderArticleSsr
} from '../../backend/news-seo/index.js';
import { listPublishedForSitemap, getArticleBySlug } from '../../backend/news.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const SEO_ROOT = path.join(ROOT, 'seo');
const PUBLIC = path.join(ROOT, 'public');
const REPORTS = path.join(SEO_ROOT, 'reports');
const SITE = process.env.SITE_ORIGIN?.replace(/\/$/, '') || 'https://sitrifor.ru';

const argv = process.argv.slice(2);
const dry =
  argv.includes('--dry-run') ||
  argv.includes('--dry') ||
  process.env.SEO_AUTOPILOT_DRY === '1';
const skipIndexNow =
  argv.includes('--skip-indexnow') || process.env.SEO_AUTOPILOT_INDEXNOW === '0';
const skipOptimize = process.env.SEO_AUTOPILOT_OPTIMIZE === '0';
const skipHubs = process.env.SEO_AUTOPILOT_HUBS === '0';

function today() {
  return new Date().toISOString().slice(0, 10);
}

function loadJson(p, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function loadEnvFile() {
  const envPath = path.join(SEO_ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].trim();
  }
}

async function runNode(scriptRel, args = [], opts = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(
      'node',
      [scriptRel, ...args],
      {
        cwd: opts.cwd || SEO_ROOT,
        env: process.env,
        timeout: opts.timeout || 120000,
        maxBuffer: 4 * 1024 * 1024
      }
    );
    return { ok: true, stdout: String(stdout || ''), stderr: String(stderr || '') };
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      stdout: String(err.stdout || ''),
      stderr: String(err.stderr || '')
    };
  }
}

function auditStaticPage(filePath, expectedCanonical) {
  const issues = [];
  if (!fs.existsSync(filePath)) {
    return [{ severity: 'error', code: 'missing_file', file: filePath }];
  }
  const html = fs.readFileSync(filePath, 'utf8');
  const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
  const canonical = (html.match(/rel="canonical"\s+href="([^"]+)"/i) || [])[1] || '';
  const robots = (html.match(/name="robots"\s+content="([^"]+)"/i) || [])[1] || '';
  const og = /property="og:title"/i.test(html);
  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '';
  const textish = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ');
  const words = textish.trim().split(/\s+/).filter(Boolean).length;

  if (!title || /Новость\s*\|/i.test(title) || title.length < 12) {
    issues.push({ severity: 'warn', code: 'thin_or_generic_title', title });
  }
  if (!canonical) issues.push({ severity: 'error', code: 'missing_canonical' });
  if (expectedCanonical && canonical && canonical !== expectedCanonical) {
    issues.push({
      severity: 'error',
      code: 'wrong_canonical',
      got: canonical,
      expected: expectedCanonical
    });
  }
  if (!og) issues.push({ severity: 'warn', code: 'missing_og_title' });
  if (!h1 || /Загрузка/i.test(h1)) {
    issues.push({ severity: 'error', code: 'missing_or_loading_h1' });
  }
  if (words < 120) issues.push({ severity: 'warn', code: 'thin_copy', words });
  if (/noindex/i.test(robots)) issues.push({ severity: 'info', code: 'noindex', robots });
  if (/Загрузка…|Загрузка\.\.\./i.test(html) && /data-news-article/i.test(html)) {
    issues.push({ severity: 'error', code: 'ssr_shell_risk' });
  }
  return issues;
}

function keywordGapReport() {
  const csvPath = path.join(REPORTS, 'keyword-universe-tattoo-ru.csv');
  const manifest = loadJson(path.join(SEO_ROOT, 'content/hubs/manifest.json'), { hubs: [] });
  const covered = new Set(
    (manifest.hubs || []).map((h) => h.cluster).filter((c) => c && c !== 'cross')
  );
  const gaps = [];
  if (!fs.existsSync(csvPath)) {
    return { ok: false, reason: 'missing_keyword_csv', gaps: [] };
  }
  const lines = fs.readFileSync(csvPath, 'utf8').split('\n').slice(1);
  const byCluster = new Map();
  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.split(',');
    const cluster = parts[1];
    const priority = parts[5];
    const hint = parts[4];
    if (priority !== '1') continue;
    if (!cluster) continue;
    if (!byCluster.has(cluster)) byCluster.set(cluster, { priority1: 0, editorial: 0 });
    const row = byCluster.get(cluster);
    row.priority1 += 1;
    if (/editorial/i.test(hint || '')) row.editorial += 1;
  }
  for (const [cluster, stats] of [...byCluster.entries()].sort(
    (a, b) => b[1].priority1 - a[1].priority1
  )) {
    if (!covered.has(cluster)) {
      gaps.push({
        cluster,
        priority1: stats.priority1,
        editorial: stats.editorial,
        status: 'missing_hub'
      });
    }
  }
  return {
    ok: true,
    covered: [...covered],
    gaps: gaps.slice(0, 20)
  };
}

function injectNewsListSsr() {
  const newsPath = path.join(PUBLIC, 'news.html');
  if (!fs.existsSync(newsPath)) return { ok: false, reason: 'news.html_missing' };
  let html = fs.readFileSync(newsPath, 'utf8');
  const items = listPublishedForSitemap({ limit: 24 });
  const lis = items
    .map((a) => {
      const href = `/news/a/${encodeURI(a.slug)}`;
      const title = String(a.title || a.slug)
        .replace(/\u2014/g, '-')
        .replace(/\u2013/g, '-');
      const day = (a.published_at || a.day || '').slice(0, 10);
      return `      <li><a href="${href}">${title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</a>${
        day ? ` <time datetime="${day}">${day}</time>` : ''
      }</li>`;
    })
    .join('\n');

  // Must stay visually hidden: a visible list between .news-bar and main.news-feed
  // created a full-page gap. Keep both news-ssr-index and sr-only.
  const block = `<!--seo-autopilot:news-ssr-index-->
  <section class="news-ssr-index sr-only" data-news-ssr-index aria-label="Свежие материалы">
    <h1 class="news-ssr-index__title">Новости для тату-мастеров</h1>
    <p class="news-ssr-index__lead">Индекс последних публикаций для поиска и навигации. Полная лента ниже подгружается интерактивно.</p>
    <ul class="news-ssr-index__list">
${lis}
    </ul>
  </section>
  <!--/seo-autopilot:news-ssr-index-->`;

  if (!/class="news-ssr-index sr-only"/i.test(block)) {
    return { ok: false, reason: 'ssr_index_template_missing_sr_only', dry };
  }

  if (/<!--seo-autopilot:news-ssr-index-->[\s\S]*?<!--\/seo-autopilot:news-ssr-index-->/.test(html)) {
    html = html.replace(
      /<!--seo-autopilot:news-ssr-index-->[\s\S]*?<!--\/seo-autopilot:news-ssr-index-->/,
      block
    );
  } else {
    html = html.replace(
      /<main class="container news-feed"[^>]*>/,
      `${block}\n  <main class="container news-feed" data-news-feed>`
    );
  }

  // Ensure unique SEO title remains
  if (!dry) fs.writeFileSync(newsPath, html);

  const written = dry ? html : fs.readFileSync(newsPath, 'utf8');
  const indexOpen = (written.match(
    /<!--seo-autopilot:news-ssr-index-->[\s\S]*?<section\b[^>]*>/i
  ) || [])[0] || '';
  const visuallyHidden =
    /\bnews-ssr-index\b/.test(indexOpen) && /\bsr-only\b/.test(indexOpen);
  if (!visuallyHidden) {
    return {
      ok: false,
      reason: 'ssr_index_not_visually_hidden_after_inject',
      items: items.length,
      dry
    };
  }

  return { ok: true, items: items.length, dry, visuallyHidden: true };
}

function sampleArticleAudits(limit = 5) {
  const rows = listPublishedForSitemap({ limit });
  const out = [];
  for (const row of rows) {
    const article = getArticleBySlug(row.slug, { lang: 'ru', publishedOnly: true });
    if (!article) {
      out.push({ slug: row.slug, issues: [{ code: 'not_found' }] });
      continue;
    }
    const page = renderArticleSsr(article);
    const issues = [];
    if (page.status !== 200) issues.push({ code: 'ssr_status', status: page.status });
    const title = (page.html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
    const canonical = (page.html.match(/rel="canonical"\s+href="([^"]+)"/i) || [])[1] || '';
    if (/\/news"?\s*$/.test(canonical) || canonical.endsWith('/news')) {
      issues.push({ code: 'canonical_points_to_feed', canonical });
    }
    if (/Загрузка/i.test(page.html) && !/<h1[^>]*>[^<]{8,}/i.test(page.html)) {
      issues.push({ code: 'loading_shell' });
    }
    if (!/application\/ld\+json/i.test(page.html)) issues.push({ code: 'missing_jsonld' });
    if (!article.seo?.ready) issues.push({ code: 'seo_not_ready' });
    out.push({
      slug: row.slug,
      title,
      canonical,
      seoReady: Boolean(article.seo?.ready),
      issues
    });
  }
  return out;
}

async function soft404Probe() {
  const url = `${SITE}/news/a/seo-autopilot-missing-${Date.now()}`;
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'manual' });
    return {
      url,
      status: res.status,
      ok: res.status === 404
    };
  } catch (err) {
    return { url, ok: false, error: err.message };
  }
}

async function siteProbe() {
  // Lightweight crawl-health without paid APIs: fetch homepage + one hub, check title
  const urls = [`${SITE}/`, `${SITE}/guides/aftercare/`, `${SITE}/634/`];
  const results = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      const html = await res.text();
      const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
      results.push({
        url,
        status: res.status,
        title,
        hasCanonical: /rel="canonical"/i.test(html),
        ok: res.status === 200 && title.length > 8
      });
    } catch (err) {
      results.push({ url, ok: false, error: err.message });
    }
  }
  return results;
}

async function gscHook() {
  const cred = path.join(SEO_ROOT, 'credentials/gsc-service-account.json');
  const checklist = path.join(REPORTS, 'gsc/README.md');
  if (!fs.existsSync(cred)) {
    return {
      status: 'awaiting_credentials',
      checklist,
      note: 'Place service account JSON at seo/credentials/gsc-service-account.json then re-run autopilot'
    };
  }
  if (dry) {
    return { status: 'credentials_present', dry: true, path: cred };
  }
  loadEnvFile();
  const { spawnSync } = await import('child_process');
  const py = path.join(SEO_ROOT, '.venv/bin/python');
  const script = path.join(SEO_ROOT, 'scripts/gsc_client.py');
  const r = spawnSync(py, [script, 'report'], {
    cwd: SEO_ROOT,
    encoding: 'utf8',
    env: process.env,
    timeout: 180000
  });
  const latest = path.join(REPORTS, 'gsc/status-latest.json');
  let need = [];
  if (fs.existsSync(latest)) {
    try {
      const j = JSON.parse(fs.readFileSync(latest, 'utf8'));
      need = j.needRequestIndexing || [];
    } catch {
      /* ignore */
    }
  }
  return {
    status: r.status === 0 ? 'report_ok' : 'report_failed',
    path: cred,
    exitCode: r.status,
    stderr: (r.stderr || '').slice(0, 500),
    stdout: (r.stdout || '').slice(0, 800),
    needRequestIndexing: need,
    latest
  };
}

async function yandexHook() {
  const tokenPath = path.join(SEO_ROOT, 'credentials/yandex-webmaster-token.txt');
  const checklist = path.join(REPORTS, 'yandex-webmaster/README.md');
  loadEnvFile();
  const hasToken = fs.existsSync(tokenPath) || Boolean(process.env.YANDEX_OAUTH_TOKEN);
  if (!hasToken) {
    return { status: 'awaiting_credentials', checklist };
  }
  if (dry) {
    return { status: 'credentials_present', dry: true, checklist };
  }
  const run = await runNode('scripts/yandex-seo-sync.mjs', ['--recrawl-limit', '25'], {
    cwd: SEO_ROOT,
    timeout: 120000
  });
  let parsed = {};
  try {
    parsed = JSON.parse(run.stdout || '{}');
  } catch {
    parsed = { raw: (run.stdout || '').slice(0, 400) };
  }
  return {
    status: run.ok !== false ? 'synced' : 'error',
    checklist,
    ...parsed,
    error: run.error
  };
}

function appendMarkdownSummary(day, report) {
  const mdPath = path.join(REPORTS, 'seo-autopilot-log.md');
  const lines = [
    '',
    `## ${day} ${report.startedAt}`,
    '',
    `- dry: ${report.dry}`,
    `- hubs built: ${report.hubs?.built ?? 'skipped'}`,
    `- news optimize: ${JSON.stringify(report.optimize?.summary || report.optimize || {})}`,
    `- news sitemap urls: ${report.newsSitemap?.urls ?? 'n/a'}`,
    `- news list SSR items: ${report.newsListSsr?.items ?? 'n/a'}`,
    `- static issues: ${report.staticAudit?.issueCount ?? 0}`,
    `- keyword gaps: ${report.keywordGaps?.gaps?.length ?? 0}`,
    `- soft404 ok: ${report.soft404?.ok}`,
    `- indexnow: ${report.indexNow?.ok ?? report.indexNow?.skipped ?? 'n/a'}`,
    `- gsc: ${report.gsc?.status}`,
    ''
  ];
  fs.appendFileSync(mdPath, lines.join('\n'));
  return mdPath;
}

async function main() {
  loadEnvFile();
  fs.mkdirSync(REPORTS, { recursive: true });
  const day = today();
  const startedAt = new Date().toISOString();
  const report = {
    day,
    startedAt,
    dry,
    site: SITE,
    steps: []
  };

  // 1) Rebuild hubs + main sitemap
  if (!skipHubs) {
    let hubs;
    if (dry) {
      hubs = { ok: true, skipped: true, reason: 'dry-run' };
    } else {
      const run = await runNode('scripts/build-hubs.mjs', [], { cwd: SEO_ROOT });
      let parsed = {};
      try {
        parsed = JSON.parse(run.stdout || '{}');
      } catch {
        parsed = { raw: (run.stdout || '').slice(0, 400) };
      }
      hubs = { ok: run.ok !== false, ...parsed, error: run.error };
    }
    report.hubs = hubs;
    report.steps.push('hubs');
  } else {
    report.hubs = { skipped: true };
  }

  // 2) Re-optimize news failing QA / not ready
  if (!skipOptimize) {
    const opt = await optimizeAllPublished({
      dry,
      injectLinks: process.env.NEWS_SEO_INJECT_LINKS !== '0'
    });
    report.optimize = {
      summary: {
        total: opt.total,
        ready: opt.ready,
        failed: opt.failed,
        failReasons: opt.failReasons || []
      }
    };
    report.steps.push('optimize_news');
  } else {
    report.optimize = { skipped: true };
  }

  // 3) News sitemap
  if (!dry) {
    report.newsSitemap = writeNewsSitemap();
  } else {
    report.newsSitemap = { dry: true };
  }
  report.steps.push('news_sitemap');

  // 4) News list SSR index in news.html
  report.newsListSsr = injectNewsListSsr();
  report.steps.push('news_list_ssr');

  // 5) Static audits (hubs + key pages)
  const staticTargets = [
    ['index.html', `${SITE}/`],
    ['guides/index.html', `${SITE}/guides/`],
    ['guides/aftercare/index.html', `${SITE}/guides/aftercare/`],
    ['guides/cartridges/index.html', `${SITE}/guides/cartridges/`],
    ['guides/pigments/index.html', `${SITE}/guides/pigments/`],
    ['tools/price-calculator/index.html', `${SITE}/tools/price-calculator/`],
    ['634/index.html', `${SITE}/634/`],
    ['news.html', `${SITE}/news`],
    ['about.html', `${SITE}/about`],
    ['masters.html', `${SITE}/masters`]
  ];
  const staticAudit = [];
  let issueCount = 0;
  for (const [rel, canon] of staticTargets) {
    const issues = auditStaticPage(path.join(PUBLIC, rel), canon);
    issueCount += issues.filter((i) => i.severity !== 'info').length;
    staticAudit.push({ file: rel, issues });
  }
  report.staticAudit = { issueCount, pages: staticAudit };
  report.steps.push('static_audit');

  // 6) Sample SSR article audits
  report.articleAudits = sampleArticleAudits(6);
  report.steps.push('article_audit');

  // 7) Keyword gaps
  report.keywordGaps = keywordGapReport();
  report.steps.push('keyword_gaps');

  // 8) Soft-404 + live probes
  report.soft404 = await soft404Probe();
  report.liveProbes = await siteProbe();
  report.steps.push('live_probes');

  // 9) IndexNow for hubs + news (conservative list)
  if (skipIndexNow || dry) {
    report.indexNow = { skipped: true, reason: dry ? 'dry-run' : 'disabled' };
  } else {
    const hubPaths = (loadJson(path.join(SEO_ROOT, 'content/hubs/manifest.json'), { hubs: [] }).hubs || []).map(
      (h) => h.path
    );
    const recent = listPublishedForSitemap({ limit: 8 }).map((a) => `/news/a/${a.slug}`);
    const paths = ['/', '/news', '/guides/', ...hubPaths, ...recent];
    report.indexNow = await runNode('scripts/indexnow.mjs', paths, {
      cwd: SEO_ROOT,
      timeout: 45000
    });
  }
  report.steps.push('indexnow');

  // 10) GSC / Yandex hooks (no fake access)
  report.gsc = await gscHook();
  report.yandex = await yandexHook();
  report.steps.push('webmaster_hooks');

  report.finishedAt = new Date().toISOString();
  const jsonPath = path.join(REPORTS, `autopilot-${day}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  // also latest pointer
  fs.writeFileSync(path.join(REPORTS, 'autopilot-latest.json'), JSON.stringify(report, null, 2));
  const mdPath = appendMarkdownSummary(day, report);

  console.log(
    JSON.stringify(
      {
        ok: true,
        dry,
        report: jsonPath,
        log: mdPath,
        summary: {
          hubs: report.hubs?.built ?? report.hubs?.skipped,
          optimize: report.optimize?.summary,
          staticIssues: report.staticAudit?.issueCount,
          keywordGaps: report.keywordGaps?.gaps?.length,
          soft404: report.soft404?.ok,
          gsc: report.gsc?.status
        }
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message, stack: err.stack }, null, 2));
  process.exit(1);
});
