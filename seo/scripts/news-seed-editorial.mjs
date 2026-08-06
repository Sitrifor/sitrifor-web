#!/usr/bin/env node
/**
 * Seed high-value editorial articles for tattoo masters (social growth, tools, lifehacks).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, '../../backend');
const news = await import(path.join(BACKEND, 'news.js'));
const { localizeBundle } = await import(path.join(BACKEND, 'translate.js'));
const { composeInsights } = await import(path.join(BACKEND, 'news-insights.js'));
const { scoreUsefulness } = await import(path.join(BACKEND, 'news-quality.js'));

const SEEDS = [
  {
    key: 'editorial-social',
    title: 'Как тату-мастеру стабильно набирать просмотры сторис и доводить их до записи',
    summary:
      'Практическая схема сторис на неделю: крючки, CTA, ответы в Direct и простая аналитика без выгорания.',
    body: `Многие мастера публикуют сторис каждый день, но не получают записи. Проблема обычно не в «алгоритме», а в отсутствии системы.

## Что ломает охваты
• Сторис без крючка в первых 2 секундах
• Нет одного понятного действия для зрителя
• Смешение личного и рабочего без структуры
• Ответы на заявки через дни, а не минуты

## Рабочая схема на 7 дней
1. Понедельник: процесс линии/заливки + вопрос «какой стиль вам ближе?»
2. Вторник: заживление 2–4 недели + короткий совет по уходу
3. Среда: эскиз «до/после правок» и объяснение композиции
4. Четверг: свободные окна на неделю + ссылка на бриф
5. Пятница: Reels/таймлапс 7–12 сек с текстом выгоды
6. Суббота: разбор частых ошибок клиентов перед сеансом
7. Воскресенье: закулисье студии + мягкий CTA

## CTA, который конвертирует
В конце серии всегда одно действие: «напишите размер и место — пришлю 2 варианта эскиза» или «свободные даты в шапке».

## Метрики на неделю
• Ответы на сторис
• Заполненные брифы
• Депозиты
• Доходимость до сеанса`,
    categories: ['clients', 'tools'],
    imageUrl: 'https://sitrifor.ru/img/marketing/app-card-bg.jpg',
    topic: 'social'
  },
  {
    key: 'editorial-reels',
    title: 'Reels для тату-мастера: как снимать короткие ролики, которые приводят клиентов',
    summary:
      'Формула Reels под запись: первые 1.5 секунды, текст на экране, оффер и простой монтаж без продакшна.',
    body: `Reels работают лучше статичных постов, если в первые секунды зрителю ясно, зачем смотреть дальше.

## Формула ролика 7–12 секунд
1. Крючок: крупный план иглы/тени/трафарета
2. Контекст: «реализм предплечье / 1 сеанс»
3. Результат: готовый фрагмент или заживление
4. Оффер: «свободные даты / бриф в шапке»

## Что снимать без студии
• Нанесение трафарета
• Первые линии
• Заливка одного фрагмента
• Сравнение «сразу / +14 дней»

## Ошибки
• Длинные вступления «привет, друзья»
• Музыка громче голоса/смысла
• Нет текста на экране (многие смотрят без звука)
• Нет следующего шага для клиента

## Инструменты
CapCut или встроенный редактор Instagram, шаблоны обложек в Canva, единый визуальный тон студии.`,
    categories: ['clients', 'tools'],
    imageUrl: 'https://sitrifor.ru/img/marketing/app-card-bg.jpg',
    topic: 'social'
  },
  {
    key: 'editorial-tools',
    title: 'Инструменты тату-мастера 2026: что реально экономит время на эскизах, записи и контенте',
    summary:
      'Короткий стек сервисов: эскиз, запись, контент-план, учёт пигментов — без перегруза подписками.',
    body: `Инструменты должны сокращать рутину, а не добавлять ещё одну таблицу «на всякий случай».

## Минимальный стек
1. Эскиз: Procreate + папки «клиент_дата_размер»
2. Запись: Booksy / YCLIENTS / аналог с напоминаниями
3. Бриф: форма с размером, местом, референсами, бюджетом, сроками
4. Контент: Later/Buffer или напоминания в календаре
5. Пигменты/проекты: Sitrifor 634
6. Цена сеанса: калькулятор Sitrifor

## Лайфхаки
• Шаблоны ответа на Direct (3 варианта: мини / средний / проект)
• Депозитная политика в одном сообщении-закрепе
• Один день недели только на эскизы — без «между сеансами на коленке»
• Фото «сразу / +14 дней» в карточке клиента

## Как выбрать, что внедрять
Если хаос в переписке — сначала бриф и запись.
Если мало заявок — сначала контент-система.
Если теряется время на эскизах — шаблоны и библиотека кистей.`,
    categories: ['tools', 'studio'],
    imageUrl: 'https://sitrifor.ru/img/marketing/app-card-bg.jpg',
    topic: 'tools'
  },
  {
    key: 'editorial-booking',
    title: 'Как снизить no-show: депозит, напоминания и бриф, которые работают в тату-студии',
    summary:
      'Пошаговый процесс от первого сообщения до сеанса: меньше срывов, выше средний чек и спокойнее график.',
    body: `Сорванные сеансы бьют по выручке сильнее, чем «медленный» Instagram.

## Воронка без хаоса
1. Заявка → автобриф
2. Созвон/переписка 10–15 минут
3. Эскиз / концепт
4. Депозит
5. Напоминания за 48 и 24 часа
6. Сеанс → уход → отзыв

## Правила депозита
• Фиксированная сумма или % от оценки
• Письменное подтверждение
• Условия переноса заранее

## Напоминания
• «Завтра сеанс, подготовьте кожу / не загорайте / пришлите вопросы»
• Просьба подтвердить ответным «+»

## После сеанса
Памятка ухода + фотоконтроль + окно touch-up. Это даёт повторные записи и отзывы.`,
    categories: ['clients', 'studio'],
    imageUrl: 'https://sitrifor.ru/img/marketing/app-card-bg.jpg',
    topic: 'clients'
  }
];

news.upsertSource({
  key: 'sitrifor-editorial',
  name: 'Sitrifor Editorial',
  url: 'https://sitrifor.ru/news',
  feedUrl: null,
  region: 'RU',
  lang: 'ru',
  enabled: 1
});
const src = news.listSources({ enabledOnly: false }).find((s) => s.key === 'sitrifor-editorial');

let inserted = 0;
for (const seed of SEEDS) {
  const quality = scoreUsefulness({
    title: seed.title,
    summary: seed.summary,
    body: seed.body,
    sourceKey: 'sitrifor-editorial',
    categories: seed.categories
  });
  const insights = await composeInsights(
    { title: seed.title, summary: seed.summary, body: seed.body },
    { topic: seed.topic }
  );
  const loc = await localizeBundle({
    title: seed.title,
    summary: seed.summary,
    body: seed.body,
    sourceLang: 'ru'
  });
  const res = news.insertArticle({
    sourceId: src.id,
    guid: 'seed:' + seed.key,
    title: seed.title,
    summary: seed.summary,
    body: seed.body,
    url: 'https://sitrifor.ru/news#' + seed.key,
    imageUrl: seed.imageUrl,
    publishedAt: new Date().toISOString(),
    categories: seed.categories,
    lang: 'ru',
    region: 'RU',
    slugBase: seed.title,
    titleRu: seed.title,
    summaryRu: seed.summary,
    bodyRu: seed.body,
    titleEn: loc.titleEn,
    summaryEn: loc.summaryEn,
    bodyEn: loc.bodyEn,
    titleDe: loc.titleDe,
    summaryDe: loc.summaryDe,
    bodyDe: loc.bodyDe,
    published: true,
    usefulScore: quality.score,
    usefulReasons: quality.reasons,
    insightsRu: insights.insightsRu,
    insightsEn: insights.insightsEn,
    insightsDe: insights.insightsDe,
    insightsTopic: seed.topic
  });
  if (res.inserted) {
    inserted += 1;
    console.log('SEED', res.slug);
  } else {
    console.log('EXISTS', seed.key);
  }
}

console.log(JSON.stringify({ inserted, stats: news.newsStats() }, null, 2));
