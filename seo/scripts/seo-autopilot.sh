#!/usr/bin/env bash
# Wrapper for systemd / manual runs: single flock around node autopilot.
set -euo pipefail
SEO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SEO_ROOT"
export PATH="/usr/bin:/bin:${PATH:-}"
# Load optional env
if [[ -f "$SEO_ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$SEO_ROOT/.env"
  set +a
fi
exec /usr/bin/flock -n /tmp/sitrifor-seo-autopilot.lock \
  /usr/bin/node "$SEO_ROOT/scripts/seo-autopilot.mjs" "$@"
