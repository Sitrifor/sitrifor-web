# sitrifor.ru

Независимый проект на сервере: лендинг + задел под API для тату-мастеров (iOS / Android / Huawei).

## DNS — почему у части пользователей / App Review 404

Сайт на **этом VPS** работает. Страница Support тоже: `https://sitrifor.ru/support/` → **200** на IP **217.26.24.29**.

| Проверка | Результат |
|----------|-----------|
| IP VPS | **217.26.24.29** |
| Auth DNS Beget (`ns1.beget.com`) | `A → 217.26.24.29` |
| Google DNS `8.8.8.8` | обычно `217.26.24.29` ✅ |
| Yandex DNS | `217.26.24.29` ✅ |
| Cloudflare `1.1.1.1` / iCloud Private Relay | часто ещё **`45.130.41.193`** ❌ |
| OpenDNS / Quad9 | часто **`45.130.41.193`** ❌ |

IP **`45.130.41.193`** — парковка Beget («Новый сайт успешно создан»).  
`/` — заглушка, **`/support/` и любые разделы → 404 Apache**.

**App Store Connect (Guideline 1.5):** ревьюеры на iPad часто идут через Private Relay / Cloudflare DNS → старый IP → видят «Support URL not functional». Это не баг страницы на VPS.

### Срочно для повторной отправки в App Review

1. **Залейте зеркало Support на хостинг Beget** (пока DNS «прыгает»):
   - файл: `deploy/beget-parking-mirror/support/index.html`
   - в `public_html` сайта Beget создайте `support/index.html`
   - тогда `/support/` отвечает и на `45.x`, и на VPS
2. В DNS-зоне Beget добавьте TXT `@` → `cache-bust=2026-07-31` (сдвиг SOA serial).
3. Purge Cloudflare: https://one.one.one.one/purge-cache/ для `sitrifor.ru` и `www` (тип A).
4. Проверка перед Submit for Review:
   ```bash
   dig +short sitrifor.ru A @1.1.1.1   # желательно 217.26.24.29
   curl -sI https://sitrifor.ru/support/ | head -1
   ```
5. В ответе Apple: Support URL исправлен / доступен; проблема была в DNS-кэше резолверов, страница живая.

### Что сделать в панели Beget (обязательно)

1. **Домены → sitrifor.ru → DNS / DNS-зона**
   - У `@` и `www` должна быть **одна** A-запись: **`217.26.24.29`**
   - Любые A на `45.130.41.193` / старые IP — **удалить**
2. Если в Beget создан «сайт» на виртуальном хостинге для `sitrifor.ru` — **отвязать или удалить** после того как DNS везде покажет VPS (иначе панель может снова подставить свой IP). Пока кэш «липнет» — держите зеркало `support/` на Beget.
3. **Принудительно обновить зону** (сдвинуть SOA serial):
   - TXT: `@` → `cache-bust=2026-07-31`
4. Почистите кэш Cloudflare: https://one.one.one.one/purge-cache/
5. Google DNS: https://developers.google.com/speed/public-dns/cache

Проверка:

```bash
dig +short sitrifor.ru A @ns1.beget.com
dig +short sitrifor.ru A @8.8.8.8
dig +short sitrifor.ru A @1.1.1.1   # пока здесь 45.x — App Review / iPhone могут видеть 404
```

MX и TXT почты Beget **не трогать** (кроме временного cache-bust TXT).

## Структура

```
/var/www/sitrifor/
├── public/          # статика (Nginx root)
├── backend/         # будущий REST API
└── deploy/          # шаблоны Nginx
```

## Резерв портов на сервере

| Порт | Назначение |
|------|------------|
| 5000 | Ktema (gunicorn) — занят |
| 8080 | Chern API — занят |
| 5433 | Chern PostgreSQL — занят |
| **8081** | sitrifor API — зарезервирован |
| **5434** | sitrifor PostgreSQL — зарезервирован |

## Деплой Nginx (основной домен)

```bash
sudo cp /var/www/sitrifor/deploy/nginx-sitrifor.ru.conf /etc/nginx/sites-available/sitrifor.ru
sudo ln -sf /etc/nginx/sites-available/sitrifor.ru /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## SSL

Уже выпущен Certbot’ом на этом VPS. После смены DNS повторно:

```bash
sudo /var/www/sitrifor/deploy/check-and-ssl.sh
```
