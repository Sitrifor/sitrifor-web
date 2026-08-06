/**
 * Sitrifor AI insights composer.
 * Knowledge packs first; optional short LLM bullets only (local 1.5B is weak for long RU copy).
 */
import { researchTopic } from './news-research.js';
import { translateText } from './translate.js';
import { isLlmAvailable, llmGenerate } from './news-llm.js';
import { isBadAiText } from './news-quality.js';
import { editorialSystemPrompt, polishEditorialText } from './news-text-polish.js';

const KNOWLEDGE = {
  social: {
    problem: 'Рост охватов и записи через соцсети',
    steps: [
      'Закрепите 3 типа контента в неделю: процесс (машина/линия), результат (заживление 2–4 недели), экспертность (уход / подготовка / стиль).',
      'Сторис: 5–8 кадров, первые 2 — крючок (до/после или таймлапс линии), в конце один CTA: «свободные даты / анкета в шапке».',
      'Reels: 7–12 секунд, вертикаль, крупный план иглы/тени в первые 1.5 сек; текст на экране с выгодой для клиента.',
      'Хештеги: 8–12 узких (город + стиль + «guest spot»), не 30 общих #tattoo.',
      'Раз в неделю — ответ на 10 комментариев и 5 входящих Direct по одному шаблону брифа.'
    ],
    tools: ['Instagram Insights', 'Later / Buffer', 'Canva', 'Google Forms (бриф)'],
    metrics: ['сохранения сторис', 'ответы на CTA', 'брифы → депозит', 'запись на сеанс']
  },
  clients: {
    problem: 'Стабильный поток заявок и доходимость до сеанса',
    steps: [
      'Единый вход: ссылка в шапке → бриф → автоответ с окном консультации.',
      'Предоплата/депозит письменно; напоминание за 48ч и за 24ч.',
      'После сеанса: памятка ухода + отзыв на 7–14 день + touch-up окно.',
      'Сегменты базы: «жду эскиз», «жду дату», «постоянный».'
    ],
    tools: ['Booksy / YCLIENTS', 'WhatsApp Business', 'CRM-таблица'],
    metrics: ['бриф → депозит', 'no-show %', 'повторные записи', 'отзывы']
  },
  tools: {
    problem: 'Инструменты, которые экономят время мастера',
    steps: [
      'Эскиз: Procreate + папка «клиент_дата_размер».',
      'Шаблоны обложек и сторис в одном визуальном тоне.',
      'Онлайн-слоты + автонапоминания вместо «когда свободен?».',
      'Учёт пигментов/партий — особенно в командной студии.'
    ],
    tools: ['Procreate', 'Canva', 'Booksy/YCLIENTS', 'Sitrifor 634', 'калькулятор Sitrifor'],
    metrics: ['время на эскиз', 'время на переписку', 'ошибки в записи']
  },
  gear: {
    problem: 'Техника и расходники без простоев',
    steps: [
      'Фиксируйте связку машина + картридж + ход под тип работы (линия / залив / реализм).',
      'Новую партию игл/пигмента тестируйте на утиль-коже до клиента.',
      'Чеклист стерильности и замены расходников между сеансами.'
    ],
    tools: ['журнал настроек машины', 'учёт партий расходников'],
    metrics: ['стабильность линии', 'заживление', 'расход картриджей на сеанс']
  },
  pigments: {
    problem: 'Пигменты и предсказуемое заживление',
    steps: [
      'Спрашивайте аллергии и историю покрытия; патч-тест по политике студии.',
      'Документируйте бренд/партию в карточке клиента.',
      'Сравнивайте заживление через 2–4 недели.'
    ],
    tools: ['карточка клиента', 'фото «сразу / +14 дней»'],
    metrics: ['ретеншн цвета', 'touch-up частота']
  },
  studio: {
    problem: 'Процессы студии и гигиена',
    steps: [
      'Чеклист открытия/закрытия и между клиентами.',
      'Зоны грязная / чистая; маркировка контейнеров.',
      'Общие правила депозита, опозданий и отмен.'
    ],
    tools: ['чеклисты', 'общий календарь студии'],
    metrics: ['инциденты', 'время подготовки кабинета']
  },
  sketch: {
    problem: 'Эскиз, который бронирует клиента',
    steps: [
      'Показывайте 2–3 варианта композиции, а не один «финал».',
      'На эскизе подписывайте размер и место.',
      'Короткое Reels «от референса к трафарету».'
    ],
    tools: ['Procreate', 'stencil / термоперенос'],
    metrics: ['одобрение с 1–2 итераций', 'депозит после эскиза']
  },
  career: {
    problem: 'Цена, портфолио и видимость',
    steps: [
      '12 сильных работ одного стиля важнее 50 разношёрстных.',
      'Guest spot: анонс за 3–4 недели, слоты и бриф заранее.',
      'Прайс пакетами: мини / сеанс / проект.'
    ],
    tools: ['медиакит PDF', 'календарь конвенций'],
    metrics: ['заполняемость', 'средний чек']
  },
  industry: {
    problem: 'Применить новость в практике на этой неделе',
    steps: [
      'Выделите 1 вывод, который меняет процесс.',
      'Проверьте: безопасность, запись клиентов или контент?',
      'Зафиксируйте действие в чеклисте или контент-плане.'
    ],
    tools: ['контент-план', 'чеклист студии'],
    metrics: ['внедрённые изменения за 7 дней']
  }
};

