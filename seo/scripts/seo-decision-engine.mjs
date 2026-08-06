#!/usr/bin/env node
/**
 * SEO decision engine — reads first-party analytics (non-unique users = visits)
 * and applies safe automatic improvements.
 *
 * Usage:
 *   node scripts/seo-decision-engine.mjs
 *   node scripts/seo-decision-engine.mjs --dry-run
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEO_ROOT = path.resolve(__dirname, "..");
const REPORTS = path.join(SEO_ROOT, "reports");
const PUBLIC = path.resolve(SEO_ROOT, "../public");
const SITEMAP = path.join(PUBLIC, "sitemap.xml");
const DRY = process.argv.includes("--dry-run");

const API = process.env.ANALYTICS_API || "http://127.0.0.1:8081";
const TOKEN = process.env.ANALYTICS_TOKEN || "";

fs.mkdirSync(REPORTS, { recursive: true });

async function api(pathname, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (TOKEN) headers["x-analytics-token"] = TOKEN;
  const res = await fetch(`${API}${pathname}`, { ...opts, headers });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${pathname} → ${res.status} ${t}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function pctChange(cur, prev) {
  if (prev === 0) return cur > 0 ? 100 : 0;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

function updateSitemapLastmod(paths) {
  if (!fs.existsSync(SITEMAP) || !paths.length) return false;
  let xml = fs.readFileSync(SITEMAP, "utf8");
  const today = new Date().toISOString().slice(0, 10);
  let changed = false;
  for (const p of paths) {
    const loc = `https://sitrifor.ru${p === "/" ? "/" : p}`;
    const re = new RegExp(
      `(<loc>${loc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</loc>\\s*<lastmod>)[^<]+(</lastmod>)`,
      "m"
    );
    if (re.test(xml)) {
      xml = xml.replace(re, `$1${today}$2`);
      changed = true;
    }
  }
  if (changed && !DRY) fs.writeFileSync(SITEMAP, xml);
  return changed;
}

function bumpKeywordPriorities(weakPaths) {
  const seedsPath = path.join(REPORTS, "keyword-seeds-latest.json");
  if (!fs.existsSync(seedsPath)) return null;
  const data = JSON.parse(fs.readFileSync(seedsPath, "utf8"));
  const map = {
    "/masters": ["приложение для тату-мастера", "калькулятор стоимости тату", "уход за тату"],
    "/": ["приложение для тату-мастера", "бренд / trust"],
    "/partners": ["партнёрам / B2B"],
    "/about": ["бренд / trust"],
  };
  const boost = new Set();
  for (const p of weakPaths) {
    for (const c of map[p] || []) boost.add(c);
  }
  if (!boost.size) return null;
  for (const cluster of data.clusters || []) {
    if (boost.has(cluster.cluster)) cluster.priority = 1;
  }
  data.engineNote = {
    at: new Date().toISOString(),
    boosted: [...boost],
    reason: "low_or_declining_visits",
  };
  if (!DRY) fs.writeFileSync(seedsPath, JSON.stringify(data, null, 2));
  return [...boost];
}

function runIndexNow(paths) {
  if (DRY) return { skipped: true };
  try {
    const args = ["scripts/indexnow.mjs", ...paths];
    const out = execFileSync("node", args, { cwd: SEO_ROOT, encoding: "utf8" });
    return { ok: true, out: out.slice(0, 500) };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

async function recordDecision(decision) {
  if (DRY) return { dryRun: true, ...decision };
  try {
    return await api("/api/analytics/decisions", {
      method: "POST",
      body: JSON.stringify(decision),
    });
  } catch (e) {
    return { error: String(e.message || e), decision };
  }
}

async function main() {
  const summary = await api("/api/analytics/summary?days=14");
  const decisions = [];
  const applied = [];

  const byPath = summary.byPath || [];
  const byDay = summary.byDay || [];

  // Split last 7 vs previous 7 for trend
  const daysSorted = [...byDay].sort((a, b) => a.day.localeCompare(b.day));
  const last7 = daysSorted.slice(-7);
  const prev7 = daysSorted.slice(-14, -7);
  const sumVisits = (rows) => rows.reduce((s, r) => s + (r.visits || 0), 0);
  const curVisits = sumVisits(last7);
  const prevVisits = sumVisits(prev7);
  const siteDelta = pctChange(curVisits, prevVisits);

  decisions.push({
    decisionType: "site_traffic_trend",
    severity: siteDelta < -15 ? "warning" : siteDelta > 15 ? "info" : "info",
    rationale: `Неуникальные пользователи (визиты): ${curVisits} за 7д vs ${prevVisits} предыдущие 7д (${siteDelta}%).`,
    metrics: {
      nonUniqueUsers7d: curVisits,
      nonUniqueUsersPrev7d: prevVisits,
      deltaPct: siteDelta,
      pageviews14d: summary.pageviews,
      uniqueVisitors14d: summary.uniqueVisitors,
    },
    action: { type: "observe" },
    status: "applied",
  });

  const weakPaths = [];
  const hotPaths = [];
  const pingPaths = new Set();

  for (const row of byPath) {
    const series = (await api(`/api/analytics/path?path=${encodeURIComponent(row.path)}&days=14`))
      .series || [];
    const recent = series.slice(-7);
    const older = series.slice(-14, -7);
    const rVisits = recent.reduce((s, x) => s + (x.visits || 0), 0);
    const oVisits = older.reduce((s, x) => s + (x.visits || 0), 0);
    const delta = pctChange(rVisits, oVisits);

    if (rVisits === 0 && ["/", "/masters", "/partners", "/about"].includes(row.path)) {
      weakPaths.push(row.path);
      pingPaths.add(row.path);
      decisions.push({
        decisionType: "zero_visits_core_page",
        path: row.path,
        severity: "warning",
        rationale: `Ядерная страница ${row.path} без визитов за 7 дней — переиндексация IndexNow + приоритет контента.`,
        metrics: { visits7d: rVisits },
        action: { type: "indexnow_and_boost_keywords", paths: [row.path] },
        status: "proposed",
      });
    } else if (delta <= -25 && oVisits >= 3) {
      weakPaths.push(row.path);
      pingPaths.add(row.path);
      decisions.push({
        decisionType: "traffic_drop",
        path: row.path,
        severity: "warning",
        rationale: `Падение визитов на ${row.path}: ${rVisits} vs ${oVisits} (${delta}%).`,
        metrics: { visits7d: rVisits, visitsPrev7d: oVisits, deltaPct: delta },
        action: { type: "indexnow_refresh_lastmod", paths: [row.path] },
        status: "proposed",
      });
    } else if (delta >= 40 && rVisits >= 5) {
      hotPaths.push(row.path);
      decisions.push({
        decisionType: "traffic_growth",
        path: row.path,
        severity: "info",
        rationale: `Рост визитов на ${row.path}: ${rVisits} vs ${oVisits} (+${delta}%). Усилить внутренние ссылки и контент кластера.`,
        metrics: { visits7d: rVisits, visitsPrev7d: oVisits, deltaPct: delta },
        action: { type: "boost_keywords_and_internal_links", paths: [row.path] },
        status: "proposed",
      });
    }

    // Thin engagement: many pageviews but few visits ratio inverted? 
    // High bounce proxy: pageviews ≈ visits and path is leaf
    if (row.pageviews >= 10 && row.visits >= 8 && row.path === "/") {
      const pvPerVisit = row.pageviews / Math.max(1, row.visits);
      if (pvPerVisit < 1.15) {
        decisions.push({
          decisionType: "shallow_sessions_home",
          path: "/",
          severity: "info",
          rationale: `На главной мало глубины (pageviews/visits=${pvPerVisit.toFixed(2)}). Нужны более сильные CTA на /masters.`,
          metrics: { pageviews: row.pageviews, visits: row.visits, pvPerVisit },
          action: { type: "content_cta_review", paths: ["/"] },
          status: "proposed",
        });
      }
    }
  }

  // Always keep sitemap fresh for top traffic pages
  const top = byPath.slice(0, 3).map((r) => r.path);
  top.forEach((p) => pingPaths.add(p));

  // Apply safe actions
  const pingList = [...pingPaths].map((p) => (p === "/" ? "/" : p));
  if (pingList.length) {
    const idx = runIndexNow(pingList);
    const sm = updateSitemapLastmod(pingList);
    const boosted = bumpKeywordPriorities([...new Set([...weakPaths, ...hotPaths])]);
    applied.push({
      type: "batch_refresh",
      indexnow: idx,
      sitemapUpdated: sm,
      keywordBoost: boosted,
      paths: pingList,
    });
    for (const d of decisions) {
      if (d.status === "proposed" && ["zero_visits_core_page", "traffic_drop", "traffic_growth"].includes(d.decisionType)) {
        d.status = DRY ? "proposed" : "applied";
        d.action = { ...(d.action || {}), result: "batch_refresh" };
      }
    }
  }

  // Persist decisions
  const saved = [];
  for (const d of decisions) {
    const res = await recordDecision(d);
    saved.push(res);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: DRY,
    nonUniqueUsers14d: summary.nonUniqueUsers,
    nonUniqueUsersToday: summary.today?.nonUniqueUsers ?? 0,
    uniqueVisitors14d: summary.uniqueVisitors,
    pageviews14d: summary.pageviews,
    siteDelta7dPct: siteDelta,
    byPath,
    decisions,
    applied,
    saved,
  };

  const out = path.join(REPORTS, "seo-decisions-latest.json");
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  fs.writeFileSync(
    path.join(REPORTS, `seo-decisions-${Date.now()}.json`),
    JSON.stringify(report, null, 2)
  );

  console.log(
    JSON.stringify(
      {
        nonUniqueUsers14d: report.nonUniqueUsers14d,
        today: report.nonUniqueUsersToday,
        decisions: decisions.length,
        applied: applied.length,
        siteDelta7dPct: siteDelta,
        file: out,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
