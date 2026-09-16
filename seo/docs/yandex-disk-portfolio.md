# Яндекс.Диск: портфолио тату-проектов

Пайплайн сортирует dump эскизов / фото / видео в проекты и пишет промо для соцсетей под **634** и **sitrifor.ru**.

## Что получится на Диске

```
disk:/Sitrifor-Portfolio/
  Входящие/               ← сюда скидываете всё подряд
  На-проверку/            ← не смэтчилось автоматически
  Тату-проекты/
    Цветные/
      Рука/
        <проект>/
          ...исходники...
          promo.md
          meta.json
      Нога/
      ...
    Черно-белые/
      ...
  Ирина/                  ← фотосеты, съёмки мастера
  Арт/                    ← картины, арты
  Архив/                  ← сырой хвост
  README.md
```

Оси сортировки:
- **Цвет:** Цветные / Черно-белые
- **Часть тела:** Рука, Кисть, Нога, Стопа, Спина, Грудь, Шея, Рёбра, Голова, Другое

## 1. Доступ к API Диска

Текущий токен Вебмастера **не** подходит (нет прав `cloud_api:disk.*`).

1. Откройте приложение: https://oauth.yandex.ru/  
2. В доступах добавьте:
   - `cloud_api:disk.info`
   - `cloud_api:disk.read`
   - `cloud_api:disk.write`
3. Выдайте токен:

```bash
cd /var/www/sitrifor
node seo/scripts/yandex-disk/auth.mjs
```

Проверка:

```bash
node seo/scripts/yandex-disk/auth.mjs --check
```

Токен сохранится **только** в encrypted store `/root/.config/sitrifor/secrets/` (не в `seo/.env` и не в `/var/www`).

Безопасность: [`yandex-disk-security.md`](./yandex-disk-security.md).

## 2. Инициализация папок

```bash
npm run yandex:disk:init --prefix seo
# или: node seo/scripts/yandex-disk/organize.mjs --init
```

## 3. Как складывать материалы

Залейте всё в `Sitrifor-Portfolio/_inbox`.

### Вариант A - имена файлов

Общий префикс проекта + роль + желательно цвет/часть тела:

- `dragon_arm_color_sketch.jpg`
- `dragon_arm_color_photo.jpg`
- `dragon_arm_color_video.mp4`

Роли в имени: `sketch` / `эскиз`, `photo` / `фото`, `video` / `видео`.

### Вариант B - pairs.json в inbox

```json
[
  {
    "title": "Дракон на предплечье",
    "color": "color",
    "body": "arm",
    "style": "neo-trad",
    "notes": "Эскиз собран в 634, на сеансе сверили пигменты.",
    "files": ["IMG_101.jpg", "IMG_102.jpg", "clip.mp4"],
    "roles": {
      "IMG_101.jpg": "sketch",
      "IMG_102.jpg": "photo",
      "clip.mp4": "video"
    }
  }
]
```

`color`: `color` | `bw`  
`body`: `arm` | `hand` | `leg` | `foot` | `back` | `chest` | `neck` | `rib` | `head` | `other`

### Локальный dump без загрузки в inbox

```bash
node seo/scripts/yandex-disk/organize.mjs --plan --local-inbox /path/to/dump
node seo/scripts/yandex-disk/organize.mjs --apply
```

## 4. План и применение

```bash
npm run yandex:disk:plan --prefix seo
# смотрите seo/data/yandex-disk-portfolio/plan.json

npm run yandex:disk:apply --prefix seo
```

- Проекты с низкой уверенностью по умолчанию **не** переносятся (остаются для ручной правки плана / `pairs.json`).
- Принудительно всё: `--force-all`
- Пробный прогон: `--dry`

Пример промо без Диска:

```bash
node seo/scripts/yandex-disk/organize.mjs --promo-sample
```

## 5. Содержимое promo.md

В каждом проекте:
- тексты для **TikTok / Instagram / VK / LinkedIn**
- теги (`#634app`, `#sitrifor`, …)
- ссылки на sitrifor.ru, `/634/`, App Store

Акцент копирайта: приложение для тату-мастера **634** (проекты, пигменты, склад краски) + сайт **Sitrifor.ru**. Без позиционирования как CRM записи.

## Скрипты

| Команда | Действие |
|---------|----------|
| `npm run yandex:disk:auth --prefix seo` | OAuth токен Диска |
| `npm run yandex:disk:check --prefix seo` | Проверка доступа |
| `npm run yandex:disk:init --prefix seo` | Создать дерево папок |
| `npm run yandex:disk:plan --prefix seo` | Построить plan.json |
| `npm run yandex:disk:apply --prefix seo` | Разложить по проектам |

## Ограничения v1

- Матчинг в основном по именам и `pairs.json`, не по нейросети.
- Если эскиз и фото названы случайно (`DSC_001` / `IMG_999`) - положите `pairs.json` или поправьте `plan.json` перед `--apply`.
- Визуальный матчинг (превью Диска + vision) можно добавить следующим шагом после появления стабильного доступа к API.
