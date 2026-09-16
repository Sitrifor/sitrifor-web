/**
 * Lawyer API: RusLawOD FTS search + fast Ollama consultation.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH =
  process.env.RUSLAW_DB || path.join(__dirname, 'data/ruslawod/laws.db');
const CORPUS_DIR =
  process.env.RUSLAW_CORPUS_DIR ||
  path.join(__dirname, 'data/ruslawod/extract/corpus_xml_lite');

const OLLAMA_HOST = (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:1.5b';
const EMBED_DIM = Number(process.env.LAWYER_EMBED_DIM || 256);

let db = null;
let embedCache = null;

function getDb() {
  if (db) return db;
  if (!fs.existsSync(DB_PATH)) return null;
  db = new Database(DB_PATH, { fileMustExist: true });
  db.pragma('query_only = ON');
  return db;
}

export function lawyerStats() {
  const d = getDb();
  if (!d) return { ready: false, docs: 0 };
  const row = d.prepare('SELECT COUNT(*) AS n, SUM(widely_used) AS w FROM acts').get();
  let chunks = 0;
  let embeddings = 0;
  try {
    if (chunksReady()) {
      chunks = d.prepare('SELECT COUNT(*) AS n FROM chunks').get()?.n || 0;
    }
  } catch {
    chunks = 0;
  }
  try {
    if (embeddingsReady()) {
      embeddings = d.prepare('SELECT COUNT(*) AS n FROM chunk_embeddings').get()?.n || 0;
    }
  } catch {
    embeddings = 0;
  }
  return {
    ready: true,
    docs: row?.n || 0,
    widelyUsed: row?.w || 0,
    chunks,
    embeddings,
    db: DB_PATH
  };
}

const STOP = new Set([
  'для', 'при', 'или', 'как', 'что', 'это', 'какие', 'какой', 'какая',
  'общий', 'общие', 'правила', 'применения', 'порядок', 'можно', 'нужно',
  'есть', 'если', 'ли', 'про', 'по', 'на', 'в', 'и', 'а', 'но', 'же',
  'вопрос', 'скажите', 'подскажите', 'расскажите', 'ваши', 'вашей', 'ваша',
  'выйти', 'поместили', 'нашли', 'хочу', 'нужен', 'нужна', 'помогите',
  'высказала', 'высказал', 'эмоциях', 'эмоциям', 'дура', 'получила', 'получил',
  'она', 'он', 'мне', 'меня', 'мой', 'моя'
]);

/** Tokens that must never use FTS prefix (сизо* → Сизова). */
const EXACT_TOKENS = new Set([
  'сизо', 'усн', 'ндс', 'нк', 'гк', 'тк', 'ук', 'коап', 'ип', 'ооо', 'упк', 'уин'
]);

const ABBR = {
  усн: {
    fts: '(упрощенн* AND систем* AND налог*) OR ("упрощенной системе налогообложения") OR ("упрощенная система налогообложения") OR ("Автоматизированная упрощенная система налогообложения")',
    like: [
      '%упрощенной системе налогообложения%',
      '%упрощенная система налогообложения%',
      '%упрощенном порядке декларирования%',
      '%Автоматизированная упрощенная система налогообложения%'
    ],
    boost: /упрощенн.*налог|упрощенн.*систем|ауси|усн/i
  },
  ндс: {
    fts: '("налога на добавленную стоимость") OR (налог* AND добавленн*)',
    like: ['%налога на добавленную стоимость%', '%НДС%'],
    boost: /добавленн|ндс/i
  },
  нк: {
    fts: '("налогового кодекса") OR (налогов* AND кодекс*)',
    like: ['%налогов%кодекс%', '%НК РФ%', '%Налогового кодекса%'],
    boost: /налогов.*кодекс|кодекс.*налог/i
  },
  гк: {
    fts: '("гражданского кодекса") OR (гражданск* AND кодекс*)',
    like: ['%гражданск%кодекс%', '%ГК РФ%', '%Гражданского кодекса%'],
    boost: /гражданск.*кодекс|кодекс.*граждан/i
  },
  тк: {
    fts: '("трудового кодекса") OR (трудов* AND кодекс*)',
    like: ['%трудов%кодекс%', '%ТК РФ%', '%Трудового кодекса%'],
    boost: /трудов.*кодекс|кодекс.*труд/i
  },
  ук: {
    fts: '("уголовного кодекса") OR (уголовн* AND кодекс*)',
    like: ['%уголовн%кодекс%', '%УК РФ%', '%Уголовного кодекса%'],
    boost: /уголовн.*кодекс|кодекс.*уголов/i
  },
  коап: {
    fts: '("об административных правонарушениях") OR (административн* AND правонарушен*)',
    like: ['%административн%правонарушен%', '%КоАП%'],
    boost: /административн|правонарушен|коап/i
  },
  ип: {
    fts: '("индивидуальн*" AND предпринимател*) OR "индивидуальных предпринимателей"',
    like: ['%индивидуальн%предпринимател%'],
    boost: /индивидуальн.*предпринимател|предпринимател/i
  }
};

