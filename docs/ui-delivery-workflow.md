# UI Delivery Workflow

Базовый production workflow для UX/UI задач в Sitrifor.

## Stage 1. Product framing

Перед любым дизайном или версткой нужно зафиксировать:
- кто пользователь;
- какой у него сценарий;
- какое действие является целевым;
- что сейчас мешает или замедляет путь.

Артефакты этого этапа:
- CJM;
- user flow;
- IA / screen map;
- список ключевых и вторичных CTA.

Гейт перехода дальше: нельзя двигаться в visual layer, пока не определены user job, screen goal и primary CTA.

## Stage 2. Visual truth

Выбирается основной source of truth:
- скриншоты приложения;
- Figma / design system;
- существующий интерфейс в коде;
- согласованный референс.

Правило: если visual truth нет, сначала собирается lightweight concept, а не финальная визуальная система.

Гейт перехода дальше: нельзя принимать сильные visual decisions вслепую, если нет ни одного референса, скриншота или дизайн-опоры.

## Stage 3. Wire and structure

Собирается screen structure:
- hero / header / nav / content bands;
- cards / panels / lists / forms;
- empty / loading / success / error states;
- mobile-first порядок блоков.

На этом шаге агент должен проверить:
- не смешаны ли разные jobs-to-be-done в одном экране;
- видна ли главная CTA;
- есть ли приоритет у контента above the fold;
- не перегружен ли экран конкурирующими элементами.

Выход этапа:
- section map;
- state map;
- CTA hierarchy;
- rough content priority.

## Stage 4. Asset strategy

До реализации нужно решить, какие визуальные материалы нужны экрану:
- реальные screenshots;
- generated hero-art;
- product mockups;
- icons / badges;
- background visuals;
- promo imagery.

Правило:
- если контент сам по себе является доказательством продукта, приоритет у реальных screen visuals;
- generated assets используются как усиление, а не как замена продуктовой правды.

## Stage 5. Motion concept

Если интерфейс должен быть живым, motion проектируется отдельным слоем:
- какие элементы двигаются;
- что является trigger;
- какой характер motion: quiet, premium, promo, cinematic;
- где нужен stagger, где hover, где scroll reveal, а где motion не нужен.

Минимальные выходы:
- список анимируемых зон;
- durations / easing class / intensity;
- reduced-motion fallback;
- запрет на decorative overload.

Гейт перехода дальше: нельзя добавлять motion "по вкусу" после верстки без заранее определенных зон, цели и интенсивности.

## Stage 6. Build

Выбор поверхности:
- код (`HTML/CSS/JS`) — для реальной страницы;
- Figma workflow — для экранов и design system;
- Canvas — для самостоятельных аналитических UX deliverables.

Для текущего Sitrifor стандартный путь такой:
- first choice: статический frontend в `public`;
- motion default: CSS transitions / keyframes;
- точечный JS — только если без него нельзя выразить нужный interaction pattern.

## Stage 7. UX pass after build

После первой реализации агент проводит второй проход:
- hierarchy;
- spacing;
- readability;
- touch targets;
- scroll behavior;
- dead CTA;
- broken states;
- consistency across pages.

Отдельно для motion:
- не мешает ли анимация чтению;
- не ломает ли perceived performance;
- нет ли конкурирующих движений в одном viewport.

## Stage 8. Validation

Минимум:
- browser smoke-test;
- responsive spot-check;
- grep по legacy / orphan references;
- проверка copy на misleading wording;
- reduced-motion sanity check для заметных анимаций.

## Stage outputs summary

`brief -> CJM/flow -> structure -> asset plan -> motion plan -> build -> UX pass -> validation`

Это и есть production loop, который дальше должен повторяться для новых UI задач в Sitrifor.

## Applied rule

Для новых UI задач агент не должен переходить сразу к верстке, пока не определены:
1. сценарий;
2. source of truth;
3. главный CTA;
4. набор состояний;
5. стратегия ассетов;
6. motion scope, если экран должен быть "живым".
