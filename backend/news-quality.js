/**
 * News usefulness scorer for tattoo masters.
 * Strict: only actionable, educational, studio-relevant items pass.
 */
const ACTION =
  /how\s+to|tips?|guide|tutorial|checklist|playbook|step[- ]by[- ]step|инструкц|как\s+(повысить|набрать|вести|продвиг|сдел|выбрат|улучш|снизить)|лайфхак|lifehack|best\s+pract|aftercare|уход|sanit|гигиен|pricing|прайс|booking|депозит|no-?show|контент[- ]план|content\s+plan|reels?|stories|сторис|обзор для мастера|плюс[ыа]|минус[ыа]|вердикт|stencil|guest\s*spot/i;

const PHOTO_FLEX =
  /done by|tattoo by|healed\b|my first tattoo|look at this|rate my|what do you think|wip\b|^oc\b|tattoos? of the week|sleeve:?\s*done|bodysuit appreciation|looking for .+ artist|каерu party|^ama with/i;

const NAME_ONLY = /^[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ'’-]+(?:\s+[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ'’-]+){0,3}$/;

const SAAS_GENERIC =
  /government social|okr|analytics\s*\+\s*reporting|we rebuilt|meet insights|best time to post|get more followers|social media audit|winning hearts before peak|buffer insights|nano banana|executives/i;

const PHOTO_DUMP = /\b(ig:\s*@|instagram\.com\/p\/)/i;

const MASTER_TOPICS = {
  social: /instagram|reels?|stories|tiktok|охват|сторис|хештег|hashtag|контент[- ]план/i,
  clients: /client|booking|lead|deposit|клиент|запись|предоплат|no-?show|бриф|депозит/i,
  tools: /procreate|canva|booksy|yclients|sitrifor|калькулятор|crm|инструмент/i,
  gear: /machine|rotary|cartridge|needle|картридж|машинк|игл|cheyenne|bishop|kwadron/i,
  pigments: /pigment|пигмент|eternal|world\s*famous|dynamic|panthera/i,
  studio: /studio|hygiene|sanit|студи|санитар|чеклист/i,
  sketch: /procreate|sketch|эскиз|stencil|flash|linework/i,
  ideas: /зодиак|гороскоп|дата\s*рожден|идеи\s*(для\s*)?тату|принесут\s*удач|родившимся|китайск(ий|ого)\s*знак|tattoo\s*ideas|for_clients/i,
  career: /guest\s*spot|convention|portfolio|прайс|pricing/i
};

const TRUSTED_EDITORIAL = /sitrifor-editorial|tattoomarket-reviews|sitrifor-daily-ai/;

