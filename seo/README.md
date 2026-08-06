# Sitrifor SEO Toolkit

Непрерывный SEO-стек для [sitrifor.ru](https://sitrifor.ru). Каталог: `/var/www/sitrifor/seo`

## First-party аналитика (неуникальные пользователи)

Собственная разметка без Метрики/GA:

- Трекер: `/js/sf-analytics.js` на всех страницах
- Collect: `POST /api/analytics/collect` → SQLite `backend/data/analytics.db`
- **Неуникальные пользователи = визиты (сессии)**: каждый новый визит считаётся снова
- IP хешируется суточной солью (не хранится в открытом виде)

```bash
# Сводка
npm run analytics

# Движок решений по визитам (IndexNow, lastmod sitemap, приоритеты кластеров)
export ANALYTICS_TOKEN=$(cat .analytics-token)
npm run decide

# Скриншоты + design-check главной
npm run visual:qa
```

Визуальный QA: `seo/docs/DESIGN-QA.md`, отчёты в `seo/reports/visual/`.
Гайды / 634: `npm run guides:qa` (контраст CTA, лимиты media, kind-модификаторы).
Копирайт продукта: `npm run copy:qa` (бан-лист калек и жаргона).

API (токен в `seo/.analytics-token` / `x-analytics-token`):
- `GET /api/analytics/summary?days=7`
- `GET /api/analytics/path?path=/masters&days=14`
- `GET /api/analytics/decisions`

Движок пишет `reports/seo-decisions-latest.json` и входит в ежедневный cron.

## Установлено

### Система
- `tidy`, `xmlstarlet`, `html-xml-utils`, `linkchecker`, `jq`, `imagemagick`
- Google Chrome Stable (Lighthouse)

### Node (`seo/`)
- `lighthouse`, `chrome-launcher`, `cheerio`, `robots-parser`, `xml2js`, `htmlhint`

### Python (`seo/.venv`)
- `advertools`, `beautifulsoup4`, `lxml`, `requests`, `pandas`, `python-dotenv`
- Google Search Console client libs

### Автоматика
- **Cron daily 06:15 UTC** (`npm run cron:install`) → audit + crawl + sitemap + lighthouse + IndexNow + summary
- IndexNow key уже в `.env` и `public/<key>.txt`

## Команды

```bash
cd /var/www/sitrifor/seo

npm run audit:live      # тех. аудит live
npm run crawl           # внутренние ссылки
npm run lighthouse -- --url https://sitrifor.ru/
npm run sitemap:validate
npm run indexnow        # пинг Bing/Yandex
npm run keywords        # кластеры + 14-дневный контент-план
npm run daily           # полный дневной прогон вручную
npm run cron:install    # поставить/обновить cron
npm run decide          # SEO-решения по визитам
npm run visual:qa       # скриншоты + design rules
npm run gsc             # нужен service account
```

Отчёты: `seo/reports/` (`seo-audit-latest.json`, `lighthouse-latest.*`, `daily-summary-latest.json`, `keyword-seeds-latest.json`).

## Органика каждый день — что реально двигает рост

Техника (уже на сайте) только снимает потери. Рост органики = **новые индексируемые URL + измерение**.

1. Публиковать 2–3 статьи/неделю по кластерам из `npm run keywords` (уход, калькулятор, 634).
2. Подключить **Метрику + Вебмастер + GSC** (см. checklist ниже) — иначе «ежедневный рост» нельзя ни видеть, ни оптимизировать.
3. После каждой публикации: обновить `sitemap.xml` и `npm run indexnow`.

## Доступы (вручную)

- [x] IndexNow key
- [ ] Яндекс.Вебмастер + `YANDEX_OAUTH_TOKEN` / verification
- [ ] Яндекс.Метрика → `YANDEX_METRIKA_ID` + сниппет в HTML
- [ ] Google Search Console + `credentials/gsc-service-account.json`
- [ ] Опционально: `GA4_MEASUREMENT_ID`

Инструкции: `credentials/README.md`, `ACCESS-CHECKLIST.md`.

## Связь с сайтом

- Public: `/var/www/sitrifor/public`
- Nginx: `/etc/nginx/sites-available/sitrifor.ru`
- API: `/var/www/sitrifor/backend` (:8081)
