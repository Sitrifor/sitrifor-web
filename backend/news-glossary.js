/**
 * Plain-language glossary for birthday / client-facing tattoo articles.
 * Prefer Russian explanations; English studio jargon only with a footnote.
 */

/** Tattoo styles: id → { label, def, search } */
export const STYLE_DEFS = {
  blackwork: {
    label: 'чёрная заливка',
    studio: 'blackwork',
    def: 'рисунок плотной чёрной краской, без цветных пятен; хорошо читается издалека',
    search: ['blackwork', 'блэкуорк'],
    palette: 'mono'
  },
  'fine-line': {
    label: 'тонкая линия',
    studio: 'fine line',
    def: 'аккуратный рисунок тонкими линиями, часто небольшого размера',
    search: ['fine line', 'тонкая линия тату'],
    palette: 'mono'
  },
  'neo-trad': {
    label: 'новый традиционный',
    studio: 'neo-traditional',
    def: 'яркий узнаваемый стиль с чётким контуром и насыщенным цветом (в студиях часто говорят neo-traditional)',
    search: ['neo traditional color', 'цветной неотрад'],
    palette: 'color'
  },
  traditional: {
    label: 'классический американский',
    studio: 'traditional',
    def: 'простые смелые мотивы с жирным контуром и ограниченной палитрой (traditional)',
    search: ['traditional tattoo color', 'old school color tattoo'],
    palette: 'color'
  },
  'black-grey': {
    label: 'чёрно-серый',
    studio: 'black and grey',
    def: 'только чёрная и серая краска, без цвета; удобно для портретов и мягких переходов',
    search: ['black and grey', 'black grey tattoo'],
    palette: 'mono'
  },
  watercolor: {
    label: 'акварель',
    studio: 'watercolor',
    def: 'эффект «краски на бумаге»: пятна, мягкие края, иногда без жёсткого контура',
    search: ['watercolor tattoo color', 'акварель тату цвет'],
    palette: 'color'
  },
  graphic: {
    label: 'графика',
    studio: 'graphic',
    def: 'рисунок линией и контрастом, близкий к иллюстрации в книге или постере',
    search: ['graphic tattoo', 'графика тату']
  },
  illustrative: {
    label: 'иллюстративный',
    studio: 'illustrative',
    def: 'как книжная или журнальная иллюстрация: сюжет, персонаж, деталь с характером',
    search: ['illustrative tattoo']
  },
  realism: {
    label: 'реализм',
    studio: 'realism',
    def: 'стремится к фотоподобной достоверности объёма и фактуры',
    search: ['realism tattoo', 'реализм тату']
  },
  'micro-realism': {
    label: 'мелкий реализм',
    studio: 'micro realism',
    def: 'реалистичная деталь в компактном размере; требует опытного мастера',
    search: ['micro realism tattoo']
  },
  geometry: {
    label: 'геометрия',
    studio: 'geometric',
    def: 'круги, линии, симметрия и точные формы; часто без лишней «декорации»',
    search: ['geometric', 'геометрия тату'],
    palette: 'mono'
  },
  lettering: {
    label: 'надпись',
    studio: 'lettering',
    def: 'текст на коже: дата, имя, короткая фраза; важны шрифт и читаемость через годы',
    search: ['lettering tattoo', 'надпись тату']
  },
  botanical: {
    label: 'ботаника',
    studio: 'botanical',
    def: 'растения, цветы, листья; подходит и для тонкой линии, и для реализма',
    search: ['botanical tattoo', 'цветы тату']
  },
  ornament: {
    label: 'орнамент',
    studio: 'ornamental',
    def: 'повтор узора, узоры и симметрия; часто как браслет, манжета или рамка',
    search: ['ornamental tattoo', 'орнамент тату']
  },
  abstract: {
    label: 'абстракция',
    studio: 'abstract',
    def: 'формы и пятна без буквального сюжета; смысл задаёте вы сами',
    search: ['abstract tattoo']
  },
  'dark-illustrative': {
    label: 'тёмная иллюстрация',
    studio: 'dark illustrative',
    def: 'контрастный, более мрачный сюжет с сильной тенью и акцентом',
    search: ['dark illustrative tattoo']
  },
  'color-realism': {
    label: 'цветной реализм',
    studio: 'color realism',
    def: 'реалистичный рисунок в цвете; дольше сеанс и важнее уход',
    search: ['color realism tattoo'],
    palette: 'color'
  },
  'travel-illustrative': {
    label: 'мотив пути',
    studio: 'travel tattoo',
    def: 'карты, компас, дорога, города – иллюстрация путешествия',
    search: ['compass tattoo', 'travel tattoo']
  }
};

/** Common client-facing terms */
export const TERM_DEFS = {
  эскиз: 'набросок будущего рисунка, который мастер согласовывает с вами до сеанса',
  флэш: 'готовый рисунок из витрины студии, который можно набить без долгой разработки с нуля',
  референс: 'пример фото или картинки, по которому вы объясняете мастеру желаемый вид',
  контур: 'внешняя линия рисунка',
  заливка: 'закрашенная область внутри контура',
  посадка: 'как рисунок ляжет на выбранную зону тела с учётом мышц и движения',
  стихия: 'в гороскопе – условная группа знака: огонь, земля, воздух или вода; это образ, не диагноз',
  управитель: 'планета, с которой знак традиционно связывают в астрологии; для тату – скорее метафора настроения',
  талисман: 'символ, которому вы сами придаёте личный смысл удачи или опоры',
  заживление: 'период после сеанса, когда кожа восстанавливается; от него зависит итоговый вид'
};

