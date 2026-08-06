# LinkedIn для Sitrifor (Founder)

Профиль: https://www.linkedin.com/in/temagrishan

## Что делаем в этом репо
1. **Готовый текст профиля** Founder Sitrifor - [`founder-profile.md`](founder-profile.md)
2. **Генератор черновиков постов** через локальный Ollama - [`ops/linkedin/`](../../ops/linkedin/)
3. Очередь черновиков в `ops/linkedin/drafts/` + апрув перед публикацией

## Чего не делаем
- **Автоприглашения в друзья / connection requests** тату-мастерам - запрещено правилами LinkedIn, ломает аккаунт. Альтернативы: ручной outreach по спискам, контент + комментарии, реклама / Company Page, партнёрства через `/partners`.
- Скрытый scraping профиля LinkedIn.

## LinkedIn API (посты)
Публикация через API требует одобрения **Marketing Developer Platform / Community Management** и прав вроде `w_member_social` или `w_organization_social`. Без партнёрского доступа «просто связать Ollama с LinkedIn API» нельзя.

Пока API нет:
1. `python3 ops/linkedin/draft_post.py` → черновик в `ops/linkedin/drafts/`
2. Вы правите и публикуете в LinkedIn вручную (или через буфер)

Когда получите Client ID/Secret и OAuth - добавим `ops/linkedin/publish.py` (только после вашего `/approve` на черновик).

## Company Page
Рекомендуется страница компании **Sitrifor** + персональный профиль Founder. Ссылки: сайт + App Store 634.
