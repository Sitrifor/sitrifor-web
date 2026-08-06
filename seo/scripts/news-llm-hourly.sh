#!/usr/bin/env bash
# LLM editorial writer for tattoo industry (social / clients / gear / birthday rotation).
# Cadence: 1 post / 20 min (systemd timer + code rate limit). MemoryMax on ollama, skip if RAM tight.
set -euo pipefail

SEO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPORTS="$SEO_ROOT/reports"
DAY="$(date -u +%Y-%m-%d)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$REPORTS/llm-hourly-$DAY.log"

mkdir -p "$REPORTS"
exec > >(tee -a "$LOG") 2>&1

echo "=== Sitrifor LLM editor $STAMP ==="
cd "$SEO_ROOT"

echo "[0/3] engagement boost (views + reactions)"
npm run news:engagement || echo "WARN: engagement boost failed"

AVAIL_KB=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
if [ "${AVAIL_KB:-0}" -lt 1100000 ]; then
  echo "WARN: MemAvailable ${AVAIL_KB}kB < 1.1GB - skip hourly LLM job"
  exit 0
fi

export OLLAMA_HOST="${OLLAMA_HOST:-http://127.0.0.1:11434}"
export OLLAMA_MODEL="${OLLAMA_MODEL:-qwen2.5:1.5b}"
export OLLAMA_NUM_THREAD="${OLLAMA_NUM_THREAD:-2}"
export OLLAMA_NUM_CTX="${OLLAMA_NUM_CTX:-2048}"
export NEWS_LLM_DAILY="${NEWS_LLM_DAILY:-1}"
export NEWS_LLM_REVIEWS="${NEWS_LLM_REVIEWS:-0}"
export NEWS_LLM_INSIGHTS="${NEWS_LLM_INSIGHTS:-0}"

echo "[1/3] editor post (1 article, mode rotation)"
npm run news:hourly || echo "WARN: hourly post failed"

echo "[2/3] polish published text + SEO"
npm run news:polish -- --limit 30 || echo "WARN: polish failed"
npm run news:seo || echo "WARN: news seo failed"
npm run news:i18n-qa || echo "WARN: news i18n QA failed"
npm run news:ui-qa || echo "WARN: news UI QA failed"

curl -s http://127.0.0.1:11434/api/generate \
  -d "{\"model\":\"$OLLAMA_MODEL\",\"keep_alive\":0,\"prompt\":\"\"}" >/dev/null || true

echo "=== done $STAMP ==="