export function scoreUsefulness({ title = '', summary = '', body = '', sourceKey = '', categories = [] } = {}) {
  const text = `${title}\n${summary}\n${(body || '').slice(0, 2500)}`;
  const titleSum = `${title}\n${summary}`;
  const reasons = [];
  let score = 0;

  const len = (body || summary || '').trim().length;
  if (len >= 1200) {
    score += 18;
    reasons.push('full_article');
  } else if (len >= 500) {
    score += 10;
    reasons.push('medium_article');
  } else if (len >= 280) {
    score += 4;
    reasons.push('short_article');
  } else {
    score -= 20;
    reasons.push('too_short');
  }

  if (ACTION.test(text)) {
    score += 30;
    reasons.push('actionable');
  }

  let topics = [];
  for (const [id, re] of Object.entries(MASTER_TOPICS)) {
    if (re.test(text)) topics.push(id);
  }
  topics = topics.slice(0, 2);
  score += topics.length * 6;
  if (topics.length) reasons.push('topics:' + topics.join(','));

  const tattooCtx =
    /tattoo|тату|artist|мастер|studio|студи|ink|pigment|картридж|машинк/i.test(text) ||
    /tattoo|inked|allday|tattooing|reddit-tattoo|sitrifor|tattoomarket/i.test(sourceKey);
  if (tattooCtx) {
    score += 12;
    reasons.push('tattoo_context');
  }

  // Photo flex / portfolio dumps
  if (
    PHOTO_FLEX.test(title) ||
    (PHOTO_DUMP.test(title) && !ACTION.test(titleSum)) ||
    (/^(healed|done by|tattoo by|by me)/i.test(title.trim()) && !ACTION.test(titleSum))
  ) {
    score -= 60;
    reasons.push('photo_flex');
  }

  // Artist name-only titles (interview stubs without how-to framing)
  if (NAME_ONLY.test(title.trim()) && !ACTION.test(titleSum)) {
    score -= 35;
    reasons.push('name_only_title');
  }

  // Generic SaaS / Buffer product marketing without tattoo angle
  if (
    (/buffer-blog|hootsuite|meta-business|later-blog/i.test(sourceKey) || SAAS_GENERIC.test(title)) &&
    !/tattoo|тату|studio|мастер|salon|ink/i.test(titleSum)
  ) {
    score -= 50;
    reasons.push('saas_generic');
  }

  if (/tattoomarket|product.?review|editorial|sitrifor-daily/i.test(sourceKey) || /обзор для мастера/i.test(title)) {
    score += 22;
    reasons.push('editorial_or_review');
  }

  // Reddit photo captions: require actionable title/summary
  if (/^reddit-/i.test(sourceKey) && !ACTION.test(titleSum) && len < 1800) {
    score -= 40;
    reasons.push('reddit_caption');
  }

  if (/love island|celebrity gossip|football|nba|nfl|disney\+|toy story/i.test(text)) {
    score -= 50;
    reasons.push('offtopic');
  }

  if (topics.some((t) => ['social', 'clients', 'tools', 'career', 'gear', 'pigments'].includes(t))) {
    score += 8;
    reasons.push('growth_focus');
  }

  if (Array.isArray(categories) && (categories.includes('clients') || categories.includes('tools'))) {
    score += 4;
  }

  const substantial =
    len >= 900 &&
    tattooCtx &&
    ACTION.test(text) &&
    !reasons.includes('photo_flex') &&
    !reasons.includes('saas_generic');

  const pass =
    score >= 70 &&
    !reasons.includes('offtopic') &&
    !reasons.includes('photo_flex') &&
    !reasons.includes('saas_generic') &&
    !reasons.includes('name_only_title') &&
    !reasons.includes('reddit_caption') &&
    (reasons.includes('actionable') ||
      reasons.includes('editorial_or_review') ||
      substantial) &&
    (tattooCtx || TRUSTED_EDITORIAL.test(sourceKey));

  return {
    score,
    pass,
    topics,
    reasons,
    primaryTopic: topics[0] || (categories[0] || 'industry')
  };
}

export function shouldPublish(scoreResult, { minBody = 400 } = {}) {
  if (!scoreResult?.pass) return false;
  // minBody is advisory for callers that pass body length separately;
  // score already penalizes too_short.
  void minBody;
  return true;
}

/** Keep format:/birthday_/zodiac:/chinese:/gallery: tags across rescoring. */
export function mergePreservedReasons(existing = [], next = []) {
  const keep = (Array.isArray(existing) ? existing : [])
    .map(String)
    .filter((r) =>
      /^(format:|birthday_|zodiac:|chinese:|gallery:|llm:birthday|template:birthday|topic:bday-)/i.test(r)
    );
  const out = [...next.map(String)];
  for (const r of keep) {
    if (!out.includes(r)) out.push(r);
  }
  return out;
}

/** AI / канцелярит clichés that make copy sound generated */
const AI_CLICHE =
  /в\s+сегодняшнем\s+(быстроменяющемся|динамичном)\s+мире|важно\s+отметить[, ]|нельзя\s+недооценивать|давайте\s+разбер[её]мся|в\s+этой\s+статье\s+мы\s+рассмотрим|является\s+ключевым\s+фактором|играет\s+важную\s+роль|комплексный\s+подход|синерги[яи]|на\s+сегодняшний\s+день|подводя\s+итог|безусловно,|в\s+рамках\s+осуществления|необходимо\s+отметить|данный\s+функционал|обеспечить\s+возможность/i;

