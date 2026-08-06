# UI Capability Stack

Этот документ фиксирует, чем агент может реально помогать проекту Sitrifor в задачах UX/UI, visual design, motion и production delivery.

## 1. Product / UX

Агент может собирать и структурировать:
- CJM, JTBD, user flows, IA, screen maps;
- UX-аудиты текущих страниц и сценариев;
- content hierarchy, CTA hierarchy, edge cases, empty/loading/error states;
- screen-by-screen разбор по коду, скриншотам и требованиям.

На практике это нужно, чтобы не переходить сразу к верстке, пока не зафиксированы пользователь, сценарий и primary action.

## 2. Visual / interface design

Агент может:
- разбирать визуальные паттерны по скриншотам приложения;
- переносить mobile UI паттерны в web-представление;
- собирать landing sections, promo blocks, dashboards, settings-like layouts;
- проектировать структуру экранов до реализации в коде.

Агент умеет строить сильнее всего не "абстрактно красивый" экран, а экран с понятной иерархией, контролем плотности, доминантой CTA и clean section rhythm.

## 3. Assets and imagery

Агент может:
- генерировать hero-art, иллюстрации, mockups, promo-изображения, icons;
- использовать пользовательские изображения как референсы;
- подбирать, где нужен реальный screenshot, а где достаточно generated visual.

Лучший результат получается, когда generated asset не заменяет продукт, а усиливает конкретную секцию: hero, feature showcase, onboarding, app promo, store preview.

## 4. Motion / cinematic UI

Агент может:
- проектировать motion как часть UX, а не как декоративный шум;
- собирать micro-interactions, hover/focus/expand states, stagger, reveal, depth cues;
- реализовывать web-motion через CSS transitions, keyframes и точечный JS;
- переводить motion из Figma в production-ready code, если motion source задан в дизайне.

Поддерживаемые классы motion:
- entrance / reveal / stagger;
- card hover, tap feedback, panel transitions;
- hero drift, ambient motion, feature spotlight;
- scroll-linked акценты и guided reveal;
- promo / cinematic landing patterns с умеренной глубиной.

## 5. Figma / design system

Если в сессии доступны соответствующие инструменты, агент может работать по Figma-oriented workflow:
- screen-building;
- component library / token setup;
- diagram generation;
- выстраивание design-system-first процесса вместо one-off верстки;
- motion-aware workflow при наличии motion context в Figma.

См. также:
- `docs/Дизайн_система_6_34.md`
- `.cursor/rules/ui-ux-web.mdc`

## 6. Code implementation

Агент может:
- собирать интерфейсы в HTML/CSS/JS;
- делать responsive cleanup и interaction polish;
- править hierarchy, spacing, layout, readability, affordance;
- собирать micro-interactions, form states и promo flows.

Для текущего Sitrifor это особенно важно, потому что web-часть работает как статическая фронтенд-поверхность в `public` без выделенного frontend build pipeline.

## 7. Validation

После реализации агент может:
- проверять responsive behavior;
- делать browser smoke-test;
- искать dead ends, лишние состояния, слабую иерархию, перегрузку и сломанные CTA;
- проверять reduced-motion fallback, если добавляется заметная анимация;
- делать второй UX pass уже после первой сборки.

## 8. Toolchain readiness for this project

По текущему состоянию проекта:
- web-часть Sitrifor живет в `public` как HTML/CSS/JS without frontend bundler;
- backend имеет `node` и `npm`, но не задает motion stack для frontend;
- на машине доступны `node`, `npm`, `python3`;
- `ffmpeg` сейчас не установлен, значит видео-экспорт и frame-by-frame motion inspection ограничены;
- явных frontend motion libraries в проекте сейчас не обнаружено.

Практический вывод:
- по умолчанию для Sitrifor стоит использовать lightweight motion через CSS и точечный JS;
- library-based motion подключать только под конкретный эффект-класс и реальную задачу;
- для сложной motion-verification заранее учитывать, что `ffmpeg` и аналогичные внешние утилиты могут потребоваться отдельно.

## Ограничения

Для сильного результата агенту нужна хотя бы одна визуальная опора:
- скриншоты продукта;
- Figma / UI-kit / design system;
- референсы;
- существующий код;
- четкий сценарий и критерий качества.

Без визуальной правды агент может собрать рабочий интерфейс, но не гарантирует высокий визуальный уровень.

Для motion-heavy или cinematic UI дополнительно нужны:
- список состояний;
- длительности и характер переходов;
- целевая surface area: hero, section, card, full-page flow;
- ограничение по интенсивности motion и fallback для `prefers-reduced-motion`.
