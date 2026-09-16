#!/usr/bin/env node
/**
 * Publish evergreen article: how to choose an app for tattoo masters (Wordstat intent).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, '../../backend');
const news = await import(path.join(BACKEND, 'news.js'));
const { localizeBundle } = await import(path.join(BACKEND, 'translate.js'));
const { composeInsights } = await import(path.join(BACKEND, 'news-insights.js'));
const { scoreUsefulness } = await import(path.join(BACKEND, 'news-quality.js'));
const { writeNewsSitemap, renderArticleSsr } = await import(
  path.join(BACKEND, 'news-seo/index.js')
);

const title = 'Приложения для тату мастера: чем 634 отличается от CRM и генераторов эскизов';
const summary =
  'Как выбрать приложение для тату мастеров: рабочий стол со эскизами и складом краски, а не онлайн-запись и не рисовалка для клиента.';
const body = `Запрос «приложение для тату» в поиске смешивает три разных продукта. Ниже - короткая рамка, чтобы не скачать не то.

## Три класса «приложений для тату»
1. Генераторы и примерка: рисуют идею или накладывают тату на фото. Это спрос клиента.
2. CRM и запись: календарь, SMS, касса. Это операционка студии.
3. Рабочий стол мастера: утвержденные эскизы проектов, пигменты, склад краски. Это спрос мастера в смене.

Если вы искали именно <strong>приложения для тату мастера</strong>, смотрите на третий класс. Под него сделан <a href="/634/">634</a>.

## Что делает 634
634 - <strong>приложение для тату мастера</strong> от Sitrifor: проекты с эскизами, подбор пигментов и оцифрованный склад краски. Не онлайн-запись и не генератор картинок «с нуля».

Типичный сценарий: эскиз больше не теряется в десяти чатах, микс пигментов привязан к проекту, перед плотной неделей видно, каких банок не хватает.

Страница продукта: <a href="/634/">sitrifor.ru/634/</a>. Скриншоты и демо - на <a href="/masters#app">Мастерам</a>. Скачать - в App Store.

## Чем это не является
Не путайте с запросами «приложение для эскизов тату» или «приложение для примерки тату». Там клиент хочет нарисовать или примерить. Мастеру нужно хранить утвержденный эскиз рядом с реальной работой и краской.

Не путайте и с CRM: если боль только в записи клиентов - оставьте привычный сервис записи. 634 закрывает другой слой.

## Связка с сайтом
Методика цвета - в <a href="/guides/pigments/">гайде по пигментам</a>, стиль и трафарет - в <a href="/guides/sketches/">хабе эскизов</a>, уход клиента - в <a href="/guides/aftercare/">aftercare</a>. Так приложение не висит в вакууме App Store.

Короткий ответ на поиск «приложение для тату мастеров для эскизов»: 634 хранит эскиз проекта, а не генерирует бесконечную ленту идей.`;

const src = news.listSources({ enabledOnly: false }).find((s) => s.key === 'sitrifor-editorial');
if (!src) {
  console.error('missing source sitrifor-editorial');
  process.exit(1);
}

const loc = await localizeBundle({ title, summary, body, sourceLang: 'ru' });
const insights = await composeInsights(
  { title, summary, body },
  { topic: 'app634' }
);
const quality = scoreUsefulness({
  title,
  summary,
  body,
  sourceKey: 'sitrifor-editorial',
  categories: ['studio', 'tools']
});

const res = news.insertArticle({
  sourceId: src.id,
  guid: 'seed:editorial-app-for-tattoo-master-2026-08-11',
  title,
  summary,
  body,
  url: 'https://sitrifor.ru/634/',
  imageUrl: 'https://sitrifor.ru/img/marketing/app-card-bg.jpg',
  publishedAt: new Date().toISOString(),
  categories: ['studio', 'tools'],
  lang: 'ru',
  region: 'RU',
  slugBase: title,
  titleRu: title,
  summaryRu: summary,
  bodyRu: body,
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
  insightsTopic: 'app634'
});

console.log(JSON.stringify(res, null, 2));
if (res.slug) {
  const article = news.getArticleBySlug(res.slug, { publishedOnly: false });
  if (article) {
    try {
      renderArticleSsr(article);
      console.log('SSR ok', res.slug);
    } catch (e) {
      console.warn('SSR', e.message || e);
    }
  }
  writeNewsSitemap();
  console.log('news sitemap updated');
}
