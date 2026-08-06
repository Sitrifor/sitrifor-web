/**
 * DNS drift + Beget parking probes for Sitrifor uptime monitor.
 * Catches resolvers still serving old Beget IP (Apache 404 parking)
 * while auth/VPS is on the expected allowlist.
 */
import dns from "node:dns/promises";
import net from "node:net";

const DEFAULT_CFG = {
  enabled: true,
  hostname: "sitrifor.ru",
  expected_ips: ["217.26.24.29"],
  known_bad_ips: ["45.130.41.193"],
  timeout_ms: 5000,
  resolvers: [
    { name: "system", servers: null },
    { name: "cloudflare", servers: ["1.1.1.1"] },
    { name: "google", servers: ["8.8.8.8"] },
    { name: "quad9", servers: ["9.9.9.9"] },
    {
      name: "beget-auth",
      servers: ["ns1.beget.com"],
      resolve_nameserver: true,
      reference: true,
    },
  ],
  parking_probe: {
    enabled: true,
    ip: "45.130.41.193",
    host_header: "sitrifor.ru",
    path: "/",
    scheme: "http",
    timeout_ms: 5000,
    severity_if_alive: "warn",
  },
};

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function isIp(s) {
  return net.isIP(String(s || "")) !== 0;
}

async function resolveNameserverIps(hostOrIp) {
  if (isIp(hostOrIp)) return [hostOrIp];
  const addrs = await dns.resolve4(hostOrIp);
  return [...new Set(addrs)];
}

async function resolveA(hostname, servers, timeoutMs, label) {
  const started = Date.now();
  try {
    let ips;
    if (!servers || servers.length === 0) {
      ips = await withTimeout(dns.resolve4(hostname), timeoutMs, label);
    } else {
      const resolver = new dns.Resolver();
      resolver.setServers(servers);
      ips = await withTimeout(resolver.resolve4(hostname), timeoutMs, label);
    }
    return {
      ok: true,
      ips: [...new Set(ips || [])].sort(),
      ms: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      ips: [],
      ms: Date.now() - started,
      error: String(err && err.message ? err.message : err),
    };
  }
}

function classifyResolverResult(ips, expectedSet, knownBadSet) {
  const issues = [];
  let severity = "ok";

  function bump(level, code, message, extra = {}) {
    issues.push({ level, code, message, ...extra });
    if (level === "critical") severity = "critical";
    else if (level === "warn" && severity === "ok") severity = "warn";
  }

  if (!ips.length) {
    bump("critical", "dns_empty", "No A records returned");
    return { severity, issues };
  }

  const badHits = ips.filter((ip) => knownBadSet.has(ip));
  if (badHits.length) {
    bump(
      "critical",
      "dns_known_bad_ip",
      `Resolver returned known-bad IP(s): ${badHits.join(", ")} (old Beget / parking)`,
      { bad_ips: badHits }
    );
  }

  // Non-allowlist IPs that are not already tagged as known-bad
  const unexpected = ips.filter((ip) => !expectedSet.has(ip) && !knownBadSet.has(ip));
  if (unexpected.length) {
    bump(
      "critical",
      "dns_drift",
      `Resolver returned IP(s) not in allowlist: ${unexpected.join(", ")}; expected ${[...expectedSet].join(", ")}`,
      { unexpected_ips: unexpected, expected_ips: [...expectedSet] }
    );
  }

  return { severity, issues };
}

const DEFAULT_PARKING_BODY_SIGNATURES = [
  "Apache2 Ubuntu Default Page",
  "It works!",
  "<address>Apache/",
  "cp.beget.com",
  "Новый сайт успешно создан",
  "beget.com/ru/virtual-hosting",
  "support@beget.com",
];

/**
 * Probe old Beget IP with Host header to see if parking (Apache or Beget default) is still alive.
 */
