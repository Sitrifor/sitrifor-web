# Visual design QA for Sitrifor

## Tools
```bash
cd /var/www/sitrifor/seo
npm run visual:qa          # homepage screenshots + structural checks
npm run guides:qa          # magazine hubs (/634/, /guides/*, tools) gate
# reports/visual/home-*.png
# reports/visual/visual-qa-latest.json
# reports/visual/guides-qa-latest.json
```

Stack: Google Chrome headless + Playwright (DOM metrics) for live contrast / media height.

## Hard rules before shipping UI on sitrifor.ru
1. **No cards in the hero** - hero is brand + lead + optional plain supporting line.
2. **Reuse existing patterns** - `agg-hero`, `svc-card`, `story-band`, `founders-hero`, `founder-card`. Do not invent new panel systems for body copy.
3. **SEO copy is typography, not a widget** - open section with H2 + paragraphs; hairline separator OK; no photo-under-text overlays.
4. **One composition** - first viewport must not look like a dashboard of bolted boxes.
5. **Short hyphen `-` in RU body copy** for Sitrifor product text; avoid em-dash `—` and en-dash `–` in new marketing paragraphs (builder normalizes dashes).
6. Always run `npm run visual:qa` after homepage/layout changes and inspect screenshots.
7. Always run `npm run guides:qa` after changes to hubs, `build-hubs.mjs`, `guides.css`, or `seo-content.css`.
8. Always run `npm run copy:qa` after product/SEO copy changes on masters, home, `/634/`, or i18n app strings.
9. **Do not ship a `/masters` edit** until `npm run copy:qa` is green on **masters structure** (tabs + panels + scripts + `</html>`). Buttons without panels = broken page.

---

## Product / SEO copy (masters, /634/, hubs)

Канон: `EDITORIAL_STYLE_RU` + mode `product` in `backend/news-text-polish.js`. Cursor rule: `.cursor/rules/seo-product-copy.mdc`.

Gate: `npm run copy:qa` fails on:
- «у кресла» / «перед креслом» / at the chair
- обрывки «Не CRM записи»
- UI-метки `УТП:` / `USP:`
- кальки «источник правды», workbench, value props, «единица работы»
- голые «на продолжение» / «когда клиент приходит на продолжение» без якоря (татуировка / сеанс)
- «перед сменой» без предмета сеанса
- RU feature strings without concrete tattoo/project/session/client/ink anchor
- old vague projects line in `masters.html`

### Masters page structure (hard gate)

`public/masters.html` must remain a **complete** document with three working tabs. `npm run copy:qa` fails when any of these are missing:

- closing `</html>` and a `<footer>`
- three `data-service-tab`: `app`, `care`, `calculator`
- panels `data-service-panel="care"` + `id="care"` and `calculator` + `id="calculator"`
- mounts `data-care-flow` and `data-calc-form`
- scripts `service-tabs.js`, `care-flow.js`, `tattoo-calculator.js`

**Forbidden for agents:** rewrite / truncate the middle of `masters.html` and save it as the whole file; treat “tab buttons still in markup” as “feature works”. Prefer targeted `StrReplace` inside one panel. After any masters edit, confirm `#app` / `#care` / `#calculator` still open content.

## Guides / 634 magazine hubs

Source of truth also mirrored in Cursor rules:
- `.cursor/rules/ux-ui-design.mdc` (alwaysApply)
- `.cursor/rules/guides-magazine.mdc`

### P0 - site typography (font stack)
- Base `body` font **must** live in `public/css/main.css` as `font-family: var(--g-font-family)` (Inter / system sans). Do not rely on `yandex-business.css` alone - hubs historically omitted it and fell back to **Times**.
- Guide pages reinforce `.guide-page { font-family: var(--g-font-family); }`.
- Display headings may use Manrope (`--font-display`); body/header title/lead/copy must stay on the site sans stack.
- Live gate (`guides:qa`): body, header title, lead/copy, H1 must not resolve to `Times` / bare `serif`.

### P0 - contrast and CTA
- Every hub page that uses `btn` / `btn--brand` / `btn--ghost` **must** ship button CSS on that page.
- Guides currently define buttons in `public/css/guides.css` (they do **not** load `yandex-business.css`).
- Brand CTA: accent background + dark ink text.
- Ghost CTA: light text (`--color-text`) + visible border on dark page. **Forbidden:** black/dark text on transparent/dark background.
- Live gate: CTA contrast ratio ≥ 4.5:1 against effective page background.

### P0 - media and scroll
- Phone screenshots (`/img/app/real/`, ar ≥ ~1.55): hero ≤ ~180px wide; section media uses `.home-seo__media--phone` (max-height ~40vh). **Never** `width: 100%` / `max-width: 36rem` for phone dumps.
- Square marketing art: `.home-seo__media--square`, max ~280px.
- Wide art: `.home-seo__media--wide`, capped height.
- Prefer one hero visual + one `.home-seo__shots` carousel. Section `shot` only if unique and sized; budget ≤ 2 section media per page.
- Live gate: any `.home-seo__media img` ≤ 45% of viewport height.

### P1 - duplication and rhythm
- Do not repeat the same app screen in hero + carousel + section media.
- UTP is open list with yellow keys - not heavy card tiles.
- `home-seo__key`: at most ~2 phrases per section; page caps enforced in `guides-qa.mjs`.

### P1 - builder
- `seo/scripts/build-hubs.mjs` must emit media kind modifiers (`--phone|--square|--wide`) and correct intrinsic width/height (phone 473×1024, not 800×800).
- Bump `ASSET_V.guidesCss` / `seoContent` when CSS changes.

### QA gate failures (guides:qa)
Fails when any of:
- body / guide copy / header title resolve to Times (missing site font stack)
- `main.css` missing `body { font-family: var(--g-font-family) }`
- `btn` used without guides/yandex button CSS linked
- section media without kind modifier
- >2 section media figures
- key-highlight over budget
- em-dash present
- live CTA contrast < 4.5
- live section media > 45% viewport height
- guides.css missing brand/ghost button rules or phone max-height cap
