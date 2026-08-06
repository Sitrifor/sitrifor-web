# GitHub setup (Sitrifor)

## Репозиторий
- Org: `Sitrifor`
- Repo: `sitrifor-web` (**Private**)
- SSH remote с сервера: `git@github.com-sitrifor-web:Sitrifor/sitrifor-web.git`
- Deploy key: `sitrifor-server` (write), ключ на VPS `/root/.ssh/sitrifor_web_github`

## Не коммитить
- `seo/.env`, токены в `seo/credentials/`
- `node_modules/`, `.venv/`, `seo/reports/`, бэкапы

## Cursor GitHub App (облачные агенты)
Dashboard Cursor → Integrations → GitHub App только на `sitrifor-web`.

## Branch protection (рекомендуется после каркаса)
`main`: PR required; позже required check `copy:qa`.

## Следующий репо
`sitrifor-634` - когда код приложения готов к переносу с Mac.

## API access (ops)

Для настройки Projects v2 нужен **Classic** PAT (`ghp_…`) со scope `repo` + `project`.
Fine-grained (`github_pat_…`) к доске Projects v2 у user-аккаунта Sitrifor не пускает.

Токен хранить только на сервере: `/root/.config/sitrifor/github.token` (chmod 600), не в git.
После утечки в чат - Revoke и перевыпуск.
