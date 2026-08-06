#!/bin/bash
# Запустить после настройки DNS (A-записи @ и www → 217.26.24.29, без 5.101.153.18)
set -euo pipefail

SERVER_IP="217.26.24.29"

echo "Проверка DNS на Beget (ns1.beget.com)..."
APEX=$(dig +short sitrifor.ru A @ns1.beget.com | sort -u | tr '\n' ' ')
WWW=$(dig +short www.sitrifor.ru A @ns1.beget.com | sort -u | tr '\n' ' ')

echo "  sitrifor.ru  → ${APEX:-нет записи}"
echo "  www          → ${WWW:-нет записи}"

if [[ "$APEX" != *"$SERVER_IP"* ]]; then
  echo "Ошибка: sitrifor.ru не указывает на $SERVER_IP."
  echo "В Beget удалите A на 45.130.41.193 / 5.101.153.18 и оставьте только A → $SERVER_IP."
  exit 1
fi

certbot --nginx -d sitrifor.ru -d www.sitrifor.ru --non-interactive --agree-tos --register-unsafely-without-email --redirect

echo "Готово. Проверка:"
curl -sI https://sitrifor.ru/ | head -3
