#!/bin/bash
# Проверка DNS и выпуск SSL для sitrifor.ru. Запуск: sudo ./check-and-ssl.sh
set -euo pipefail

SERVER_IP="217.26.24.29"
DOMAIN="sitrifor.ru"

echo "=========================================="
echo " Проверка sitrifor.ru — $(date -Iseconds)"
echo "=========================================="

echo ""
echo "[1] IP сервера:"
curl -4 -s ifconfig.me || true
echo ""

echo "[2] DNS на Beget (ns1.beget.com):"
echo "  sitrifor.ru: $(dig +short sitrifor.ru A @ns1.beget.com | tr '\n' ' ')"
echo "  www:         $(dig +short www.sitrifor.ru A @ns1.beget.com | tr '\n' ' ')"

echo ""
echo "[3] Публичный DNS (Google 8.8.8.8):"
PUB=$(dig +short sitrifor.ru A @8.8.8.8 | tr '\n' ' ')
echo "  sitrifor.ru: ${PUB:-NXDOMAIN / пусто}"

echo ""
echo "[4] HTTP с сервера:"
if curl -sI --max-time 10 "http://${DOMAIN}/" 2>/dev/null | head -1; then
  :
else
  echo "  не открывается (DNS ещё не в интернете)"
fi

echo ""
echo "[5] Nginx (принудительно на наш IP):"
curl -sI --resolve "${DOMAIN}:80:${SERVER_IP}" "http://${DOMAIN}/" | head -1

echo ""
echo "[6] Whois (статус домена):"
whois sitrifor.ru 2>/dev/null | grep -iE '^state:|^created:' || true

# Проверки перед certbot
APEX_BEGET=$(dig +short sitrifor.ru A @ns1.beget.com)
PUB_DNS=$(dig +short sitrifor.ru A @8.8.8.8)

if [[ -z "$PUB_DNS" ]]; then
  echo ""
  echo ">>> SSL пока нельзя: домен не виден в публичном DNS."
  echo ">>> Домен новый — подождите 1–24 ч. Проверьте верификацию в Beget (статус UNVERIFIED)."
  exit 0
fi

if ! echo "$APEX_BEGET" | grep -q "$SERVER_IP"; then
  echo ""
  echo ">>> SSL пока нельзя: sitrifor.ru на Beget не указывает на $SERVER_IP"
  exit 1
fi

WWW_BEGET=$(dig +short www.sitrifor.ru A @ns1.beget.com)
if echo "$WWW_BEGET" | grep -q "5.101.153.18"; then
  echo ""
  echo ">>> Внимание: www всё ещё на 5.101.153.18 — в Beget смените www A на $SERVER_IP"
fi

echo ""
echo "[7] Запуск certbot..."
if certbot --nginx -d sitrifor.ru -d www.sitrifor.ru --non-interactive --agree-tos --register-unsafely-without-email 2>&1; then
  echo ""
  echo ">>> SSL выпущен!"
  curl -sI "https://${DOMAIN}/" | head -3
else
  echo ""
  echo ">>> Certbot не прошёл. Повторите позже: sudo $0"
  exit 1
fi