function normalizeQuery(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/["«»„“”']/g, ' ')
    .replace(/[^\p{L}\p{N}\s\-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

function tokenize(raw) {
  return normalizeQuery(raw)
    .split(' ')
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

function ftsTerm(token) {
  const t = String(token || '').toLowerCase();
  // digits / short / known abbr / hyphenated (152-фз): exact only
  // Hyphens must be quoted - bare 152-фз* is parsed as FTS column syntax.
  if (
    /^\d+$/.test(t) ||
    t.length <= 3 ||
    EXACT_TOKENS.has(t) ||
    t.length === 4 ||
    /[-./]/.test(t)
  ) {
    return `"${t.replace(/"/g, '')}"`;
  }
  const stem = t.replace(/(ами|ями|ов|ев|ей|ом|ем|ах|ях|ых|ии|ий|ый|ая|ое|ые|ию|ью)$/u, '');
  const base = stem.length >= 5 ? stem : t;
  return `${base}*`;
}

function detectDomain(raw) {
  const norm = normalizeQuery(raw);
  const art = norm.match(/(?:статья|ст|статье|статьи)\s*(\d{1,4}(?:\.\d+)?)/);
  const artNum = art ? art[1] : null;

  // Criminal / detention first
  if (
    /сизо|следственн\w*\s+изолятор|изолятор|под страж|содержани\w*\s+под\s+страж|мера пресечен|мер[аые]\s+пресечен|подписк\w*\s+о\s+невыезд|невыезд|домашн\w*\s+арест|заключени\w*\s+под\s+страж|освобождени\w*\s+из\s+под\s+страж|упк|уголовн\w*\s+процесс/.test(
      norm
    ) ||
    artNum === '228' ||
    (/наркотик|психотроп|прекурсор/.test(norm) && !/неуважен|обжаловать штраф/.test(norm))
  ) {
    return {
      id: 'criminal',
      artNum,
      fts: [
        '(следственн* AND изолятор*)',
        '(содержани* AND страж*)',
        '(наркотическ* OR психотроп*)',
        '("Уголовно-процессуального кодекса")',
        '("Уголовно-процессуальный кодекс")',
        artNum === '228' ? '("228" AND (стать* OR наркот* OR уголовн*))' : null,
        '(размеров AND наркотических)'
      ]
        .filter(Boolean)
        .join(' OR '),
      likes: [
        '%следственных изоляторов%',
        '%следственном изоляторе%',
        '%содержании под стражей подозреваемых%',
        '%О содержании под стражей%',
        '%О наркотических средствах и психотропных веществах%',
        '%размеров наркотических средств%',
        '%Уголовно-процессуального кодекса%',
        '%введении в действие Уголовно-процессуального кодекса%',
        artNum === '228' ? '%статьи 228%' : null
      ].filter(Boolean),
      seeds: [
        '%Правил внутреннего распорядка следственных изоляторов%',
        '%О содержании под стражей подозреваемых%',
        'О наркотических средствах и психотропных веществах',
        '%крупного и особо крупного размеров наркотических%',
        '%значительного, крупного и особо крупного размеров наркотических%',
        '%введении в действие Уголовно-процессуального кодекса%'
      ]
    };
  }

  // Administrative fine / contempt of court / KoAP appeal
  if (
    /неуважен\w*\s+к\s+суду|неуважени[ея]\s+суду/.test(norm) ||
    /коап|кодекс\w*\s+об\s+административных\s+правонарушен/.test(norm) ||
    /административн\w*\s+(штраф|правонарушен|наказан|постановлен)/.test(norm) ||
    (/обжаловать|обжалован/.test(norm) && /штраф|постановлен|суд|административ/.test(norm)) ||
    (/штраф/.test(norm) && /суд|судь|неуважен/.test(norm))
  ) {
    return {
      id: 'admin',
      artNum,
      fts: [
        '("Кодекс Российской Федерации об административных правонарушениях")',
        '(административн* AND правонарушен*)',
        '(неуважен* AND суд*)',
        '(обжалован* AND постановлен*)',
        '(административн* AND штраф*)'
      ].join(' OR '),
      likes: [
        '%Кодекс Российской Федерации об административных правонарушениях%',
        '%об административных правонарушениях%',
        '%неуважение к суду%',
        '%неуважени%суду%',
        '%административных правонарушениях%',
        '%административного наказания%',
        '%обжалован%постановлен%'
      ],
      seeds: [
        'Кодекс Российской Федерации об административных правонарушениях',
        '%неуважение к суду%',
        '%Кодекса Российской Федерации об административных правонарушениях%'
      ]
    };
  }

  return null;
}

/**
 * LegalFrame: slot extraction from narrative context + question.
 * Search uses slots only - emotional fluff never enters FTS.
 */
/** Cyrillic-safe "word" char (JS \w is ASCII-only). */
const RL = String.raw`\p{L}`;
const RB = String.raw`(?:^|[^\p{L}\p{N}])`; // left edge
const RE = String.raw`(?=[^\p{L}\p{N}]|$)`; // right edge

const JURISDICTION_PATTERNS = [
  {
    id: 'criminal',
    re: new RegExp(
      `сизо|следственн${RL}*\\s+изолятор|под страж|мера пресечен|подписк${RL}*\\s+о\\s+невыезд|невыезд|домашн${RL}*\\s+арест|упк|уголовн${RL}*\\s+процесс|уголовн${RL}*\\s+кодекс|${RB}ук${RE}|стать${RL}*\\s*228|наркотик|психотроп|прекурсор`,
      'u'
    )
  },
  {
    id: 'admin',
    re: new RegExp(
      `неуважени[еяю](?:\\s+к)?\\s+суд|${RB}коап${RE}|административн${RL}*\\s+(штраф|правонарушен|наказан|постановлен)|обжаловать\\s+штраф|штраф\\s+за\\s+неуважен|штраф[\\s\\S]{0,40}судь|судь[\\s\\S]{0,40}штраф|назвал${RL}*\\s+судь`,
      'u'
    )
  },
  {
    id: 'tax',
    re: new RegExp(
      `${RB}усн${RE}|${RB}ндс${RE}|${RB}нк${RE}|налогов${RL}*\\s+кодекс|упрощенн${RL}*\\s+систем${RL}*\\s+налог|налог${RL}*\\s+на\\s+добавленн`,
      'u'
    )
  },
  {
    id: 'labor',
    re: new RegExp(
      `${RB}тк${RE}|трудов${RL}*\\s+кодекс|трудов${RL}*\\s+договор|увольнен|заработн${RL}*\\s+плат|не выплат${RL}*\\s+зарплат`,
      'u'
    )
  },
  {
    id: 'consumer',
    re: new RegExp(
      `защит${RL}*\\s+прав${RL}*\\s+потребител|возврат${RL}*\\s+товар|вернут${RL}*\\s+[\\s\\S]{0,24}товар|бракованн|некачественн${RL}*\\s+товар|без\\s+чека`,
      'u'
    )
  },
  {
    id: 'privacy',
    re: new RegExp(
      `персональн${RL}*\\s+данн|обработк${RL}*\\s+персональн|${RB}152-фз${RE}|данн${RL}*\\s+клиент|баз${RL}*\\s+клиент|телефон${RL}*\\s+клиент`,
      'u'
    )
  },
  {
    id: 'civil',
    re: new RegExp(
      `${RB}гк${RE}|гражданск${RL}*\\s+кодекс|договор${RL}*\\s+аренды|аренд${RL}*\\s+помещ|неустойк|взыскан${RL}*\\s+долг`,
      'u'
    )
  }
];

const CODE_SEEDS = {
  admin: {
    codes: ['КоАП РФ'],
    seeds: [
      'Кодекс Российской Федерации об административных правонарушениях',
      '%неуважение к суду%'
    ]
  },
  criminal: {
    codes: ['УПК РФ', 'УК РФ'],
    seeds: [
      '%содержании под стражей%',
      '%следственных изоляторов%',
      'О наркотических средствах и психотропных веществах'
    ]
  },
  tax: {
    codes: ['НК РФ'],
    seeds: ['Об упрощенной системе налогообложения%', '%Налогового кодекса%']
  },
  labor: {
    codes: ['ТК РФ'],
    seeds: ['Трудовой кодекс%', '%трудового договора%']
  },
  consumer: {
    codes: ['ЗоЗПП'],
    seeds: ['О защите прав потребителей']
  },
  privacy: {
    codes: ['152-ФЗ'],
    seeds: ['О персональных данных']
  },
  civil: {
    codes: ['ГК РФ'],
    seeds: ['Гражданский кодекс%', '%договор%аренды%']
  }
};

const NOISE_RE = new RegExp(
  `${RB}(дура|дурой|дуру|дурак|идиот|эмоци${RL}*|бесил${RL}*|ненавиж${RL}*|пожалуйста|подскажите|расскажите|помогите)${RE}`,
  'giu'
);

function detectJurisdiction(norm) {
  for (const row of JURISDICTION_PATTERNS) {
    if (row.re.test(norm)) return row.id;
  }
  return 'other';
}

function extractRoles(norm, jurisdiction) {
  const roles = { subject: null, addressee: null, authority: null };
  let roleNote = '';

  if (
    /получил[аи]?\s+штраф|выпис\p{L}*\s+штраф|назнач\p{L}*\s+штраф|штраф\s+за/u.test(norm) ||
    (jurisdiction === 'admin' && /штраф/.test(norm))
  ) {
    roles.subject = 'заявитель';
    roles.authority = 'суд или орган, вынесший постановление';
    if (
      /судь|суду|судье|судью/.test(norm) &&
      /высказал|высказала|сказал|сказала|назвал|назвала/.test(norm)
    ) {
      roles.addressee = 'судья (адресат высказывания)';
      roleNote =
        'Важно по вашему контексту: штраф получили вы. Судья - адресат высказывания, а не лицо, которому выписали штраф.';
    } else {
      roleNote =
        'Важно по вашему контексту: штраф / постановление касается вас как лица, привлечённого к ответственности.';
    }
  }

  if (/сизо|под страж|изолятор/.test(norm)) {
    roles.subject = roles.subject || 'заявитель / обвиняемый (под стражей)';
    roles.authority = 'суд / следователь';
    roleNote =
      roleNote ||
      'Важно по вашему контексту: вопрос про меру пресечения в отношении лица, содержащегося под стражей.';
  }

  if (/уволил|уволили|не выплат|задержан\p{L}*\s+зарплат/u.test(norm)) {
    roles.subject = 'работник (заявитель)';
    roles.addressee = 'работодатель';
    roleNote = 'Важно по вашему контексту: речь о трудовых правах заявителя по отношению к работодателю.';
  }

  return { roles, roleNote };
}

function extractRemedy(norm) {
  if (/обжаловать|обжалован|жалоб/.test(norm)) return 'appeal';
  if (/выйти|освобод|изменить меру|подписк\p{L}*\s+о\s+невыезд/u.test(norm)) return 'change_measure';
  if (/как\s+(оформ|заключ|расторг|подать|вернуть|получить)/.test(norm)) return 'how_to';
  if (/что\s+грозит|какая\s+ответствен|квалификац/.test(norm)) return 'qualify';
  return 'clarify';
}

function extractTopicTerms(norm, jurisdiction) {
  const terms = [];
  const push = (t) => {
    if (t && !terms.includes(t)) terms.push(t);
  };

  if (/неуважени[еяю](?:\s+к)?\s+суд|назвал\p{L}*\s+судь|штраф[\s\S]{0,40}судь/u.test(norm)) {
    push('неуважение к суду');
    push('административное правонарушение');
  }
  if (/обжаловать|обжалован/.test(norm)) {
    if (jurisdiction === 'admin' || /штраф|постановлен|административ/.test(norm)) {
      push('обжалование постановления об административном правонарушении');
    } else {
      push('обжалование');
    }
  }
  if (/штраф/.test(norm) && jurisdiction === 'admin') push('административный штраф');
  if (/сизо|под страж|изолятор/.test(norm)) push('содержание под стражей');
  if (/мера пресечен|подписк|невыезд/.test(norm)) push('мера пресечения');
  if (/228|наркотик/.test(norm)) push('наркотические средства');
  if (/усн|упрощенн/u.test(norm)) push('упрощенная система налогообложения');
  if (new RegExp(`${RB}ндс${RE}`, 'u').test(norm)) push('налог на добавленную стоимость');
  if (/персональн\p{L}*\s+данн|данн\p{L}*\s+клиент|баз\p{L}*\s+клиент/u.test(norm)) {
    push('персональные данные');
  }
  if (
    /защит\p{L}*\s+прав\p{L}*\s+потребител|потребител|бракованн|вернут\p{L}*\s+[\s\S]{0,24}товар|возврат/u.test(
      norm
    )
  ) {
    push('защита прав потребителей');
  }
  if (/трудов\p{L}*\s+договор/u.test(norm)) push('трудовой договор');
  if (/аренд/.test(norm)) push('договор аренды');
  if (/увольнен/.test(norm)) push('расторжение трудового договора');

  return terms;
}

/**
 * @param {string} question
 * @param {string} [context]
 */
export function extractLegalFrame(question, context = '') {
  const q = String(question || '').trim().slice(0, 500);
  const ctx = String(context || '').trim().slice(0, 400);
  const raw = `${ctx} ${q}`.trim();
  const noiseDropped = [...raw.matchAll(NOISE_RE)].map((m) => (m[1] || m[0]).toLowerCase());
  const cleaned = raw.replace(NOISE_RE, ' ').replace(/\s+/g, ' ').trim();
  const norm = normalizeQuery(cleaned);
  const qNorm = normalizeQuery(q);

  const jurisdiction = detectJurisdiction(norm);
  const articles = [
    ...norm.matchAll(/(?:статья|ст|статье|статьи)\s*(\d{1,4}(?:\.\d+)?)/g)
  ].map((m) => m[1]);
  const uniqueArts = [...new Set(articles)].slice(0, 4);

  const topicTerms = extractTopicTerms(norm, jurisdiction);
  const { roles, roleNote } = extractRoles(norm, jurisdiction);
  const remedy = extractRemedy(`${qNorm} ${norm}`);
  const pack = CODE_SEEDS[jurisdiction] || { codes: [], seeds: [] };

  const searchQueries = [];
  const addQ = (s) => {
    const t = String(s || '').replace(/%/g, '').trim();
    if (t.length >= 4 && !searchQueries.includes(t)) searchQueries.push(t);
  };

  for (const seed of pack.seeds) addQ(seed);
  for (const term of topicTerms) addQ(term);
  for (const a of uniqueArts) addQ(`статья ${a}`);

  if (jurisdiction === 'admin' && remedy === 'appeal') {
    addQ('Кодекс Российской Федерации об административных правонарушениях обжалование постановления');
  }
  if (jurisdiction === 'criminal' && (remedy === 'change_measure' || /сизо|под страж/.test(norm))) {
    addQ('мера пресечения содержание под стражей Уголовно-процессуальный кодекс');
  }
  if (jurisdiction === 'privacy') addQ('О персональных данных');
  if (jurisdiction === 'tax') addQ('Об упрощенной системе налогообложения');

  const qTokens = tokenize(q).filter((t) => t.length >= 4 || /^\d+$/.test(t) || EXACT_TOKENS.has(t));
  if (qTokens.length) addQ(qTokens.slice(0, 6).join(' '));

  const primaryParts = [
    ...pack.codes,
    ...topicTerms.slice(0, 4),
    ...uniqueArts.map((a) => `статья ${a}`),
    qTokens.slice(0, 4).join(' ')
  ].filter(Boolean);

  let confidence = 0.35;
  if (jurisdiction !== 'other') confidence += 0.25;
  if (topicTerms.length) confidence += 0.15;
  if (uniqueArts.length) confidence += 0.1;
  if (pack.codes.length) confidence += 0.1;
  if (roles.subject) confidence += 0.05;
  confidence = Math.min(0.95, confidence);

  return {
    jurisdiction,
    roles,
    roleNote,
    topicTerms,
    remedy,
    codes: pack.codes,
    articles: uniqueArts,
    searchQueries: searchQueries.slice(0, 6),
    primaryQuery: primaryParts.join(' ').trim() || tokenize(q).join(' ') || q,
    noiseDropped: [...new Set(noiseDropped)].slice(0, 12),
    confidence
  };
}

/** @deprecated use extractLegalFrame; kept for callers */
function buildSmartQuery(question, context = '') {
  return extractLegalFrame(question, context).primaryQuery;
}

function reciprocalRankFuse(rankLists, { limit = 8, k = 60 } = {}) {
  const scores = new Map();
  for (const list of rankLists) {
    list.forEach((hit, idx) => {
      if (!hit?.id) return;
      const prev = scores.get(hit.id) || { hit, score: 0 };
      prev.score += 1 / (k + idx + 1);
      if (!prev.hit.heading || (hit.heading && idx === 0)) prev.hit = { ...prev.hit, ...hit };
      scores.set(hit.id, prev);
    });
  }
  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => ({ ...x.hit, _rrf: x.score }));
}

function authorityBoost(hit) {
  const t = `${hit.doc_type || ''}`.toLowerCase();
  const h = `${hit.heading || ''}`.toLowerCase();
  let b = 0;
  if (typeof hit.authority === 'number') b += hit.authority / 400;
  if (/кодекс/.test(t) || /^кодекс/.test(h)) b += 0.08;
  if (/федеральный/.test(t) || /^федеральный закон/.test(h)) b += 0.05;
  if (/приказ|письмо|циркуляр/.test(t)) b -= 0.04;
  if (/^действует/i.test(hit.status || '')) b += 0.02;
  if (h.length && h.length <= 90) b += 0.03;
  if (h.length > 200) b -= 0.04;
  return b;
}

const JURISDICTION_FAMILIES = {
  admin: ['koap'],
  criminal: ['upk', 'uk', 'drugs', 'detention'],
  tax: ['nk'],
  labor: ['tk'],
  consumer: ['consumer'],
  privacy: ['pd'],
  civil: ['gk']
};

function chunksReady() {
  const d = getDb();
  if (!d) return false;
  try {
    return Boolean(
      d.prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='chunks'`).get()?.ok
    );
  } catch {
    return false;
  }
}

function embeddingsReady() {
  const d = getDb();
  if (!d) return false;
  try {
    return Boolean(
      d
        .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='chunk_embeddings'`)
        .get()?.ok
    );
  } catch {
    return false;
  }
}

function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function embedTextLocal(text, dim = EMBED_DIM) {
  const vec = new Float32Array(dim);
  const tokens = String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3)
    .slice(0, 80);
  if (!tokens.length) return vec;
  const add = (tok, weight = 1) => {
    const h = hash32(tok);
    const idx = h % dim;
    const sign = hash32(tok + '#s') & 1 ? 1 : -1;
    vec[idx] += sign * weight;
  };
  for (const t of tokens) add(t, 1);
  for (let i = 0; i < tokens.length - 1; i++) add(`${tokens[i]}_${tokens[i + 1]}`, 0.7);
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) vec[i] /= norm;
  return vec;
}

function bufferToVec(buf) {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Float32Array(ab);
}

function cosineSim(a, b) {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function loadEmbedCache() {
  if (embedCache) return embedCache;
  const d = getDb();
  if (!d || !embeddingsReady()) {
    embedCache = [];
    return embedCache;
  }
  const rows = d
    .prepare(
      `SELECT e.chunk_id, e.act_id, e.code_family, e.authority, e.vector,
              c.article, c.heading AS chunk_heading,
              a.heading, a.doc_type, a.author, a.doc_date, a.doc_number, a.status, a.widely_used
       FROM chunk_embeddings e
       JOIN chunks c ON c.id = e.chunk_id
       JOIN acts a ON a.id = e.act_id`
    )
    .all();
  embedCache = rows.map((r) => ({
    chunk_id: r.chunk_id,
    act_id: r.act_id,
    code_family: r.code_family,
    authority: r.authority,
    article: r.article,
    chunk_heading: r.chunk_heading,
    heading: r.heading,
    doc_type: r.doc_type,
    author: r.author,
    doc_date: r.doc_date,
    doc_number: r.doc_number,
    status: r.status,
    widely_used: r.widely_used,
    vec: bufferToVec(r.vector)
  }));
  console.log('[lawyer] embed cache', embedCache.length);
  return embedCache;
}

function searchEmbeddings(query, { limit = 8, families = null } = {}) {
  const cache = loadEmbedCache();
  if (!cache.length) return [];
  const qv = embedTextLocal(query);
  let rows = cache;
  if (families?.length) rows = rows.filter((r) => families.includes(r.code_family));
  const scored = rows
    .map((r) => ({ r, score: cosineSim(qv, r.vec) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(limit * 2, 12));

  const d = getDb();
  const bodyStmt = d?.prepare(`SELECT body FROM chunks WHERE id = ?`);

  return scored.slice(0, limit).map(({ r, score }) => {
    let snippet = '';
    try {
      snippet = (bodyStmt?.get(r.chunk_id)?.body || '').slice(0, 320);
    } catch {
      snippet = '';
    }
    return {
      id: r.act_id,
      chunk_id: r.chunk_id,
      article: r.article,
      heading: r.heading,
      chunk_heading: r.chunk_heading,
      doc_type: r.doc_type,
      author: r.author,
      doc_date: r.doc_date,
      doc_number: r.doc_number,
      status: r.status,
      widely_used: r.widely_used,
      snippet,
      code_family: r.code_family,
      authority: r.authority,
      _fromChunk: true,
      _fromEmbed: true,
      _embed: score
    };
  });
}

function searchChunks(query, { limit = 8, families = null } = {}) {
  const d = getDb();
  if (!d || !chunksReady()) return [];
  const lim = Math.min(Math.max(Number(limit) || 8, 1), 20);
  const fts = buildFtsQuery(query);
  if (!fts) return [];

  let rows = [];
  try {
    rows = d
      .prepare(
        `SELECT c.id AS chunk_id, c.act_id AS id, c.article, c.heading AS chunk_heading,
                c.body AS snippet, c.code_family, c.authority,
                a.heading, a.doc_type, a.author, a.doc_date, a.doc_number, a.status, a.widely_used,
                bm25(chunks_fts, 10.0, 8.0, 4.0, 1.0) AS rank
         FROM chunks_fts
         JOIN chunks c ON c.rowid = chunks_fts.rowid
         JOIN acts a ON a.id = c.act_id
         WHERE chunks_fts MATCH ?
         ORDER BY rank
         LIMIT ?`
      )
      .all(fts, Math.max(lim * 6, 24));
  } catch (e) {
    console.error('[lawyer] chunks fts error', e.message, fts);
    return [];
  }

  if (families?.length) {
    rows = rows.filter((r) => families.includes(r.code_family));
  }

  return rows.slice(0, lim).map((r) => ({
    id: r.id,
    chunk_id: r.chunk_id,
    article: r.article,
    heading: r.heading,
    chunk_heading: r.chunk_heading,
    doc_type: r.doc_type,
    author: r.author,
    doc_date: r.doc_date,
    doc_number: r.doc_number,
    status: r.status,
    widely_used: r.widely_used,
    snippet: (r.snippet || '').slice(0, 320),
    code_family: r.code_family,
    authority: r.authority,
    _fromChunk: true
  }));
}

function familyBoost(hit, frame) {
  const families = JURISDICTION_FAMILIES[frame?.jurisdiction] || [];
  if (!families.length || !hit.code_family) return 0;
  return families.includes(hit.code_family) ? 0.1 : -0.03;
}

function topicOverlapBoost(hit, frame) {
  const blob = `${hit.heading || ''} ${hit.chunk_heading || ''} ${hit.snippet || ''}`.toLowerCase();
  let s = 0;
  for (const term of frame?.topicTerms || []) {
    const toks = tokenize(term).filter((t) => t.length >= 5);
    if (!toks.length) continue;
    if (toks.every((t) => blob.includes(stemRu(t)) || blob.includes(t))) s += 0.04;
  }
  for (const a of frame?.articles || []) {
    if (hit.article === a || new RegExp(`стать[яие]\\s*${a.replace('.', '\\.')}`, 'i').test(blob)) {
      s += 0.12;
    }
  }
  // Strong phrase hits inside chunk body
  if (/неуважени[еяю](?:\s+к)?\s+суд/u.test(blob)) s += 0.18;
  if (/обжалован\p{L}*\s+постановлен/u.test(blob)) s += 0.1;
  if (/мер\p{L}*\s+пресечен|подписк\p{L}*\s+о\s+невыезд/u.test(blob)) s += 0.12;
  return s;
}

/**
 * Lexical + authority rerank after RRF fusion.
 */
export function rerankHits(hits, frame) {
  return hits
    .map((h) => {
      const score =
        (h._rrf || 0) +
        authorityBoost(h) +
        familyBoost(h, frame) +
        topicOverlapBoost(h, frame) +
        (h._fromChunk ? 0.04 : 0) +
        (h._fromEmbed ? Math.max(0, (h._embed || 0) - 0.15) * 0.2 : 0);
      return { ...h, _score: score };
    })
    .sort((a, b) => b._score - a._score);
}

/**
 * Retrieval confidence in [0,1] from frame + top hits.
 */
export function retrievalConfidence(frame, hits) {
  if (!hits?.length) return Math.min(0.35, (frame?.confidence || 0) * 0.4);
  const top = hits[0]._score ?? hits[0]._rrf ?? 0;
  let c = (frame?.confidence || 0.4) * 0.45;
  if (top >= 0.2) c += 0.25;
  else if (top >= 0.12) c += 0.15;
  else if (top >= 0.06) c += 0.08;
  if (familyBoost(hits[0], frame) > 0) c += 0.12;
  if (hits.length >= 2) c += 0.05;
  if (hits[0]._fromChunk && (frame?.articles?.length || frame?.topicTerms?.length)) c += 0.06;
  return Math.max(0.05, Math.min(0.98, c));
}

/**
 * Multi-query retrieval from LegalFrame slots (acts + chunks, RRF, rerank).
 */
export function searchByFrame(frame, { limit = 8 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 8, 1), 20);
  const queries = [...(frame?.searchQueries || []), frame?.primaryQuery]
    .filter((q, i, arr) => q && arr.indexOf(q) === i)
    .slice(0, 5);

  if (!queries.length) return [];

  const families = JURISDICTION_FAMILIES[frame?.jurisdiction] || null;
  const actLists = queries.map((q) => searchLaws(q, { limit: Math.max(lim, 8) }));
  const chunkLists = chunksReady()
    ? queries.map((q) => searchChunks(q, { limit: Math.max(lim, 6), families }))
    : [];
  const embedLists = embeddingsReady()
    ? [
        searchEmbeddings(frame.primaryQuery || queries[0], {
          limit: Math.max(lim, 6),
          families
        })
      ]
    : [];

  const fused = reciprocalRankFuse([...actLists, ...chunkLists, ...embedLists], {
    limit: lim * 4,
    k: 60
  });

  // Attach code_family/authority from DB when missing
  const d = getDb();
  const enriched = fused.map((h) => {
    if (h.code_family != null && h.authority != null) return h;
    if (!d) return h;
    try {
      const meta = d
        .prepare(`SELECT code_family, authority FROM acts WHERE id = ?`)
        .get(h.id);
      return { ...h, code_family: meta?.code_family, authority: meta?.authority };
    } catch {
      return h;
    }
  });

  const filtered = enriched.filter((h) => isHitRelevantToFrame(h, frame));
  const ranked = rerankHits(filtered, frame);

  if (frame?.jurisdiction === 'admin') {
    ranked.sort((a, b) => {
      const rank = (h) => {
        const t = (h.heading || '').toLowerCase();
        if (/^кодекс российской федерации об административных/.test(t)) return 3;
        if (/введении в действие кодекса российской федерации об административных/.test(t)) return 2;
        return 0;
      };
      const dlt = rank(b) - rank(a);
      if (dlt) return dlt;
      return (b._score || 0) - (a._score || 0);
    });
  }

  // Dedupe by act id keeping best chunk/snippet
  const seen = new Set();
  const out = [];
  for (const h of ranked) {
    if (seen.has(h.id)) continue;
    seen.add(h.id);
    out.push(h);
    if (out.length >= lim) break;
  }
  return out;
}

function buildFtsQuery(raw) {
  const norm = normalizeQuery(raw);
  const tokens = tokenize(raw);
  if (!tokens.length) return '';

  const domain = detectDomain(raw);
  if (domain?.fts) return domain.fts;

  // Prefer strongest domain template (tax codes over noisy "ип")
  const abbrPriority = ['усн', 'ндс', 'нк', 'гк', 'тк', 'ук', 'коап'];
  for (const key of abbrPriority) {
    if (tokens.includes(key) || new RegExp(`(?:^|\\s)${key}(?:\\s|$)`).test(norm)) {
      return ABBR[key].fts;
    }
  }

  // "статья N" / "ст N"
  const art = norm.match(/(?:статья|ст\.?|статье|статьи)\s*(\d{1,4})/);
  if (art) {
    return `("${art[1]}") AND (стать* OR кодекс* OR уголовн* OR наркот*)`;
  }

  // Multi-word: AND on stemmed tokens
  if (tokens.length >= 2) {
    const core = tokens.filter((t) => t.length >= 4 || /^\d+$/.test(t)).slice(0, 5);
    const use = core.length >= 2 ? core : tokens.slice(0, 5);
    return `(${use.map(ftsTerm).join(' AND ')})`;
  }

  if (tokens[0] === 'ип') return ABBR.ип.fts;
  return ftsTerm(tokens[0]);
}

function likePatterns(raw) {
  const norm = normalizeQuery(raw);
  const tokens = tokenize(raw);
  const patterns = [];
  const domain = detectDomain(raw);
  if (domain?.likes) patterns.push(...domain.likes);

  const abbrPriority = ['усн', 'ндс', 'нк', 'гк', 'тк', 'ук', 'коап'];
  let usedAbbr = false;
  for (const key of abbrPriority) {
    if (tokens.includes(key) || new RegExp(`(?:^|\\s)${key}(?:\\s|$)`).test(norm)) {
      patterns.push(...ABBR[key].like);
      usedAbbr = true;
      break;
    }
  }

  const content = tokens.filter((t) => t.length >= 4 || /^\d+$/.test(t));
  // Never LIKE bare short abbrs like %сизо% → Сизова
  if (!domain && content.length >= 2) {
    patterns.push(`%${content.slice(0, 3).join('%')}%`);
    patterns.push(`%${content[0]}%${content[1]}%`);
  } else if (!domain && !usedAbbr && content.length === 1 && content[0].length >= 5) {
    patterns.push(`%${content[0]}%`);
  }

  if (/гражданск.*кодекс|кодекс.*гражданск/i.test(norm)) patterns.unshift('%Гражданский кодекс%');
  if (/трудов.*кодекс|кодекс.*трудов/i.test(norm)) patterns.unshift('%Трудовой кодекс%');
  if (/защит.*потребител/i.test(norm)) patterns.unshift('%защите прав потребителей%');
  if (/персональн.*данн/i.test(norm)) {
    patterns.unshift('%персональных данных%');
    patterns.unshift('%персональн%данн%');
  }
  if (/трудов.*договор|договор.*трудов/i.test(norm)) {
    patterns.unshift('%трудов%договор%');
    patterns.unshift('%типовой форме трудового договора%');
    patterns.unshift('%заключению трудового договора%');
  }
  if (/аренд/i.test(norm) && /помещ|нежил|здан|договор/i.test(norm)) {
    patterns.unshift('%аренд%помещ%');
    patterns.unshift('%договор%аренды%');
    patterns.unshift('%аренд%нежил%');
    patterns.unshift('%типовых условий договоров аренды%');
  }
  return [...new Set(patterns)].slice(0, 10);
}

function stemRu(token) {
  const t = String(token || '').toLowerCase();
  if (t.length <= 4) return t;
  return t.replace(/(ами|ями|ого|ему|ыми|ими|ов|ев|ей|ом|ем|ах|ях|ых|ии|ий|ый|ая|ое|ые|ию|ью|ым|им|ой|ие|ия|ию)$/u, '');
}

function scoreHit(row, tokens, raw) {
  const heading = (row.heading || '').toLowerCase();
  const snippet = `${row.snippet || ''} ${row.text_excerpt || ''}`.toLowerCase();
  const norm = normalizeQuery(raw);
  const domain = detectDomain(raw);
  const contentTokens = tokens.filter(
    (t) => t.length >= 4 || /^\d+$/.test(t) || ['усн', 'ндс', 'нк', 'гк', 'тк', 'ук', 'коап', 'упк'].includes(t)
  );
  let score = 0;

  if (norm.length >= 6 && heading.includes(norm)) score += 35;

  let headingHits = 0;
  for (const tok of contentTokens) {
    if (EXACT_TOKENS.has(tok)) continue; // scored via domain rules
    const stem = stemRu(tok);
    if (heading.includes(tok) || (stem.length >= 4 && heading.includes(stem))) {
      headingHits += 1;
      score += 10;
    } else if (snippet.includes(tok) || (stem.length >= 4 && snippet.includes(stem))) {
      score += 1;
    }
  }
  if (contentTokens.length >= 2 && headingHits === contentTokens.length) score += 16;
  else if (contentTokens.length >= 2 && headingHits === 0) score -= 8;

  if (heading.length <= 60 && headingHits >= Math.min(2, contentTokens.length)) score += 10;
  if (/^о персональных данных$/i.test(heading)) score += 30;
  if (/^гражданский кодекс/i.test(heading)) score += 30;
  if (/^о защите прав потребителей$/i.test(heading)) score += 30;
  if (/^об упрощенной системе налогообложения/i.test(heading)) score += 40;
  if (/^о наркотических средствах и психотропных веществах$/i.test(heading)) score += 35;

  if (/трудов.*договор|договор.*трудов/i.test(norm)) {
    const pos = heading.search(/трудов\w*\s+договор/i);
    if (pos >= 0 && pos <= 90) score += 32;
    else if (pos > 150) score -= 22;
    else if (pos >= 0) score += 6;
    if (/типовой форме трудового договора|заключени[юя] трудового договора|расторжени\w+ трудового договора|рекомендац\w+ по заключению трудового/i.test(heading)) {
      score += 22;
    }
    if (heading.length > 220) score -= 14;
  }
  if (/аренд/i.test(norm)) {
    const pos = heading.search(/аренд/i);
    if (pos >= 0 && pos <= 80) score += 16;
    if (/договор\w*\s+аренды|аренды\s+(нежил|помещ|здан|федерального имущества)|типовых условий договоров аренды/i.test(heading)) {
      score += 20;
    }
    if (/передаче .* арендуем/i.test(heading)) score -= 10;
    if (heading.length > 200) score -= 8;
  }
  if (/персональн.*данн/i.test(norm) && /персональн.*данн/i.test(heading)) score += 20;
  if (/защит.*потребител/i.test(norm) && /защит.*потребител/i.test(heading)) score += 25;
  if (/гражданск.*кодекс/i.test(norm) && /гражданск.*кодекс/i.test(heading)) score += 25;

  if (domain?.id === 'criminal') {
    const wantsExit =
      /сизо|подписк|пресечен|выйти|освобод|невыезд|под страж|изолятор/.test(norm);
    if (/следственн\w*\s+изолятор|правил внутреннего распорядка следственных/i.test(heading)) {
      score += wantsExit ? 55 : 40;
    }
    if (/содержании под стражей подозреваемых|о содержании под стражей/i.test(heading)) {
      score += wantsExit ? 50 : 38;
    }
    if (/наркотическ|психотроп|прекурсор/i.test(heading)) score += 30;
    if (/размеров наркотических/i.test(heading)) {
      score += /228|наркотик/.test(norm) ? 34 : 18;
      if (wantsExit && !/228|наркотик/.test(norm)) score -= 8;
    }
    if (/уголовно-процессуальн/i.test(heading)) score += wantsExit ? 40 : 28;
    if (/стать\w*\s*228|ст\.\s*228|статьи 228/i.test(heading)) score += 32;
    if (/мер\w*\s+пресечен|подписк|невыезд|домашн\w*\s+арест|заключени\w*\s+под\s+страж/i.test(heading)) {
      score += 40;
    }
    if (/сизова|сизов |сизову|сизовым/i.test(heading)) score -= 50;
    if (/осаго|обязательном страховании гражданской ответственности владельцев транспортных/i.test(heading)) {
      score -= 45;
    }
    if (/чернобыл|радиац|подписке на|печатных изданий по подписке/i.test(heading)) score -= 40;
    if (/по жалобе гражданина|по жалобе граждан /i.test(heading) && !/страж|изолятор|наркот|процессуальн|228/i.test(heading)) {
      score -= 20;
    }
  }

  if (domain?.id === 'admin') {
    if (/кодекс российской федерации об административных правонарушениях|^кодекс.*административных правонарушениях/i.test(heading)) {
      score += 50;
    }
    if (/неуважен\w*\s+к\s+суду|неуважени/i.test(heading)) score += 45;
    if (/административн\w*\s+правонарушен|об административных правонарушениях/i.test(heading)) score += 30;
    if (/обжалован/i.test(heading) && /административн|правонарушен/i.test(heading)) score += 28;
    // Hard negatives: drug rehab control orders, scrap metal, unrelated KS/old drafts
    if (/наркоман|наркотич|психотроп|диагностик|реабилитац|лома и отходов|черных и цветных металлов/i.test(heading)) {
      score -= 55;
    }
    if (/осаго|чернобыл|радиац|авторск|социальн\w*\s+обслуживан|рсфср|о проектах законов/i.test(heading)) {
      score -= 40;
    }
    if (/по делу о проверке конституционности/i.test(heading) && !/административн\w*\s+правонарушен/i.test(heading)) {
      score -= 35;
    }
  }

  if (/^Федеральный|^Закон|^Кодекс/i.test(row.doc_type || '')) score += 8;
  else if (/^Указ|^Постановление/i.test(row.doc_type || '')) score += 1;
  else if (/^Определение|^Письмо|^Приказ|^Циркуляр/i.test(row.doc_type || '')) score -= 2;

  if (/^Действует/i.test(row.status || '')) score += 5;
  if (/Утратил/i.test(row.status || '')) {
    if (/упрощенн\w*\s+систем\w*\s+налогооблож|гражданский кодекс|о персональных данных|о защите прав потребителей|следственных изоляторов|наркотических средствах/i.test(heading)) {
      score -= 2;
    } else {
      score -= 7;
    }
  }

  for (const key of ['усн', 'ндс', 'нк', 'гк', 'тк', 'ук', 'коап']) {
    if (contentTokens.includes(key) && ABBR[key].boost.test(heading)) score += 12;
  }
  if (tokens.includes('ип') && /индивидуальн|предпринимател/i.test(heading)) score += 4;

  if (contentTokens.includes('усн') || /усн|упрощенн/i.test(norm)) {
    if (/упрощенн\w*\s+систем\w*\s+налогооблож/i.test(heading)) score += 28;
    if (/автоматизированная упрощенная система налогообложения/i.test(heading)) score += 12;
    if (/налог на профессиональный доход|самозанят/i.test(heading)) score -= 18;
    if (/страховых взносов|коэффициент.*дефлятор/i.test(heading)) score -= 14;
  }

  if (/усн-\d|цеха №|санитарно-защит/i.test(heading)) score -= 25;
  if (/диагностическ|антиретровирус|covid|соvid/i.test(heading)) score -= 15;

  if (typeof row.rank === 'number') score -= Math.max(0, row.rank) * 0.12;
  return score;
}

function uniqueById(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (!r?.id || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

export function searchLaws(query, { limit = 8 } = {}) {
  const d = getDb();
  if (!d) return [];
  const lim = Math.min(Math.max(Number(limit) || 8, 1), 20);
  const tokens = tokenize(query);
  const fts = buildFtsQuery(query);
  const likes = likePatterns(query);

  const selectCols = `id, heading, doc_type, author, doc_date, doc_number, status, widely_used,
                      substr(text_excerpt, 1, 320) AS snippet`;

  let ftsRows = [];
  if (fts) {
    try {
      ftsRows = d
        .prepare(
          `SELECT a.id, a.heading, a.doc_type, a.author, a.doc_date, a.doc_number, a.status,
                  a.widely_used, substr(a.text_excerpt, 1, 320) AS snippet,
                  bm25(acts_fts, 12.0, 2.0, 1.0, 1.5, 1.0) AS rank
           FROM acts_fts
           JOIN acts a ON a.rowid = acts_fts.rowid
           WHERE acts_fts MATCH ?
           ORDER BY rank
           LIMIT ?`
        )
        .all(fts, Math.max(lim * 10, 50));
    } catch (e) {
      console.error('[lawyer] fts error', e.message, fts);
    }
  }

  let likeRows = [];
  for (const pat of likes) {
    try {
      const rows = d
        .prepare(
          `SELECT ${selectCols}
           FROM acts
           WHERE heading LIKE ? ESCAPE '\\'
           ORDER BY
             CASE WHEN heading LIKE 'Гражданский кодекс%' OR heading LIKE 'О персональных данных' OR heading LIKE 'О защите прав потребителей' OR heading LIKE 'Об упрощенной системе налогообложения%' THEN 0 ELSE 1 END,
             CASE WHEN status LIKE 'Действует%' THEN 0 ELSE 1 END,
             CASE WHEN doc_type LIKE 'Федеральный%' OR doc_type IN ('Закон','Кодекс') THEN 0 ELSE 1 END,
             length(heading)
           LIMIT ?`
        )
        .all(pat, lim * 3);
      likeRows.push(...rows);
    } catch (e) {
      console.error('[lawyer] like error', e.message, pat);
    }
  }

  // Seed cornerstone statutes for common intents
  const seeds = [];
  const norm = normalizeQuery(query);
  const domain = detectDomain(query);
  if (domain?.seeds) seeds.push(...domain.seeds);
  if (/усн|упрощенн/i.test(norm)) {
    seeds.push('Об упрощенной системе налогообложения%');
    seeds.push('О проведении эксперимента по установлению специального налогового режима "Автоматизированная упрощенная%');
  }
  if (/персональн/i.test(norm)) seeds.push('О персональных данных');
  if (/потребител/i.test(norm)) seeds.push('О защите прав потребителей');
  if (/гражданск.*кодекс/i.test(norm)) seeds.push('Гражданский кодекс%');
  for (const seed of seeds) {
    try {
      likeRows.push(
        ...d
          .prepare(
            `SELECT ${selectCols} FROM acts WHERE heading LIKE ? ORDER BY length(heading) LIMIT 4`
          )
          .all(seed)
      );
    } catch {
      /* ignore */
    }
  }

  // Soft fallback: skip for criminal/admin domains (prefix OR brings noise)
  if (!domain && ftsRows.length + likeRows.length < 3 && tokens.length >= 2) {
    const softTokens = tokens.filter((t) => t.length >= 5).slice(0, 4);
    if (softTokens.length) {
      const soft = `(${softTokens.map(ftsTerm).join(' OR ')})`;
      try {
        ftsRows = ftsRows.concat(
          d
            .prepare(
              `SELECT a.id, a.heading, a.doc_type, a.author, a.doc_date, a.doc_number, a.status,
                      a.widely_used, substr(a.text_excerpt, 1, 320) AS snippet,
                      bm25(acts_fts, 12.0, 2.0, 1.0, 1.5, 1.0) AS rank
               FROM acts_fts
               JOIN acts a ON a.rowid = acts_fts.rowid
               WHERE acts_fts MATCH ?
               ORDER BY rank
               LIMIT ?`
            )
            .all(soft, lim * 8)
        );
      } catch {
        /* ignore */
      }
    }
  }

  let merged = uniqueById([...likeRows, ...ftsRows]).map((r) => ({
    ...r,
    _score: scoreHit(r, tokens, query)
  }));

  // Drop hard negatives for criminal/admin queries
  if (domain?.id === 'criminal') {
    merged = merged.filter((r) => {
      const h = (r.heading || '').toLowerCase();
      if (/сизова|сизов |осаго|чернобыл|радиац|печатных изданий по подписке/.test(h)) return false;
      return r._score > 0;
    });
  }
  if (domain?.id === 'admin') {
    merged = merged.filter((r) => {
      const h = (r.heading || '').toLowerCase();
      if (
        /наркоман|наркотич|психотроп|диагностик|реабилитац|лома и отходов|осаго|чернобыл|ликвидации|олимпий|финансовых операций с иностранными|градостроительн|рсфср|о проектах законов|авторск|социальн\w*\s+обслуживан/.test(
          h
        )
      ) {
        return false;
      }
      return (
        r._score > 0 &&
        (/кодекс российской федерации об административных правонарушениях/.test(h) ||
          /неуважен\w*\s+к\s+суду|неуважени\w*\s+к\s+суду/.test(h) ||
          (/административн/.test(h) && /правонарушен/.test(h)) ||
          (/обжалован/.test(h) && /административн|правонарушен/.test(h)))
      );
    });
  }

  merged.sort((a, b) => b._score - a._score);
  const top = merged[0]?._score ?? 0;
  const filtered = merged.filter((r) => r._score >= Math.max(8, top * 0.3));
  return (filtered.length ? filtered : merged).slice(0, lim).map(({ _score, rank, ...rest }) => rest);
}

function loadFullExcerpt(id) {
  const d = getDb();
  if (!d) return null;
  return d
    .prepare(
      `SELECT id, heading, doc_type, author, doc_date, doc_number, status, text_excerpt, file_name
       FROM acts WHERE id = ?`
    )
    .get(id);
}

async function isOllamaUp() {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(2500) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Fast path: call Ollama directly (no news editorial queue / polish).
 */
async function lawyerLlmChat(messages, { timeoutMs = 45000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages,
        stream: false,
        keep_alive: '10m',
        options: {
          temperature: 0.1,
          top_p: 0.8,
          num_ctx: Number(process.env.LAWYER_OLLAMA_NUM_CTX || 768),
          num_predict: Number(process.env.LAWYER_OLLAMA_NUM_PREDICT || 160),
          num_thread: Number(process.env.OLLAMA_NUM_THREAD || 4),
          repeat_penalty: 1.08
        }
      })
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      console.error('[lawyer] ollama failed', res.status, err.slice(0, 200));
      return null;
    }
    const data = await res.json();
    return data?.message?.content?.trim() || null;
  } catch (e) {
    console.error('[lawyer] ollama error', e.message || e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const SYSTEM_PROMPT = `Справочный ассистент по законам РФ. Отвечай сразу по делу, по-русски, на «вы».
Не повторяй вопрос и не копируй заголовки актов дословно как весь ответ.
Контекст описывает ситуацию пользователя: не путайте роли (кто получил штраф, кто судья и т.п.).
Используй ТОЛЬКО переданные акты. Если они не про вопрос - прямо скажи, что в выдаче нет подходящих норм, и не выдумывай.
Сделай: 1) краткий вывод 2) какие из переданных актов относятся к теме 3) строка «Справка, не юруслуга».
Без длинного тире.`;

function diversifyHits(hits, query) {
  const domain = detectDomain(query);
  if (domain?.id !== 'criminal' || hits.length <= 3) return hits;
  const picked = [];
  const rest = [...hits];
  const take = (pred) => {
    const idx = rest.findIndex((h) => pred(`${h.heading || ''}`.toLowerCase()));
    if (idx >= 0) picked.push(rest.splice(idx, 1)[0]);
  };
  take((h) => /изолятор/.test(h));
  take((h) => /содержании под стражей|под страж/.test(h));
  take((h) => /процессуальн/.test(h));
  take((h) => /наркот|психотроп|228/.test(h));
  return [...picked, ...rest];
}

function isHitRelevantToFrame(hit, frame) {
  const title = (hit.heading || '').toLowerCase();
  const blob = `${title} ${hit.snippet || ''}`.toLowerCase();
  const j = frame?.jurisdiction || 'other';

  if (/сизова|осаго|чернобыл|радиац|печатных изданий по подписке/.test(blob)) {
    if (j === 'criminal' || j === 'admin') return false;
  }

  if (j === 'criminal') {
    return /страж|изолятор|наркот|психотроп|прекурсор|процессуальн|228|пресечен|арест|уголовн/.test(
      blob
    );
  }

  if (j === 'admin') {
    if (
      /наркоман|наркотич|психотроп|диагностик|реабилитац|лома и отходов|рсфср|о проектах законов|авторск|социальн\p{L}*\s+обслуживан|ликвидации|олимпий|валютн|тариф|пожар|розничн|финансовых операций|коммунального комплекса|задержанных за административ|условиях содержания лиц|соглашения между|представлении президенту/u.test(
        title
      )
    ) {
      return false;
    }
    if (/^кодекс российской федерации об административных правонарушениях/.test(title)) return true;
    if (/введении в действие кодекса российской федерации об административных/.test(title)) {
      return true;
    }
    if (/неуважени[еяю](?:\s+к)?\s+суд/u.test(title)) {
      // Prefer federal / code-level acts over regional KS refusals
      if (/отказе в принятии|республики башкортостан|закона республики/u.test(title)) return false;
      return true;
    }
    if (/реализации.*кодекса российской федерации об административных/.test(title) && title.length < 160) {
      return true;
    }
    return false;
  }

  if (j === 'tax') {
    if (/страховых взносов|индексации фиксированного/.test(title)) return false;
    return (
      /упрощенн\p{L}*\s+систем\p{L}*\s+налог/u.test(title) ||
      /автоматизированн\p{L}*\s+упрощенн/u.test(title) ||
      /налогов\p{L}*\s+кодекс/u.test(title) ||
      /^о налоге на добавленную стоимость/.test(title) ||
      (/ндс/.test(title) && /налог/.test(title))
    );
  }
  if (j === 'labor') {
    if (/розничн\p{L}*\s+рынк|кредиторской задолженности/u.test(title)) return false;
    return (
      /^трудовой кодекс/.test(title) ||
      /трудов\p{L}*\s+договор/u.test(title) ||
      (/трудов/.test(title) && /увольнен|расторжен|заработн/.test(title))
    );
  }
  if (j === 'consumer') {
    return /потребител/.test(title);
  }
  if (j === 'privacy') {
    return (
      /^о персональных данных$/.test(title) ||
      (/персональн\p{L}*\s+данн/u.test(title) && !/эксперимент|биометрическ/.test(title) && title.length < 120)
    );
  }
  if (j === 'civil') {
    return (
      /^гражданский кодекс/.test(title) ||
      /аренд/.test(title) ||
      (/договор/.test(title) && /аренд|купл|подряд/.test(title))
    );
  }

  if (frame?.topicTerms?.length) {
    const joined = frame.topicTerms.join(' ').toLowerCase();
    const stems = tokenize(joined).filter((t) => t.length >= 5).slice(0, 4);
    if (stems.length && !stems.some((s) => title.includes(stemRu(s)) || blob.includes(s))) {
      if (!/^кодекс|^федеральный закон/i.test(hit.heading || '')) return false;
    }
  }
  return true;
}

function formatSourcesBlock(hits) {
  return hits
    .map(
      (h) =>
        `- ${h.doc_type || 'Акт'} ${h.doc_number || ''} от ${h.doc_date || '?'}: ${h.heading} (${h.status || ''})`
    )
    .join('\n');
}

function buildGroundedFromFrame(frame, hits) {
  const j = frame.jurisdiction;
  const lines = [];

  if (j === 'criminal') {
    lines.push(
      'Краткий вывод: вопрос про меру пресечения / уголовный процесс решается по УПК РФ (ходатайство защитника или обвиняемого). В открытой базе мало полного актуального текста УПК, поэтому пошаговый алгоритм здесь нельзя выдать как официальную норму.'
    );
  } else if (j === 'admin' && frame.remedy === 'appeal') {
    lines.push(
      'Краткий вывод: если вам назначили штраф за административное правонарушение (в том числе за неуважение к суду), обжалуют обычно постановление по делу об административном правонарушении (КоАП РФ).'
    );
  } else if (j === 'admin') {
    lines.push(
      'Краткий вывод: тема относится к административной ответственности (КоАП РФ). Опирайтесь на найденные акты и полный текст кодекса.'
    );
  } else if (j === 'tax') {
    lines.push(
      'Краткий вывод: вопрос в налоговой плоскости. Смотрите НК РФ и профильные законы из выдачи ниже.'
    );
  } else if (j === 'labor') {
    lines.push(
      'Краткий вывод: вопрос трудовой. Ориентир - ТК РФ и найденные акты о трудовом договоре / увольнении.'
    );
  } else if (j === 'consumer') {
    lines.push(
      'Краткий вывод: вопрос о правах потребителя. Ориентир - закон «О защите прав потребителей» и найденные акты.'
    );
  } else if (j === 'privacy') {
    lines.push(
      'Краткий вывод: вопрос о персональных данных. Ориентир - ФЗ «О персональных данных».'
    );
  } else {
    lines.push(
      'Краткий вывод: ниже акты, наиболее близкие к юридическому фокусу вашего запроса (без опоры на бытовой шум из рассказа).'
    );
  }

  if (frame.roleNote) {
    lines.push('');
    lines.push(frame.roleNote);
  }

  if (j === 'admin' && frame.remedy === 'appeal') {
    lines.push('');
    lines.push('Что проверить по КоАП РФ (ориентир, не замена юристу):');
    lines.push('- срок и порядок обжалования постановления по делу об административном правонарушении;');
    lines.push('- куда подавать жалобу (зависит от того, кто вынес постановление);');
    lines.push(
      '- в жалобе: ваши данные, номер и дата постановления, в чём ошибка, чего просите (отменить или изменить).'
    );
  }

  if (j === 'criminal') {
    lines.push('');
    if (frame.articles.includes('228') || frame.topicTerms.some((t) => /наркот/.test(t))) {
      lines.push(
        'По ст. 228 смотрите также размеры наркотических средств в постановлениях Правительства и ФЗ «О наркотических средствах и психотропных веществах».'
      );
    }
    lines.push(
      'Практически: через адвоката заявите ходатайство об изменении меры пресечения, приложите данные о личности, адресе, работе/учёбе и гарантиях явки.'
    );
  }

  lines.push('');
  lines.push('Что нашлось в базе по теме:');
  if (hits.length) {
    lines.push(
      hits
        .map((h) => {
          const art = h.article ? `, ст. ${String(h.article).replace(/\.$/, '')}` : '';
          return `- ${h.doc_type || 'Акт'} ${h.doc_number || ''} от ${h.doc_date || '?'}${art}: ${h.heading} (${h.status || ''})`;
        })
        .join('\n')
    );
  } else {
    lines.push(
      '- релевантных фрагментов мало; в корпусе может не быть полной редакции нужного кодекса. Обратитесь к юристу и официальным текстам.'
    );
  }

  if (frame.codes?.length) {
    lines.push('');
    lines.push(`Кодексы-ориентиры по теме: ${frame.codes.join(', ')}.`);
  }

  lines.push('');
  lines.push('Справка, не юруслуга.');
  return lines.join('\n');
}

const GROUNDED_JURISDICTIONS = new Set([
  'criminal',
  'admin',
  'tax',
  'labor',
  'consumer',
  'privacy',
  'civil'
]);

export async function consultLaws({ question, context = '', limit = 3 }) {
  const q = String(question || '').trim().slice(0, 500);
  const userContext = String(context || '').trim().slice(0, 280);
  if (q.length < 4) {
    return { error: 'Слишком короткий вопрос', statusCode: 400 };
  }

  const frame = extractLegalFrame(q, userContext);
  const hitLimit =
    frame.jurisdiction === 'criminal' || frame.jurisdiction === 'admin'
      ? Math.max(limit, 3)
      : Math.min(Math.max(limit, 2), 4);

  let hits = searchByFrame(frame, { limit: Math.max(hitLimit, 8) });
  if (frame.jurisdiction === 'criminal') {
    hits = diversifyHits(hits, frame.primaryQuery).slice(0, hitLimit);
  } else {
    hits = hits.slice(0, hitLimit);
  }

  // Soft fallback seeds if empty
  if (!hits.length && frame.jurisdiction !== 'other') {
    const pack = CODE_SEEDS[frame.jurisdiction];
    if (pack?.seeds?.length) {
      hits = searchLaws(pack.seeds[0].replace(/%/g, ''), { limit: 8 })
        .filter((h) => isHitRelevantToFrame(h, frame))
        .slice(0, hitLimit);
      hits = rerankHits(hits, frame);
    }
  }

  const conf = retrievalConfidence(frame, hits);
  frame.retrievalConfidence = conf;

  const CONF_LOW = Number(process.env.LAWYER_CONF_LOW || 0.42);
  const CONF_REFUSE = Number(process.env.LAWYER_CONF_REFUSE || 0.28);

  // Vague narrative with no legal slots: do not dump random acts
  const tooVague =
    frame.jurisdiction === 'other' &&
    !(frame.topicTerms || []).length &&
    !(frame.articles || []).length &&
    conf < 0.55;

  if (tooVague) {
    return {
      answer:
        'Запрос слишком общий: не удалось выделить юридическую тему (кодекс, статья, вид спора). Добавьте контекст: что случилось по делу и какой вопрос (обжаловать, оформить, какая ответственность). Справка, не юруслуга.',
      sources: [],
      llm: false,
      grounded: true,
      confidence: conf,
      frame: publicFrame(frame)
    };
  }

  const enriched = hits.slice(0, hitLimit).map((h) => {
    const full = loadFullExcerpt(h.id);
    const snippet = (h.snippet || full?.text_excerpt || '').slice(0, 280);
    return {
      ...h,
      text_excerpt: snippet,
      snippet
    };
  });

  const corpusBlock = enriched
    .map((h, i) => {
      const art = h.article ? ` ст. ${h.article}` : '';
      return `${i + 1}) ${h.doc_type || 'Акт'} ${h.doc_number || ''} от ${h.doc_date || '?'} (${h.status || '?'}): ${h.heading}${art}. ${(h.text_excerpt || '').slice(0, 200)}`;
    })
    .join('\n');

  // Hard refuse: almost no signal
  if (conf < CONF_REFUSE && !enriched.length) {
    return {
      answer:
        'Не удалось надёжно сопоставить ваш запрос с актами в открытой базе. Уточните кодекс/статью или сформулируйте юридический вопрос короче (без бытовых деталей). Справка, не юруслуга.',
      sources: [],
      llm: false,
      grounded: true,
      confidence: conf,
      frame: publicFrame(frame)
    };
  }

  const useGrounded =
    GROUNDED_JURISDICTIONS.has(frame.jurisdiction) ||
    frame.confidence >= 0.7 ||
    conf < CONF_LOW ||
    !enriched.length;

  if (useGrounded && (GROUNDED_JURISDICTIONS.has(frame.jurisdiction) || conf < CONF_LOW || !enriched.length)) {
    let answer = buildGroundedFromFrame(frame, enriched);
    if (conf < CONF_LOW) {
      answer =
        'Уверенность сопоставления средняя/низкая: ниже ориентир по найденным актам, не полная юридическая квалификация.\n\n' +
        answer;
    }
    console.log(
      '[lawyer] grounded',
      frame.jurisdiction,
      'conf',
      conf.toFixed(2),
      'frame',
      frame.confidence.toFixed(2),
      'queries',
      frame.searchQueries.slice(0, 3).join(' | '),
      'hits',
      enriched.length,
      'chunks',
      chunksReady()
    );
    return {
      answer,
      sources: enriched.map(publicHit),
      llm: false,
      grounded: true,
      confidence: conf,
      frame: publicFrame(frame)
    };
  }

  if (!(await isOllamaUp())) {
    return {
      answer:
        (frame.roleNote ? frame.roleNote + '\n\n' : '') +
        'Локальная модель сейчас недоступна. Ниже найденные акты:\n\n' +
        (enriched.length ? formatSourcesBlock(enriched) : '- подходящих актов не найдено'),
      sources: enriched.map(publicHit),
      llm: false,
      frame: publicFrame(frame)
    };
  }

  const roleGuard = frame.roles?.subject
    ? `Роли из разбора ситуации: субъект=${frame.roles.subject}; адресат=${frame.roles.addressee || '-'}; орган=${frame.roles.authority || '-'}. Не переставляйте роли.`
    : 'Не путайте роли участников ситуации.';

  const userPrompt = [
    roleGuard,
    frame.roleNote || '',
    `Юридический фокус: ${frame.jurisdiction}; темы: ${(frame.topicTerms || []).join(', ') || 'не выделены'}; кодексы: ${(frame.codes || []).join(', ') || 'не указаны'}.`,
    `Вопрос пользователя: ${q}`,
    // Do NOT pass raw emotional context - only slots
    corpusBlock
      ? `Акты:\n${corpusBlock}`
      : 'Релевантных актов не найдено - прямо скажите об этом и не выдумывайте.'
  ]
    .filter(Boolean)
    .join('\n');

  const t0 = Date.now();
  const answer = await lawyerLlmChat(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ],
    { timeoutMs: Number(process.env.LAWYER_LLM_TIMEOUT_MS || 45000) }
  );
  console.log(
    '[lawyer] llm ms',
    Date.now() - t0,
    'jurisdiction',
    frame.jurisdiction,
    'conf',
    frame.confidence.toFixed(2),
    'prompt_chars',
    userPrompt.length
  );

  if (!answer) {
    return {
      answer: buildGroundedFromFrame(frame, enriched),
      sources: enriched.map(publicHit),
      llm: false,
      grounded: true,
      confidence: conf,
      frame: publicFrame(frame)
    };
  }

  const safeAnswer = String(answer).replace(/\u2014/g, '-').replace(/\u2013/g, '-');
  return {
    answer: frame.roleNote && !safeAnswer.includes('штраф получили вы')
      ? `${frame.roleNote}\n\n${safeAnswer}`
      : safeAnswer,
    sources: enriched.map(publicHit),
    llm: true,
    grounded: false,
    confidence: conf,
    frame: publicFrame(frame)
  };
}

function publicFrame(frame) {
  if (!frame) return null;
  return {
    jurisdiction: frame.jurisdiction,
    roles: frame.roles,
    topicTerms: frame.topicTerms,
    remedy: frame.remedy,
    codes: frame.codes,
    articles: frame.articles,
    searchQueries: frame.searchQueries,
    confidence: frame.confidence,
    retrievalConfidence: frame.retrievalConfidence,
    noiseDropped: frame.noiseDropped
  };
}

function publicHit(h) {
  return {
    id: h.id,
    heading: h.heading,
    doc_type: h.doc_type,
    author: h.author,
    doc_date: h.doc_date,
    doc_number: h.doc_number,
    status: h.status,
    snippet: (h.snippet || h.text_excerpt || '').slice(0, 280),
    widely_used: h.widely_used,
    article: h.article || null,
    chunk_heading: h.chunk_heading || null,
    code_family: h.code_family || null,
    authority: h.authority ?? null,
    score: h._score ?? h._rrf ?? null
  };
}

export function registerLawyerRoutes(app) {
  app.get('/api/lawyer/health', async () => {
    const stats = lawyerStats();
    const llm = await isOllamaUp();
    return { ok: stats.ready, ...stats, llm, corpusDir: CORPUS_DIR, model: OLLAMA_MODEL };
  });

  app.get('/api/lawyer/search', async (request, reply) => {
    const q = String(request.query?.q || '');
    const context = String(request.query?.context || '');
    const limit = Number(request.query?.limit || 8);
    if (!getDb()) {
      return reply.code(503).send({ error: 'База законодательства не проиндексирована' });
    }
    const frame = extractLegalFrame(q, context);
    const hits = searchByFrame(frame, { limit }).map(publicHit);
    return {
      q,
      context,
      query: frame.primaryQuery,
      frame: publicFrame(frame),
      hits,
      count: hits.length
    };
  });

  app.post('/api/lawyer/consult', async (request, reply) => {
    const body = request.body || {};
    const result = await consultLaws({
      question: body.question || body.q || '',
      context: body.context || '',
      limit: body.limit || 2
    });
    if (result.error) {
      return reply.code(result.statusCode || 400).send({ error: result.error });
    }
    return result;
  });
}
