# UI Production Playbook

Главный входной документ для UX/UI production workflow в Sitrifor.

## Purpose

Этот playbook нужен, чтобы все новые интерфейсные задачи проходили по одному контуру:

`brief -> UX framing -> visual truth -> structure -> assets -> motion -> build -> UX pass -> validation`

## What to use

### Capability baseline
- `docs/ui-capability-stack.md`

### Process
- `docs/ui-delivery-workflow.md`

### Inputs and expected artifacts
- `docs/ui-inputs-and-artifacts.md`

### Motion and validation
- `docs/ui-motion-and-validation-checklist.md`

### Existing visual foundation
- `docs/Дизайн_система_6_34.md`

### Persistent agent behavior
- `.cursor/rules/ui-ux-web.mdc`

## Project defaults for Sitrifor

- Frontend surface: `public`
- Delivery mode: static HTML/CSS/JS
- Default visual strategy: clean hierarchy first, polish second
- Default motion strategy: CSS-first, lightweight, intentional
- Escalation to extra tooling: only for a clearly justified effect class

## Definition of a strong result

Сильный интерфейс для Sitrifor:
- сразу показывает, для кого экран;
- имеет один доминирующий сценарий в каждом viewport block;
- использует реальные product cues, а не декоративный шум;
- выглядит убедительно и в статике, и с motion;
- не ломается по responsive и не создает UX dead ends.

## Working rule

Если задача сформулирована как "сделай красиво", агент сначала должен превратить ее в:
- user scenario;
- section goal;
- visual source of truth;
- CTA hierarchy;
- motion scope.

Только после этого начинается реальная реализация.