/** Heuristic: drop LLM output that looks hallucinated / useless */
export function isBadAiText(text = '') {
  if (!text || text.length < 40) return true;
  // LLM mistranslations / decorative nonsense
  if (
    /типы пайки|пайки,\s*ножниц|реагирует на различные типы пайки|подготовьте.{0,40}пайки|кружевн|стрелочк/i.test(
      text
    )
  ) {
    return true;
  }
  if (/(.)\1{6,}/.test(text)) return true;
  if (/lorem ipsum|as an ai|как языковая модель/i.test(text)) return true;
  // Markdown bold artifacts from weak models: «текст**:»
  if (/\w\*\*:/.test(text)) return true;
  // Em-dash forbidden (short en-dash only)
  if (/\u2014/.test(text)) return true;
  // Dense AI cliché clusters
  const clicheRe = new RegExp(AI_CLICHE.source, 'gi');
  const cliches = text.match(clicheRe);
  if (cliches && cliches.length >= 3) return true;
  if (AI_CLICHE.test(text) && text.length < 280) return true;
  return false;
}

/**
 * Combined publish gate: usefulness + editorial style (krrkt/mawo/speller).
 * @param {object} usefulness – scoreUsefulness() result
 * @param {object|null} editorial – polishEditorialText() result for body
 */
export function passesPublishGate(usefulness, editorial = null, opts = {}) {
  if (!shouldPublish(usefulness, opts)) return false;
  if (process.env.NEWS_EDITORIAL_GATE === '0') return true;
  if (!editorial) return true;
  // Hard junk only. Soft polish.ok alone must not block when gate.ok.
  if ((editorial.hints || []).includes('bad_pattern')) return false;
  if (editorial.gate) {
    if (editorial.gate.ok === false) return false;
  } else if (editorial.ok === false) {
    // No structured gate (e.g. js-only polish) - fall back to polish.ok
    return false;
  }
  const min = Number(opts.minEditorial ?? process.env.NEWS_KRRKT_MIN ?? 7);
  const info = editorial.infoScore ?? editorial.editorialScore;
  if (
    info != null &&
    Number(info) < min &&
    editorial.gate &&
    !editorial.gate.skipped_krrkt
  ) {
    return false;
  }
  return true;
}

/**
 * Require real EN/DE locales (not empty, not leftover Russian) before publish.
 * @param {object} article – fields titleEn/bodyEn/titleDe/bodyDe (or *_en snake)
 */
export function checkLocaleCompleteness(article = {}) {
  const issues = [];
  const get = (...keys) => {
    for (const k of keys) {
      if (article[k] != null && String(article[k]).trim()) return String(article[k]);
    }
    return '';
  };
  const enTitle = get('titleEn', 'title_en');
  const enBody = get('bodyEn', 'body_en');
  const deTitle = get('titleDe', 'title_de');
  const deBody = get('bodyDe', 'body_de');

  const heavyCyr = (text) => {
    const s = String(text || '');
    if (s.length < 12) return false;
    const cyr = (s.match(/[А-Яа-яЁё]/g) || []).length;
    const lat = (s.match(/[A-Za-z]/g) || []).length;
    return cyr >= 8 && cyr > lat;
  };

  if (!enTitle || !enBody) issues.push('missing_en');
  else if (heavyCyr(enTitle) || heavyCyr(enBody.slice(0, 400))) issues.push('en_looks_russian');

  if (!deTitle || !deBody) issues.push('missing_de');
  else if (heavyCyr(deTitle) || heavyCyr(deBody.slice(0, 400))) issues.push('de_looks_russian');

  return { ok: issues.length === 0, issues };
}

/**
 * Combined gate including locale completeness when NEWS_I18N_GATE !== '0'.
 */
export function passesPublishGateWithLocales(usefulness, editorial = null, articleLocales = null, opts = {}) {
  if (!passesPublishGate(usefulness, editorial, opts)) return false;
  if (process.env.NEWS_I18N_GATE === '0') return true;
  if (!articleLocales) return true;
  return checkLocaleCompleteness(articleLocales).ok;
}
