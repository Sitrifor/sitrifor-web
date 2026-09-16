# Credentials for SEO automation

Put secrets **outside** the web tree. Preferred store:

`/root/.config/sitrifor/secrets/` (AES-256-GCM, mode 700/600, root only)

Managed by:

```bash
npm run yandex:disk:harden --prefix seo
npm run yandex:disk:audit --prefix seo
npm run yandex:disk:auth --prefix seo
```

Docs: [`../docs/yandex-disk-security.md`](../docs/yandex-disk-security.md)

| Secret | Where |
|--------|-------|
| Yandex Disk OAuth | encrypted `yandex-disk-token.enc` |
| Yandex Webmaster OAuth | encrypted `yandex-webmaster-token.enc` |
| Yandex OAuth app (client id/secret) | encrypted `yandex-oauth-app.enc` |
| `../.env` | non-secret config only (Metrika id, IndexNow key, …) - **no Disk token** |
| `gsc-service-account.json` | still under `credentials/` if used; keep mode 600 |

## Rules

1. Never commit real keys (this folder is gitignored except README / stubs).
2. Never paste OAuth tokens into Cursor chat.
3. Never put `YANDEX_DISK_OAUTH_TOKEN=` into `seo/.env`.
4. Do not restore plaintext `*-token.txt` under `/var/www`.

## Google Search Console

1. Create a GCP project → enable **Search Console API**.
2. Create a **service account**, download JSON → save as `gsc-service-account.json` (mode 600).
3. In GSC → Settings → Users → add the service account email as **Full** user.

## Yandex Webmaster / Disk

See [`../docs/yandex-disk-security.md`](../docs/yandex-disk-security.md) and [`../docs/yandex-disk-portfolio.md`](../docs/yandex-disk-portfolio.md).
