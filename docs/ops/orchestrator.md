# Orchestrator

## Принцип
Оркестратор = **диспетчер колонок**, не «мозг» критичных ролей.

| Роли | Кто исполняет |
|------|----------------|
| Architect, Design, DevOps, QA, Dev, SysAnalyst, Product, IB/Legal, … | **Cursor** (cloud/local) или человек |
| Ollama `qwen2.5:1.5b` | **выключен** по умолчанию (только опциональный allowlist в config) |

Маленькая локальная модель не проектирует архитектуру, не делает DevOps и не закрывает QA.

## Цикл
1. Issue с `product:web` / `product:634` → доска → **0 Inbox**
2. Inbox → следующая роль
3. В Issue появляется бриф роли (ROLE.md + KB) для Cursor
4. Вы (или Cursor-агент) делаете работу → комментарий **`/done`** (или **`/skip`**)
5. На гейтах Product / Design / Architect / Dev / DevOps / IB / QA / Scrum - ещё **`/approve`**
6. Карточка едет дальше

## Команды в Issue
- `/done` - роль завершила этап
- `/skip` - этап не нужен
- `/approve` - апрув заказчика на гейте

## Запуск
```bash
python3 /var/www/sitrifor/ops/orchestrator/run.py
# timer: sitrifor-orchestrator.timer (каждые 3 мин)
```

## Cursor API (следующий шаг)
Когда будет `CURSOR_API_KEY`, можно подключить автозапуск Cursor Agent на `runner: cursor` вместо ручного `/done`. До ключа - бриф в Issue + ручной/чат Cursor.
