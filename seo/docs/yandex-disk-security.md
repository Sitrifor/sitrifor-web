# Безопасность токенов Яндекс.Диска

## Модель защиты

| Слой | Что сделано |
|------|-------------|
| Хранение | AES-256-GCM в `/root/.config/sitrifor/secrets/` (не в `/var/www`) |
| Права | каталог `700`, файлы `600`, только `root` |
| Веб | `www-data` / nginx не читают секреты; plaintext убран из `seo/credentials` и `seo/.env` |
| Агент | Cursor hook блокирует токены `y0__…` в shell и чтение `.enc` / `master.key` |
| Логи | terminal/agent-tools/transcripts с токеном заредactены |

Проверка:

```bash
npm run yandex:disk:audit --prefix seo
npm run yandex:disk:check --prefix seo
```

## Как правильно выдавать токен

1. Откройте URL из `npm run yandex:disk:auth --prefix seo`
2. Вставьте токен **только в интерактивный терминал** (не в чат)
3. Либо: `npm run yandex:disk:auth --prefix seo -- --from-stdin`

Запрещено:
- вставлять токен в чат Cursor
- передавать токен аргументом shell (`TOKEN=... curl ...`)
- класть токен в `seo/.env` или файлы под `/var/www`

## Если токен уже светился (чат / история)

1. https://oauth.yandex.ru/ → приложение → отозвать доступ / перевыпустить токен
2. `npm run yandex:disk:auth --prefix seo` - сохранить новый
3. `npm run yandex:disk:audit --prefix seo`

Старый токен после утечки в чат считать скомпрометированным.

## Ротация / аудит

```bash
node seo/scripts/yandex-disk/harden.mjs          # миграция + shred plaintext
node seo/scripts/yandex-disk/harden.mjs --audit  # проверка
```

Encrypted имена:
- `yandex-disk-token.enc`
- `yandex-webmaster-token.enc`
- `yandex-oauth-app.enc`
- `master.key` (никому не копировать; бэкап только в отдельный encrypted vault)
