# Sitrifor UI Audit

Жесткий аудит текущих страниц Sitrifor по новому production standard.

## Executive summary

Сейчас сайт не выглядит как цельный продукт. Основная проблема не в "красоте" как таковой, а в том, что интерфейс одновременно:
- показывает живые продуктовые куски;
- содержит публичные заглушки;
- держится на разрозненных visual patterns;
- не имеет одной ясной product hierarchy.

Из-за этого UI читается как смесь:
- лендинга;
- sandbox-страниц;
- внутренних utility tools;
- незавершенных product направлений.

## Severity 1

### 1. Product surface смешана с заглушками

Критическая проблема:
- `masters.html` совмещает полноценный app landing с публичными tab-панелями, где часть разделов все еще "В процессе реализации";
- `partners.html` почти полностью состоит из coming-soon блоков.

Следствие:
- пользователь получает ощущение недостроенного продукта;
- tabs визуально обещают полноценные направления, но фактически ведут в пустоту;
- доверие к app и platform value падает.

### 2. Нет единственной product truth на главной

На `index.html` в hero конкурируют:
- carousel с общими слоганами;
- promo card приложения;
- promo card обучения.

Следствие:
- первый экран не отвечает быстро, что именно такое Sitrifor;
- нет одного dominant CTA;
- hero работает как набор отдельных плиток, а не как product statement.

### 3. Публичные dead CTA и placeholder actions

Прямые проблемы:
- в `index.html` кнопки `App Store` и `Google Play` ведут на `#`;
- в footer используется демонстрационный телефон `+7 (800) 123-45-67`;
- страницы публично рекламируют разделы, которые еще не готовы.

Это нельзя оставлять в публичной поверхности.

## Severity 2

### 4. Смешение разных jobs-to-be-done в `masters.html`

В одной tab shell собраны:
- приложение 6:34;
- обучение;
- создание сайта;
- уход;
- калькулятор;
- юридическая помощь.

Это слишком разные сценарии:
- product promo;
- education;
- utility care guidance;
- pricing tool;
- service upsell.

В результате страница не является ни сильным app landing, ни service hub, ни knowledge center.

### 5. Визуальная эклектика между light shell и dark app blocks

Сайт в целом живет в light theme, но `app-634` секции используют dark gradients, floating chips, pseudo-glass cards и отдельный stylistic sub-language.

Проблема не в самом dark block, а в отсутствии общего transition system:
- header, nav и page shell ощущаются одним продуктом;
- app hero ощущается другим;
- placeholder cards — третьим.

### 6. Слишком много UI на основе декоративных эмодзи

Эмодзи используются как иконки в:
- home promo;
- masters tabs content;
- care flow;
- partnership / legal / website placeholders;
- form inputs.

Это удешевляет интерфейс и делает его inconsistent с попыткой показать premium product.

## Severity 3

### 7. About page выглядит как placeholder corporate page

`about.html` содержит generic team cards с инициалами и краткими ролями без product proof, истории, кейсов или trust anchors.

Страница не усиливает бренд и выглядит как временный шаблон.

### 8. FAQ полезен, но слишком плоский

`faq.html` функционален, однако:
- не сегментирован по аудиториям;
- не подталкивает к следующему действию;
- не решает navigation problem.

Он скорее справка, чем часть продуманного product flow.

### 9. Motion есть, но он не работает как UX-инструмент

Сейчас motion mostly decorative:
- autoplay carousel;
- pulse/dots у coming-soon;
- hover lifts;
- animated logo tracks in legacy styles.

Нет motion system с intent:
- attention guidance;
- onboarding emphasis;
- trust-building product reveal;
- hierarchy support.

## Page-by-page findings

## Home

Проблемы:
- hero не позиционирует продукт в одном предложении;
- carousel делает first screen более шумным, а не более ясным;
- education promo спорит с app promo;
- CTA hierarchy размыта;
- modal stores с `#` links подрывают доверие.

Переделать:
- заменить carousel на один сильный product hero;
- оставить один primary narrative;
- вывести app как главный продукт или четко обозначить экосистему через one message;
- убрать dead store links до реальной доступности.

## Masters

Проблемы:
- tab architecture скрывает ключевой app section внутри service shell;
- живая секция "Приложение" соседствует с пустыми публичными направлениями;
- care и calculator выглядят как utility appendices, а не как часть осознанной IA;
- forms и modals scattered across the page without one conversion path.

Переделать:
- разорвать страницу на отдельные продуктовые блоки или отдельные лендинги;
- app section сделать standalone landing;
- utility tools вынести в отдельный knowledge/tools block;
- убрать из публичной навигации все неподготовленные tabs.

## Partners

Проблемы:
- страница почти не содержит реального партнерского предложения;
- три tabs не добавляют ценности, потому что каждая панель пустая;
- page exists without B2B trust material.

Переделать:
- либо закрыть страницу до readiness;
- либо сделать один честный B2B landing с оффером, формой, форматами интеграции и примерами партнерств.

## About

Проблемы:
- generic composition;
- weak trust surface;
- privacy section встроена утилитарно и не помогает бренду.

Переделать:
- сократить pseudo-corporate filler;
- добавить why/for whom/value/trust structure;
- privacy вынести или оформить как separate legal block.

## FAQ

Проблемы:
- нет аудиторной группировки;
- нет CTA после ответов;
- слабая связь с ключевыми сценариями сайта.

Переделать:
- разделить FAQ на "Для мастеров", "Для партнеров", "О приложении";
- добавить next-step CTA после основных ответов.

## Technical design debt

- слишком много разрозненных CSS layers: `landing.css`, `sections.css`, `app-634.css`, `coming-soon.css`, `masters-tools.css`, `pages.css`;
- присутствуют отдельные micro-patterns без общего visual contract;
- placeholder animations занимают публичное пространство, хотя не несут product value;
- modal and tab behavior решают локальные задачи, но не создают coherent UX system.

## Concrete remediation backlog

### P0

- Убрать из публичной поверхности все "В процессе реализации" sections.
- Убрать `href=\"#\"` store links и демонстрационные контакты.
- Пересобрать `index.html` вокруг одного dominant product message and CTA.
- Разделить `masters.html` по сценариям, не держать app landing внутри noisy tab shell.
- Определить, остается ли `partners.html` публичной страницей или уходит во временный redirect/stub.

### P1

- Заменить emoji-first iconography на единый icon language.
- Снизить визуальную эклектику между light shell и dark app content.
- Пересобрать About как trust page, а не как placeholder team list.
- Перестроить FAQ по аудиториям и сценариям.

### P2

- Собрать реальный motion system: reveal, hover, CTA emphasis, reduced-motion strategy.
- Сократить количество ad-hoc visual patterns и свести их к нескольким reusable section archetypes.
- Подготовить отдельный app media kit: screenshots, store states, promo visuals.

## Recommended next implementation order

1. `index.html`
2. `masters.html`
3. decision on `partners.html`
4. `about.html`
5. `faq.html`
6. motion polish only after IA and content cleanup
