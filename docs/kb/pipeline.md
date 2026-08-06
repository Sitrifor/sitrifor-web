# Pipeline ролей (Kanban)

Колонки (порядок):

0. Inbox (заказчик)  
1. BizDev  
2. Strategist  
3. Product  
4. Project  
5. Design / CJM  
6. SysAnalyst  
7. Architect  
8. Dev  
9. DevOps  
10. IB / Legal  
11. QA  
12. Marketing  
13. SMM / Editor  
14. AI / Data  
15. Support (если нужно)  
16. Scrum gate  
17. Ready for You (заказчик: релизим?)

## Skip
Тип задачи задаёт маршрут. Пропуски пишутся в `docs/tasks/<id>/pipeline.md`, например:  
`skipped: [ib_legal] - юридическое включение не нужно`.

## Артефакты задачи
`docs/tasks/<id>/brief.md`, `score.md`, `pipeline.md`, `acceptance.md`, `qa-report.md`, `release-ask.md`.

## Techdebt
Агенты могут открывать Issue `type:techdebt` с риском/багом → Inbox → скоринг.
