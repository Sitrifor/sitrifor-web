# Bing Webmaster для sitrifor.ru

Нужен для экосистемы Microsoft / части browsing в ChatGPT. IndexNow уже шлётся с сервера; кабинет даёт отчёты и ручную проверку URL.

## Шаги

1. Откройте [Bing Webmaster Tools](https://www.bing.com/webmasters).
2. Войдите Microsoft-аккаунтом.
3. **Add a site** → `https://sitrifor.ru`.
4. Подтверждение (любой удобный способ):
   - **XML file** - скачать `BingSiteAuth.xml` → положить в `public/` и задеплоить, или
   - **DNS CNAME/TXT** по инструкции Bing, или
   - импорт из Google Search Console (если GSC уже verified).
5. Добавьте sitemaps:
   - `https://sitrifor.ru/sitemap.xml`
   - `https://sitrifor.ru/sitemap-news.xml`
   - `https://sitrifor.ru/sitemap-marketplace.xml`
6. Опционально: URL Inspection для `/`, `/634/`, `/masters`, `/guides/aftercare/`.

## Уже на сервере

- IndexNow key: `seo/.env` → `INDEXNOW_KEY`
- Key file: `public/<key>.txt`
- Пинг: `cd seo && npm run indexnow -- / /634/ /masters /guides/aftercare/`

После подтверждения пришлите - зафиксируем в `seo/ACCESS-CHECKLIST.md`.
