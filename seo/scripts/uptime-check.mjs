#!/usr/bin/env node
/**
 * Sitrifor site availability monitor.
 * Usage:
 *   node scripts/uptime-check.mjs --once
 *   node scripts/uptime-check.mjs --once --config /path/to/uptime-urls.json
 * Exit: 0 = ok/warn only, 1 = any critical failure, 2 = config/runtime error
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runDnsChecks } from "./uptime-dns.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEO_ROOT = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const out = {
    once: true,
    config: path.join(SEO_ROOT, "config/uptime-urls.json"),
    dnsConfig: path.join(SEO_ROOT, "config/uptime-dns.json"),
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--once") out.once = true;
    else if (a === "--quiet" || a === "-q") out.quiet = true;
    else if (a === "--config" && argv[i + 1]) out.config = path.resolve(argv[++i]);
    else if (a === "--dns-config" && argv[i + 1]) out.dnsConfig = path.resolve(argv[++i]);
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function loadDnsConfig(args, cfg) {
  // Inline `dns` in uptime-urls.json wins; else load dedicated file (default uptime-dns.json).
  if (cfg.dns && typeof cfg.dns === "object") return cfg.dns;
  const dnsPath = cfg.dns_config
    ? path.isAbsolute(cfg.dns_config)
      ? cfg.dns_config
      : path.join(SEO_ROOT, cfg.dns_config)
    : args.dnsConfig;
  try {
    if (fs.existsSync(dnsPath)) return JSON.parse(fs.readFileSync(dnsPath, "utf8"));
  } catch (err) {
    console.error(`Failed to load DNS config ${dnsPath}: ${err.message}`);
  }
  return { enabled: true };
}

function loadConfig(configPath) {
  const raw = fs.readFileSync(configPath, "utf8");
  return JSON.parse(raw);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function dayStamp(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function isoNow() {
  return new Date().toISOString();
}

function compileRe(src, flags = "") {
  if (!src) return null;
  if (src.startsWith("(?i)")) return new RegExp(src.slice(4), flags.includes("i") ? flags : flags + "i");
  return new RegExp(src, flags);
}

function classifyFetchError(err) {
  const msg = String(err && err.message ? err.message : err);
  const name = String(err && err.name ? err.name : "");
  const cause = err && err.cause ? String(err.cause.code || err.cause.message || err.cause) : "";
  const blob = `${name} ${msg} ${cause}`.toLowerCase();
  if (name === "AbortError" || blob.includes("aborted") || blob.includes("timeout")) {
    return { kind: "timeout", detail: msg };
  }
  if (blob.includes("cert") || blob.includes("tls") || blob.includes("ssl") || blob.includes("unable to verify")) {
    return { kind: "tls", detail: msg };
  }
  if (
    blob.includes("econnrefused") ||
    blob.includes("enotfound") ||
    blob.includes("econnreset") ||
    blob.includes("eai_again") ||
    blob.includes("network") ||
    blob.includes("fetch failed")
  ) {
    return { kind: "connection", detail: msg || cause };
  }
  return { kind: "fetch_error", detail: msg || cause || "unknown" };
}

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const n = Math.max(1, Math.min(concurrency || 4, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

async function fetchSitemapLocs(sitemapUrl, timeoutMs, ua) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(sitemapUrl, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": ua, Accept: "application/xml,text/xml,*/*" },
    });
    if (!res.ok) return { url: sitemapUrl, ok: false, status: res.status, locs: [] };
    const xml = await res.text();
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].trim());
    return { url: sitemapUrl, ok: true, status: res.status, locs };
  } catch (err) {
    return { url: sitemapUrl, ok: false, error: classifyFetchError(err), locs: [] };
  } finally {
    clearTimeout(t);
  }
}

