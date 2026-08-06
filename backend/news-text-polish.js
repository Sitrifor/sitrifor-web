/**
 * Russian editorial style + text polish bridge for Sitrifor LLM writers.
 * Fast JS typography always; deeper razdel/pymorphy3 + krrkt/mawo/speller/NER via Python.
 * Modes: editorialSystemPrompt('social'|'tips'|…). Art Lebedev Typograf is intentionally NOT used.
 */
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const POLISH_PY = join(__dirname, 'text_polish.py');
const VENV_PY = [
  join(__dirname, '../seo/.venv/bin/python'),
  join(__dirname, '.venv/bin/python'),
  '/var/www/sitrifor/seo/.venv/bin/python'
].find((p) => existsSync(p));

const KRRKT_MIN = Number(process.env.NEWS_KRRKT_MIN || 7);

/** System style guide injected into LLM prompts (ru-score rubric embedded). */
export const EDITORIAL_STYLE_RU = `Ты литературный редактор Sitrifor для тату-мастеров.

Стиль (цель – оценка информационного стиля ≥ 7.0 из 10, как у Главред/ru-score / krrkt):
- Русский литературный, ясный, деловой, без канцелярита и без сленговой грязи.
- Короткие абзацы: 1–3 предложения. Фраза – одна мысль.
- Конкретика: шаги, инструменты, метрики, чеклисты. Без воды и общих лозунгов.
- Кавычки «ёлочки», только короткое тире – (никогда длинное —). Не пиши латиницей CTA/Direct без нужды; если термин нужен – оставь как принято в отрасли.
- Студийный жаргон (fine line, blackwork, флэш, референс) для клиентских текстов объясняй сразу простыми словами или сноской; в текстах для мастеров жаргон допустим, если он привычен отрасли.
- Не выдумывай бренды, цифры, рейтинги, исследования и медицинские гарантии. Если нет источника со ссылкой – не пиши «доказано» и проценты.
- Не повторяй одну конструкцию («Важно…», «Также…») подряд и не начинай три предложения с одной леммы.
- Списки – параллельные по форме. Заголовки разделов короткие (##).
- Обращение на «вы». Тон уважительный к мастеру.
- В статьях по дате рождения день месяца – отдельный характер: соседние даты одного знака не должны читаться как копия с другой цифрой.

SMM и контент (если тема про Instagram / Reels / Stories / Telegram):
- Пиши практику студии: хук первых 1–2 секунд, оффер, CTA в Direct/WhatsApp, частота публикаций, что снимать в кадре.
- Запрещены пустые SMM-лозунги: «взрывной рост охватов», «контент, который взрывает ленту», «секреты алгоритма» без конкретного шага.
- Хештеги и «био» – только если есть готовая формулировка; не обещай охваты.

Структура ответа:
- Для длинных статей (≥400 слов): минимум 3 заголовка ## и хотя бы один список.
- Для коротких советов: только маркированный список, без вступления «в этой статье».

Шкала самопроверки перед ответом (1–10):
10 – каждая фраза несёт факт или действие; нет стоп-слов.
7 – норма к публикации: мало воды, есть шаги/CTA.
5 – много «важно отметить», канцелярит, общие фразы.
Ниже 7 – перепиши короче и конкретнее, пока не станет ≥7.

Запрещённые клише:
- «в сегодняшнем быстроменяющемся мире», «важно отметить», «нельзя недооценивать»;
- «давайте разберёмся», «в этой статье мы рассмотрим», «играет важную роль»;
- «комплексный подход», «синергия», «на сегодняшний день», «подводя итог», «безусловно»;
- «как известно», «не секрет, что», «в наше время», «каждый мастер знает».

Продуктовые страницы (Мастерам, /634/, UI-описания экранов):
- Не пиши «у кресла» / «перед креслом» - пиши «перед сеансом», «в работе», «в студии».
- Не пиши обрывки «Не CRM записи». Нужно отмежевание: «634 не заменяет онлайн-запись и кассу студии».
- Не выноси в интерфейс метку «УТП:» - формулируй пользу одной фразой.
- Не пиши «когда клиент приходит на продолжение» без якоря. Нужно: «на следующем сеансе по этой же татуировке».
- Без калек: «источник правды», workbench, value props, «единица работы».

Запрещено:
- длинное тире — (U+2014); используй только короткое – (U+2013);
- бессмысленные метафоры, «кружевные узоры», выдуманные рейтинги;
- markdown-артефакты вроде «слово**:»;
- англоязычные кальки без необходимости.`;

