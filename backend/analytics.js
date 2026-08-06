/**
 * First-party analytics for sitrifor.ru
 * Stores anonymized pageviews / visits (non-unique) and powers SEO decisions.
 */
import { createHash, randomBytes } from 'crypto';
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, 'data');
mkdirSync(dataDir, { recursive: true });

const db = new Database(join(dataDir, 'analytics.db'));
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    day TEXT NOT NULL,
    path TEXT NOT NULL,
    referrer_host TEXT,
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    visitor_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    is_new_session INTEGER NOT NULL DEFAULT 0,
    is_bounce_candidate INTEGER NOT NULL DEFAULT 1,
    lang TEXT,
    screen TEXT,
    ip_hash TEXT,
    ua_hash TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_events_day ON events(day);
  CREATE INDEX IF NOT EXISTS idx_events_path_day ON events(path, day);
  CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
  CREATE INDEX IF NOT EXISTS idx_events_visitor_day ON events(visitor_id, day);

  CREATE TABLE IF NOT EXISTS daily_stats (
    day TEXT NOT NULL,
    path TEXT NOT NULL,
    pageviews INTEGER NOT NULL DEFAULT 0,
    visits INTEGER NOT NULL DEFAULT 0,
    unique_visitors INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, path)
  );

  CREATE TABLE IF NOT EXISTS seo_decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    day TEXT NOT NULL,
    decision_type TEXT NOT NULL,
    path TEXT,
    severity TEXT NOT NULL DEFAULT 'info',
    rationale TEXT NOT NULL,
    metrics_json TEXT,
    action_json TEXT,
    status TEXT NOT NULL DEFAULT 'proposed',
    applied_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_decisions_day ON seo_decisions(day);
  CREATE INDEX IF NOT EXISTS idx_decisions_status ON seo_decisions(status);
`);

const ALLOWED_PATHS = new Set([
  '/',
  '/masters',
  '/partners',
  '/about',
  '/exclusive',
  '/privacy/',
  '/support/',
  '/news',
  '/404.html'
]);

function normalizePath(raw) {
  if (!raw || typeof raw !== 'string') return '/';
  let p = raw.trim();
  try {
    if (p.startsWith('http')) p = new URL(p).pathname;
  } catch {
    /* keep */
  }
  p = p.split('?')[0].split('#')[0] || '/';
  if (!p.startsWith('/')) p = `/${p}`;
  // collapse known aliases
  if (p === '/index.html') p = '/';
  if (p === '/privacy') p = '/privacy/';
  if (p === '/support') p = '/support/';
  if (['/masters/', '/partners/', '/about/', '/exclusive/'].includes(p)) {
    p = p.slice(0, -1);
  }
  if (p.length > 120) p = p.slice(0, 120);
  return p;
}

function dayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function hashValue(value, salt) {
  return createHash('sha256').update(`${salt}:${value || ''}`).digest('hex').slice(0, 32);
}

/** Daily rotating salt so IP hashes are not long-term identifiers */
function dailySalt() {
  return dayKey();
}

const insertEventStmt = db.prepare(`
  INSERT INTO events (
    day, path, referrer_host, utm_source, utm_medium, utm_campaign,
    visitor_id, session_id, is_new_session, lang, screen, ip_hash, ua_hash
  ) VALUES (
    @day, @path, @referrerHost, @utmSource, @utmMedium, @utmCampaign,
    @visitorId, @sessionId, @isNewSession, @lang, @screen, @ipHash, @uaHash
  )
`);

const upsertDailyStmt = db.prepare(`
  INSERT INTO daily_stats (day, path, pageviews, visits, unique_visitors)
  VALUES (@day, @path, 1, @visitInc, 0)
  ON CONFLICT(day, path) DO UPDATE SET
    pageviews = pageviews + 1,
    visits = visits + @visitInc
`);

const refreshUniquesStmt = db.prepare(`
  UPDATE daily_stats
  SET unique_visitors = (
    SELECT COUNT(DISTINCT visitor_id) FROM events
    WHERE events.day = daily_stats.day AND events.path = daily_stats.path
  )
  WHERE day = ? AND path = ?
`);

const countRecentByIpHash = db.prepare(`
  SELECT COUNT(*) AS c FROM events
  WHERE ip_hash = ? AND datetime(ts) > datetime('now', '-1 hour')
