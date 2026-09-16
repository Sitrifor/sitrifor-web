# GSC кабинет sitrifor.ru - идеальная настройка

Актуально после API-подключения (2026-08-10). Ресурс: **Domain** `sitrifor.ru` (`sc-domain:sitrifor.ru`).

## Уже закрыто (агент / API)

- [x] Domain verified (DNS)
- [x] Service account Full + ключ на сервере
- [x] 3 sitemap без ошибок: main / news / marketplace
- [x] URL Inspection хабов + отчёт `seo/reports/gsc/`
- [x] IndexNow пинг приоритетных URL
- [x] `npm run gsc -- report` в autopilot

## Сделайте в UI (5-10 мин) - без этого Google не «дожмёт» индекс

### 1. Request indexing для NEED URL

1. Откройте [Search Console](https://search.google.com/search-console) → `sitrifor.ru`.
2. Вверху **Проверка URL** (URL Inspection).
3. Вставьте URL → дождитесь результата → **Запросить индексирование**.

Приоритет сегодня:

| URL | Статус API (на момент отчёта) |
|-----|-------------------------------|
| `https://sitrifor.ru/634/` | Crawled - currently not indexed |
| остальные хабы guides/news | если в отчёте NEED |

Квота ограничена - 1-2 раза в день на URL, не спамить.

### 2. Мониторинг кабинета (раз в неделю)

| Раздел | Зачем |
|--------|--------|
| **Эффективность** | клики / показы / CTR / запросы |
| **Страницы** (индексирование) | почему не в индексе |
| **Файлы Sitemap** | errors=0, рост indexed |
| **Удобство для мобильных** | после появления трафика |
| **Основные веб-показатели** | Core Web Vitals |

### 3. Пользователи

- Владелец: ваш Google-аккаунт
- Full: `sitrifor-gsc@sitrifor-seo.iam.gserviceaccount.com` (уже)

### 4. Bing (опционально, усиливает экосистему)

[Bing Webmaster](https://www.bing.com/webmasters) → импорт из GSC одним кликом.

## Crawl budget (важно)

Marketplace sitemap (~3505 URL) **временно снят** из GSC и из `robots.txt` Sitemap (файл `/sitemap-marketplace.xml` на сайте остаётся). Цель - 2-4 недели фокуса краула на хабы и news.

Вернуть:
1. Добавить строку `Sitemap: https://sitrifor.ru/sitemap-marketplace.xml` в `build-hubs.mjs` / robots
2. `npm run gsc --` submit через `sitemap-ensure` после возврата URL в `SITEMAPS`
3. Яндекс sync снова начнёт ensure, если вернуть URL в `wanted`

Пока фокус Request indexing + внешние ссылки - на `/`, `/634/`, `/masters`, guides, aftercare.

## Команды агента

```bash
cd /var/www/sitrifor/seo
set -a && source .env && set +a
npm run gsc -- report          # полный снимок
npm run gsc -- inspect-hubs    # быстрый статус хабов
npm run gsc -- analytics --dimensions query,page
npm run gsc -- sitemap-ensure  # дослать sitemap если пропали
```

## Ожидание

Пустая **Эффективность** первые дни - норма. Сначала растёт индекс хабов, потом показы, потом клики.