function pickSitemapChecks(cfg, discovered) {
  const base = (cfg.base_url || "https://sitrifor.ru").replace(/\/$/, "");
  const main = [];
  const news = [];
  for (const u of discovered) {
    try {
      const pathName = new URL(u).pathname;
      if (pathName.startsWith("/news/a/")) news.push(u);
      else main.push(u);
    } catch {
      /* skip bad */
    }
  }
  const selected = new Set();
  if (cfg.sitemap?.include_all_main !== false) {
    for (const u of main) selected.add(u);
  }
  const sampleN = Number(cfg.sitemap?.news_sample ?? 5);
  // deterministic sample: first N unique articles
  for (const u of news.slice(0, sampleN)) selected.add(u);

  const maxTotal = Number(cfg.sitemap?.max_total ?? 80);
  const list = [...selected].slice(0, maxTotal);
  return list.map((url) => {
    const isArticle = /\/news\/a\//.test(url);
    return {
      name: `sitemap:${url.replace(base, "") || "/"}`,
      url,
      expect_status: 200,
      markers: isArticle ? ['rel="canonical"', "Sitrifor"] : ["Sitrifor"],
      min_body_bytes: isArticle ? 400 : cfg.min_body_bytes,
      check_server: url.startsWith("https://sitrifor.ru"),
      from_sitemap: true,
    };
  });
}

function mergeChecks(explicit, fromSitemap) {
  const byUrl = new Map();
  for (const c of fromSitemap) byUrl.set(normalizeUrlKey(c.url), c);
  // explicit overrides / wins
  for (const c of explicit) byUrl.set(normalizeUrlKey(c.url), c);
  return [...byUrl.values()];
}

function normalizeUrlKey(u) {
  try {
    const x = new URL(u);
    // keep trailing slash differences as distinct for static dirs
    return x.href;
  } catch {
    return u;
  }
}

