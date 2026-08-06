/**
 * Birthday tattoo article composer + LLM editor.
 * SEO target: plain-language articles ≥ 3500 characters with glossary footnotes.
 */
import { birthProfile, zodiacSearchSlug } from './news-zodiac.js';
import { fetchTattooGalleryImages, fetchStyleMatchedGallery, galleryToMarkdown } from './news-yandex-images.js';
import { pickFormatImage, articleTypeForTopic } from './news-format-bodies.js';
import { editorialSystemPrompt, polishEditorialText, passesEditorialGate } from './news-text-polish.js';
import { llmChat, isLlmAvailable, unloadModel } from './news-llm.js';
import { localizeBundle, translateText } from './translate.js';
import { nextBirthdayTopic, buildBirthdayTopic } from './news-birthday-topics.js';
import {
  formatStyleBullet,
  glossaryMarkdown,
  plainTextLen,
  BIRTHDAY_MIN_CHARS,
  resolveStyle,
  buildStyleImageQueries
} from './news-glossary.js';
import { buildBirthdayBanner } from './news-magazine-images.js';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __composeDir = dirname(fileURLToPath(import.meta.url));
const PUBLIC_ROOT = join(__composeDir, '../public');

function imageFileExists(src) {
  const clean = String(src || '')
    .replace(/^https?:\/\/sitrifor\.ru/i, '')
    .split('?')[0]
    .replace(/^\//, '');
  return Boolean(clean) && existsSync(join(PUBLIC_ROOT, clean));
}

export const BIRTHDAY_EDITOR_STYLE = `${editorialSystemPrompt('birthday')}

Специализация: длинные SEO-статьи «тату по дате рождения» для клиента, который выбирает первую или новую татуировку.
Цель – польза и ясность: знак зодиака, китайский год, характер именно этого дня, стили и мотивы «на удачу».

Уникальность даты (обязательно):
- День месяца – отдельный слой характера, не копия общего текста знака. Соседние даты (например 03.01 и 07.01) одного знака и года должны читаться как разные люди.
- Сначала опиши день рождения и число судьбы / декаду (из фактов в задании), затем общий знак. Нельзя свести статью к «все Козероги одинаковы».
- Мотивы, акценты характера и советы по стилю бери из фактов именно этой даты; не переноси шаблон соседней даты, меняя только цифры в дате.
- Запрещено писать взаимозаменяемый текст, где достаточно заменить DD.MM – каждая статья должна содержать уникальные формулировки дня.

Пиши простым русским. Если нужен студийный термин (fine line, blackwork, флэш) – сразу дай короткое определение в скобках или вынеси в раздел «Словарь простых определений».
Не обещай магическую защиту. Формулируй: «часто выбирают», «символически связывают», «подойдёт, если откликается».
Объём текста без картинок – не меньше ${BIRTHDAY_MIN_CHARS} знаков (пробелы считаются). Лучше 3800–5200.
Сохраняй markdown-заголовки ## и списки • .
Не повторяй одну и ту же фразу в списках. У каждого пункта списка – своё короткое пояснение, без копипаста хвостов вроде «как личный талисман».
Не копируй один абзац дважды.
Не вставляй картинки и URL – галерею добавит парсер.
Подписи галереи вида «Стиль: neo-traditional · …» должны совпадать с текстом стилей:
- neo-traditional / новый традиционный / акварель / цветной реализм – это ЦВЕТНЫЕ работы (насыщенный цвет, не чёрно-белые линии);
- blackwork / тонкая линия / геометрия / чёрно-серый – без цветной заливки.
Не описывай стиль как «насыщенный цвет», если в фактах стиля указано иное; и наоборот – для неотрада всегда подчёркивай цвет и чёткий контур.
Только короткое тире –. Без англоязычных названий стилей без перевода.`;

function bullets(items) {
  return items.map((x) => `• ${x}`).join('\n');
}

/** Unique plain reasons for luck motifs – never reuse the same tail in one list. */
const MOTIF_REASONS = [
  [/гора|вершин/, 'символ пути вверх и долгой работы над целью'],
  [/козерог|коз[её]л|баран|рог/, 'узнаваемый силуэт знака – если хотите «свой» зодиакальный маркер'],
  [/ключ(?!\s*и\s*замок)/, 'образ доступа к новому этапу или личного решения'],
  [/ключ\s*и\s*замок|замок/, 'парный мотив про связь и выбор: открыть или сохранить'],
  [/дат|римск|цифр/, 'личная метка времени без лишней мистики'],
  [/геометр|ось|круг|спираль/, 'порядок и ясная структура – близко характеру знака'],
  [/лун|полумесяц/, 'мягкий ночной образ для спокойного акцента'],
  [/роз|цвет(?:ок|ы)?|ботаник|лист|колос|пшениц|лотос|бамбук/, 'живой природный мотив, который удобно посадить на тело'],
  [/компас|карта|маршрут|дорог|стрел|лук/, 'мотив пути и выбора направления'],
  [/солнц|огон|факел|молн/, 'энергия и заметный акцент на коже'],
  [/рыб|волн|океан|медуз|раковин/, 'водный образ, мягкий по настроению'],
  [/феникс|змея|скорпион|кинжал/, 'образ перемен и силы – берите, только если откликается лично'],
  [/маск|театр/, 'игра ролей и самовыражение без буквального портрета'],
  [/монет|удач|узел|подков/, 'народный символ удачи, если вам близок такой язык образов'],
  [/обезьян/, 'живой, подвижный персонаж года – лучше лёгкий силуэт, чем перегруз деталями'],
  [/фрукт|яблок|персик|гранат/, 'тёплый бытовой символ изобилия; хорошо смотрится в тонкой линии'],
  [/бык|тигр|дракон|лошад|собак|свинь|кролик|крыс|петух|коз[аы]/, 'животное китайского года как персонаж, а не «обязательный» тотем'],
  [/лев|краб|водолей|весы|близнец/, 'прямой символ знака – берите, если хотите узнаваемость с первого взгляда'],
  [/сердц|дом/, 'личный якорь: семья, дом, близкие – смысл важнее декора'],
  [/перо/, 'лёгкий воздушный акцент, часто для тонкой линии и надписей рядом'],
  [/бабочк/, 'образ перемен и лёгкости; удобен для парных или симметричных композиций'],
  [/корон/, 'акцент на достоинстве – лучше сдержанный размер, чтобы не кричало'],
  [/звезд|созвезди/, 'небольшой «космический» акцент без тяжёлого сюжета'],
  [/щит/, 'образ защиты и верности – спокойный, если без лишней агрессии'],
  [/чаш|часы/, 'бытовой символ времени или достатка – уточните личную историю'],
  [/облак|ветер/, 'фон и настроение, а не главный герой рисунка'],
  [/украшен|камея/, 'декоративный акцент «под ювелирку» – важен вкус мастера к деталям']
];

const FALLBACK_REASONS = [
  'спокойный личный символ, если откликается без давления гороскопа',
  'удачный кандидат на маленький акцент, который не устареет через год',
  'можно взять как основу эскиза или как деталь к более крупному сюжету',
  'подходит, если хотите смысл, а не случайную картинку из ленты',
  'хороший старт для разговора с мастером: «вот это близко, вот это – нет»',
  'берите только при личном отклике – таблица знаков не важнее вашего вкуса',
  'часто выбирают как тихий талисман, а не как главный «кричащий» мотив',
  'удобно комбинировать с датой или коротким словом, если нужен личный слой'
];

export function motifWhy(motif, westernName, used = null) {
  const m = String(motif || '').toLowerCase();
  let reason = null;
  for (const [re, text] of MOTIF_REASONS) {
    if (re.test(m)) {
      reason = text;
      break;
    }
  }
  if (!reason) {
    reason = `мотив, который часто связывают со знаком ${westernName} – берите при личном отклике`;
  }
  if (used instanceof Set) {
    if (used.has(reason)) {
      for (const alt of FALLBACK_REASONS) {
        if (!used.has(alt)) {
          reason = alt;
          break;
        }
      }
      // last resort: make unique by motif label
      if (used.has(reason)) {
        reason = `${reason} (${String(motif).split('/')[0].trim()})`;
      }
    }
    used.add(reason);
  }
  return reason;
}

export function formatLuckyMotifBullets(motifs, westernName) {
  const used = new Set();
  return bullets(
    (motifs || []).map((m) => `${m} – ${motifWhy(m, westernName, used)}`)
  );
}

/**
 * Fix repeated bullet tails like "… – как личный талисман" x N.
 * Rewrites duplicate suffixes with motifWhy when a luck-section pattern is detected.
 */
export function dedupeBulletTails(text = '', { westernName = 'вашего знака' } = {}) {
  const lines = String(text || '').split('\n');
  const bulletRe = /^([ \t]*[•\-*]\s+)(.+?)\s+[–—-]\s+(.+)$/;
  const groups = [];
  let i = 0;
  while (i < lines.length) {
    if (!bulletRe.test(lines[i])) {
      i += 1;
      continue;
    }
    const start = i;
    const items = [];
    while (i < lines.length && bulletRe.test(lines[i])) {
      const m = lines[i].match(bulletRe);
      items.push({ raw: lines[i], prefix: m[1], head: m[2].trim(), tail: m[3].trim() });
      i += 1;
    }
    groups.push({ start, end: i, items });
  }

  for (const g of groups) {
    if (g.items.length < 3) continue;
    const tailCounts = new Map();
    for (const it of g.items) {
      tailCounts.set(it.tail, (tailCounts.get(it.tail) || 0) + 1);
    }
    const dominant = [...tailCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!dominant || dominant[1] < 3) continue;
    // Rewrite whole group with unique reasons
    const used = new Set();
    for (let k = 0; k < g.items.length; k++) {
      const it = g.items[k];
      const why = motifWhy(it.head, westernName, used);
      lines[g.start + k] = `${it.prefix}${it.head} – ${why}`;
    }
  }
  return lines.join('\n');
}

/**
 * Drop near-duplicate paragraphs (same text twice in a row / same block copied).
 */
export function stripRepeatedParagraphs(text = '') {
  const parts = String(text || '').split(/\n{2,}/);
  const out = [];
  let prev = '';
  for (const p of parts) {
    const norm = p.replace(/\s+/g, ' ').trim().toLowerCase();
    if (norm && norm === prev) continue;
    // also skip if identical to any recent short paragraph
    if (norm.length > 40 && out.some((o) => o.replace(/\s+/g, ' ').trim().toLowerCase() === norm)) {
      continue;
    }
    out.push(p);
    prev = norm;
  }
  return out.join('\n\n');
}

/**
 * Rich deterministic body (SEO fallback and length floor).
 */
export function buildBirthdayBody(topic, profile, images = []) {
  const { western, chinese, luckyMotifs, styles, dateRu, placement } = profile;
  const dayProfile = profile.dayProfile || {};
  const birthNumber = profile.birthNumber || {};
  const decan = profile.decan || {};
  const styleLabels = styles.map((s) => resolveStyle(s).label);
  const galleryMd = galleryToMarkdown(images, 'Примеры татуировок по стилям');
  const places = placement || western.placement || ['предплечье', 'плечо', 'икра'];
  const dayTraits = profile.dayTraits || dayProfile.traits || [];
  const uniqueTraits = profile.uniqueTraits || dayTraits;

  const sections = [
    `Если вы родились ${dateRu}, этот материал поможет выбрать татуировку с опорой на дату: не только знак зодиака и китайский год, но и характер именно вашего дня месяца – люди одного знака заметно различаются по числу рождения.`,
    '',
    'Мы не обещаем магический эффект. Речь о понятных идеях для разговора с мастером: что набить, в каком настроении и в каком стиле рисунка, чтобы результат был вашим, а не чужим шаблоном из ленты.',
    '',
    '## День рождения и характер',
    `Число дня – ${dayProfile.day || profile.day}. В популярной астрологии дня это отдельный слой характера рядом со знаком «${western.name}».`,
    dayProfile.character || western.character,
    '',
    `Настроение эскиза для вашего дня: ${dayProfile.mood || 'спокойное и личное'}. Черты дня: ${(dayTraits.length ? dayTraits : western.traits).join(', ')}.`,
    '',
    `Число судьбы по дате (сумма цифр ${dateRu}) – ${birthNumber.label || 'личное число'}: ${(birthNumber.traits || []).join(', ')}. ${birthNumber.note || ''}`.trim(),
    '',
    `По положению в знаке это ${decan.name || 'середина знака'}: ${decan.accent || 'уточняйте личный акцент у себя, а не только по таблице знака.'}`,
    profile.cusp ? `${profile.cusp}` : '',
    '',
    '## Знак зодиака',
    `Ваш западный знак – ${western.name} ${western.symbol}. В традиции гороскопов его относят к стихии «${western.element}» (стихия – условная группа знака: огонь, земля, воздух или вода; это образ настроения, не диагноз).`,
    `Планету, с которой знак связывают, называют управителем: у ${western.name} это ${western.planet}. Для выбора татуировки это скорее подсказка тона – строгий, мягкий, яркий или спокойный – а не инструкция «обязательно набить планету».`,
    '',
    western.character,
    '',
    `Общие черты знака «${western.name}»: ${western.traits.join(', ')}. Сложите их с чертами вашего дня (${(dayTraits.slice(0, 3) || []).join(', ') || 'см. выше'}): в эскизе усильте 1–2 близких акцента и сознательно приглушите то, что вам чуждо.`,
    '',
    '## Китайский знак',
    `${chinese.year} год в восточном календаре связывают с образом «${chinese.name}» ${chinese.emoji}. Это ещё один слой символики рядом с западным знаком и днём месяца, а не «второй гороскоп вместо первого».`,
    `В популярных описаниях года ${chinese.name} часто отмечают: ${chinese.traits.join(', ')}. Если какой-то из этих акцентов вам откликается – его можно мягко отразить в мотиве (животное года, деталь характера, спокойный фон). Если не откликается – спокойно отбросьте.`,
    '',
    'Сочетание удобно читать так: день задаёт личный характер, западный знак – тон линии и стиля, китайский год – дополнительный персонаж или деталь. Не смешивайте в одном маленьком рисунке всё сразу: лучше один ясный символ, чем перегруженный коллаж.',
    '',
    '## Характер и настроение эскиза',
    `Сводка для мастера по дате ${dateRu}: ${(uniqueTraits || []).join(', ') || western.traits.join(', ')}. Переведите это на язык татуировки простыми вопросами:`,
    bullets([
      `Рисунок ближе к настроению дня («${dayProfile.mood || 'личное'}») или к общему тону знака «${western.name}»?`,
      'Нужен один символ или короткий сюжет?',
      'Важнее смысл для себя или заметность для окружающих?',
      'Цвет нужен или достаточно чёрного и серого?'
    ]),
    '',
    'Хороший тон разговора: «мне близки черты дня и такие-то акценты знака, хочу отразить вот это, вот это – не трогаем». Так мастер быстрее предложит 2–3 варианта наброска без давления «гороскоп сказал».',
    '',
    '## Какие татуировки принесут удачу',
    'Ниже – мотивы, собранные под вашу дату (сначала акценты дня, затем знак и год). У каждого свой смысл; это идеи для эскиза, а не обещание судьбы:',
    formatLuckyMotifBullets(luckyMotifs, western.name),
    '',
    'Как выбрать из списка: отметьте два мотива, которые «ваши» эмоционально, и один запасной. Покажите мастеру примеры (референс – фото или картинка для ориентира) в похожем настроении, а не в точности «скопируйте чужую работу».',
    '',
    'Если мотив из списка вас раздражает или кажется чужим – это нормальный сигнал отказаться. Удача в татуировке начинается с согласия с собой, а не с таблицы знаков.',
    '',
    '## Стилистика, которая подойдёт',
    `Для даты ${dateRu} (день + знак «${western.name}») обычно хорошо заходят направления ниже. Названия даём по-русски и студийным термином; ниже в галерее – пример под каждый стиль:`,
    bullets(styles.map((s) => formatStyleBullet(s))),
    '',
    `Практичный выбор на первую консультацию: ${styleLabels.slice(0, 2).join(' или ')}. Попросите мастера показать в портфолио зажившие работы именно в этом направлении – так вы увидите итог после заживления (заживление – период восстановления кожи после сеанса).`,
    '',
    '## Куда лучше разместить',
    `Стартовые зоны для вашей даты: ${places.join(', ')}. Это не правило, а ориентир по читаемости и комфорту сеанса.`,
    bullets([
      'Маленький символ – запястье, лодыжка, ключица: быстрее сеанс, проще спрятать под одеждой',
      'Средний мотив – предплечье, плечо, икра: баланс заметности и ухода',
      'Крупный сюжет – бедро, спина, грудь: нужен опыт мастера и запас времени на сеансы'
    ]),
    '',
    'Уточните посадку: как рисунок ляжет на мышцу в движении. Красивая картинка на плоском экране не всегда так же выглядит на живом теле.',
    galleryMd,
    '',
    '## Как обсудить с мастером',
    bullets([
      `Назовите дату ${dateRu}, день (${dayProfile.day || profile.day}), знак ${western.name} и год ${chinese.name} – как отправную точку, не как догму`,
      `Опишите характер дня своими словами: ${(dayTraits.slice(0, 2) || ['личный акцент']).join(', ')}`,
      'Покажите 1–2 мотива «на удачу» и один запасной из списка выше',
      `Зафиксируйте стиль: ${styleLabels.slice(0, 2).join(' или ')}`,
      'Договоритесь о размере в сантиметрах и зоне до отрисовки наброска',
      'Спросите про уход в первые две недели и что будет с линией через год',
      'Если мотив «не ваш» эмоционально – откажитесь без давления гороскопа'
    ]),
    '',
    'Полезный мини-бриф, который можно отправить мастеру в сообщении:',
    bullets([
      `Дата рождения: ${dateRu}`,
      `День / число судьбы: ${dayProfile.day || profile.day}; ${birthNumber.label || ''}`.replace(/; $/, ''),
      `Знак: ${western.name}; китайский год: ${chinese.name}`,
      `Настроение дня: ${dayProfile.mood || western.traits.slice(0, 2).join(', ')}`,
      `Мотивы: ${luckyMotifs.slice(0, 2).join('; ')}`,
      `Стиль: ${styleLabels.slice(0, 2).join(' / ')}`,
      `Зона: ${places[0]} (запасная: ${places[1] || places[0]})`
    ]),
    '',
    glossaryMarkdown(styles),
    '## Важно',
    'Материал – идея для свободных эскизов и разговора с клиентом, не гороскоп и не медицинский совет. Клиентам младше 14 лет такие темы не предлагаем. Примеры в галерее собраны из открытого поиска по запросам знака и служат ориентиром стиля, а не копией для точного повтора.',
    '',
    'Перед сеансом уточните у мастера стерильность, опыт в выбранном стиле и правила записи. Если есть вопросы по коже или противопоказаниям – это зона врача, не редакции и не астрологии.',
    '',
    '_Материал редакции Sitrifor. Не юридическая и не медицинская консультация: сверяйте нормы и клинику у профильных специалистов._'
  ];

  return sections.filter((x) => x != null && String(x).trim() !== '').join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function llmPrompt(profile, topic) {
  const { western, chinese, luckyMotifs, styles, dateRu, placement } = profile;
  const dayProfile = profile.dayProfile || {};
  const birthNumber = profile.birthNumber || {};
  const decan = profile.decan || {};
  const styleHints = styles.map((s) => formatStyleBullet(s)).join('\n');
  return `Напиши markdown-статью для клиента тату-студии. Простой русский язык. SEO-объём.
Статья должна быть УНИКАЛЬНОЙ для этой даты: нельзя получить соседнюю дату простой заменой цифр.

Дата рождения: ${dateRu}
Заголовок темы: ${topic.title}

ФАКТЫ ДНЯ (обязательно раскрыть в тексте, своими словами):
- Число дня: ${dayProfile.day || profile.day}
- Характер дня: ${dayProfile.character || ''}
- Настроение эскиза дня: ${dayProfile.mood || ''}
- Черты дня: ${(profile.dayTraits || dayProfile.traits || []).join(', ')}
- Число судьбы: ${birthNumber.label || ''} (цифры ${birthNumber.n || ''}) – черты: ${(birthNumber.traits || []).join(', ')}. Подсказка: ${birthNumber.note || ''}
- Декада знака: ${decan.name || ''} – ${decan.accent || ''}
${profile.cusp ? `- Куспид / край знака: ${profile.cusp}` : ''}

Знак зодиака (общий фон, не замена дня): ${western.name} (стихия «${western.element}», управитель ${western.planet})
Общие черты знака: ${western.traits.join(', ')}
Китайский знак: ${chinese.name} (${chinese.year}), черты: ${chinese.traits.join(', ')}
Сводка уникальных акцентов даты: ${(profile.uniqueTraits || []).join(', ')}
Мотивы на удачу (уже подобраны под дату – используй именно их, в этом порядке приоритета): ${luckyMotifs.join(', ')}
Стили (уже с определениями – используй русские названия):
${styleHints}
Зоны: ${(placement || []).join(', ')}

Структура строго:
лид 3–5 предложений без заголовка (упомяни, что день месяца меняет характер внутри знака)
## День рождения и характер
## Знак зодиака
## Китайский знак
## Характер и настроение эскиза
## Какие татуировки принесут удачу
## Стилистика, которая подойдёт
## Куда лучше разместить
## Как обсудить с мастером
## Словарь простых определений
## Важно

Правила языка:
- любой студийный термин сразу объясняй в скобках или в словаре;
- не пиши fine line / blackwork / neo-trad без русского названия рядом;
- не используй слова «флэш», «референс», «посадка» без короткого определения при первом упоминании;
- в разделе «День рождения и характер» не копируй абзац общего знака – опиши именно день ${dayProfile.day || profile.day};
- сравнивать «все ${western.name}» нельзя: подчеркни отличие дня от шаблона знака.

В разделе про удачу – 6–8 мотивов списком • ; у КАЖДОГО пункта своё пояснение «зачем», без повтора одной фразы.
Запрещено копировать один хвост на все пункты (например «как личный талисман» восемь раз).
В стилистике – 3–4 стиля списком • с понятным объяснением (тоже без копипаста).
У каждого стиля должно быть уникальное описание; не пиши одну фразу «хорошо читается на коже» на все пункты.
Если в списке есть «новый традиционный / neo-traditional» – обязательно пиши про насыщенный цвет и чёткий контур (не про чёрно-белые линии).
Если есть blackwork / тонкая линия / геометрия – не обещай цветную заливку.
В галерее будут примеры с подписями вида «Стиль: blackwork · ${western.name}» – в тексте стилей используй те же направления и ту же палитру (цвет vs ч/б).
В словаре – 6–10 пунктов • с определениями.
В «Важно» напомни: идея для эскиза, не гороскоп и не медсовет.
Объём текста без картинок – минимум ${BIRTHDAY_MIN_CHARS} знаков, лучше 4000–5000.
Не добавляй картинки и URL.`;
}

/**
 * Call LLM editor; fall back to template if short / incomplete.
 */
export async function writeBirthdayWithLlm(topic, profile, { useLlm = true } = {}) {
  const template = buildBirthdayBody(topic, profile, []);
  if (!useLlm || process.env.NEWS_BIRTHDAY_LLM === '0') {
    return { body: template, usedLlm: false };
  }
  const available = await isLlmAvailable();
  if (!available) return { body: template, usedLlm: false };

  const raw = await llmChat(
    [
      { role: 'system', content: BIRTHDAY_EDITOR_STYLE },
      { role: 'user', content: llmPrompt(profile, topic) }
    ],
    {
      timeoutMs: Number(process.env.NEWS_BIRTHDAY_LLM_TIMEOUT_MS || 240000),
      options: {
        temperature: Number(process.env.NEWS_BIRTHDAY_LLM_TEMP || 0.62),
        num_ctx: Number(process.env.OLLAMA_NUM_CTX || 4096)
      },
      rewrite: false,
      // Composer polishes + gates itself; skip early finalize so long SEO drafts survive
      finalize: false
    }
  );

  if (!raw || plainTextLen(raw) < Math.min(1200, BIRTHDAY_MIN_CHARS * 0.45)) {
    return { body: template, usedLlm: false };
  }
  if (!/##\s*Какие татуировки принесут удачу/i.test(raw) || !/##\s*Знак зодиака/i.test(raw)) {
    return { body: template, usedLlm: false };
  }
  if (!/##\s*День рождения и характер/i.test(raw)) {
    console.warn('[birthday] llm missing day section, using template');
    return { body: template, usedLlm: false };
  }

  // If LLM under-delivers length, keep template (already SEO-sized + plain language)
  if (plainTextLen(raw) < BIRTHDAY_MIN_CHARS) {
    console.warn('[birthday] llm too short, using template', {
      llmChars: plainTextLen(raw),
      min: BIRTHDAY_MIN_CHARS
    });
    return { body: template, usedLlm: false };
  }

  // Ensure glossary exists
  let body = raw;
  if (!/##\s*Словарь/i.test(body)) {
    body = body.replace(/##\s*Важно/i, `${glossaryMarkdown(profile.styles)}\n## Важно`);
  }
  return { body, usedLlm: true };
}

function injectGallery(body, images) {
  const md = galleryToMarkdown(images, 'Примеры татуировок по стилям');
  // Strip any previous gallery / dead image cluster
  let next = String(body || '').replace(/##\s*Примеры татуировок[\s\S]*?(?=\n##\s|\n_Материал|$)/gi, '\n');
  next = next.replace(/##\s*Подготовка и уход[\s\S]*?(?=\n##\s|\n_Материал|$)/gi, '\n');

  if (!md) {
    const care = [
      '',
      '## Подготовка и уход',
      '',
      'Подходящих фото-примеров стилей сейчас нет – лучше честный пробел, чем случайная нерелевантная картинка.',
      '',
      'В Sitrifor собраны чек-листы подготовки к сеансу и ухода после татуировки. Откройте [блок ухода на сайте](/masters#care) или приложение – там по шагам: что сделать до сеанса и как пройти заживление.',
      '',
      '![Уход и подготовка к тату – Sitrifor](/img/marketing/card-care.jpg)',
      ''
    ].join('\n');
    if (/##\s*Как обсудить с мастером/i.test(next)) {
      return next.replace(/##\s*Как обсудить с мастером/i, `${care}\n## Как обсудить с мастером`);
    }
    if (/##\s*Словарь/i.test(next)) {
      return next.replace(/##\s*Словарь/i, `${care}\n## Словарь`);
    }
    if (/##\s*Важно/i.test(next)) {
      return next.replace(/##\s*Важно/i, `${care}\n## Важно`);
    }
    return `${next.trim()}\n\n${care.trim()}`;
  }

  if (/##\s*Как обсудить с мастером/i.test(next)) {
    return next.replace(/##\s*Как обсудить с мастером/i, `${md.trim()}\n\n## Как обсудить с мастером`);
  }
  if (/##\s*Словарь/i.test(next)) {
    return next.replace(/##\s*Словарь/i, `${md.trim()}\n\n## Словарь`);
  }
  if (/##\s*Важно/i.test(next)) {
    return next.replace(/##\s*Важно/i, `${md.trim()}\n\n## Важно`);
  }
  return `${next.trim()}\n\n${md.trim()}`;
}

function insightsFor(profile) {
  const styleLabels = (profile.styles || []).slice(0, 2).map((s) => resolveStyle(s).label);
  const dayMood = profile.dayProfile?.mood || profile.mood || '';
  return `Кратко: ${profile.dateRu} – день ${profile.dayProfile?.day || profile.day} (${dayMood}), знак ${profile.western.name}, год ${profile.chinese.name}. Мотивы: ${profile.luckyMotifs.slice(0, 3).join(', ')}. Стили: ${styleLabels.join(', ')}.`;
}

/**
 * Compose full birthday article payload (ready for publishComposed).
 */
export async function composeBirthdayArticle(state = {}, opts = {}) {
  const hour = opts.hour || new Date().toISOString().slice(0, 13);
  const localize = opts.localize !== false && process.env.NEWS_BIRTHDAY_LOCALIZE !== '0';
  const useLlm = opts.useLlm !== false;
  const imageLimit = Number(opts.imageLimit || process.env.NEWS_BIRTHDAY_IMG_LIMIT || 6);
  const minChars = Number(opts.minChars || BIRTHDAY_MIN_CHARS);

  let topic;
  let nextCursor;
  if (opts.month && opts.day && opts.year) {
    topic = buildBirthdayTopic(opts.month, opts.day, opts.year);
    nextCursor = state.bdayCursor ?? 0;
  } else {
    const next = nextBirthdayTopic(state);
    topic = next.topic;
    nextCursor = next.nextCursor;
  }

  const profile = birthProfile(topic.birthday.month, topic.birthday.day, topic.birthday.year);
  const slug = zodiacSearchSlug(profile);

  let images = [];
  try {
    const styleQueries = buildStyleImageQueries({
      styles: profile.styles,
      signName: profile.western.name,
      signId: profile.western.id,
      motif: profile.luckyMotifs[0] || profile.western.name
    });
    images = await fetchStyleMatchedGallery({
      styleQueries,
      slug,
      perStyle: Number(process.env.NEWS_BIRTHDAY_PER_STYLE || 2),
      force: Boolean(opts.forceImages)
    });
    // Ensure a choosable set for the reader (not a single weak frame)
    const galleryFloor = Number(process.env.NEWS_BIRTHDAY_GALLERY_MIN || 6);
    if (images.length < galleryFloor) {
      const extra = await fetchTattooGalleryImages({
        queries: [
          ...profile.imageQueries,
          `beautiful tattoo on skin healed portfolio`,
          `professional tattoo forearm healed studio`
        ],
        slug,
        limit: galleryFloor + 2,
        force: Boolean(opts.forceImages)
      });
      for (const img of extra) {
        if (images.some((x) => x.src === img.src)) continue;
        if (!imageFileExists(img.src)) continue;
        images.push({
          ...img,
          alt: img.alt || `Пример тату · ${profile.western.name}`
        });
        if (images.length >= galleryFloor) break;
      }
    }
  } catch (err) {
    console.warn('[birthday] image fetch failed', err.message || err);
  }

  // Drop broken / purged cache paths so we never publish dead gallery URLs
  images = (images || []).filter((img) => img?.src && imageFileExists(img.src));

  const { body: rawBody, usedLlm } = await writeBirthdayWithLlm(topic, profile, { useLlm });
  // Polish text without gallery first – deep polish can mangle image alts
  let bodyNoGallery = rawBody
    .replace(/##\s*Примеры татуировок[\s\S]*?(?=\n##\s|\n_Материал|$)/gi, '')
    .replace(/!\[[^\]]*\]\([^)\s]+\)\n*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  bodyNoGallery = stripRepeatedParagraphs(bodyNoGallery);
  bodyNoGallery = dedupeBulletTails(bodyNoGallery, { westernName: profile.western.name });
  const bodyPolish = polishEditorialText(bodyNoGallery, { deep: opts.deepPolish !== false });
  // Polish can reintroduce sameness in rare cases – run dedupe again on polished text
  let polishedText = dedupeBulletTails(stripRepeatedParagraphs(bodyPolish.text), {
    westernName: profile.western.name
  });
  let body = injectGallery(polishedText, images);

  let chars = plainTextLen(body);
  if (chars < minChars) {
    // Hard floor for SEO: rebuild from expanded template
    console.warn('[birthday] body below SEO floor, rebuilding template', { chars, minChars });
    const rebuilt = polishEditorialText(buildBirthdayBody(topic, profile, []), {
      deep: opts.deepPolish !== false
    });
    polishedText = dedupeBulletTails(stripRepeatedParagraphs(rebuilt.text), {
      westernName: profile.western.name
    });
    body = injectGallery(polishedText, images);
    chars = plainTextLen(body);
  }

  const lengthOk = chars >= minChars;
  const summarySeed = `Какие татуировки принесут удачу родившимся ${profile.dateRu}: характер дня ${profile.dayProfile?.day || profile.day}, знак ${profile.western.name}, год ${profile.chinese.name}, мотивы и стили под вашу дату – для разговора с мастером.`;
  const summary = polishEditorialText(summarySeed, { soft: true, deep: true, gate: false }).text;
  const title = topic.title;

  let loc = {
    titleEn: '',
    summaryEn: '',
    bodyEn: '',
    titleDe: '',
    summaryDe: '',
    bodyDe: ''
  };
  if (localize) {
    loc = await localizeBundle({ title, summary, body, sourceLang: 'ru' });
  } else {
    loc.titleEn = (await translateText(title, 'en')) || '';
    loc.summaryEn = (await translateText(summary, 'en')) || '';
    loc.titleDe = (await translateText(title, 'de')) || '';
    loc.summaryDe = (await translateText(summary, 'de')) || '';
  }

  const insightsRu = polishEditorialText(insightsFor(profile), { deep: true, gate: false }).text;
  const editorialOk = passesEditorialGate(bodyPolish) && lengthOk;

  let cover =
    images[0]?.src
      ? images[0].src.startsWith('http')
        ? images[0].src
        : `https://sitrifor.ru${images[0].src}`
      : pickFormatImage(topic, nextCursor);

  let bannerUrl = null;
  try {
    const banner = await buildBirthdayBanner({
      images,
      outName: `${topic.id}.jpg`,
      title: topic.title,
      kicker: 'Тату по дате рождения',
      sign: profile.western?.name || '',
      dateRu: profile.dateRu,
      force: Boolean(opts.forceImages || opts.forceBanner)
    });
    if (banner?.url) {
      bannerUrl = banner.url.startsWith('http') ? banner.url : `https://sitrifor.ru${banner.url}`;
      cover = bannerUrl;
    }
  } catch (err) {
    console.warn('[birthday] banner build failed', err.message || err);
  }

  return {
    composed: {
      topicId: topic.id,
      title,
      summary,
      body,
      imageUrl: cover,
      categories: topic.categories || ['for_clients'],
      articleType: articleTypeForTopic(topic),
      titleRu: title,
      summaryRu: summary,
      bodyRu: body,
      titleEn: loc.titleEn,
      summaryEn: loc.summaryEn,
      bodyEn: loc.bodyEn,
      titleDe: loc.titleDe,
      summaryDe: loc.summaryDe,
      bodyDe: loc.bodyDe,
      insightsRu,
      insightsEn: localize ? await translateText(insightsRu, 'en') : '',
      insightsDe: localize ? await translateText(insightsRu, 'de') : '',
      insightsTopic: 'for_clients',
      usefulScore: lengthOk ? 88 : 60,
      usefulReasons: [
        'birthday_tattoo',
        `topic:${topic.id}`,
        'format:birthday_tattoo',
        `zodiac:${profile.western.id}`,
        `chinese:${profile.chinese.id}`,
        usedLlm ? 'llm:birthday_editor' : 'template:birthday_editor',
        images.length ? `gallery:${images.length}` : 'gallery:0',
        bannerUrl ? 'banner:collage' : 'banner:none',
        `chars:${chars}`,
        lengthOk ? 'seo_len_ok' : 'seo_len_fail',
        ...(bodyPolish.infoScore != null ? [`krrkt:${bodyPolish.infoScore}`] : [])
      ],
      editorialScore: bodyPolish.editorialScore ?? bodyPolish.infoScore,
      editorialOk,
      publishOk: editorialOk,
      guid: opts.guid || `hourly:${hour}:${topic.id}`,
      publishedAt: new Date().toISOString(),
      galleryImages: images,
      bannerUrl,
      birthdayProfile: {
        dateRu: profile.dateRu,
        western: profile.western.name,
        chinese: profile.chinese.name,
        styles: profile.styles.map((s) => resolveStyle(s).label),
        luckyMotifs: profile.luckyMotifs,
        chars
      },
      usedLlm,
      chars
    },
    nextCursor,
    topic,
    profile,
    images
  };
}

export { unloadModel, plainTextLen, BIRTHDAY_MIN_CHARS };