/** Map legacy style strings from profiles → STYLE_DEFS keys */
export const STYLE_ALIASES = {
  blackwork: 'blackwork',
  'fine line': 'fine-line',
  'fine-line': 'fine-line',
  неотрад: 'neo-trad',
  'neo-traditional': 'neo-trad',
  традишнл: 'traditional',
  traditional: 'traditional',
  'black & grey': 'black-grey',
  'black and grey': 'black-grey',
  акварель: 'watercolor',
  графика: 'graphic',
  illustrative: 'illustrative',
  realism: 'realism',
  микрореализм: 'micro-realism',
  геометрия: 'geometry',
  леттеринг: 'lettering',
  ботаника: 'botanical',
  орнамент: 'ornament',
  abstract: 'abstract',
  'dark illustrative': 'dark-illustrative',
  'цветной реализм': 'color-realism',
  'travel illustrative': 'travel-illustrative'
};

export function resolveStyle(raw) {
  const key = STYLE_ALIASES[String(raw || '').trim().toLowerCase()] || STYLE_ALIASES[String(raw || '').trim()];
  if (key && STYLE_DEFS[key]) {
    return { id: key, ...STYLE_DEFS[key], raw };
  }
  const asIs = String(raw || '').trim();
  return {
    id: asIs,
    label: asIs,
    studio: asIs,
    def: 'направление рисунка; уточните у мастера на примерах из портфолио',
    search: [asIs],
    raw: asIs
  };
}

export function formatStyleBullet(raw) {
  const s = resolveStyle(raw);
  const studio = s.studio && s.studio !== s.label ? ` (${s.studio})` : '';
  let paletteNote = '';
  if (s.palette === 'color') {
    paletteNote = ' В галерее к этому стилю – цветной пример на коже.';
  } else if (s.palette === 'mono') {
    paletteNote = ' В галерее к этому стилю – пример без цветной заливки.';
  }
  // Ensure sentence break after def (def may end without period)
  const def = /[.!?…]$/.test(String(s.def || '').trim()) ? s.def : `${s.def}.`;
  return `${s.label}${studio} – ${def}${paletteNote}`;
}

/** Caption for a gallery image matched to a style. */
export function styleImageCaption(raw, signName = '') {
  const s = resolveStyle(raw);
  const studio = s.studio || s.label;
  const sign = signName ? ` · ${signName}` : '';
  return `Стиль: ${studio}${sign}`;
}

/**
 * Build search queries: style-first (portfolio quality), motif as secondary.
 * Avoids four near-identical zodiac animals labeled as different styles.
 */
export function buildStyleImageQueries({ styles = [], signName = '', signId = '', motif = '' } = {}) {
  const out = [];
  for (const raw of styles) {
    const s = resolveStyle(raw);
    const styleTerm = (s.search && s.search[0]) || s.studio || s.label;
    const styleRu = (s.search && s.search[1]) || s.label || styleTerm;
    const subjectRu = signName || motif || '';
    const subjectEn = signId || subjectRu;
    const palette = s.palette || 'any';
    const queries = [
      // Style-first: single clean studio photo (avoid blog "ideas" collages)
      `elegant ${styleTerm} tattoo on skin healed photo`,
      `beautiful ${styleTerm} tattoo real skin close up`,
      `${styleTerm} tattoo forearm shoulder healed`,
      `татуировка ${styleRu} на коже красивая зажившая фото`
    ];
    if (palette === 'color') {
      queries.unshift(
        `colorful ${styleTerm} tattoo bright color on skin healed`,
        `цветной ${styleRu} татуировка насыщенный цвет на коже`
      );
    } else if (palette === 'mono') {
      queries.unshift(
        `black ${styleTerm} tattoo on skin no color healed`,
        `чёрная ${styleRu} татуировка на коже без цвета`
      );
    }
    // One motif-tied query last – thematic, but not the only source
    if (subjectRu || subjectEn) {
      queries.push(`elegant ${styleTerm} ${subjectEn || subjectRu} tattoo skin photo`);
      queries.push(`татуировка ${subjectRu} ${styleRu} на коже фото`);
    }
    out.push({
      styleId: s.id,
      styleRaw: raw,
      label: s.label,
      studio: s.studio || s.label,
      palette,
      caption: styleImageCaption(raw, signName),
      queries: queries.filter(Boolean)
    });
  }
  return out;
}

export function glossaryMarkdown(styles = [], extraTerms = []) {
  const lines = ['## Словарь простых определений', ''];
  const seen = new Set();

  for (const raw of styles) {
    const s = resolveStyle(raw);
    const key = `style:${s.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`• **${s.label}** – ${s.def}`);
  }

  const terms = [...extraTerms, 'эскиз', 'флэш', 'референс', 'посадка', 'талисман', 'заживление', 'стихия'];
  for (const t of terms) {
    const def = TERM_DEFS[t];
    if (!def || seen.has(`term:${t}`)) continue;
    seen.add(`term:${t}`);
    lines.push(`• **${t}** – ${def}`);
  }

  lines.push('');
  return lines.join('\n');
}

/** Plain length without markdown images and excess whitespace. */
export function plainTextLen(text = '') {
  return String(text || '')
    .replace(/!\[[^\]]*\]\([^)\s]+\)/g, '')
    .replace(/[#>*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim().length;
}

export const BIRTHDAY_MIN_CHARS = Number(process.env.NEWS_BIRTHDAY_MIN_CHARS || 3500);