async function checkOne(check, cfg) {
  const started = Date.now();
  const expectStatus = check.expect_status ?? 200;
  const timeoutMs = check.timeout_ms ?? cfg.timeout_ms ?? 15000;
  const maxRedirects = cfg.max_redirects ?? 8;
  const warnMs = check.warn_ms ?? cfg.warn_ms ?? 2000;
  const criticalMs = check.critical_ms ?? cfg.critical_ms ?? 5000;
  const minBody = check.min_body_bytes ?? cfg.min_body_bytes ?? 200;
  const ua = cfg.user_agent || "SitriforUptime/1.0";
  const expectedServerRe = compileRe(cfg.expected_server_re);
  const forbiddenServerRe = compileRe(cfg.forbidden_server_re);
  const issues = [];
  let severity = "ok"; // ok | warn | critical

  function bump(level, code, message, extra = {}) {
    issues.push({ level, code, message, ...extra });
    if (level === "critical") severity = "critical";
    else if (level === "warn" && severity === "ok") severity = "warn";
  }

  const chain = [];
  let current = check.url;
  let finalRes = null;
  let bodyText = "";
  let bodyBytes = 0;
  let server = null;
  let contentType = null;

  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let res;
      try {
        res = await fetch(current, {
          method: "GET",
          redirect: "manual",
          signal: ctrl.signal,
          headers: {
            "User-Agent": ua,
            Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
            "Accept-Language": "ru,en;q=0.8",
          },
        });
      } finally {
        clearTimeout(timer);
      }

      chain.push({ url: current, status: res.status });
      server = res.headers.get("server");
      contentType = res.headers.get("content-type");

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) {
          bump("critical", "redirect_no_location", `Redirect ${res.status} without Location`);
          finalRes = res;
          break;
        }
        const next = new URL(loc, current).toString();
        if (chain.some((c) => c.url === next)) {
          bump("critical", "redirect_loop", `Redirect loop at ${next}`, { chain });
          finalRes = res;
          break;
        }
        current = next;
        if (hop === maxRedirects) {
          bump("critical", "too_many_redirects", `Exceeded ${maxRedirects} redirects`, { chain });
        }
        continue;
      }

      finalRes = res;
      const buf = Buffer.from(await res.arrayBuffer());
      bodyBytes = buf.length;
      bodyText = buf.toString("utf8");
      break;
    }
  } catch (err) {
    const info = classifyFetchError(err);
    bump("critical", info.kind, info.detail);
    return {
      name: check.name,
      url: check.url,
      ok: false,
      severity: "critical",
      ms: Date.now() - started,
      issues,
      chain,
      expect_status: expectStatus,
      from_sitemap: !!check.from_sitemap,
    };
  }

  const ms = Date.now() - started;
  const status = finalRes ? finalRes.status : 0;

  if (status !== expectStatus) {
    bump(
      "critical",
      "bad_status",
      `HTTP ${status}, expected ${expectStatus}`,
      { status, expect_status: expectStatus }
    );
  }

  // Apache default / parking signatures
  if (bodyText) {
    for (const sig of cfg.apache_body_signatures || []) {
      if (bodyText.includes(sig)) {
        bump("critical", "apache_default_page", `Body matches Apache/default signature: ${sig}`);
        break;
      }
    }
  }

  const checkServer = check.check_server !== false && /^https?:\/\/([^/]*\.)?sitrifor\.ru\b/i.test(check.url);
  if (checkServer && server) {
    if (forbiddenServerRe && forbiddenServerRe.test(server)) {
      bump("critical", "unexpected_apache", `Server header looks like Apache: ${server}`);
    } else if (expectedServerRe && !expectedServerRe.test(server)) {
      bump("warn", "server_anomaly", `Unexpected Server header: ${server}`);
    }
  }

  if (!check.skip_body_size) {
    if (bodyBytes === 0 && expectStatus === 200) {
      bump("critical", "empty_body", "Empty response body");
    } else if (bodyBytes > 0 && bodyBytes < minBody) {
      bump("warn", "tiny_body", `Body ${bodyBytes}B < min ${minBody}B`);
    }
  }

  if (check.content_type_includes && contentType) {
    if (!contentType.toLowerCase().includes(String(check.content_type_includes).toLowerCase())) {
      bump("warn", "content_type", `Content-Type ${contentType} missing ${check.content_type_includes}`);
    }
  }

  for (const marker of check.markers || []) {
    if (!marker) continue;
    if (!bodyText.includes(marker)) {
      bump("critical", "missing_marker", `Missing expected marker: ${marker}`);
    }
  }

  if (ms > criticalMs) {
    bump("critical", "slow_critical", `Response ${ms}ms > critical ${criticalMs}ms`);
  } else if (ms > warnMs) {
    bump("warn", "slow_warn", `Response ${ms}ms > warn ${warnMs}ms`);
  }

  return {
    name: check.name,
    url: check.url,
    ok: severity !== "critical",
    severity,
    status,
    expect_status: expectStatus,
    ms,
    body_bytes: bodyBytes,
    server,
    content_type: contentType,
    redirect_hops: Math.max(0, chain.length - 1),
    chain: chain.length > 1 ? chain : undefined,
    issues,
    from_sitemap: !!check.from_sitemap,
  };
}

function rotateIfNeeded(filePath, maxBytes) {
  try {
    const st = fs.statSync(filePath);
    if (st.size < maxBytes) return;
    const rotated = `${filePath}.${Date.now()}.bak`;
    fs.renameSync(filePath, rotated);
  } catch {
    /* missing is fine */
  }
}

function pruneOldLogs(logDir, retentionDays) {
  const cutoff = Date.now() - retentionDays * 86400_000;
  let entries;
  try {
    entries = fs.readdirSync(logDir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!/\.(jsonl|log|bak)$/.test(name) && !/^uptime-\d{4}-\d{2}-\d{2}/.test(name)) continue;
    const full = path.join(logDir, name);
    try {
      const st = fs.statSync(full);
      if (st.mtimeMs < cutoff) fs.unlinkSync(full);
    } catch {
      /* ignore */
    }
  }
}

function appendLine(filePath, line) {
  fs.appendFileSync(filePath, line.endsWith("\n") ? line : line + "\n", "utf8");
}

