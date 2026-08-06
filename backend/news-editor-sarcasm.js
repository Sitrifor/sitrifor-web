/**
 * Sarcastic «Главный редактор Sitrifor» takes on boss TG posts (notepad_ceo).
 * Voice: woman editor; boss dramatizes «hardships» that land on the team.
 */
import { fetchTelegramChannelPosts } from './news-telegram.js';
import { llmGenerate, isLlmAvailable } from './news-llm.js';
import { translateText, localizeBundle } from './translate.js';
import { scoreUsefulness, passesPublishGate } from './news-quality.js';
import { editorialSystemPrompt, polishEditorialText, passesEditorialGate } from './news-text-polish.js';
import { normalizeCategories } from './news.js';

const CHANNEL = 'notepad_ceo';
const CHANNEL_URL = `https://t.me/${CHANNEL}`;

const JOKE_ANGLES = [
  'босс описывает «свой» подвиг, а в кадре – чужие руки и нервы',
  'экономия на всём, кроме пафоса в посте',
  'сроки «два дня» живут отдельно от реальности календаря',
  'AI спасёт всех, кроме того, кому потом править продакшн',
  'посредники плохие, пока сам не стал посредником для команды',
  'мат в канале – как KPI: чем громче, тем меньше деталей для исполнителей',
  '«я просто хочу платить деньги» звучит мило, пока бухгалтерия считает часы',
  'успех в посте измеряется эмодзи, а не тикетами в бэклоге',
  'огурцы вместо оплаты – метафора любого «нестандартного» процесса',
  'релиз «уже чешется», а чеклист релиза ещё в черновиках'
];

function softenQuote(text) {
  return String(text || '')
    .replace(/[аa]хуй\w*/gi, 'чёрт')
    .replace(/\bбля\w*/gi, 'блин')
    .replace(/пизд\w*/gi, 'ерунд')
    .replace(/ублюд\w*/gi, 'ужасн')
    .replace(/сран\w*/gi, 'паршив')
    .replace(/нахер|нахуй/gi, 'не нужны')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 520);
}

function pickAngle(seed) {
  const i = Math.abs(Number(seed) || Date.now()) % JOKE_ANGLES.length;
  return JOKE_ANGLES[i];
}

function templateSarcasm(post, angle) {
  const quote = softenQuote(post.text).split('\n').filter(Boolean).slice(0, 4).join(' ');
  const title = `Заметка главреда: босс снова «герой», а команда – в саппорте`;
  const summary =
    'Главный редактор новостей Sitrifor разбирает свежий пост босса из Telegram: драма на сцене, а себестоимость – за кулисами.';

  const body = [
    summary,
    '',
    '## Что написал босс',
    `> ${quote}`,
    '',
    `_Источник: [Блокнот в Telegram](${post.url || CHANNEL_URL})_`,
    '',
    '## Комментарий главреда',
    `Сегодняшний угол: ${angle}.`,
    '',
    'В канале это звучит как личный квест основателя. В студии/продукте это обычно выглядит иначе: кто-то ловит отказ Apple, кто-то правит UI «за час с нейросети», кто-то объясняет клиенту, почему «два дня» растянулись на неделю.',
    '',
    'Едкое, но честное: если в посте много эмодзи и мало чеклиста – команда уже знает, кто будет доделывать детали после оваций.',
    '',
    '## Что полезного вынести мастеру и команде',
    '• Фиксируйте «успех» не эмодзи, а артефактом: ссылка, билд, закрытый тикет',
    '• Срок в посте ≠ срок в календаре. Кладите буфер до обещания клиенту',
    '• Экономия на посредниках хороша, пока не экономите на людях, которые держат процесс',
    '',
    `Канал босса (обязательная ссылка): ${CHANNEL_URL}`,
    '',
    '_Колонка «Главный редактор Sitrifor». Сарказм – рабочий инструмент редакции, не личная война._'
  ].join('\n');

  const insights = [
    'Кратко: пост босса – витрина. Работа – склад за витриной.',
    '',
    `Угол выпуска: ${angle}.`,
    '',
    'Совет команде: после громкого поста сверьте, кто реально закрывает хвосты – и положите это в ретро.'
  ].join('\n');

  return { title, summary, body, insights };
}

