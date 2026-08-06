# UI Inputs And Artifacts

Этот документ фиксирует, какие входы нужно давать агенту, чтобы получать сильный визуальный результат.

## Лучшие входы

### 1. Visual inputs
- скриншоты приложения;
- Figma link / file;
- UI-kit или design system;
- 2-5 референсов по стилю.

### 2. Product inputs
- кто пользователь;
- что он должен сделать;
- какой экран или раздел нужен;
- где primary CTA;
- что должно быть видно на первом экране.

### 3. Quality inputs
- desired style: premium, mobile-first, editorial, dashboard, marketplace, minimal;
- допустимый уровень анимации;
- какие экраны должны выглядеть "дорого" и какие должны быть просто utility-first.

### 4. Motion inputs
- какие зоны можно анимировать;
- какая интенсивность допустима;
- нужен ли cinematic feel или только subtle polish;
- есть ли запрет на autoplay / parallax / floating effects;
- требуется ли reduced-motion fallback.

## Что особенно важно для Sitrifor

Для этого проекта вход желательно формулировать не абстрактно как "сделай красиво", а в формате:
- какая страница или секция меняется;
- кто ее пользователь: мастер, партнер, посетитель;
- какое действие должно доминировать;
- что является визуальной правдой: app screens, референс, текущая секция, Figma;
- нужен ли motion и какой именно: subtle, premium, promo, cinematic.

## Что агент должен вернуть

В зависимости от задачи:
- CJM / flow / IA;
- wireframe-level structure;
- UI concept по screen sections;
- готовую HTML/CSS/JS реализацию;
- generated assets;
- UX pass после первой сборки;
- motion recommendation или motion map, если это часть задачи.

## Когда использовать что

### Код
Когда нужен реальный интерфейс на сайте.

### Figma workflow
Когда нужен screen design, systematization или component library.

### Canvas
Когда deliverable сам по себе аналитический: audit, map, matrix, breakdown.

### Image generation
Когда не хватает hero visual, illustration, promo art, preview asset.

### Motion workflow
Когда важны кинематографичность, reveal, polish, storytelling или app showcase.

## Expected artifacts by stage

### Discovery
- brief;
- сценарий;
- user/job definition.

### UX
- CJM или flow;
- IA или structure note.

### Visual
- reference set;
- section concept;
- hierarchy decisions.

### Asset layer
- список нужных изображений;
- указание, где нужны реальные screenshots, а где допустим generated art.

### Motion layer
- motion map;
- intensity notes;
- fallback notes.

### Delivery
- production-ready code;
- UX/UI validation notes.

## Minimum brief template

Перед стартом новой UI задачи желательно давать:
- цель экрана;
- целевое действие;
- 1-3 скриншота или референса;
- где экран живет в продукте;
- что важно сохранить из текущего интерфейса;
- что точно нельзя делать;
- нужен ли motion и насколько он должен быть заметным.