async function probeParking(probeCfg, apacheSignatures = []) {
  const started = Date.now();
  const ip = probeCfg.ip || "45.130.41.193";
  const host = probeCfg.host_header || "sitrifor.ru";
  const path = probeCfg.path || "/";
  const scheme = probeCfg.scheme || "http";
  const timeoutMs = probeCfg.timeout_ms || 5000;
  const aliveSeverity = probeCfg.severity_if_alive || "warn";
  const url = `${scheme}://${ip}${path.startsWith("/") ? path : "/" + path}`;
  const bodySigs = [
    ...new Set([
      ...(probeCfg.body_signatures || []),
      ...DEFAULT_PARKING_BODY_SIGNATURES,
      ...(apacheSignatures || []),
    ]),
  ];
  const issues = [];
  let severity = "ok";
  let status = 0;
  let server = null;
  let bodyText = "";
  let parkingAlive = false;

  function bump(level, code, message, extra = {}) {
    issues.push({ level, code, message, ...extra });
    if (level === "critical") severity = "critical";
    else if (level === "warn" && severity === "ok") severity = "warn";
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: ctrl.signal,
      headers: {
        Host: host,
        "User-Agent": "SitriforUptime/1.0 (+dns-parking-probe)",
        Accept: "text/html,*/*",
      },
    });
    status = res.status;
    server = res.headers.get("server");
    const buf = Buffer.from(await res.arrayBuffer());
    bodyText = buf.toString("utf8");

    const apacheServer = server && /\bApache\b/i.test(server);
    const sigHit = bodySigs.find((sig) => sig && bodyText.includes(sig));
    // Parking: Apache Server and/or known Beget/Apache body signatures on the old IP.
    if (apacheServer || sigHit) {
      parkingAlive = true;
      const level = aliveSeverity === "critical" ? "critical" : "warn";
      bump(
        level,
        "beget_parking_alive",
        `Old Beget IP ${ip} still answers Host=${host} (HTTP ${status}, Server=${server || "n/a"})${sigHit ? `; body sig: ${sigHit}` : "; Apache Server"}`,
        { ip, host, status, server, signature: sigHit || null }
      );
    } else if (status > 0) {
      bump(
        "warn",
        "parking_probe_unexpected",
        `Parking IP ${ip} responded HTTP ${status} without clear parking signature (Server=${server || "n/a"})`,
        { ip, status, server }
      );
    }
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    const name = String(err && err.name ? err.name : "");
    // Connection refused / timeout / unreachable = parking torn down (good)
    if (
      name === "AbortError" ||
      /econnrefused|etimedout|ehostunreach|enetunreach|enotfound|aborted|timeout|fetch failed/i.test(msg)
    ) {
      // ok: parking IP not serving (or unreachable)
      return {
        name: `dns:parking-probe:${ip}`,
        url,
        ok: true,
        severity: "ok",
        status: 0,
        ms: Date.now() - started,
        server: null,
        parking_alive: false,
        issues: [
          {
            level: "ok",
            code: "parking_unreachable",
            message: `Parking IP ${ip} unreachable (good): ${msg}`,
          },
        ],
        kind: "parking_probe",
      };
    }
    bump("warn", "parking_probe_error", `Parking probe failed: ${msg}`, { ip });
  } finally {
    clearTimeout(timer);
  }

  return {
    name: `dns:parking-probe:${ip}`,
    url,
    ok: severity !== "critical",
    severity,
    status,
    ms: Date.now() - started,
    server,
    parking_alive: parkingAlive,
    issues: issues.filter((i) => i.level !== "ok"),
    kind: "parking_probe",
  };
}

/**
 * Run all DNS drift checks. Returns synthetic check results compatible with uptime-check.mjs.
 */
