# Orchestrator (минимальный)

## Что делает
Каждые ~3 минуты (`sitrifor-orchestrator.timer`):

1. Находит open Issues с label `product:web` или `product:634`
2. Добавляет их на доску [Sitrifor Delivery](https://github.com/users/Sitrifor/projects/1) в **0 Inbox** (если ещё нет)
3. Inbox → **1 BizDev** → запускает агента роли через **локальный Ollama** (`qwen2.5:1.5b`)
4. Пишет комментарий в Issue + файлы в `docs/tasks/ISSUE-N/`
5. Двигает Status дальше по пайплайну

## Апрув человеком
После этапов **Product**, **Architect**, **Scrum gate** оркестратор ждёт комментарий в Issue:

```text
/approve
```

Без этого карточка не едет дальше. **Dev** - только план (код пишет Cursor/человек).

## Запуск вручную
```bash
python3 /var/www/sitrifor/ops/orchestrator/run.py
```

## Требования
- Classic PAT в `/root/.config/sitrifor/github.token` (`repo` + `project`)
- Ollama на `127.0.0.1:11434`

## Важно
Это **не** Cursor Cloud Agent. Анализ ролей делает локальная маленькая модель. Для кода на этапе Dev работайте в Cursor по плану из комментария.