function humanLine(run) {
  const crit = run.checks.filter((c) => c.severity === "critical").length;
  const warn = run.checks.filter((c) => c.severity === "warn").length;
  const ok = run.checks.filter((c) => c.severity === "ok").length;
  const worst = run.checks
    .filter((c) => c.severity !== "ok")
    .slice(0, 8)
    .map((c) => {
      const codes = (c.issues || []).map((i) => i.code).join(",");
      return `${c.name}:${c.status || "ERR"}:${codes || c.severity}`;
    })
    .join("; ");
  const dnsBits = (run.checks || [])
    .filter((c) => c.kind === "dns" && Array.isArray(c.returned_ips))
    .map((c) => `${c.resolver}=[${c.returned_ips.join(",")}]`)
    .join(" ");
  return `${run.ts} severity=${run.severity} ok=${ok} warn=${warn} critical=${crit} total=${run.checks.length} max_ms=${run.max_ms}${dnsBits ? " dns:" + dnsBits : ""}${worst ? " | " + worst : ""}`;
}

function printHelp() {
  console.log(`Sitrifor uptime check

Usage:
  node scripts/uptime-check.mjs --once [--config path] [--dns-config path] [--quiet]

Exit codes:
  0  all checks ok or warn only
  1  one or more critical failures
  2  config / runtime error

Logs (default): seo/reports/uptime/
  uptime-YYYY-MM-DD.jsonl   structured per-check + run summary
  uptime-summary.log        human one-liners
  uptime-alerts.log         failures only (warn+critical)

DNS drift: seo/config/uptime-dns.json (or inline "dns" in uptime-urls.json)
`);
}

