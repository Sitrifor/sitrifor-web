# News UX checklist (manual + Playwright)

Use before shipping News changes.

Full pre-release gate (gap bug, magazine contrast, SSR, i18n links):
**`seo/reports/news-pre-release-qa.md`**

## Sticky chrome
- [ ] Site header stays at top while scrolling
- [ ] Week strip sits as a second sticky line under the header
- [ ] Week strip height stays compact (< ~120-140px with tags)
- [ ] No full-month grid, no jerky expand/collapse

## Header title
- [ ] "Новости" uses `.header__page-title` like Masters / Partners
- [ ] Title sits next to the logo (`margin-left: 0`, not pushed to the far right)
- [ ] No giant H1 "Новости" above the calendar

## SSR index (no layout gap)
- [ ] Between calendar and feed: no huge empty band
- [ ] `seo-autopilot:news-ssr-index` section has `news-ssr-index sr-only`
- [ ] After autopilot refresh, `sr-only` is still present

## Magazine / review
- [ ] Yellow `.btn--brand` has dark text (not yellow-on-yellow under `.news-mag a`)
- [ ] Product review buy links are buttons, not broken spaced URLs
- [ ] Markdown lists render as real lists

## Content model
- [ ] Feed cards open `/news/a/:slug` on Sitrifor
- [ ] Article page shows full body text (not only external link)
- [ ] With UI language RU, English sources show Russian title/body when translation exists
- [ ] Attribution is quiet (source name), not "read on external site"

## Navigation
- [ ] News is last item in the drawer
- [ ] Label includes `(beta)`

## Automated
```bash
cd /var/www/sitrifor/seo
npx playwright test tests/news.spec.mjs
npm run news:ui-qa
npm run news:i18n-qa
```

News UI QA fails when:
- SSR index on `/news` is missing `sr-only` / visible layout classes reopen the calendar-feed gap
- `.news-ssr-index` or `.sr-only` CSS no longer clips out of flow
- autopilot inject template drops `sr-only`
- magazine brand button contrast override is missing
- news header title selectors lose `margin-left: 0`
- review buy-button / list renderers are missing from `news-article.js`

News i18n QA fails when:
- required `news.*` keys are missing in ru/en/de
- hardcoded Russian UI remains in news JS / magazine CTAs
- published articles lack real EN/DE title+body (or EN/DE still look Russian)