function pickPack(topic) {
  return KNOWLEDGE[topic] || KNOWLEDGE.industry;
}

function bullets(items) {
  return items.map((x) => `• ${x}`).join('\n');
}

function fromResearch(research) {
  const lines = [];
  for (const r of research.slice(0, 3)) {
    const bit = (r.snippet || r.pageText || '').replace(/\s+/g, ' ').trim();
    if (!bit) continue;
    const sentence = bit.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
    if (sentence.length > 50) {
      lines.push(`• ${sentence.slice(0, 220)}${sentence.length > 220 ? '…' : ''} _(источник: ${r.title})_`);
    }
  }
  return lines.slice(0, 3);
}

function articleHook(title, summary) {
  const t = (title || '').trim();
  const s = (summary || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  if (!t) return null;
  return `**По теме материала:** «${t}»${s ? ` – ${s}` : ''}`;
}

async function shortLlmBullets(title, summary, topic) {
  // Opt-in only: small models often produce vague/decorative tips
  if (process.env.NEWS_LLM_INSIGHTS !== '1') return null;
  try {
    if (!(await isLlmAvailable())) return null;
    const text = await llmGenerate(
      `Тема: ${title}\nКратко: ${summary}\nТопик: ${topic}\n\nДай ровно 3 коротких практических совета тату-мастеру по этой теме. Только маркированный список, по 1 предложению каждый. Без выдуманных брендов и цифр.`,
      {
        system: editorialSystemPrompt('insights'),
        mode: 'insights',
        options: { temperature: 0.2, num_ctx: 1024 },
        timeoutMs: 90000
      }
    );
    if (!text || isBadAiText(text) || text.length > 600) return null;
    const lines = text
      .split(/\n/)
      .map((l) => l.replace(/^[-*•\d.)\s]+/, '').trim())
      .filter((l) => l.length > 20 && l.length < 180)
      .slice(0, 3);
    return lines.length >= 2 ? lines : null;
  } catch {
    return null;
  }
}

export async function composeInsights(article, { topic = 'industry', lang = 'ru' } = {}) {
  const pack = pickPack(topic);
  const title = article.title || '';
  const summary = article.summary || '';
  const body = (article.body || '').slice(0, 800);

  let research = [];
  try {
    research = await researchTopic(`${title} tattoo artist practical tips`, { limit: 3 });
  } catch {
    research = [];
  }
  const researchLines = fromResearch(research);
  const llmBullets = await shortLlmBullets(title, summary, topic);
  const hook = articleHook(title, summary);

  const insightsRu = polishEditorialText(
    [
      `**Задача для мастера:** ${pack.problem}`,
      hook,
      '',
      '**Что сделать на этой неделе**',
      bullets(llmBullets || pack.steps.slice(0, 4)),
      '',
      researchLines.length ? '**Из открытых источников**' : null,
      researchLines.length ? researchLines.join('\n') : null,
      '',
      '**Инструменты**',
      bullets(pack.tools),
      '',
      '**Как понять, что сработало**',
      bullets(pack.metrics),
      '',
      '_Sitrifor AI: отраслевые практики для тату-мастеров._'
    ]
      .filter((x) => x !== null && x !== undefined)
      .join('\n'),
    { deep: true }
  ).text;

  // Expand thin bodies with pack (never long LLM essay — quality too low on 1.5B)
  let expandedRu = null;
  const rawLen = (article.body || article.summary || '').length;
  if (rawLen < 700) {
    expandedRu = [
      summary || title,
      '',
      '## Контекст',
      body || summary || title,
      '',
      '## Практический разбор',
      bullets(pack.steps.slice(0, 4)),
      '',
      researchLines.length ? '## Дополнения из открытых источников' : null,
      researchLines.length ? researchLines.join('\n') : null
    ]
      .filter((x) => x !== null)
      .join('\n');
  }

  const insightsEn = lang === 'en' ? insightsRu : await translateText(insightsRu, 'en');
  const insightsDe = lang === 'de' ? insightsRu : await translateText(insightsRu, 'de');
  const bodyExpandEn = expandedRu ? await translateText(expandedRu, 'en') : null;
  const bodyExpandDe = expandedRu ? await translateText(expandedRu, 'de') : null;

  return {
    insightsRu,
    insightsEn: insightsEn || insightsRu,
    insightsDe: insightsDe || insightsRu,
    expandedBodyRu: expandedRu,
    expandedBodyEn: bodyExpandEn,
    expandedBodyDe: bodyExpandDe,
    researchCount: research.length,
    topic,
    usedLlm: Boolean(llmBullets)
  };
}
