# UI Motion And Validation Checklist

Этот checklist нужен для красивых, сочных и motion-aware интерфейсов в Sitrifor.

## 1. Перед реализацией

- Зафиксирован user scenario и главный CTA.
- Есть visual source of truth: screenshots, reference, current code or Figma.
- Понятно, зачем нужен motion: polish, guidance, emphasis, storytelling.
- Определено, где motion запрещен, чтобы не перегружать экран.

## 2. Motion design decisions

- Определен intensity level: `none`, `subtle`, `premium`, `promo`, `cinematic`.
- Определены конкретные motion zones: hero, cards, CTA, onboarding, feature reveals.
- Выбраны classes of motion: hover, reveal, stagger, ambient drift, panel transition.
- Проверено, что на одном viewport нет нескольких конкурирующих анимационных фокусов.

## 3. Реализация для текущего Sitrifor stack

Текущий frontend stack проекта:
- статические страницы в `public`;
- HTML/CSS/JS без frontend bundler;
- без обнаруженного dedicated motion library;
- `ffmpeg` не установлен, значит видео-ориентированная motion verification ограничена.

Практические правила:
- использовать CSS transitions по умолчанию;
- использовать CSS keyframes для repeatable reveal/ambient effects;
- добавлять JS только там, где нужны stateful interactions, sequencing или viewport triggers;
- подключать внешнюю motion library только под конкретный эффект-класс, а не "на всякий случай".

## 4. Visual quality checks

- Есть clear primary focus в первом экране.
- CTA не спорит с второстепенными элементами.
- Текст читается без борьбы с фоном и motion.
- Decorative layers не душат продуктовую информацию.
- Секция остается сильной и в статике, даже если motion отключить.

## 5. UX quality checks

- Screen не смешивает несколько jobs-to-be-done.
- Empty, loading, success и error states учтены, если сценарий этого требует.
- Mobile order выглядит естественно.
- Tap targets и interaction affordance достаточно ясные.

## 6. Motion quality checks

- Анимация помогает навигации взгляда, а не отвлекает.
- Длительность не делает интерфейс медленным.
- Нет motion spam: слишком много объектов движется одновременно.
- Нет постоянного "парения" всего подряд ради декоративности.
- Для заметного motion предусмотрен `prefers-reduced-motion` fallback.

## 7. Final validation

- Проверен responsive behavior.
- Проверен scroll behavior.
- Проверены dead CTA и orphan references после изменений.
- Проверена copy density: текст не перегружает section.
- Проведен второй UX pass уже после сборки.

## 8. When to escalate tooling

Нужен отдельный внешний toolchain или library evaluation, если задача требует:
- frame-by-frame motion review;
- сложных timeline animations;
- parallax/scroll scenes на нескольких слоях;
- particle / confetti / physics-like effects;
- video export, sequence rendering или cinematic demo capture.

В таких случаях сначала фиксируется effect class, а уже потом выбирается инструмент.
