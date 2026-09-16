## 2026-08-06 11:33 UTC

### Роль `product` - нужен Cursor / сильный агент / человек

Оркестратор **не** гоняет эту роль на Ollama. Откройте Issue в Cursor (cloud или local), выполните роль по брифу ниже, приложите артефакты в `docs/tasks/ISSUE-1/`, затем в комментарии Issue напишите:

- `/done` - этап выполнен, можно дальше
- `/skip` - этап не нужен (с обоснованием в том же комментарии)

#### Issue
**#1**: [web] Smoke: доска и пайплайн агентов
Labels: product:web, type:feature
URL: https://github.com/Sitrifor/sitrifor-web/issues/1

#### Brief
## Brief
Проверочная задача после настройки GitHub: убедиться, что Issue + labels + Project работают.

## Acceptance (черновик)
- [ ] Issue видна на доске Sitrifor Delivery
- [ ] Labels `product:web` + `type:feature` на месте
- [ ] Колонки пайплайна настроены (Inbox → Ready for You)

## Notes
Создано агентом с сервера. Можно закрыть после проверки колонок.


#### ROLE.md
# Product Manager

## Миссия
Проблема пользователя, scope, acceptance product-level, метрики успеха

## Входы
- Issue + labels (`product:web|634`, `type:*`)
- `docs/kb/*`
- `docs/tasks/<id>/` (накопленные артефакты)
- Свод правил: [RULES.md](RULES.md)

## Выходы
- Комментарий в Issue с результатом этапа
- Обновление `docs/tasks/<id>/` (минимум дописать блок в `acceptance.md`)
- При skip: строка в `pipeline.md`

## Доступы
См. [TOOLS.md](TOOLS.md). Секреты не читать в чат и не коммитить.


#### RULES.md
# Rules: Product Manager

Append-only: при багах и косяках добавляйте пункт с датой.

## Общие
- Читать KB перед работой.
- Не коммитить секреты.
- Продуктовый RU-текст: только короткий дефис `-`.
- `/masters`: не обрезать HTML; после правок - `npm run copy:qa`.

## Журнал
- 2026-08-06: стартовый шаблон роли.


#### KB
- `docs/kb/sitrifor-web.md`
- `docs/kb/app-634.md`
- `docs/kb/metrics.md`
- `docs/kb/pipeline.md`

<!-- orch:dispatched:product -->
<!-- orch:awaiting-done:product -->

