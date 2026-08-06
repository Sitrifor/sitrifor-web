# SEO access checklist for agent

- [x] `seo/.env` from `.env.example`
- [x] IndexNow key in `.env` + `public/<key>.txt` (live ping OK)
- [x] Daily cron installed (`npm run cron:install`)
- [ ] Яндекс.Вебмастер: site added + verified
- [ ] `YANDEX_VERIFICATION` meta/DNS in `.env` (+ HTML meta if needed)
- [ ] Яндекс.Метрика counter → `YANDEX_METRIKA_ID` + snippet in HTML
- [ ] Google Search Console property for `sitrifor.ru`
- [ ] `credentials/gsc-service-account.json` + user invite in GSC
- [ ] Optional: `GA4_MEASUREMENT_ID`
- [ ] Optional: `YANDEX_OAUTH_TOKEN` for Webmaster API
