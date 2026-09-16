# Weekly SEO runbook (Sitrifor)

Цель недели: больше URL в Яндексе, рост показов, первые Search-визиты в Метрике.

## Уже сделано (2026-08-08)

- [x] Яндекс: хост `OK`, переобход 12 хабов (квота ~30 осталось на день)
- [x] IndexNow (Bing + Yandex) по приоритетным URL
- [x] `public/llms.txt` + ссылка в `robots.txt`
- [x] Aftercare FAQ под живые запросы Вебмастера (ребра / первая неделя)
- [x] Правка копирайта aftercare (`до кресла` → `до сеанса`)
- [x] Инструкции: GSC `seo/docs/google-search-console-setup.md`, Bing `seo/docs/bing-webmaster-setup.md`

## Ваш UI-чеклист (без API не закрыть)

1. [x] [Google Search Console](https://search.google.com/search-console) - Domain `sitrifor.ru` + sitemap main/news (marketplace sitemap paused)
2. [x] GSC Request indexing для `/634/`, `/news`, pigments, machines (Indexed)
3. [ ] Опубликовать 1-2 внешних упоминания из `seo/docs/external-mentions-drafts.md` (Telegram / LinkedIn)
4. [ ] [Bing Webmaster](https://www.bing.com/webmasters) - импорт из GSC
5. [ ] Яндекс.Вебмастер UI: регион Россия, Метрика `111332527`, обход по счётчику

Playbook: `seo/docs/gsc-cabinet-playbook.md`. Снимок API: `cd seo && npm run gsc -- report`.

Сделано 2026-08-10: aftercare под живые запросы, статья `/news/a/tatu-na-rebrakh-…`, переобход `/634/`+`/masters`, marketplace sitemap снят из GSC/robots.

## Каждые 2-3 дня (агент / cron)

```bash
cd /var/www/sitrifor/seo
# IndexNow хабы
node scripts/indexnow.mjs / /634/ /masters /guides/aftercare/ /guides/pigments/ /news
```

Переобход Вебмастера - не чаще чем раз в 2-3 дня по тем же URL (квота 150/день).

## Пятничный срез

1. Метрика: есть ли источник Search? users/visits за 7 дней
2. Вебмастер: `searchable_pages_count`, новые queries/shows
3. `/634/` появился ли в «Страницах в поиске»
4. Запись в `seo/reports/yandex-webmaster/status-YYYY-MM-DD.md`

## Команды

```bash
cd /var/www/sitrifor/seo
npm run hubs:build          # пересобрать гайды/634 из JSON
npm run indexnow -- / /634/ /guides/aftercare/
npm run copy:qa             # после правок копирайта
```

## Ожидание (не баг)

При единичных показах Search в Метрике может быть 0 ещё 1-3 недели. Смотрите сначала рост **страниц в поиске** и **показов**, потом клики.