function formatDnsConsoleLine(c) {
  if (c.kind === "dns") {
    const ips = (c.returned_ips || []).join(", ") || "(none)";
    const exp = (c.expected_ips || []).join(", ");
    const servers = (c.resolver_servers || []).join(", ");
    const detail = (c.issues || [])
      .filter((i) => i.level !== "ok")
      .map((i) => `${i.code}:${i.message}`)
      .join(" | ");
    const base = `  DNS ${c.severity.toUpperCase()} resolver=${c.resolver} servers=[${servers}] returned=[${ips}] expected=[${exp}]`;
    return detail ? `${base} - ${detail}` : base;
  }
  if (c.kind === "parking_probe") {
    const detail = (c.issues || []).map((i) => `${i.code}:${i.message}`).join(" | ");
    return `  PARKING ${c.severity.toUpperCase()} ${c.name} alive=${!!c.parking_alive} - ${detail || "ok"}`;
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  let cfg;
  try {
    cfg = loadConfig(args.config);
  } catch (err) {
    console.error(`Failed to load config ${args.config}: ${err.message}`);
    process.exit(2);
  }

  const logDir = path.isAbsolute(cfg.log_dir)
    ? cfg.log_dir
    : path.join(SEO_ROOT, cfg.log_dir || "reports/uptime");
  ensureDir(logDir);

  const ua = cfg.user_agent || "SitriforUptime/1.0";
  const timeoutMs = cfg.timeout_ms || 15000;

  let sitemapMeta = [];
  let sitemapChecks = [];
  if (cfg.sitemap?.enabled) {
    const smUrls = cfg.sitemap.urls || [`${cfg.base_url}/sitemap.xml`];
    const smResults = await mapPool(smUrls, 2, (u) => fetchSitemapLocs(u, timeoutMs, ua));
    sitemapMeta = smResults.map(({ locs, ...rest }) => ({ ...rest, count: locs.length }));
    const allLocs = smResults.flatMap((r) => r.locs);
    for (const r of smResults) {
      if (!r.ok) {
        // sitemap fetch failure is warn (site may still be up)
        sitemapMeta.find((m) => m.url === r.url).severity_hint = "warn";
      }
    }
    sitemapChecks = pickSitemapChecks(cfg, allLocs);
  }

  const checks = mergeChecks(cfg.checks || [], sitemapChecks);
  const results = await mapPool(checks, cfg.concurrency || 6, (c) => checkOne(c, cfg));

  // Surface sitemap fetch problems as synthetic checks
  for (const sm of sitemapMeta) {
    if (sm.ok === false) {
      results.push({
        name: `sitemap-fetch:${sm.url}`,
        url: sm.url,
        ok: false,
        severity: "warn",
        status: sm.status || 0,
        ms: 0,
        issues: [
          {
            level: "warn",
            code: sm.error?.kind || "sitemap_fetch",
            message: sm.error?.detail || `HTTP ${sm.status}`,
          },
        ],
      });
    }
  }

  // DNS drift + optional Beget parking probe (old IP Apache 404)
  const dnsCfg = loadDnsConfig(args, cfg);
  let dnsResults = [];
  try {
    dnsResults = await runDnsChecks(dnsCfg, {
      apache_body_signatures: cfg.apache_body_signatures || [],
    });
  } catch (err) {
    dnsResults = [
      {
        name: "dns:runtime",
        url: "dns://sitrifor.ru",
        ok: false,
        severity: "critical",
        status: 0,
        ms: 0,
        kind: "dns",
        issues: [
          {
            level: "critical",
            code: "dns_runtime",
            message: String(err && err.message ? err.message : err),
          },
        ],
      },
    ];
  }
  results.push(...dnsResults);

  const critical = results.filter((r) => r.severity === "critical");
  const warn = results.filter((r) => r.severity === "warn");
  const severity = critical.length ? "critical" : warn.length ? "warn" : "ok";
  const maxMs = results.reduce((m, r) => Math.max(m, r.ms || 0), 0);
  const run = {
    ts: isoNow(),
    severity,
    host: "sitrifor.ru",
    check_count: results.length,
    ok_count: results.filter((r) => r.severity === "ok").length,
    warn_count: warn.length,
    critical_count: critical.length,
    max_ms: maxMs,
    warn_ms: cfg.warn_ms,
    critical_ms: cfg.critical_ms,
    sitemap: sitemapMeta,
    dns: dnsResults.map((c) => ({
      name: c.name,
      severity: c.severity,
      resolver: c.resolver,
      returned_ips: c.returned_ips,
      expected_ips: c.expected_ips,
      parking_alive: c.parking_alive,
      issues: (c.issues || []).filter((i) => i.level !== "ok"),
    })),
    checks: results,
  };

  const day = dayStamp();
  const jsonlPath = path.join(logDir, `uptime-${day}.jsonl`);
  const summaryPath = path.join(logDir, "uptime-summary.log");
  const alertsPath = path.join(logDir, "uptime-alerts.log");
  const latestPath = path.join(logDir, "uptime-latest.json");

  const maxBytes = cfg.max_jsonl_bytes || 50 * 1024 * 1024;
  rotateIfNeeded(jsonlPath, maxBytes);
  rotateIfNeeded(summaryPath, maxBytes);
  rotateIfNeeded(alertsPath, maxBytes);

  appendLine(jsonlPath, JSON.stringify({ type: "run", ...run }));
  for (const c of results) {
    appendLine(
      jsonlPath,
      JSON.stringify({
        type: "check",
        ts: run.ts,
        ...c,
      })
    );
  }

  const summary = humanLine(run);
  appendLine(summaryPath, summary);

  if (severity !== "ok") {
    appendLine(alertsPath, summary);
    for (const c of [...critical, ...warn]) {
      for (const issue of c.issues || []) {
        appendLine(
          alertsPath,
          `${run.ts} [${issue.level}] ${c.name} ${c.url} ${issue.code}: ${issue.message}`
        );
      }
    }
  }

  fs.writeFileSync(latestPath, JSON.stringify(run, null, 2) + "\n", "utf8");

  if (cfg.retention_days) pruneOldLogs(logDir, cfg.retention_days);

  if (!args.quiet) {
    console.log(summary);
    // Always print DNS resolver snapshots (even when ok) so drift is visible in journal/manual runs
    for (const c of dnsResults) {
      const line = formatDnsConsoleLine(c);
      if (line) console.log(line);
    }
    if (severity !== "ok") {
      for (const c of results.filter((r) => r.severity !== "ok" && r.kind !== "dns" && r.kind !== "parking_probe")) {
        const detail = (c.issues || []).map((i) => `${i.code}:${i.message}`).join(" | ");
        console.log(`  ${c.severity.toUpperCase()} ${c.name} ${c.url} - ${detail}`);
      }
    }
  }

  process.exit(critical.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
