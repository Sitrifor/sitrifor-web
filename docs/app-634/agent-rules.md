# Правила для агентов про 634

## Можно
- Опираться на этот каталог `docs/app-634/` и `docs/kb/app-634.md`
- Цитировать App Store / страницы sitrifor.ru
- Предлагать задачи на сайт (лендинг, support, SEO `/634/`) и на будущий repo приложения
- Фиксировать баги UI приложения как `type:bug` + `product:634` **после** проверки на устройстве или скрине заказчика

## Нельзя
- Выдумывать Swift/SwiftUI структуру, API, Core Data, CloudKit, эндпоинты
- Обещать Android «скоро» с датой
- Путать web-калькулятор / aftercare с фичами 634
- Называть 634 CRM или «записью клиентов»
- Коммитить секреты Apple (certificates, `.p8`, App Store Connect keys) в любой репо

## Когда появится `sitrifor-634`
- Читать README и ADR того репо
- iOS-агенты - local на Mac; сайт - этот репо
- Общая доска: GitHub Project **Sitrifor Delivery**, labels `product:634`

## Критичные роли
Architect / Dev / QA / Design по приложению - только Cursor (сильная модель) или человек. Не Ollama.