async function llmSarcasm(post, angle) {
  const ok = await isLlmAvailable();
  if (!ok) return null;
  const quote = softenQuote(post.text);
  const prompt = `Напиши колонку главной редакторки новостей Sitrifor (женщина, сухой сарказм, без мата).

Факт: босс ведёт TG-канал «Блокнот» (${CHANNEL_URL}) и описал ситуацию. На деле «сложности босса» часто ложатся на сотрудников.

Пост босса (уже смягчён):
"""
${quote}
"""

Ссылка на пост: ${post.url || CHANNEL_URL}
Угол шутки этого выпуска (обязательно обыграй по-новому): ${angle}

Формат markdown:
# Заголовок (начни с «Заметка главреда:»)
Краткое summary одним абзацем.

## Что написал босс
(короткая цитата)

## Комментарий главреда
(едкие замечания, разные шутки, без копирования мата)

## Что полезного вынести
(3 практических пункта)

В конце обязательно строка со ссылкой на канал: ${CHANNEL_URL}

Правила: только короткое тире –; без длинного —; без медицинских/юр. гарантий; не выдумывай факты сверх поста.`;

  const text = await llmGenerate(prompt, {
    system: editorialSystemPrompt('sarcasm'),
    mode: 'sarcasm',
    options: { temperature: 0.7, num_ctx: 3072 },
    timeoutMs: 180000
  });
  if (!text || text.length < 280) return null;

  const lines = text.split('\n');
  let title = 'Заметка главреда: босс снова герой ленты';
  let i = 0;
  if (/^#\s+/.test(lines[0] || '')) {
    title = lines[0].replace(/^#\s+/, '').trim().slice(0, 180);
    i = 1;
  }
  while (i < lines.length && !lines[i].trim()) i += 1;
  let summary = (lines[i] || '').trim();
  if (!summary || /^#/.test(summary) || summary.length < 40) {
    summary =
      'Главред Sitrifor разбирает пост босса из Telegram: витрина драмы и себестоимость команды.';
  } else i += 1;
  let body = lines.slice(i).join('\n').trim() || text;
  if (!body.includes(CHANNEL_URL)) {
    body += `\n\nКанал босса: ${CHANNEL_URL}`;
  }
  return {
    title,
    summary: summary.slice(0, 500),
    body: body.slice(0, 16000),
    insights: [
      'Кратко от главреда: громкий пост ≠ закрытый процесс.',
      '',
      `Угол: ${angle}.`,
      '',
      `Читать первоисточник: ${CHANNEL_URL}`
    ].join('\n')
  };
}

/**
 * Compose one sarcasm column from latest unused TG post.
 */
export async function composeEditorSarcasm({ usedIds = [], preferId = null } = {}) {
  const posts = await fetchTelegramChannelPosts(CHANNEL, { limit: 25 });
  if (!posts.length) throw new Error('no_tg_posts');

  let post = preferId ? posts.find((p) => p.id === preferId) : null;
  if (!post) {
    post = posts.find((p) => !usedIds.includes(p.id)) || posts[0];
  }

  const angle = pickAngle((post.id || '').replace(/\D/g, '') || Date.now());
  let draft = null;
  let usedLlm = false;
  if (process.env.NEWS_LLM_SARCASM !== '0') {
    draft = await llmSarcasm(post, angle);
    usedLlm = Boolean(draft);
  }
  if (!draft) draft = templateSarcasm(post, angle);

  draft.title = polishEditorialText(draft.title, { soft: true, deep: true, gate: false }).text;
  draft.summary = polishEditorialText(draft.summary, { soft: true, deep: true, gate: false }).text;
  const bodyPolish = polishEditorialText(draft.body, { deep: true });
  draft.body = bodyPolish.text;
  draft.insights = polishEditorialText(draft.insights, { deep: true, gate: false }).text;

  const loc = await localizeBundle({
    title: draft.title,
    summary: draft.summary,
    body: draft.body,
    sourceLang: 'ru'
  });
  const insightsEn = await translateText(draft.insights, 'en');
  const insightsDe = await translateText(draft.insights, 'de');

  const categories = normalizeCategories(['culture', 'tools', 'studio'], { primary: 'culture' });
  const quality = scoreUsefulness({
    title: draft.title,
    summary: draft.summary,
    body: draft.body,
    sourceKey: 'sitrifor-editor',
    categories
  });
  const editorialOk = passesEditorialGate(bodyPolish);
  const publishOk = passesPublishGate(quality, bodyPolish);

  return {
    postId: post.id,
    postUrl: post.url,
    channelUrl: CHANNEL_URL,
    title: draft.title,
    summary: draft.summary,
    body: draft.body,
    imageUrl: 'https://sitrifor.ru/img/news/formats/editor-sarcasm.jpg',
    categories,
    titleRu: draft.title,
    summaryRu: draft.summary,
    bodyRu: draft.body,
    titleEn: loc.titleEn,
    summaryEn: loc.summaryEn,
    bodyEn: loc.bodyEn,
    titleDe: loc.titleDe,
    summaryDe: loc.summaryDe,
    bodyDe: loc.bodyDe,
    insightsRu: draft.insights,
    insightsEn: insightsEn || draft.insights,
    insightsDe: insightsDe || draft.insights,
    insightsTopic: 'culture',
    usefulScore: Math.max(quality.score, 50),
    usefulReasons: [
      ...(quality.reasons || []),
      'editor_sarcasm',
      'telegram_column',
      ...(bodyPolish.infoScore != null ? [`krrkt:${bodyPolish.infoScore}`] : [])
    ],
    editorialScore: bodyPolish.editorialScore ?? bodyPolish.infoScore,
    editorialOk,
    publishOk,
    articleType: 'editor_sarcasm',
    usedLlm
  };
}
