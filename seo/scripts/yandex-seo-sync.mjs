#!/usr/bin/env node
/**
 * Yandex SEO sync for sitrifor.ru
 * - ensure Webmaster sitemaps
 * - IndexNow (Yandex)
 * - recrawl priority URLs (daily quota)
 * - dump diagnostics + Metrika goals snapshot
 *
 * Usage:
 *   node scripts/yandex-seo-sync.mjs
 *   node scripts/yandex-seo-sync.mjs --dry-run
 *   node scripts/yandex-seo-sync.mjs --recrawl-limit 40
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECRET_NAMES, getSecret, hasSecret } from './yandex-disk/secrets.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEO_ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.resolve(SEO_ROOT, '../public');
const REPORTS = path.join(SEO_ROOT, 'reports/yandex-webmaster');

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const limitIdx = args.indexOf('--recrawl-limit');
const recrawlLimit = limitIdx >= 0 ? Number(args[limitIdx + 1]) || 40 : 40;

function loadEnv() {
  const envPath = path.join(SEO_ROOT, '.env');
  const out = {};
  if (!fs.existsSync(envPath)) return out;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

function readToken(env) {
  if (hasSecret(SECRET_NAMES.webmasterToken)) {
    const t = getSecret(SECRET_NAMES.webmasterToken).trim();
    if (t) return t;
  }
  if (env.YANDEX_OAUTH_TOKEN) return env.YANDEX_OAUTH_TOKEN;
  const p = path.join(SEO_ROOT, 'credentials/yandex-webmaster-token.txt');
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
  return '';
}

async function yw(token, method, urlPath, body) {
  const res = await fetch(`https://api.webmaster.yandex.net/v4${urlPath}`, {
    method,
    headers: {
      Authorization: `OAuth ${token}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  return { ok: res.ok, status: res.status, json };
}

async function ym(token, method, urlPath, body) {
  const res = await fetch(`https://api-metrika.yandex.net${urlPath}`, {
    method,
    headers: {
      Authorization: `OAuth ${token}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  return { ok: res.ok, status: res.status, json };
}

function sitemapLocs(file, max = 50) {
  const p = path.join(PUBLIC, file);
  if (!fs.existsSync(p)) return [];
  const xml = fs.readFileSync(p, 'utf8');
  const locs = [];
  const re = /<loc>([^<]+)<\/loc>/g;
  let m;
  while ((m = re.exec(xml)) && locs.length < max) locs.push(m[1].trim());
  return locs;
}

function priorityUrls() {
  const core = [
    'https://sitrifor.ru/',
    'https://sitrifor.ru/masters',
    'https://sitrifor.ru/634/',
    'https://sitrifor.ru/tools/price-calculator/',
    'https://sitrifor.ru/guides/',
    'https://sitrifor.ru/guides/aftercare/',
    'https://sitrifor.ru/guides/cartridges/',
    'https://sitrifor.ru/guides/pigments/',
    'https://sitrifor.ru/guides/machines/',
    'https://sitrifor.ru/marketplace',
    'https://sitrifor.ru/news',
    'https://sitrifor.ru/about',
    'https://sitrifor.ru/partners',
    'https://sitrifor.ru/exclusive'
  ];
  const hubs = sitemapLocs('sitemap.xml', 30);
  const news = sitemapLocs('sitemap-news.xml', 12);
  // Marketplace product recrawl paused with sitemap (crawl focus on hubs/news).
  const products = [];
  const seen = new Set();
  const out = [];
  for (const u of [...core, ...hubs, ...news, ...products]) {
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

async function ensureSitemaps(token, userId, hostId) {
  // Marketplace sitemap paused for crawl focus on young domain (file stays public).
  const wanted = [
    'https://sitrifor.ru/sitemap.xml',
    'https://sitrifor.ru/sitemap-news.xml'
  ];
  const paused = new Set(['https://sitrifor.ru/sitemap-marketplace.xml']);
  const list = await yw(token, 'GET', `/user/${userId}/hosts/${hostId}/user-added-sitemaps`);
  const entries = (list.json && list.json.sitemaps) || [];
  const byUrl = new Map(entries.map((s) => [s.sitemap_url, s]));
  const added = [];
  const skipped = [];
  const removed = [];
  for (const url of wanted) {
    if (byUrl.has(url)) {
      skipped.push(url);
      continue;
    }
    if (dry) {
      added.push({ url, dry: true });
      continue;
    }
    const r = await yw(token, 'POST', `/user/${userId}/hosts/${hostId}/user-added-sitemaps`, {
      url
    });
    added.push({ url, status: r.status, body: r.json });
  }
  for (const url of paused) {
    const entry = byUrl.get(url);
    if (!entry) continue;
    if (dry) {
      removed.push({ url, sitemapId: entry.sitemap_id, dry: true });
      continue;
    }
    const r = await yw(
      token,
      'DELETE',
      `/user/${userId}/hosts/${hostId}/user-added-sitemaps/${encodeURIComponent(entry.sitemap_id)}`
    );
    removed.push({ url, sitemapId: entry.sitemap_id, status: r.status, body: r.json });
  }
  return {
    have: entries.map((s) => s.sitemap_url),
    added,
    skipped,
    removed,
    listStatus: list.status
  };
}

async function indexNowYandex(env, urls) {
  const key = env.INDEXNOW_KEY;
  if (!key) return { ok: false, error: 'missing INDEXNOW_KEY' };
  if (dry) return { ok: true, dry: true, count: urls.length };
  const body = {
    host: 'sitrifor.ru',
    key,
    keyLocation: `https://sitrifor.ru/${key}.txt`,
    urlList: urls
  };
  const res = await fetch('https://yandex.com/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  return { ok: res.status >= 200 && res.status < 300, status: res.status, body: text.slice(0, 200), count: urls.length };
}

async function recrawlBatch(token, userId, hostId, urls, max) {
  const quota = await yw(token, 'GET', `/user/${userId}/hosts/${hostId}/recrawl/quota`);
  const remainder = (quota.json && quota.json.quota_remainder) || 0;
  const take = urls.slice(0, Math.min(max, remainder));
  const results = [];
  for (const url of take) {
    if (dry) {
      results.push({ url, dry: true });
      continue;
    }
    const r = await yw(token, 'POST', `/user/${userId}/hosts/${hostId}/recrawl/queue`, { url });
    results.push({
      url,
      status: r.status,
      ok: r.status === 200 || r.status === 202 || r.status === 409
    });
  }
  const after = await yw(token, 'GET', `/user/${userId}/hosts/${hostId}/recrawl/quota`);
  return {
    before: quota.json,
    after: after.json,
    submitted: results.length,
    ok: results.filter((r) => r.ok || r.dry).length,
    sample: results.slice(0, 5)
  };
}

async function main() {
  const env = loadEnv();
  const token = readToken(env);
  const userId = env.YANDEX_WEBMASTER_USER_ID;
  const hostId = env.YANDEX_WEBMASTER_HOST_ID || 'https:sitrifor.ru:443';
  const metrikaId = env.YANDEX_METRIKA_ID || '111332527';

  fs.mkdirSync(REPORTS, { recursive: true });

  const report = {
    generatedAt: new Date().toISOString(),
    dry,
    hostId,
    metrikaId,
    steps: {}
  };

  if (!token || !userId) {
    report.error = 'missing YANDEX_OAUTH_TOKEN or YANDEX_WEBMASTER_USER_ID';
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const urls = priorityUrls();
  report.priorityUrlCount = urls.length;

  report.steps.sitemaps = await ensureSitemaps(token, userId, hostId);
  report.steps.indexNow = await indexNowYandex(env, urls.slice(0, 80));
  report.steps.recrawl = await recrawlBatch(token, userId, hostId, urls, recrawlLimit);

  const diag = await yw(token, 'GET', `/user/${userId}/hosts/${hostId}/diagnostics`);
  report.steps.diagnostics = {
    status: diag.status,
    problemsPresent: Object.fromEntries(
      Object.entries((diag.json && diag.json.problems) || {}).filter(
        ([, v]) => v && v.state && !['ABSENT', 'UNDEFINED'].includes(v.state)
      )
    )
  };

  const goals = await ym(token, 'GET', `/management/v1/counter/${metrikaId}/goals`);
  report.steps.metrikaGoals = {
    status: goals.status,
    count: ((goals.json && goals.json.goals) || []).length,
    idents: ((goals.json && goals.json.goals) || []).map((g) => {
      const c = (g.conditions || [])[0] || {};
      return { id: g.id, name: g.name, ident: c.url };
    })
  };

  const day = new Date().toISOString().slice(0, 10);
  const outPath = path.join(REPORTS, `sync-${day}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(REPORTS, 'sync-latest.json'), JSON.stringify(report, null, 2));

  console.log(
    JSON.stringify(
      {
        ok: true,
        dry,
        report: outPath,
        sitemaps: report.steps.sitemaps.skipped?.length,
        indexNow: report.steps.indexNow,
        recrawl: {
          submitted: report.steps.recrawl.submitted,
          ok: report.steps.recrawl.ok,
          quotaAfter: report.steps.recrawl.after
        },
        goals: report.steps.metrikaGoals.count,
        problems: report.steps.diagnostics.problemsPresent
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
