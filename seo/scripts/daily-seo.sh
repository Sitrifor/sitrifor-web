#!/usr/bin/env bash
# Daily SEO pipeline for sitrifor.ru — technical health + IndexNow + summaries.
set -euo pipefail

SEO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPORTS="$SEO_ROOT/reports"
DAY="$(date -u +%Y-%m-%d)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$REPORTS/daily-$DAY.log"
SUMMARY="$REPORTS/daily-summary-$DAY.json"

mkdir -p "$REPORTS"
exec > >(tee -a "$LOG") 2>&1

echo "=== Sitrifor daily SEO $STAMP ==="
cd "$SEO_ROOT"

echo "[1/7] technical audit"
npm run audit:live

echo "[2/7] internal crawl"
npm run crawl | tee "$REPORTS/crawl-$DAY.txt"

echo "[3/7] sitemap validate"
npm run sitemap:validate | tee "$REPORTS/sitemap-$DAY.txt"

echo "[4/7] lighthouse (home)"
npm run lighthouse -- --url https://sitrifor.ru/ || echo "WARN: lighthouse failed"

echo "[5.5/7] news ingest + SEO publish"
npm run news:ingest || echo "WARN: news ingest failed"
npm run news:seo || echo "WARN: news seo publish failed"

echo "[5/7] IndexNow ping"
npm run indexnow || echo "WARN: indexnow failed"

echo "[6/7] SEO decision engine (analytics-driven)"
export ANALYTICS_TOKEN="$(cat "$SEO_ROOT/.analytics-token" 2>/dev/null || true)"
export ANALYTICS_API="http://127.0.0.1:8081"
npm run decide || echo "WARN: decision engine failed"

echo "[7/7] summarize"
./.venv/bin/python scripts/summarize-daily.py --day "$DAY" --out "$SUMMARY" || true

# Keep last 45 daily logs
find "$REPORTS" -name 'daily-*.log' -mtime +45 -delete 2>/dev/null || true
find "$REPORTS" -name 'seo-audit-*.json' ! -name 'seo-audit-latest.json' -mtime +45 -delete 2>/dev/null || true
find "$REPORTS" -name 'seo-decisions-*.json' ! -name 'seo-decisions-latest.json' -mtime +45 -delete 2>/dev/null || true

echo "=== done $STAMP ==="
echo "summary: $SUMMARY"
