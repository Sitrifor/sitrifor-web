# Credentials for SEO automation

Put secrets here (gitignored except this README). Never commit real keys.

| File | Purpose |
|------|---------|
| `../.env` | IndexNow, Metrika, site origin (see `.env.example`) |
| `gsc-service-account.json` | Google Search Console API (service account) |
| `yandex-webmaster-oauth.json` | Yandex OAuth token for Webmaster API |

## Google Search Console

1. Create a GCP project → enable **Search Console API**.
2. Create a **service account**, download JSON → save as `gsc-service-account.json`.
3. In GSC → Settings → Users → add the service account email as **Full** user.
4. Property: `https://sitrifor.ru/` (URL-prefix) or Domain `sitrifor.ru`.

## Yandex Webmaster

1. Add site in [Яндекс.Вебмастер](https://webmaster.yandex.ru/).
2. Verify via DNS `yandex-verification` TXT or HTML meta.
3. Create OAuth app at https://oauth.yandex.ru/ → save token JSON here.
4. Optional: enable **IndexNow** and put the key in `../.env` + host key file under `public/`.

## Yandex Metrika

1. Create counter for `sitrifor.ru`.
2. Put `YANDEX_METRIKA_ID` into `../.env`.
3. Agent injects the snippet into HTML when asked to implement tracking.
