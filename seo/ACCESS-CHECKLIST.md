# SEO access checklist for agent

- [x] `seo/.env` from `.env.example`
- [x] IndexNow key in `.env` + `public/<key>.txt` (live ping OK)
- [x] Daily cron installed (`npm run cron:install`)
- [x] Яндекс.Вебмастер: site verified (DNS), host `OK`, OAuth API
- [x] Яндекс.Метрика `111332527` + snippet
- [x] `public/llms.txt` live
- [x] Google Search Console Domain `sitrifor.ru` (`GSC_SITE_URL=sc-domain:sitrifor.ru`)
- [x] `credentials/gsc-service-account.json` + Full user in GSC
- [ ] Bing Webmaster site + sitemaps (see `seo/docs/bing-webmaster-setup.md`)
- [ ] Optional: `GA4_MEASUREMENT_ID`

GSC playbook: `seo/docs/gsc-cabinet-playbook.md`  
Weekly: `seo/docs/weekly-seo-runbook.md`
