#!/usr/bin/env bash
# Daily birthday tattoo articles (zodiac + Yandex gallery + LLM editor).
# Target: ≥30 posts/day. Runs under flock with other LLM jobs.
set -euo pipefail

SEO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPORTS="$SEO_ROOT/reports"
DAY="$(date -u +%Y-%m-%d)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$REPORTS/birthday-$DAY.log"
COUNT="${NEWS_BIRTHDAY_DAILY_COUNT:-30}"

mkdir -p "$REPORTS"
exec > >(tee -a "$LOG") 2>&1

echo "=== Sitrifor birthday daily $STAMP count=$COUNT ==="
cd "$SEO_ROOT"

AVAIL_KB=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
if [ "${AVAIL_KB:-0}" -lt 900000 ]; then
  echo "WARN: MemAvailable ${AVAIL_KB}kB < 0.9GB — skip birthday batch"
  exit 0
fi

export OLLAMA_HOST="${OLLAMA_HOST:-http://127.0.0.1:11434}"
export OLLAMA_MODEL="${OLLAMA_MODEL:-qwen2.5:1.5b}"
export OLLAMA_NUM_THREAD="${OLLAMA_NUM_THREAD:-2}"
export OLLAMA_NUM_CTX="${OLLAMA_NUM_CTX:-2048}"
export NEWS_BIRTHDAY_DAILY_COUNT="$COUNT"
export NEWS_BIRTHDAY_LLM="${NEWS_BIRTHDAY_LLM:-1}"
export NEWS_BIRTHDAY_LOCALIZE="${NEWS_BIRTHDAY_LOCALIZE:-0}"
export NEWS_BIRTHDAY_IMG_LIMIT="${NEWS_BIRTHDAY_IMG_LIMIT:-6}"

echo "[1/2] birthday batch ($COUNT)"
npm run news:birthday -- --count "$COUNT" || echo "WARN: birthday batch failed"

echo "[2/2] SEO publish"
npm run news:seo || echo "WARN: news seo failed"

curl -s http://127.0.0.1:11434/api/generate \
  -d "{\"model\":\"$OLLAMA_MODEL\",\"keep_alive\":0,\"prompt\":\"\"}" >/dev/null || true

echo "=== birthday done $STAMP ==="
