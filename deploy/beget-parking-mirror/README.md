# Зеркало для парковки Beget (45.130.41.193)

Пока часть резолверов (1.1.1.1, 9.9.9.9) отдаёт старый IP Beget,
внутренние URL вроде `/news/a/...` показывают **Apache 404** - это видит пользователь
(и раньше App Review на iPad для `/support/`).

Auth NS Beget уже указывает на VPS `217.26.24.29`. Проблема - stale DNS + живой shared-сайт.

## Важно про редиректы

**Нельзя** ставить 301/meta-refresh на `https://sitrifor.ru/...`: при stale DNS клиент снова попадёт на Beget (цикл / тот же 404).

Варианты:

1. Показать понятную страницу «сайт переехал» + инструкции (файл `index.html` в корне).
2. Удалить/отвязать сайт в панели Beget, чтобы Host `sitrifor.ru` на `45.130.41.193` перестал отвечать.
3. Пользователю: purge https://one.one.one.one/purge-cache/ и временно DNS `8.8.8.8`.

В этом репозитории **нет** FTP/API-учёток Beget - загрузка только вручную из панели.

## Что загрузить в Beget (файловый менеджер / FTP)

1. Откройте сайт `sitrifor.ru` на виртуальном хостинге Beget.
2. В `public_html` (корень сайта) загрузите:
   - `index.html` (сообщение о переезде)
   - папку `support/` с `index.html` (App Review / support)
3. Проверьте с принудительным IP:
   ```bash
   curl -sI --resolve 'sitrifor.ru:80:45.130.41.193' -H 'Host: sitrifor.ru' http://sitrifor.ru/
   curl -sI --resolve 'sitrifor.ru:443:45.130.41.193' https://sitrifor.ru/support/
   ```
4. После полной пропагации DNS лучше **удалить** сайт на Beget.

Целевой IP VPS: **217.26.24.29**

Подробный runbook: `seo/reports/dns-apache-404-runbook.md`
