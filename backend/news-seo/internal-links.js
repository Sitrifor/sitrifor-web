/**
 * Safe internal link suggestions for tattoo-industry news (RU).
 * Rules-based only - no LLM.
 */

const HUBS = [
  {
    id: 'aftercare',
    href: '/guides/aftercare/',
    label: 'Уход и заживление',
    keywords: [/уход/i, /заживлен/i, /aftercare/i, /плёнк/i, /пленк/i, /saniderm/i, /second\s*skin/i, /чем\s+мазать/i]
  },
  {
    id: 'cartridges',
    href: '/guides/cartridges/',
    label: 'Картриджи и иглы',
    keywords: [/картридж/i, /\bRL\b/, /\bRS\b/, /\bM1\b/, /игл/i, /мембран/i]
  },
  {
    id: 'pigments',
    href: '/guides/pigments/',
    label: 'Пигменты и колористика',
    keywords: [/пигмент/i, /краск/i, /колористик/i, /heal[- ]?shift/i, /микс/i]
  },
  {
    id: 'machines',
    href: '/guides/machines/',
    label: 'Машинки и питание',
    keywords: [/машинк/i, /блок\s+питани/i, /wireless/i, /клипкорд/i, /stroke/i]
  },
  {
    id: 'consumables',
    href: '/guides/consumables/',
    label: 'Расходники и санитария',
    keywords: [/расходник/i, /санитар/i, /дезинфек/i, /перчатк/i, /барьер/i]
  },
  {
    id: 'sketches',
    href: '/guides/sketches/',
    label: 'Эскизы и стили',
    keywords: [/эскиз/i, /трафарет/i, /стил/i, /референс/i, /stencil/i]
  },
  {
    id: 'studio',
    href: '/guides/studio/',
    label: 'Студия и клиенты',
    keywords: [/студи/i, /клиент/i, /no-?show/i, /депозит/i, /запись/i, /maps/i, /instagram/i]
  },
  {
    id: 'education',
    href: '/guides/education/',
    label: 'Обучение мастера',
    keywords: [/обучен/i, /курс/i, /ментор/i, /ученик/i]
  },
  {
    id: 'calculator',
    href: '/tools/price-calculator/',
    label: 'Калькулятор цены',
    keywords: [/прайс/i, /цен[аыу]/i, /стоимост/i, /пакет/i, /сеанс/i, /калькулятор/i]
  },
  {
    id: 'app',
    href: '/634/',
    label: 'Приложение 634',
    keywords: [/634/i, /склад/i, /инвентар/i, /app\s*store/i, /приложен/i]
  },
  {
    id: 'guides',
    href: '/guides/',
    label: 'Гайды Sitrifor',
    keywords: [/гайд/i, /ликбез/i, /как\s+выбрать/i]
  },
  {
    id: 'masters',
    href: '/masters',
    label: 'Мастерам',
    keywords: [/мастер/i, /инструмент/i]
  },
  {
    id: 'partners',
    href: '/partners',
    label: 'Партнёрам',
    keywords: [/партнёр/i, /b2b/i, /поставщик/i, /дистриб/i]
  },
  {
    id: 'news',
    href: '/news',
    label: 'Лента новостей',
    keywords: [/новост/i, /индустри/i, /тренд/i]
  },
  {
    id: 'about',
    href: '/about',
    label: 'О проекте Sitrifor',
    keywords: [/sitrifor/i, /о\s+проект/i]
  }
];

export function suggestInternalLinks(article, { max = 3 } = {}) {
  const text = `${article.title || ''}\n${article.summary || ''}\n${(article.body || '').slice(0, 2000)}`;
  const cats = Array.isArray(article.categories) ? article.categories : [];
  const scored = [];

  for (const hub of HUBS) {
    let score = 0;
    for (const re of hub.keywords) {
      if (re.test(text)) score += 2;
    }
    if (hub.id === 'aftercare' && cats.includes('studio')) score += 1;
    if (hub.id === 'calculator' && (cats.includes('studio') || cats.includes('clients'))) score += 2;
    if (hub.id === 'app' && (cats.includes('pigments') || cats.includes('tools'))) score += 2;
    if (hub.id === 'pigments' && cats.includes('pigments')) score += 3;
    if (hub.id === 'cartridges' && cats.includes('gear')) score += 2;
    if (hub.id === 'machines' && cats.includes('gear')) score += 2;
    if (hub.id === 'sketches' && cats.includes('sketch')) score += 3;
    if (hub.id === 'studio' && cats.includes('clients')) score += 2;
    if (hub.id === 'masters' && cats.includes('gear')) score += 1;
    if (score > 0) scored.push({ ...hub, score });
  }

  scored.sort((a, b) => b.score - a.score);
  const picked = scored.slice(0, max).map(({ id, href, label }) => ({ id, href, label }));

  const have = new Set(picked.map((p) => p.id));
  if (!have.has('guides') && picked.length < max) {
    picked.push({ id: 'guides', href: '/guides/', label: 'Гайды Sitrifor' });
  }
  if (!have.has('news') && picked.length < max) {
    picked.push({ id: 'news', href: '/news', label: 'Лента новостей' });
  }
  return picked.slice(0, max);
}

/**
 * Append a short "Читайте также" block if body lacks sitrifor hub links.
 */
export function injectInternalLinksBlock(body, links) {
  const src = String(body || '');
  if (!links?.length) return src;
  if (
    /sitrifor\.ru\/(masters|news|partners|about|guides|tools|634)/i.test(src) ||
    /\]\(\/(masters|news|partners|guides|tools|634)/i.test(src)
  ) {
    return src;
  }
  if (/##\s*Читайте также/i.test(src) || /##\s*Ещё на Sitrifor/i.test(src)) {
    return src;
  }
  const lines = links.map((l) => `- [${l.label}](${l.href})`).join('\n');
  return `${src.trimEnd()}\n\n## Ещё на Sitrifor\n\n${lines}\n`;
}
