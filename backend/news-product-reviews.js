/**
 * Generate tattoo-master product reviews from TattooMarket cards + web research + local LLM.
 */
import { researchTopic } from './news-research.js';
import { llmGenerate, isLlmAvailable } from './news-llm.js';
import { translateText, localizeBundle } from './translate.js';
import { fetchProduct } from './tattoomarket.js';
import { scoreUsefulness, passesPublishGate } from './news-quality.js';
import {
  editorialSystemPrompt,
  polishEditorialText,
  passesEditorialGate,
  healBrokenHttpUrls
} from './news-text-polish.js';
import { normalizeCategories } from './news.js';

/**
 * Buy-link body format (FE + magazine parser contract):
 *   ## Где купить
 *   - TattooMarket: https://...
 *   - Ozon: https://...
 *   - Wildberries: https://...
 *   - Яндекс Маркет: https://...
 * Labels must match extractBuyLinks / composeMagazineLayout regex.
 * Prefer `- ` markdown lists (not `•`) so marked.lexer emits list tokens.
 */
function bullets(items) {
  return items.map((x) => `- ${x}`).join('\n');
}

function formatBuySection(links) {
  return ['## Где купить', bullets(links.map((l) => `${l.label}: ${l.url}`))].join('\n');
}

function stripBuySection(body) {
  return String(body || '')
    .replace(/\n##\s*Где купить[\s\S]*?(?=\n##\s|\n_[^\n]*$|$)/gi, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function researchDigest(research) {
  const lines = [];
  for (const r of research.slice(0, 5)) {
    const bit = (r.snippet || r.pageText || '').replace(/\s+/g, ' ').trim();
    if (!bit || bit.length < 40) continue;
    lines.push(`- ${bit.slice(0, 260)}${bit.length > 260 ? '…' : ''} _(источник: ${r.title})_`);
  }
  return lines;
}

function parseNeedleSpec(name = '') {
  const m = String(name).match(/(\d{2})\s*[\/×x]\s*(\d+)\s*([A-Z]{2,6})/i);
  if (!m) return null;
  return { diameter: m[1], count: Number(m[2]), code: m[3].toUpperCase() };
}

function useWhenNot(product, category) {
  const name = product.name || '';
  const spec = parseNeedleSpec(name);
  const isLiner = /liner|rl|линей/i.test(name);
  const isShader = /shader|rs|rm|m1|зали|shader/i.test(name);
  const isPigment = category === 'pigments' || /пигмент|ink|краск/i.test(name);

  if (isPigment) {
    return {
      use: [
        'Подбор оттенка под ваш стиль и ожидаемое заживление на утиль-коже',
        'Сверка партии и насыщения до клиентской работы',
        'Работа в привычной технике, где уже известна плотность проходов'
      ],
      avoid: [
        'Смешивать партии «на глаз» без пометки в карточке клиента',
        'Обещать клиенту «вечный цвет» без оглядки на уход и тип кожи',
        'Менять бренд на большом проекте без тестового участка'
      ]
    };
  }

  if (isLiner || (spec && /RL/i.test(spec.code))) {
    return {
      use: [
        'Контур, тонкие линии, орнамент, lettering малым кеглем',
        'Детали и «иголочная» графика, где важна острота линии',
        'Тест на утиль-коже: стабильность линии на вашем ходе и напряжении'
      ],
      avoid: [
        'Плотный блэкворк / крупные заливки — берите shader / magnum',
        'Глубокая растушёвка и мягкие переходы — не задача liner',
        'Работать «на клиенте сразу» без пробы, если меняли машину или ход'
      ]
    };
  }

  if (isShader || (spec && /RS|RM|M1/i.test(spec.code))) {
    return {
      use: [
        'Залив, тень, мягкие переходы и плотные участки',
        'Сравнение расхода с вашей обычной конфигурацией за сеанс',
        'Проверка комфорта мембраны и люфта на вашей машине'
      ],
      avoid: [
        'Сверхтонкий контур и микро-деталь — лучше liner меньшего диаметра',
        'Слишком агрессивный ход «в надежде на скорость» без теста на утиль-коже',
        'Менять конфигурацию mid-session на большом проекте без плана'
      ]
    };
  }

  return {
    use: [
      'Протестируйте на утиль-коже до клиентской работы',
      'Зафиксируйте связку машина + ход + напряжение',
      'Сверьте цену/фасовку перед закупкой партии'
    ],
    avoid: [
      'Брать крупную партию без теста на вашей машине',
      'Менять расходник mid-project без контрольного участка',
      'Опираться только на маркетинговое описание карточки'
    ]
  };
}

function priceBand(product) {
  if (!product.prices?.length) return 'цену сверяйте по фасовке в карточке';
  return product.prices.map((p) => `${p.label}: ${p.price}`).join('; ');
}

function peerLine(peer, product, category) {
  const brand = product.brand || 'этой позиции';
  const prices = priceBand(product);
  const spec = parseNeedleSpec(product.name || '');
  const specHint = spec
    ? `близкий ориентир: ${spec.diameter}/${spec.count}${spec.code}`
    : 'берите близкий диаметр и счёт игл';

  if (category === 'pigments') {
    const pigmentMap = {
      'World Famous': `World Famous: ярче «витринный» пигмент, часто дороже мл; рядом с ${brand} смотрите насыщение после заживления и цену флакона (${prices}).`,
      Eternal: `Eternal: плотная укрывистость, привычный выбор для колора; сравните расход мл/сеанс и цену с ${brand} (${prices}).`,
      Dynamic: `Dynamic: часто берут как рабочий black/база; смотрите густоту, седину после заживления и цену литра/флакона vs ${brand}.`,
      Panthera: `Panthera: сильный сегмент black/grey; сравните глубину чёрного и цену с ${brand} (${prices}), без обещаний «навсегда».`
    };
    return (
      pigmentMap[peer] ||
      `${peer}: сравните насыщение, расход и цену флакона с ${brand} (${prices}).`
    );
  }

  const needleMap = {
    Cheyenne: `Cheyenne (Capillary/Craft): обычно дороже коробкой, посадка и мембрана под их экосистему; линия часто «суше» на том же ходе. Рядом с ${brand} сверьте цену (${prices}) и люфт на вашей машинке (${specHint}).`,
    Bishop: `Bishop: сильный сегмент liner/shader под ротари, отдача часто жёстче. Сравните цену за шт/коробку с ${brand} (${prices}) и стабильность линии/залива на вашей связке (${specHint}).`,
    'FK Irons / Spektra': `FK Irons / Spektra: удобны, если уже на их машинах/хвостовиках. Смотрите посадку, расход за сеанс и цену коробки рядом с ${brand} (${prices}).`,
    Critical: `Critical: чаще машинки/БП, чем расходники; если сравниваете иглы - берите ${specHint} и цену коробки vs ${brand} (${prices}).`
  };
  return (
    needleMap[peer] ||
    `${peer}: сравните цену коробки, посадку на машине и стабильность линии/залива с ${brand} (${prices}).`
  );
}

function compareBlocks(product, category) {
  const brand = product.brand || 'этого бренда';
  const name = product.name || 'позиции';
  const otherBrands =
    category === 'pigments'
      ? ['World Famous', 'Eternal', 'Dynamic', 'Panthera']
      : ['Cheyenne', 'Bishop', 'FK Irons / Spektra', 'Critical'];
  const peers = otherBrands.filter((b) => !new RegExp(b.split(/\s|\//)[0], 'i').test(brand)).slice(0, 3);

  const sameBrandUpDown = [];
  const spec = parseNeedleSpec(name);
  if (spec) {
    const d = Number(spec.diameter);
    sameBrandUpDown.push(
      `Рядом по линейке ${brand}: диаметр ${String(d - 5).padStart(2, '0')} / ${spec.count}${spec.code} - мягче/тоньше линия (если есть в каталоге).`
    );
    sameBrandUpDown.push(
      `Рядом по линейке ${brand}: диаметр ${String(d + 5).padStart(2, '0')} / ${spec.count}${spec.code} - плотнее след, быстрее закрытие линии.`
    );
    if (spec.count === 1) {
      sameBrandUpDown.push(
        `Вариант ${spec.diameter}/3${spec.code} той же серии - если нужен чуть более «мясистый» контур.`
      );
    }
  } else {
    sameBrandUpDown.push(`Сверьте соседние SKU ${brand} в той же серии: на шаг тоньше и на шаг плотнее.`);
    sameBrandUpDown.push(`Если берёте коробку - сравните фасовку 5 vs 20 шт по цене за штуку.`);
  }

  return {
    peers,
    peerLines: peers.map((b) => peerLine(b, product, category)),
    sameBrandUpDown
  };
}

function buyLinks(product) {
  const q = encodeURIComponent(
    [product.brand, product.name].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 120)
  );
  const links = [
    { id: 'tattoomarket', label: 'TattooMarket', url: product.url, primary: true },
    { id: 'ozon', label: 'Ozon', url: `https://www.ozon.ru/search/?text=${q}` },
    { id: 'wb', label: 'Wildberries', url: `https://www.wildberries.ru/catalog/0/search.aspx?search=${q}` },
    {
      id: 'yandex',
      label: 'Яндекс Маркет',
      url: `https://market.yandex.ru/search?text=${q}`
    }
  ];
  return links;
}

function summaryInsight(product, useAvoid, compare) {
  const priceLine =
    product.prices?.length > 0
      ? product.prices.map((p) => `${p.label}: ${p.price}`).join('; ')
      : 'цену смотрите в магазине';
  return [
    `Кратко: ${product.name} - практический обзор для мастера.`,
    '',
    `Брать в работу, когда нужны: ${useAvoid.use[0].replace(/^./, (c) => c.toLowerCase())}.`,
    `Лучше не использовать, если задача: ${useAvoid.avoid[0].replace(/^./, (c) => c.toLowerCase())}.`,
    '',
    `Сравнение: держите в уме аналоги ${compare.peers.join(', ')} и соседние модели ${product.brand || 'бренда'} в той же серии.`,
    `Ориентир цен: ${priceLine}. Решение - после теста на утиль-коже.`
  ].join('\n');
}

function templateReview(product, researchLines, category) {
  const priceLine =
    product.prices?.length > 0
      ? product.prices.map((p) => `${p.label}: ${p.price}`).join('; ')
      : 'уточняйте актуальные цены в магазине';

  const useAvoid = useWhenNot(product, category);
  const compare = compareBlocks(product, category);
  const links = buyLinks(product);

  const pros = [
    product.brand ? `Бренд в сегменте: ${product.brand}` : 'Позиция из специализированного тату-магазина',
    product.specs?.[0] || 'Есть описание характеристик в карточке',
    'Удобно сверить цену и фасовку перед закупкой'
  ];
  const cons = [
    'Комфорт зависит от машины и техники - без теста на утиль-коже вывод неполный',
    'Цены и наличие меняются - сверяйте карточку перед заказом',
    researchLines.length
      ? 'Отзывы в открытых источниках могут быть противоречивы'
      : 'Мало независимых отзывов в открытом доступе - опирайтесь на собственный тест'
  ];

  const title = `Обзор для мастера: ${product.name}`;
  const summary = `${product.name} - практический разбор: когда брать, с чем сравнить, плюсы/минусы и где купить. Цены: ${priceLine}.`;

  const body = [
    summary,
    '',
    '## Что это',
    product.description || product.descriptionMeta || product.name,
    '',
    product.specs?.length ? '## Характеристики из карточки' : null,
    product.specs?.length ? bullets(product.specs.slice(0, 6)) : null,
    '',
    '## Для каких работ подходит',
    bullets(useAvoid.use),
    '',
    '## Для каких задач лучше не брать',
    bullets(useAvoid.avoid),
    '',
    '## Сравнение с другими производителями',
    bullets(compare.peerLines),
    '',
    `## Сравнение внутри линейки ${product.brand || 'бренда'}`,
    bullets(compare.sameBrandUpDown),
    '',
    '## Цены (ориентир)',
    bullets(
      product.prices?.length
        ? product.prices.map((p) => `${p.label} - ${p.price}`)
        : ['Смотрите актуальную цену на странице товара']
    ),
    '',
    formatBuySection(links),
    '',
    '## Как тестировать в студии',
    bullets([
      'Протестируйте на утиль-коже: линия / залив / тень - до клиентской работы.',
      'Зафиксируйте связку машина + ход + напряжение под этот картридж/иглу.',
      'Сравните расход за сеанс с вашей обычной конфигурацией.'
    ]),
    '',
    '## Плюсы',
    bullets(pros),
    '',
    '## Минусы и риски',
    bullets(cons),
    '',
    researchLines.length ? '## Отзывы мастеров и заметки из сети' : null,
    researchLines.length ? researchLines.join('\n') : null,
    '',
    '## Вердикт',
    `Имеет смысл брать в тест, если «${product.name}» закрывает ваши задачи из блока выше. Решение - после пробы на утиль-коже и сравнения с текущей связкой.`,
    '',
    `_Обзор Sitrifor AI по карточке TattooMarket и открытым источникам. Не реклама: сверяйте наличие и цену у продавца._`
  ]
    .filter((x) => x !== null)
    .join('\n');

  const insights = summaryInsight(product, useAvoid, compare);

  return { title, summary, body, insights, buyLinks: links, useAvoid };
}

async function llmReview(product, researchLines, category) {
  const ok = await isLlmAvailable();
  if (!ok) return null;

  const useAvoid = useWhenNot(product, category);
  const compare = compareBlocks(product, category);

  const facts = [
    `Название: ${product.name}`,
    product.brand ? `Бренд: ${product.brand}` : null,
    `URL: ${product.url}`,
    product.description ? `Описание: ${product.description.slice(0, 900)}` : null,
    product.prices?.length ? `Цены: ${product.prices.map((p) => `${p.label}=${p.price}`).join('; ')}` : null,
    product.specs?.length ? `Спеки: ${product.specs.slice(0, 6).join(' | ')}` : null,
    `Когда уместно: ${useAvoid.use.join('; ')}`,
    `Когда лучше не брать: ${useAvoid.avoid.join('; ')}`,
    `Аналоги других брендов (используй эти формулировки, не копируй одну фразу на всех):\n${(compare.peerLines || compare.peers).map((x) => `- ${x}`).join('\n')}`,
    researchLines.length ? `Заметки из сети:\n${researchLines.join('\n')}` : 'Независимых отзывов мало.'
  ]
    .filter(Boolean)
    .join('\n');

  const prompt = `Напиши обзор товара для тату-мастеров на русском.

Факты (не выдумывай других характеристик и URL):
${facts}

Категория: ${category}

Формат строго markdown:
# Заголовок (начни с «Обзор для мастера:»)
Краткое summary одним абзацем.

## Что это
## Для каких работ подходит
## Для каких задач лучше не брать
## Сравнение с другими производителями
## Сравнение внутри линейки
## Как тестировать в студии
## Плюсы
## Минусы и риски
## Отзывы мастеров (только если есть факты выше; иначе пропусти раздел)
## Вердикт

Правила:
- только факты из блока выше + здравый смысл практики;
- без медицинских гарантий; без выдуманных рейтингов;
- списки только markdown с «- » (не «•»);
- в сравнении с брендами - разные конкретные отличия (цена, посадка, тип иглы/пигмента), не одна общая фраза «надо пробовать»;
- не добавляй раздел «Где купить» и не пиши URL (ссылки добавит система);
- не ломай URL пробелами; в русском тексте только короткий дефис «-», без длинного тире.`;

  const text = await llmGenerate(prompt, {
    system: editorialSystemPrompt('review'),
    mode: 'review',
    options: { temperature: 0.3, num_ctx: 3072 },
    timeoutMs: 240000
  });
  if (!text || text.length < 280) return null;

  const lines = text.split('\n');
  let title = `Обзор для мастера: ${product.name}`.slice(0, 180);
  let i = 0;
  if (/^#\s+/.test(lines[0] || '')) {
    title = lines[0].replace(/^#\s+/, '').trim().slice(0, 180);
    i = 1;
  }
  while (i < lines.length && !lines[i].trim()) i += 1;
  let summary = (lines[i] || '').trim();
  if (!summary || /^#/.test(summary) || summary.length < 40) {
    summary = `${product.name} - практический разбор для тату-мастера: задачи, сравнение, тест в студии.`;
  } else {
    i += 1;
  }
  const body = lines.slice(i).join('\n').trim() || text;
  const insights = summaryInsight(product, useAvoid, compare);

  return {
    title: title.slice(0, 180),
    summary: summary.slice(0, 500),
    body: body.slice(0, 20000),
    insights,
    buyLinks: buyLinks(product)
  };
}

function softPolishKeepUrls(text, opts = {}) {
  // Protect URLs from language-tool / morph spacing damage
  const urls = [];
  const masked = healBrokenHttpUrls(String(text || '')).replace(/https?:\/\/[^\s)]+/g, (u) => {
    urls.push(u);
    return `⟦URL${urls.length - 1}⟧`;
  });
  const polished = polishEditorialText(masked, { soft: true, deep: true, ...opts });
  const out = healBrokenHttpUrls(
    polished.text.replace(/⟦URL(\d+)⟧/g, (_, n) => urls[Number(n)] || '')
  );
  return { ...polished, text: out };
}

/**
 * Build a full review article payload ready for insertArticle.
 */
export async function composeProductReview(productOrUrl, { category = 'gear' } = {}) {
  const product =
    typeof productOrUrl === 'string' || productOrUrl?.url || productOrUrl?.path
      ? await fetchProduct(productOrUrl.url || productOrUrl.path || productOrUrl)
      : productOrUrl;

  const q = `${product.brand || ''} ${product.name} tattoo review OR отзыв картридж OR pigment`.trim();
  let research = [];
  try {
    research = await researchTopic(q, { limit: 4 });
  } catch {
    research = [];
  }
  const researchLines = researchDigest(research);

  let draft = null;
  let usedLlm = false;
  if (process.env.NEWS_LLM_REVIEWS === '1') {
    draft = await llmReview(product, researchLines, category);
    usedLlm = Boolean(draft);
  }
  if (!draft) {
    draft = templateReview(product, researchLines, category);
  }
  if (!draft.insights) {
    draft.insights = templateReview(product, researchLines, category).insights;
  }
  if (!draft.buyLinks) {
    draft.buyLinks = buyLinks(product);
  }

  draft.title = softPolishKeepUrls(draft.title, { gate: false }).text;
  draft.summary = softPolishKeepUrls(draft.summary, { gate: false }).text;
  // Polish without shop URLs, then append a clean buy block from structured links
  const bodyPolish = softPolishKeepUrls(stripBuySection(draft.body), { gate: true });
  draft.body = `${stripBuySection(bodyPolish.text)}\n\n${formatBuySection(draft.buyLinks)}`;
  draft.insights = softPolishKeepUrls(draft.insights, { gate: false }).text;

  const insightsRu = draft.insights;
  const insightsEn = await translateText(insightsRu, 'en');
  const insightsDe = await translateText(insightsRu, 'de');

  const loc = await localizeBundle({
    title: draft.title,
    summary: draft.summary,
    body: draft.body,
    sourceLang: 'ru'
  });

  const cats = normalizeCategories(
    category === 'pigments' ? ['pigments', 'gear', 'tools'] : [category, 'gear', 'tools'],
    { primary: category === 'pigments' ? 'pigments' : category === 'studio' ? 'studio' : 'gear' }
  );

  const quality = scoreUsefulness({
    title: draft.title,
    summary: draft.summary,
    body: draft.body,
    sourceKey: 'tattoomarket-reviews',
    categories: cats
  });
  const editorialOk = passesEditorialGate(bodyPolish);
  const publishOk = passesPublishGate(quality, bodyPolish);

  return {
    product,
    title: draft.title,
    summary: draft.summary,
    body: draft.body,
    imageUrl: product.imageUrl,
    categories: cats,
    buyLinks: draft.buyLinks,
    titleRu: draft.title,
    summaryRu: draft.summary,
    bodyRu: draft.body,
    titleEn: loc.titleEn,
    summaryEn: loc.summaryEn,
    bodyEn: loc.bodyEn,
    titleDe: loc.titleDe,
    summaryDe: loc.summaryDe,
    bodyDe: loc.bodyDe,
    insightsRu,
    insightsEn: insightsEn || insightsRu,
    insightsDe: insightsDe || insightsRu,
    insightsTopic: cats[0],
    usefulScore: Math.max(quality.score, 55),
    usefulReasons: [
      ...(quality.reasons || []),
      'product_review',
      'llm_or_template',
      ...(bodyPolish.infoScore != null ? [`krrkt:${bodyPolish.infoScore}`] : []),
      ...(bodyPolish.gate?.reasons || []).map((r) => `gate:${r}`),
      ...(bodyPolish.ok === false ? ['polish_ok_false'] : []),
      ...(editorialOk ? [] : ['editorial_gate_fail']),
      ...(publishOk ? [] : ['publish_gate_fail'])
    ],
    editorialScore: bodyPolish.editorialScore ?? bodyPolish.infoScore,
    editorialOk,
    publishOk,
    gateReasons: bodyPolish.gate?.reasons || [],
    polishOk: bodyPolish.ok !== false,
    researchCount: research.length,
    usedLlm
  };
}