`);

export function collectHit({
  path,
  referrer,
  utmSource,
  utmMedium,
  utmCampaign,
  visitorId,
  sessionId,
  isNewSession,
  lang,
  screen,
  clientIp,
  userAgent
}) {
  const cleanPath = normalizePath(path);
  if (!ALLOWED_PATHS.has(cleanPath) && !cleanPath.startsWith('/blog/') && !cleanPath.startsWith('/guides/')) {
    // still accept unknown site paths but cap length; reject junk
    if (!/^\/[a-zA-Z0-9/_-]{0,100}$/.test(cleanPath)) {
      return { ok: false, error: 'invalid_path' };
    }
  }

  const vid = String(visitorId || '').slice(0, 64);
  const sid = String(sessionId || '').slice(0, 64);
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(vid) || !/^[a-zA-Z0-9_-]{8,64}$/.test(sid)) {
    return { ok: false, error: 'invalid_ids' };
  }

  const salt = dailySalt();
  const ipHash = hashValue(clientIp || 'unknown', salt);
  const recent = countRecentByIpHash.get(ipHash).c;
  if (recent >= 120) {
    return { ok: false, error: 'rate_limited' };
  }

  let referrerHost = null;
  if (referrer && typeof referrer === 'string') {
    try {
      const u = new URL(referrer);
      if (!u.hostname.includes('sitrifor.ru')) referrerHost = u.hostname.slice(0, 120);
    } catch {
      /* ignore */
    }
  }

  const day = dayKey();
  const visitInc = isNewSession ? 1 : 0;

  const tx = db.transaction(() => {
    insertEventStmt.run({
      day,
      path: cleanPath,
      referrerHost,
      utmSource: utmSource ? String(utmSource).slice(0, 80) : null,
      utmMedium: utmMedium ? String(utmMedium).slice(0, 80) : null,
      utmCampaign: utmCampaign ? String(utmCampaign).slice(0, 80) : null,
      visitorId: vid,
      sessionId: sid,
      isNewSession: visitInc,
      lang: lang ? String(lang).slice(0, 16) : null,
      screen: screen ? String(screen).slice(0, 24) : null,
      ipHash,
      uaHash: hashValue(userAgent || '', salt)
    });
    upsertDailyStmt.run({ day, path: cleanPath, visitInc });
    refreshUniquesStmt.run(day, cleanPath);
  });
  tx();

  return { ok: true, path: cleanPath, day, countedVisit: Boolean(visitInc) };
}

export function getSummary({ days = 7 } = {}) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(pageviews), 0) AS pageviews,
      COALESCE(SUM(visits), 0) AS visits,
      COALESCE(SUM(unique_visitors), 0) AS unique_visitors_sum
    FROM daily_stats
    WHERE day >= ?
  `).get(since);

  // true unique visitors across site in window
  const siteUniques = db.prepare(`
    SELECT COUNT(DISTINCT visitor_id) AS c FROM events WHERE day >= ?
  `).get(since).c;

  const byDay = db.prepare(`
    SELECT day,
      SUM(pageviews) AS pageviews,
      SUM(visits) AS visits,
      SUM(unique_visitors) AS unique_visitors
    FROM daily_stats
    WHERE day >= ?
    GROUP BY day
    ORDER BY day ASC
  `).all(since);

  const byPath = db.prepare(`
    SELECT path,
      SUM(pageviews) AS pageviews,
      SUM(visits) AS visits,
      SUM(unique_visitors) AS unique_visitors
    FROM daily_stats
    WHERE day >= ?
    GROUP BY path
    ORDER BY visits DESC, pageviews DESC
  `).all(since);

  const today = dayKey();
  const todayRow = db.prepare(`
    SELECT
      COALESCE(SUM(pageviews), 0) AS pageviews,
      COALESCE(SUM(visits), 0) AS visits
    FROM daily_stats WHERE day = ?
  `).get(today);

  const referrers = db.prepare(`
    SELECT referrer_host AS host, COUNT(*) AS hits
    FROM events
    WHERE day >= ? AND referrer_host IS NOT NULL
    GROUP BY referrer_host
    ORDER BY hits DESC
    LIMIT 15
  `).all(since);

  return {
    generatedAt: new Date().toISOString(),
    windowDays: days,
    since,
    /** Non-unique users ≈ visits (sessions), each return counts again */
    nonUniqueUsers: totals.visits,
    visits: totals.visits,
    pageviews: totals.pageviews,
    uniqueVisitors: siteUniques,
    today: {
      day: today,
      nonUniqueUsers: todayRow.visits,
      visits: todayRow.visits,
      pageviews: todayRow.pageviews
    },
    byDay,
    byPath,
    referrers
  };
}

export function getPathSeries(path, days = 14) {
  const clean = normalizePath(path);
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  return db.prepare(`
    SELECT day, pageviews, visits, unique_visitors
    FROM daily_stats
    WHERE path = ? AND day >= ?
    ORDER BY day ASC
  `).all(clean, since);
}

export function insertDecision(row) {
  const stmt = db.prepare(`
    INSERT INTO seo_decisions (day, decision_type, path, severity, rationale, metrics_json, action_json, status)
    VALUES (@day, @decisionType, @path, @severity, @rationale, @metricsJson, @actionJson, @status)
  `);
  const result = stmt.run({
    day: row.day || dayKey(),
    decisionType: row.decisionType,
    path: row.path || null,
    severity: row.severity || 'info',
    rationale: row.rationale,
    metricsJson: JSON.stringify(row.metrics || {}),
    actionJson: JSON.stringify(row.action || {}),
    status: row.status || 'proposed'
  });
  return result.lastInsertRowid;
}

export function markDecisionApplied(id, extra = {}) {
  db.prepare(`
    UPDATE seo_decisions
    SET status = 'applied',
        applied_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
        action_json = CASE
          WHEN @actionJson IS NULL THEN action_json
          ELSE @actionJson
        END
    WHERE id = @id
  `).run({
    id,
    actionJson: extra.action ? JSON.stringify(extra.action) : null
  });
}

export function listDecisions({ days = 14, limit = 50 } = {}) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  return db.prepare(`
    SELECT * FROM seo_decisions
    WHERE day >= ?
    ORDER BY id DESC
    LIMIT ?
  `).all(since, limit);
}

export function newId(prefix = 'sf') {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}

export { normalizePath, dayKey, db as analyticsDb };