/** Extra voice lines per writer mode (shared registry for all composers). */
export const EDITORIAL_MODE_EXTRAS = {
  editorial:
    'Режим: редакционная колонка для мастера. Практика студии, запись, прайс, гигиена, контент.',
  social:
    'Режим: SMM-практика для тату-мастера. Хуки Reels/Stories, оффер, CTA, без пустых обещаний охватов.',
  tips: 'Сейчас пиши только три коротких совета списком. Без вступления и заключения.',
  insights: 'Ответ – только 3 пункта списка. По одному предложению на пункт.',
  sarcasm:
    'Голос: женщина-главред, сарказм, защита команды. Едко, но по делу; в конце – практический вывод.',
  review:
    'Режим: обзор товара для мастера. Только факты из задания; плюсы/минусы/вердикт; без выдуманных рейтингов.',
  birthday:
    'Режим: SEO-статья по дате рождения для клиента. День месяца уникален; стили и мотивы – из фактов задания.',
  soft: 'Режим: короткий полезный пост. 1 мысль, 2–4 абзаца или короткий список, один CTA.',
  product:
    'Режим: продуктовый SEO-копирайт (Мастерам, /634/, лендинги, гайды). Пиши для тату-мастера. Каждый абзац держит якорь: чья татуировка, какой проект, какой сеанс, какой эскиз. Запрещены «у кресла», обрывки «Не CRM записи», метка «УТП:», голые «продолжение» / «когда клиент приходит» без уточнения работы, кальки «источник правды» / workbench / «единица работы». Если нужно отмежеваться от онлайн-записи - одно ясное предложение. Польза - в факте, не в ярлыке.',
  rewrite:
    'Задача rewrite-pass: перепиши ярче и плотнее, сохрани факты и markdown. Удали канцелярит и AI-клише. URL не меняй.'
};

/**
 * Build system prompt for a writer mode.
 * @param {keyof typeof EDITORIAL_MODE_EXTRAS | string} [mode]
 * @param {string} [extra]
 */
export function editorialSystemPrompt(mode = 'editorial', extra = '') {
  const bit = EDITORIAL_MODE_EXTRAS[mode] || '';
  return [EDITORIAL_STYLE_RU, bit, extra].filter(Boolean).join('\n\n');
}

export const REWRITE_STYLE_RU = editorialSystemPrompt('rewrite');

const AI_CLICHE_JS = [
  [/^важно\s+отметить[,:]?\s*/gim, ''],
  [/^стоит\s+отметить[,:]?\s*/gim, ''],
  [/^безусловно,\s*/gim, ''],
  [/^как\s+известно,\s*/gim, ''],
  [/^не\s+секрет,\s+что\s*/gim, ''],
  [/в\s+сегодняшнем\s+(быстроменяющемся|динамичном)\s+мире[, ]*/gi, ''],
  [/давайте\s+разбер[её]мся[.:!]?\s*/gi, ''],
  [/в\s+этой\s+статье\s+мы\s+рассмотрим[^.?!]*[.?!]\s*/gi, ''],
  [/подводя\s+итог[,:]?\s*/gi, ''],
  [/на\s+сегодняшний\s+день\s*/gi, 'сейчас '],
  [/играет\s+важную\s+роль/gi, 'влияет на результат'],
  [/является\s+ключевым\s+фактором/gi, 'сильно влияет'],
  [/комплексный\s+подход/gi, 'системная работа'],
  [/синерги[яи]\s+контент[аеу]?,?\s+который\s+взрывает\s+(ленту|охват[ы]?)/gi, 'контент, который лучше удерживает внимание'],
  [/контент[аеу]?,?\s+который\s+взрывает\s+(ленту|охват[ы]?)/gi, 'материал, который лучше удерживает внимание'],
  [/который\s+взрывает\s+(ленту|охват[ы]?)/gi, 'который лучше удерживает внимание'],
  [/синерги[яи]/gi, 'согласованность'],
  [/взрывной\s+рост\s+охватов/gi, 'рост охватов'],
  [/каждый\s+мастер\s+знает[,:]?\s*/gi, ''],
  [/секреты?\s+успеха/gi, 'рабочие приёмы'],
  [/нельзя\s+недооценивать\s*/gi, ''],
  [/в\s+наше\s+время\s*/gi, 'сейчас ']
];

