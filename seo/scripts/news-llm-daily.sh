#!/usr/bin/env bash
# Nightly LLM pipeline: daily tattoo industry post + reviews + SEO.
# Low-load window (~02:30 MSK). Leaves RAM for the site.
set -euo pipefail

SEO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPORTS="$SEO_ROOT/reports"
DAY="$(date -u +%Y-%m-%d)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$REPORTS/llm-$DAY.log"

mkdir -p "$REPORTS"
exec > >(tee -a "$LOG") 2>&1

echo "=== Sitrifor LLM daily writer $STAMP ==="
cd "$SEO_ROOT"

AVAIL_KB=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
if [ "${AVAIL_KB:-0}" -lt 1200000 ]; then
  echo "WARN: MemAvailable ${AVAIL_KB}kB < 1.2GB — skip LLM job"
  exit 0
fi

export OLLAMA_HOST="${OLLAMA_HOST:-http://127.0.0.1:11434}"
export OLLAMA_MODEL="${OLLAMA_MODEL:-qwen2.5:1.5b}"
export OLLAMA_NUM_THREAD="${OLLAMA_NUM_THREAD:-2}"
export OLLAMA_NUM_CTX="${OLLAMA_NUM_CTX:-2048}"
# Short LLM tips for daily posts (safe); long freeform off by default
export NEWS_LLM_DAILY="${NEWS_LLM_DAILY:-1}"
export NEWS_LLM_INSIGHTS="${NEWS_LLM_INSIGHTS:-0}"
export NEWS_LLM_REVIEWS="${NEWS_LLM_REVIEWS:-0}"

echo "[1/5] daily tattoo industry post"
npm run news:daily-post || echo "WARN: daily post failed"

echo "[2/5] TattooMarket reviews (template-first, limit ${TM_REVIEW_LIMIT:-1})"
npm run news:reviews -- --limit "${TM_REVIEW_LIMIT:-1}" || echo "WARN: reviews failed"

echo "[3/5] quality cleanup"
npm run news:cleanup -- --insights-limit "${LLM_INSIGHTS_LIMIT:-5}" || echo "WARN: cleanup failed"

echo "[4/5] optional LLM editor"
if [ "${NEWS_LLM_INSIGHTS:-0}" = "1" ]; then
  npm run news:llm -- --limit "${LLM_EDIT_LIMIT:-2}" || echo "WARN: llm editor failed"
else
  echo "skip llm editor"
fi

echo "[5/5] SEO publish"
npm run news:seo || echo "WARN: news seo failed"

curl -s http://127.0.0.1:11434/api/generate \
  -d "{\"model\":\"$OLLAMA_MODEL\",\"keep_alive\":0,\"prompt\":\"\"}" >/dev/null || true

echo "=== done $STAMP ==="
