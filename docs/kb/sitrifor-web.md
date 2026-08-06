# Sitrifor Web (sitrifor.ru)

## Продукт
Экосистема для тату-мастеров: сайт, гайды, каталог, инструменты (уход, калькулятор), лендинг приложения 634.

## Стек
- Статика: `public/` (HTML/CSS/JS), раздача с VPS
- SEO toolkit: `seo/` (hubs build, IndexNow, copy QA)
- Backend helpers: `backend/` (polish, news tooling)
- Правила агентов: `.cursor/rules/`

## Важные URL
- `/` главная
- `/masters` - 634 + уход + калькулятор (три вкладки: `#app` `#care` `#calculator`)
- `/guides/*`, `/634/`, `/marketplace`, `/about`, `/partners`

## Инварианты (не ломать)
- `public/masters.html` - полный документ: 3 панели + скрипты + `</html>`
- Gate: `cd seo && npm run copy:qa` (в т.ч. `masters:struct_*`)
- В продуктовом тексте только короткий дефис `-` (не длинное тире)

## Деплой
Код на сервере `/var/www/sitrifor`. Релиз на прод - только после явного «релизим?» от заказчика. Секреты в `seo/.env` и `seo/credentials/` - не в git.

## Репозиторий
Private: `github.com/Sitrifor/sitrifor-web`