export async function runDnsChecks(dnsCfg = {}, opts = {}) {
  const cfg = {
    ...DEFAULT_CFG,
    ...dnsCfg,
    parking_probe: { ...DEFAULT_CFG.parking_probe, ...(dnsCfg.parking_probe || {}) },
    resolvers: dnsCfg.resolvers || DEFAULT_CFG.resolvers,
  };

  if (cfg.enabled === false) return [];

  const hostname = cfg.hostname || "sitrifor.ru";
  const expected = [...new Set(cfg.expected_ips || [])];
  const expectedSet = new Set(expected);
  const knownBadSet = new Set(cfg.known_bad_ips || []);
  const timeoutMs = cfg.timeout_ms || 5000;
  const apacheSignatures = opts.apache_body_signatures || [];
  const results = [];

  for (const r of cfg.resolvers || []) {
    const started = Date.now();
    const name = r.name || (r.servers ? r.servers.join(",") : "system");
    let serverIps = null;
    let resolveErr = null;

    if (r.servers && r.servers.length) {
      if (r.resolve_nameserver) {
        try {
          const resolved = [];
          for (const s of r.servers) {
            resolved.push(...(await resolveNameserverIps(s)));
          }
          serverIps = [...new Set(resolved)];
        } catch (err) {
          resolveErr = String(err && err.message ? err.message : err);
        }
      } else {
        serverIps = r.servers.filter(isIp);
        if (!serverIps.length) {
          // try resolving hostnames listed as servers
          try {
            const resolved = [];
            for (const s of r.servers) {
              resolved.push(...(await resolveNameserverIps(s)));
            }
            serverIps = [...new Set(resolved)];
          } catch (err) {
            resolveErr = String(err && err.message ? err.message : err);
          }
        }
      }
    }

    if (resolveErr) {
      results.push({
        name: `dns:${name}`,
        url: `dns://${hostname}?resolver=${name}`,
        ok: false,
        severity: r.reference ? "warn" : "critical",
        status: 0,
        ms: Date.now() - started,
        issues: [
          {
            level: r.reference ? "warn" : "critical",
            code: "dns_resolver_setup",
            message: `Failed to resolve nameserver for ${name}: ${resolveErr}`,
          },
        ],
        kind: "dns",
        resolver: name,
        resolver_servers: r.servers || ["system"],
        returned_ips: [],
        expected_ips: expected,
        reference: !!r.reference,
      });
      continue;
    }

    const resolved = await resolveA(hostname, serverIps, timeoutMs, `dns:${name}`);
    const logBase = {
      kind: "dns",
      resolver: name,
      resolver_servers: serverIps || ["system-default"],
      returned_ips: resolved.ips,
      expected_ips: expected,
      reference: !!r.reference,
    };

    if (!resolved.ok) {
      // Auth reference failure is warn (Beget NS may rate-limit); public resolvers critical
      const level = r.reference ? "warn" : "critical";
      results.push({
        name: `dns:${name}`,
        url: `dns://${hostname}?resolver=${name}`,
        ok: level !== "critical",
        severity: level,
        status: 0,
        ms: resolved.ms,
        issues: [
          {
            level,
            code: "dns_resolve_error",
            message: `resolver=${name} servers=${(serverIps || ["system"]).join(",")} error=${resolved.error}; expected=${expected.join(",")}`,
          },
        ],
        ...logBase,
      });
      continue;
    }

    const { severity, issues } = classifyResolverResult(resolved.ips, expectedSet, knownBadSet);
    // Enrich messages with resolver context for logs
    const enriched = issues.map((i) => ({
      ...i,
      message: `resolver=${name} servers=${(serverIps || ["system"]).join(",")} returned=[${resolved.ips.join(", ")}] expected=[${expected.join(", ")}] - ${i.message}`,
    }));

    // Always emit an ok-info issue when clean so jsonl shows the snapshot
    if (severity === "ok") {
      enriched.push({
        level: "ok",
        code: "dns_ok",
        message: `resolver=${name} servers=${(serverIps || ["system"]).join(",")} returned=[${resolved.ips.join(", ")}] expected=[${expected.join(", ")}]`,
      });
    }

    results.push({
      name: `dns:${name}`,
      url: `dns://${hostname}?resolver=${name}`,
      ok: severity !== "critical",
      severity,
      status: 0,
      ms: resolved.ms,
      issues: severity === "ok" ? enriched : enriched.filter((i) => i.level !== "ok"),
      ...logBase,
    });
  }

  if (cfg.parking_probe?.enabled !== false) {
    const parking = await probeParking(cfg.parking_probe, apacheSignatures);
    // Drop level=ok noise from parking unreachable for alert logs; keep in issues for jsonl via a note
    if (parking.severity === "ok" && parking.issues?.some((i) => i.code === "parking_unreachable")) {
      parking.issues = parking.issues.map((i) =>
        i.level === "ok"
          ? {
              ...i,
              // keep for jsonl; human/alerts skip ok
            }
          : i
      );
    }
    results.push(parking);
  }

  return results;
}

export { DEFAULT_CFG as DNS_DEFAULT_CFG };
