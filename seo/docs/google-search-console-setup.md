# Google Search Console для sitrifor.ru

Пошаговая настройка владельцем (аккаунт Google). После верификации можно подключить service account для API-скриптов.

## 1. Создать ресурс

1. Откройте [Google Search Console](https://search.google.com/search-console).
2. Нажмите **Добавить ресурс**.
3. Выберите тип (рекомендуем оба, если есть доступ к DNS):

| Тип | Значение | Плюс |
|-----|----------|------|
| **Домен** (предпочтительно) | `sitrifor.ru` | Все протоколы и поддомены, верификация только DNS |
| **Префикс URL** | `https://sitrifor.ru/` | Быстрее через HTML-тег / файл; только HTTPS этого хоста |

Для автоматизации в репо: `GSC_SITE_URL=sc-domain:sitrifor.ru` (Domain). Для префикса URL: `https://sitrifor.ru/`.

Playbook кабинета после верификации: `seo/docs/gsc-cabinet-playbook.md`.

## 2. Подтвердить права

### Вариант A - DNS (для Domain или Prefикс)

В панели DNS Beget добавьте TXT-запись, которую покажет Google, например:

```text
Имя/хост: @   (или sitrifor.ru)
Тип: TXT
Значение: google-site-verification=XXXXXXXX
```

Подождите 5-30 минут (иногда до суток), в GSC нажмите **Проверить**.

Уже есть TXT `yandex-verification:...` - **не удаляйте**, добавьте вторую TXT рядом.

### Вариант B - HTML-тег (только Prefикс URL)

1. В GSC скопируйте код вида:
   `content="XXXXXXXX"`
2. Пришлите токен агенту или положите в `seo/.env`:

```env
GOOGLE_SITE_VERIFICATION=XXXXXXXX
```

3. Агент вставит meta на главную (и хабы при необходимости).
4. В GSC - **Проверить**.

### Вариант C - HTML-файл

Скачайте `googleXXXXXXXX.html` из GSC → положите в `public/` → задеплойте → **Проверить**.

## 3. Отправить sitemap

После успешной верификации:

1. GSC → ресурс → **Индексирование → Файлы Sitemap** (Sitemaps).
2. Добавьте по очереди:

```text
https://sitrifor.ru/sitemap.xml
https://sitrifor.ru/sitemap-news.xml
https://sitrifor.ru/sitemap-marketplace.xml
```

Они уже указаны в `https://sitrifor.ru/robots.txt`.

## 4. Запросить индексацию ключевых URL (опционально)

**Проверка URL** → вставьте адрес → **Запросить индексирование**:

- `https://sitrifor.ru/`
- `https://sitrifor.ru/masters`
- `https://sitrifor.ru/634/`
- `https://sitrifor.ru/marketplace`
- 2-3 свежие новости

Квота ограничена - не спамить десятками страниц в день.

## 5. Подключить API (для агента / cron)

Нужно один раз, чтобы скрипты читали GSC без вашего клика.

1. [Google Cloud Console](https://console.cloud.google.com/) → создать проект (например `sitrifor-seo`) или выбрать существующий.
2. **APIs & Services → Library** → включить **Google Search Console API**.
3. **IAM & Admin → Service Accounts** → Create:
   - имя: `sitrifor-gsc`
   - роль на проект не обязательна для GSC
4. У service account: **Keys → Add key → JSON** → скачать файл.
5. Сохранить на сервер:

```bash
# путь строго такой (gitignored)
/var/www/sitrifor/seo/credentials/gsc-service-account.json
chmod 600 /var/www/sitrifor/seo/credentials/gsc-service-account.json
```

6. В JSON найдите `client_email` вида `sitrifor-gsc@PROJECT.iam.gserviceaccount.com`.
7. GSC → **Настройки → Пользователи и права** → **Добавить пользователя**:
   - email = `client_email` из JSON
   - право: **Владелец** или минимум **Полный**
8. В `seo/.env`:

```env
GOOGLE_APPLICATION_CREDENTIALS=./credentials/gsc-service-account.json
GSC_SITE_URL=sc-domain:sitrifor.ru
```

(Если Prefикс URL: `GSC_SITE_URL=https://sitrifor.ru/`)

## 6. Проверка, что всё живое

В GSC UI:

- [ ] Ресурс verified
- [ ] 3 sitemap без ошибки «Не удалось получить»
- [ ] Через несколько дней появляются **Эффективность** (клики/показы) и **Покрытие / Страницы**

На сервере (после п.5):

```bash
cd /var/www/sitrifor/seo && test -f credentials/gsc-service-account.json && echo "GSC creds OK"
```

## Частые ошибки

| Симптом | Что сделать |
|---------|-------------|
| DNS verification failed | Подождать; проверить TXT через `dig TXT sitrifor.ru` |
| Sitemap «не удалось получить» | Открыть URL в браузере - должен быть XML 200 |
| API 403 | Service account не добавлен как пользователь ресурса GSC |
| Пустая эффективность недели | Нормально для нового сайта - ждите индексы |

## Связанные файлы в репо

- `seo/.env.example` - переменные GSC
- `seo/credentials/README.md` - кратко про ключи
- `seo/ACCESS-CHECKLIST.md` - чеклист доступа агента
- Live: `https://sitrifor.ru/sitemap.xml`, `robots.txt`
