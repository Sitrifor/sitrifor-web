# Visual Motion Toolchain Install Plan

Этот документ фиксирует отдельный план установки и подключения visual/motion toolchain для Sitrifor.

## Current baseline

Сейчас в проекте уже есть:
- `node`
- `npm`
- `python3`

Сейчас отсутствует или не подтверждено:
- `ffmpeg`
- frontend motion library
- browser-driven visual capture toolchain
- image/vector export utilities

Текущий frontend stack Sitrifor:
- статические страницы в `public`
- HTML/CSS/JS без frontend bundler
- no dedicated motion pipeline

Вывод: сначала нужен базовый toolchain для capture/verification, а не массовая установка тяжелых библиотек "на всякий случай".

## Installation policy

Инструменты ставятся по слоям:
1. baseline verification tools;
2. asset and video tooling;
3. optional motion libraries by effect class;
4. escalation stack for cinematic demos.

Правило: library или utility устанавливается только если она закрывает конкретный production gap.

## Phase 1. Baseline verification

### Required

#### `ffmpeg`
Зачем:
- video export review;
- frame extraction;
- motion timing inspection;
- cinematic demo assembly.

Install:

```bash
sudo apt update
sudo apt install -y ffmpeg
```

Verify:

```bash
ffmpeg -version
```

### Recommended

#### Playwright or equivalent browser automation
Зачем:
- smoke-test pages;
- scripted screenshot capture;
- viewport regression checks.

Примечание:
- если появится выделенный frontend workspace с `package.json`, ставить в него;
- для текущего static stack сначала достаточно определить, где будет жить automation layer.

## Phase 2. Asset and export tooling

### Recommended

#### ImageMagick
Зачем:
- batch image resize;
- crops and format conversion;
- quick asset cleanup.

Install:

```bash
sudo apt install -y imagemagick
```

Verify:

```bash
magick -version
```

#### Inkscape
Зачем:
- SVG inspection;
- vector cleanup;
- export PNG from SVG-based promo assets.

Install:

```bash
sudo apt install -y inkscape
```

Verify:

```bash
inkscape --version
```

## Phase 3. Frontend motion stack

Для текущего Sitrifor по умолчанию не нужно сразу ставить тяжелую motion stack.

### Default approach

Использовать:
- CSS transitions;
- CSS keyframes;
- focused vanilla JS for state and sequencing.

Это покрывает:
- hover polish;
- reveal;
- stagger;
- ambient section motion;
- small promo interactions.

### When to add a library

#### `motion`
Когда:
- React-based UI surface;
- richer sequencing;
- shared variants;
- stateful component animation.

Install:

```bash
npm install motion
```

Не рекомендовано ставить заранее в текущую static front surface без отдельного frontend runtime.

#### `gsap`
Когда:
- scroll scenes;
- timeline-heavy promo sections;
- layered hero choreography;
- cinematic landing behavior.

Install:

```bash
npm install gsap
```

Использовать только под конкретный effect class, а не как дефолт.

#### `lottie-web`
Когда:
- готовые motion assets from design;
- exported animation handoff;
- lightweight illustration playback.

Install:

```bash
npm install lottie-web
```

## Phase 4. Cinematic escalation stack

Подключать только если нужен реально насыщенный promo/demo layer.

Возможные дополнения:
- `lenis` для controlled smooth scroll;
- `gsap` + `ScrollTrigger` для scroll narratives;
- `three` только если задача реально 3D and spatial, что для текущего Sitrifor пока избыточно.

## Recommended order for Sitrifor

1. Установить `ffmpeg`
2. Установить `imagemagick`
3. Установить `inkscape`
4. Определить browser capture/testing layer
5. Не ставить frontend motion library, пока не выбрана конкретная cinematic задача
6. При появлении promo-heavy или React-heavy surface выбрать между `motion` и `gsap`

## Do not install by default

Не нужно заранее тянуть:
- `three`
- particle engines
- confetti libraries
- full scroll frameworks
- heavy visual packages без конкретного user story

Это увеличивает сложность, но не делает UI автоматически лучше.

## Decision matrix

- Нужен subtle polish на статических страницах -> CSS
- Нужен stateful component motion -> `motion`
- Нужен timeline / scroll choreography -> `gsap`
- Нужен animation asset playback -> `lottie-web`
- Нужен export / frame review -> `ffmpeg`
- Нужен vector/image cleanup -> `inkscape` + `imagemagick`
