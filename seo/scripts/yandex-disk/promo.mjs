/**
 * Promo copy for socials: TikTok / Instagram / LinkedIn / VK.
 * Promotes 634 app + sitrifor.ru. Short hyphen style only.
 */

const APP_STORE = 'https://apps.apple.com/ru/app/634/id6795944683';
const SITE = 'https://sitrifor.ru';
const MASTERS = 'https://sitrifor.ru/masters#app';
const HUB_634 = 'https://sitrifor.ru/634/';

const BASE_TAGS = [
  '#тату',
  '#татуировка',
  '#татумастер',
  '#tattoo',
  '#tattooartist',
  '#эскиз',
  '#tattooflash',
  '#634app',
  '#sitrifor',
  '#приложениедлятатумастера'
];

function colorLabel(color) {
  if (color === 'bw') return 'чёрно-белая';
  return 'цветная';
}

/** Prepositional case for «на …» */
const BODY_LOCATIVE = {
  arm: 'руке',
  hand: 'кисти',
  leg: 'ноге',
  foot: 'стопе',
  back: 'спине',
  chest: 'груди',
  neck: 'шее',
  rib: 'рёбрах',
  head: 'голове',
  other: 'теле'
};

function bodyOn(body) {
  return BODY_LOCATIVE[body] || 'теле';
}

function bodyLabel(body, bodyRu) {
  return bodyRu || body || 'тело';
}

function titleLine({ title, style }) {
  if (title && style) return `${title} · ${style}`;
  if (title) return title;
  if (style) return style;
  return 'Проект тату';
}

/**
 * @param {object} p
 * @param {string} [p.title]
 * @param {string} [p.style] - neo-trad, realism, ornamental...
 * @param {'color'|'bw'} [p.color]
 * @param {string} [p.body]
 * @param {string} [p.bodyRu]
 * @param {string} [p.notes] - free form from user / vision
 */
export function buildPromo(p = {}) {
  const title = titleLine(p);
  const color = colorLabel(p.color);
  const body = bodyLabel(p.body, p.bodyRu);
  const bodyPrep = bodyOn(p.body);
  const notes = (p.notes || '').trim();

  const tags = [
    ...BASE_TAGS,
    p.color === 'bw' ? '#blackwork' : '#colortattoo',
    bodyHashtag(p.body),
    styleHashtag(p.style)
  ].filter(Boolean);

  const tiktok = [
    `${title}`,
    '',
    `Эскиз → ${color} тату на ${bodyPrep}.`,
    notes || 'От идеи до сеанса - один проект в 634.',
    '',
    `Приложение для тату-мастера 634: проекты, пигменты, склад краски.`,
    `Сайт: sitrifor.ru`,
    '',
    tags.join(' ')
  ].join('\n');

  const instagram = [
    `${title}`,
    '',
    `Сначала эскиз, потом живая татуировка на ${bodyPrep} (${color}).`,
    notes || 'В 634 этот проект лежит целиком: эскиз, палитра, заметки к сеансу.',
    '',
    `634 - приложение для тату-мастера. Не заменяет онлайн-запись и кассу студии.`,
    `Подробнее: ${HUB_634}`,
    `App Store: ${APP_STORE}`,
    '',
    'Сохраните пост в избранное, если собираете референсы.',
    '',
    tags.join(' ')
  ].join('\n');

  const vk = [
    `${title}`,
    '',
    `Показываем путь проекта: эскиз и готовая ${color} татуировка (${body}).`,
    notes || '',
    '',
    `Если ведёте проекты, пигменты и склад краски в телефоне - посмотрите 634.`,
    `Сайт Sitrifor: ${SITE}`,
    `Мастерам: ${MASTERS}`,
    `App Store: ${APP_STORE}`,
    '',
    tags.join(' ')
  ]
    .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
    .join('\n');

  const linkedin = [
    `${title} - кейс для тату-мастеров`,
    '',
    `В кадре: эскиз и результат (${color}, ${body}).`,
    notes ||
      'На практике мастеру важно держать эскиз, пигменты и заметки по этой же татуировке в одном месте.',
    '',
    `634 - приложение для тату-мастера (проекты, пигменты, склад краски).`,
    `634 не заменяет онлайн-запись и кассу студии.`,
    '',
    `Сайт: ${SITE}`,
    `Лендинг: ${HUB_634}`,
    `App Store: ${APP_STORE}`,
    '',
    '#TattooBusiness #TattooArtist #634app #Sitrifor #MobileApp'
  ].join('\n');

  return {
    title,
    tags,
    channels: { tiktok, instagram, linkedin, vk },
    links: { site: SITE, hub634: HUB_634, masters: MASTERS, appStore: APP_STORE }
  };
}

export function renderPromoMarkdown(promo, meta = {}) {
  const { channels, tags, links, title } = promo;
  const lines = [
    `# ${title}`,
    '',
    '## Мета',
    '',
    `- Цвет: ${meta.colorRu || meta.color || '-'}`,
    `- Часть тела: ${meta.bodyRu || meta.body || '-'}`,
    `- Стиль: ${meta.style || '-'}`,
    `- Дата: ${meta.date || new Date().toISOString().slice(0, 10)}`,
    '',
    '## TikTok',
    '',
    channels.tiktok,
    '',
    '## Instagram',
    '',
    channels.instagram,
    '',
    '## VK',
    '',
    channels.vk,
    '',
    '## LinkedIn',
    '',
    channels.linkedin,
    '',
    '## Теги',
    '',
    tags.join(' '),
    '',
    '## Ссылки',
    '',
    `- Сайт: ${links.site}`,
    `- 634: ${links.hub634}`,
    `- Мастерам: ${links.masters}`,
    `- App Store: ${links.appStore}`,
    ''
  ];
  return lines.join('\n');
}

function bodyHashtag(body) {
  const map = {
    arm: '#armtattoo',
    hand: '#handtattoo',
    leg: '#legtattoo',
    foot: '#foottattoo',
    back: '#backtattoo',
    chest: '#chesttattoo',
    neck: '#necktattoo',
    rib: '#ribtattoo',
    head: '#facetattoo'
  };
  return map[body] || null;
}

function styleHashtag(style) {
  if (!style) return null;
  const s = String(style).toLowerCase();
  if (/real/i.test(s)) return '#realismtattoo';
  if (/neo/i.test(s)) return '#neotraditional';
  if (/trad/i.test(s)) return '#traditionaltattoo';
  if (/ornament|орнамент/i.test(s)) return '#ornamentaltattoo';
  if (/fineline|лайн/i.test(s)) return '#fineline';
  if (/blackwork|блэк/i.test(s)) return '#blackwork';
  if (/botanic|флора|flower/i.test(s)) return '#botanicaltattoo';
  return `#${s.replace(/[^a-z0-9а-я]+/gi, '')}`.slice(0, 32);
}
