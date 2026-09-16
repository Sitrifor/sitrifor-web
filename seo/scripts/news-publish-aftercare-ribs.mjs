#!/usr/bin/env node
/**
 * One-shot: publish aftercare SEO article targeting live Yandex queries.
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

const title = 'Сколько заживает тату на ребрах и чем смазывать первую неделю';
const summary =
  'Практичный ответ для клиента и шаблон для мастера: сроки на ребрах, чем смазывать тату первую неделю, одежда и когда ждать touch-up.';
const body = `Клиенты после сеанса чаще всего гуглят два вопроса: сколько времени заживает тату на ребрах и чем смазывать тату первую неделю. Ниже - короткая рамка, которую можно отдать ссылкой вместе с памяткой студии.

## Сколько заживает тату на ребрах
На ребрах процесс обычно капризнее, чем на плече или предплечье. Одежда трет зону, грудная клетка двигается при дыхании. Поверхностно часто те же 2-4 недели, но зуд и шелушение могут тянуться дольше. Это не значит, что работа «испортилась» - чаще это нормальный ход на сложной зоне.

Что прописать клиенту заранее:
• одежда без грубого шва по свежей работе;
• аккуратнее с поясом и плотным бельем в первые дни;
• не оценивать цвет по мокрому виду на сеансе.

Развернутый протокол - в гайде <a href="/guides/aftercare/">уход и заживление</a>.

## Чем смазывать тату первую неделю
Универсального «лучшего крема из рекламы» нет. Для студии ответ один: средство из вашей памятки, тонкий слой после мягкого мытья, чистые руки. Не меняйте крем каждый день по советам из ленты - так чаще раздражают кожу.

В дни 1-3 важнее гигиена и режим, чем толщина слоя. Перемазать зону - частая причина лишних претензий к цвету.

Интерактивную памятку и PDF удобно отдать со страницы <a href="/masters#care">Мастерам - уход</a>.

## Связка с работой мастера
Если ведете эскизы, пигменты и склад в <a href="/634/">приложении для тату-мастера 634</a>, оставьте рядом пометку, какой протокол ухода отдали этому клиенту на крупной заливке. Прайс на возможный touch-up после заживления заранее заложите через <a href="/tools/price-calculator/">калькулятор стоимости</a>.

Полный текст для студии: <a href="/guides/aftercare/">sitrifor.ru/guides/aftercare/</a>.`;

const src = news.listSources({ enabledOnly: false }).find((s) => s.key === 'sitrifor-editorial');
if (!src) {
  console.error('missing source sitrifor-editorial - run news-seed-editorial once or upsertSource');
  process.exit(1);
}

const loc = await localizeBundle({ title, summary, body, sourceLang: 'ru' });
const insights = await composeInsights(
  { title, summary, body },
  { topic: 'aftercare' }
);
const quality = scoreUsefulness({
  title,
  summary,
  body,
  sourceKey: 'sitrifor-editorial',
  categories: ['clients', 'studio']
});

const res = news.insertArticle({
  sourceId: src.id,
  guid: 'seed:editorial-aftercare-ribs-week-2026-08-10',
  title,
  summary,
  body,
  url: 'https://sitrifor.ru/guides/aftercare/',
  imageUrl: 'https://sitrifor.ru/img/marketing/card-care.jpg',
  publishedAt: new Date().toISOString(),
  categories: ['clients', 'studio'],
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
  insightsTopic: 'aftercare'
});

if (res.inserted) {
  const article = news.getArticleBySlug(res.slug, { publishedOnly: false });
  if (article) {
    try {
      renderArticleSsr(article);
    } catch (e) {
      console.warn('SSR warn', e.message);
    }
  }
  writeNewsSitemap();
  console.log(JSON.stringify({ inserted: true, slug: res.slug, id: res.id }, null, 2));
} else {
  console.log(JSON.stringify({ inserted: false, reason: 'duplicate guid/source' }, null, 2));
}
