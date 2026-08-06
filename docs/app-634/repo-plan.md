# План репозитория кода 634

## Сейчас
- Продуктовая документация: этот каталог в **private** `Sitrifor/sitrifor-web`
- Исходники iOS: локально у заказчика (ещё не на GitHub)

## Цель
Private репозиторий `Sitrifor/sitrifor-634`:
- тот же GitHub account/org
- deploy key / PAT отдельно от web (least privilege)
- общая доска Projects + labels `product:634`
- копия или submodule ссылки на `docs/app-634` / KB

## Чеклист переноса (когда будете готовы)
1. Создать private `sitrifor-634` без README
2. Deploy key с Mac (write) или fine-grained PAT только на этот репо
3. Первый push без secrets (`.gitignore`: `*.p8`, `AuthKey*`, `xcuserdata`, `.env`)
4. В `sitrifor-web` обновить `docs/kb/app-634.md` ссылкой на код
5. Cursor GitHub App - добавить второй репо точечно

До переноса агенты сайта работают по **этой** документации, не по догадкам о коде.