/** Soft JS strip of AI/SMM fluff (mirrors Python strip_ai_cliches). */
export function stripAiClichesJs(text = '') {
  let t = String(text || '');
  for (const [re, repl] of AI_CLICHE_JS) t = t.replace(re, repl);
  return t.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Repair http(s) URLs damaged by typography (spaces after dots, capitalized host).
 * Example: https://www. Tattoomarket. Ru/x → https://www.tattoomarket.ru/x
 */
export function healBrokenHttpUrls(text = '') {
  return String(text || '').replace(
    /https?:\/\/(?:[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%\-]| (?=[A-Za-z0-9%._~+\-?=&#/]))+/g,
    (raw) => {
      const compact = raw.replace(/ /g, '');
      try {
        const u = new URL(compact);
        u.hostname = u.hostname.toLowerCase();
        return u.toString();
      } catch {
        return compact;
      }
    }
  );
}

export function polishTypographyJs(text = '', { preserveMarkdown = true } = {}) {
  let t = healBrokenHttpUrls(String(text || ''))
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ');

  // always fix broken artifacts like «слово**:»
  t = t.replace(/(\w)\*\*:/g, '$1:');

  if (!preserveMarkdown) {
    t = t.replace(/\*\*([^*]+)\*\*/g, '$1');
    t = t.replace(/`+/g, '');
  }

  // Protect URLs and existing mask tokens from spacing/capitalization rules
  const urls = [];
  t = t.replace(/https?:\/\/[^\s)\]]+/g, (u) => {
    urls.push(u);
    return `@@URL${urls.length - 1}@@`;
  });
  t = t.replace(/⟦URL(\d+)⟧/g, (_, n) => `@@URLKEEP${n}@@`);

  if ((t.match(/"/g) || []).length >= 2) {
    let open = true;
    t = t.replace(/"/g, () => {
      const q = open ? '«' : '»';
      open = !open;
      return q;
    });
  }

  t = t
    // Mandatory: never em-dash — only short en-dash –
    .replace(/\u2014/g, '–')
    // Only mid-sentence "word - word" → en-dash; never markdown list markers at line start
    .replace(/([^\s\n])[ \t]+-[ \t]+/g, '$1 – ')
    .replace(/([^\s\n])[ \t]+–[ \t]+/g, '$1 – ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\s+,/g, ',')
    .replace(/\s+\./g, '.')
    .replace(/\s+!/g, '!')
    .replace(/\s+\?/g, '?')
    .replace(/,{2,}/g, ',')
    .replace(/\.([A-Za-zА-Яа-яЁё])/g, '. $1')
    .replace(/\?([A-Za-zА-Яа-яЁё])/g, '? $1')
    .replace(/!([A-Za-zА-Яа-яЁё])/g, '! $1')
    .replace(/([.?!…]\s+)([a-zа-яё])/g, (_, a, b) => a + b.toUpperCase())
    .replace(/\bвообщем\b/gi, 'в общем')
    .replace(/\bщас\b/gi, 'сейчас');

  t = t
    .split('\n')
    .map((line) => {
      const s = line.trimStart();
      if (
        !s ||
        s.startsWith('#') ||
        s.startsWith('•') ||
        s.startsWith('- ') ||
        s.startsWith('* ') ||
        s.startsWith('**') ||
        /^\d+\./.test(s)
      ) {
        return line;
      }
      const lead = line.slice(0, line.length - s.length);
      if (/[a-zа-яё]/.test(s[0])) {
        return lead + s[0].toUpperCase() + s.slice(1);
      }
      return line;
    })
    .join('\n');

  t = t.replace(/@@URLKEEP(\d+)@@/g, (_, n) => `⟦URL${n}⟧`);
  t = t.replace(/@@URL(\d+)@@/g, (_, n) => {
    const i = Number(n);
    return urls[i] != null ? urls[i] : `@@URL${i}@@`;
  });
  return healBrokenHttpUrls(t.trim());
}

function maskUrls(text) {
  const urls = [];
  let masked = String(text || '');
  // Protect markdown images first (paths or absolute URLs)
  masked = masked.replace(/!\[[^\]]*\]\(([^)]+)\)/g, (_full, src) => {
    urls.push(src);
    return `![img](@@URL${urls.length - 1}@@)`;
  });
  masked = masked.replace(/https?:\/\/[^\s)\]]+/g, (u) => {
    urls.push(u);
    return `@@URL${urls.length - 1}@@`;
  });
  return { masked, urls };
}

function unmaskUrls(text, urls) {
  return String(text || '').replace(/@@URL(\d+)@@/g, (_, n) => urls[Number(n)] || '');
}

function emptyPolish(text, engine = 'js') {
  return {
    text: String(text || '').trim(),
    changed: false,
    score: null,
    ok: true,
    engine,
    editorialScore: null,
    infoScore: null,
    gate: null,
    hints: [],
    grammar: [],
    krrkt: null,
    entities: [],
    structure: null
  };
}

export function polishWithPython(text, { soft = false, preserveMarkdown = true, gate = true } = {}) {
  const { masked, urls } = maskUrls(text);
  if (!VENV_PY || !existsSync(POLISH_PY) || !text) {
    const js = unmaskUrls(polishTypographyJs(masked, { preserveMarkdown }), urls);
    return { ...emptyPolish(js, 'js'), text: js };
  }
  try {
    const args = [POLISH_PY, '--json'];
    if (soft) args.push('--soft');
    if (preserveMarkdown) args.push('--keep-md');
    if (gate === false || process.env.NEWS_EDITORIAL_GATE === '0') args.push('--no-gate');
    const res = spawnSync(VENV_PY, args, {
      input: masked,
      encoding: 'utf8',
      timeout: 45000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env }
    });
    if (res.status !== 0 && !res.stdout) {
      const js = unmaskUrls(polishTypographyJs(masked, { preserveMarkdown }), urls);
      return { ...emptyPolish(js, 'js-fallback'), text: js };
    }
    const data = JSON.parse(res.stdout || '{}');
    const polished = unmaskUrls(
      polishTypographyJs(data.text || masked, { preserveMarkdown }),
      urls
    );
    return {
      text: polished,
      changed: Boolean(data.changed) || polished !== String(text || '').trim(),
      score: data.score,
      metrics: data.metrics,
      structure: data.structure || data.metrics?.structure || null,
      hints: data.hints || [],
      ok: data.ok !== false,
      engine: 'python',
      editorialScore: data.editorial_score ?? data.gate?.editorial_score ?? null,
      infoScore: data.info_score ?? data.krrkt?.score ?? null,
      gate: data.gate || null,
      grammar: data.grammar || [],
      spellIssues: data.spell_issues || [],
      krrkt: data.krrkt || null,
      entities: data.entities || []
    };
  } catch {
    const js = unmaskUrls(polishTypographyJs(masked, { preserveMarkdown }), urls);
    return { ...emptyPolish(js, 'js-error'), text: js };
  }
}

export function polishEditorialText(text, opts = {}) {
  const deep = opts.deep !== false;
  const preserveMarkdown = opts.preserveMarkdown !== false;
  const gate = opts.gate !== false;
  const pre = opts.stripCliches !== false ? stripAiClichesJs(text) : text;
  if (deep) return polishWithPython(pre, { ...opts, preserveMarkdown, gate });
  const { masked, urls } = maskUrls(pre);
  const t = unmaskUrls(polishTypographyJs(masked, { preserveMarkdown }), urls);
  return {
    ...emptyPolish(t, 'js'),
    text: t,
    changed: t !== String(text || '').trim()
  };
}

/** True if polish/gate result is good enough to publish. */
export function passesEditorialGate(result, { minScore = KRRKT_MIN, requireGate = false } = {}) {
  if (!result) return false;
  if (process.env.NEWS_EDITORIAL_GATE === '0') return true;
  // Hard junk only. Soft polish.ok must not override an explicit gate.ok.
  if ((result.hints || []).includes('bad_pattern')) return false;
  if (result.gate) {
    if (result.gate.ok === false) return false;
    const info = result.infoScore ?? result.editorialScore ?? result.gate.info_score;
    if (
      info != null &&
      Number(info) < Number(minScore) &&
      !result.gate.skipped_krrkt
    ) {
      return false;
    }
    // Ignore soft readability polish.ok when structured gate passed
    return true;
  }
  if (result.ok === false) return false;
  if (requireGate) return false;
  return true;
}

export function isReadableEnough(text = '') {
  const t = String(text || '').trim();
  if (t.length < 40) return false;
  if (/типы пайки|пайки,\s*ножниц|кружевн|стрелочк|\w\*\*:/.test(t)) return false;
  if (/\u2014/.test(t)) return false;
  if (/как языковая модель|as an ai|lorem ipsum/i.test(t)) return false;
  return true;
}

/**
 * Soft gate reasons that a second polish/strip pass can often fix.
 */
export function isSoftGateFailure(result) {
  if (!result?.gate || result.gate.ok !== false) return false;
  const reasons = result.gate.reasons || [];
  if (!reasons.length) return false;
  const soft = new Set(['ai_cliche', 'em_dash']);
  return reasons.every((r) => soft.has(r));
}
