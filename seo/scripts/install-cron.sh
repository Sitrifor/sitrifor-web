#!/usr/bin/env bash
# Install/refresh daily SEO cron. LLM writer: systemd sitrifor-llm-hourly.timer
set -euo pipefail
SEO_ROOT="/var/www/sitrifor/seo"
SCRIPT="$SEO_ROOT/scripts/daily-seo.sh"
MARKER="# sitrifor-seo-daily"
LLM_MARKER="# sitrifor-llm-nightly"

chmod +x "$SCRIPT" \
  "$SEO_ROOT/scripts/news-llm-daily.sh" \
  "$SEO_ROOT/scripts/news-llm-hourly.sh" \
  "$SEO_ROOT/scripts/news-daily-post.mjs" \
  "$SEO_ROOT/scripts/news-hourly-post.mjs" \
  "$SEO_ROOT/scripts/summarize-daily.py" \
  "$SEO_ROOT/scripts/keyword-seeds.py" \
  "$SEO_ROOT/scripts/install-cron.sh"

line="15 6 * * * cd $SEO_ROOT && /usr/bin/flock -n /tmp/sitrifor-seo.lock $SCRIPT >> $SEO_ROOT/reports/cron.log 2>&1 $MARKER"
tmp=$(mktemp)
crontab -l 2>/dev/null | grep -v "$MARKER" | grep -v "$LLM_MARKER" >"$tmp" || true
echo "$line" >>"$tmp"
crontab "$tmp"
rm -f "$tmp"

if [ -f /var/www/sitrifor/deploy/sitrifor-llm-hourly.service ]; then
  cp /var/www/sitrifor/deploy/sitrifor-llm-hourly.service /etc/systemd/system/
  cp /var/www/sitrifor/deploy/sitrifor-llm-hourly.timer /etc/systemd/system/
  systemctl disable --now sitrifor-llm-daily.timer 2>/dev/null || true
  systemctl daemon-reload
  systemctl enable --now sitrifor-llm-hourly.timer
fi

echo "Installed SEO cron:"
crontab -l | grep "$MARKER" || true
echo "LLM hourly timer:"
systemctl list-timers sitrifor-llm-hourly.timer --no-pager || true
