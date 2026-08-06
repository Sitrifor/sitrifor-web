/**
 * News DB for sitrifor.ru — aggregated industry feed for tattoo masters.
 * Stores titles/summaries + canonical source URLs (no full republish).
 */
import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { normalizeImageUrl } from './news-images.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, 'data');
mkdirSync(dataDir, { recursive: true });

const db = new Database(join(dataDir, 'news.db'));
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    feed_url TEXT,
    region TEXT,
    lang TEXT DEFAULT 'en',
    enabled INTEGER NOT NULL DEFAULT 1,
    last_fetch_at TEXT,
    last_status TEXT
  );

  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL,
    guid TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT,
    url TEXT NOT NULL,
    image_url TEXT,
    published_at TEXT NOT NULL,
    day TEXT NOT NULL,
    categories TEXT NOT NULL DEFAULT '[]',
    lang TEXT,
    region TEXT,
    slug TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(source_id, guid),
    FOREIGN KEY(source_id) REFERENCES sources(id)
  );

  CREATE INDEX IF NOT EXISTS idx_articles_day ON articles(day);
  CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at DESC);
  CREATE INDEX IF NOT EXISTS idx_articles_slug ON articles(slug);

  CREATE TABLE IF NOT EXISTS reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id INTEGER NOT NULL,
    reaction TEXT NOT NULL,
    visitor_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(article_id, visitor_hash, reaction),
    FOREIGN KEY(article_id) REFERENCES articles(id)
  );

  CREATE INDEX IF NOT EXISTS idx_reactions_article ON reactions(article_id);
`);

for (const sql of [
  'ALTER TABLE articles ADD COLUMN body TEXT',
  'ALTER TABLE articles ADD COLUMN title_ru TEXT',
  'ALTER TABLE articles ADD COLUMN summary_ru TEXT',
  'ALTER TABLE articles ADD COLUMN body_ru TEXT',
  'ALTER TABLE articles ADD COLUMN title_en TEXT',
  'ALTER TABLE articles ADD COLUMN summary_en TEXT',
  'ALTER TABLE articles ADD COLUMN body_en TEXT',
  'ALTER TABLE articles ADD COLUMN title_de TEXT',
  'ALTER TABLE articles ADD COLUMN summary_de TEXT',
  'ALTER TABLE articles ADD COLUMN body_de TEXT',
  'ALTER TABLE articles ADD COLUMN published INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE articles ADD COLUMN useful_score REAL',
  'ALTER TABLE articles ADD COLUMN useful_reasons TEXT',
  'ALTER TABLE articles ADD COLUMN insights_ru TEXT',
  'ALTER TABLE articles ADD COLUMN insights_en TEXT',
  'ALTER TABLE articles ADD COLUMN insights_de TEXT',
  'ALTER TABLE articles ADD COLUMN insights_topic TEXT',
  'ALTER TABLE articles ADD COLUMN views INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE articles ADD COLUMN seo_title TEXT',
  'ALTER TABLE articles ADD COLUMN seo_description TEXT',
  'ALTER TABLE articles ADD COLUMN seo_image_alt TEXT',
  'ALTER TABLE articles ADD COLUMN seo_ready INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE articles ADD COLUMN seo_optimized_at TEXT',
  'ALTER TABLE articles ADD COLUMN seo_meta TEXT'
]) {
  try {
    db.exec(sql);
  } catch {
    /* exists */
  }
}

try {
  db.exec('CREATE INDEX IF NOT EXISTS idx_articles_published_flag ON articles(published, day)');
} catch {
  /* exists */
}

/** Transparent taxonomy for tattoo-master interests */
export const NEWS_CATEGORIES = [
  { id: 'industry', label: 'Индустрия', labelEn: 'Industry', labelDe: 'Branche', description: 'Общие новости тату-мира' },
  { id: 'gear', label: 'Техника', labelEn: 'Gear', labelDe: 'Technik', description: 'Машины, блоки, расходники' },
  { id: 'pigments', label: 'Пигменты', labelEn: 'Pigments', labelDe: 'Pigmente', description: 'Краски, бренды, безопасность' },
  { id: 'sketch', label: 'Эскиз и рисунок', labelEn: 'Sketch', labelDe: 'Skizze', description: 'Procreate, тени, линии, портрет' },
  { id: 'clients', label: 'Клиенты и соцсети', labelEn: 'Clients & social', labelDe: 'Kunden & Social', description: 'Лиды, Instagram, Reels, удержание' },
  { id: 'events', label: 'Выставки', labelEn: 'Events', labelDe: 'Events', description: 'Конвенции, гостевые споты' },
  { id: 'travel', label: 'Города и страны', labelEn: 'Travel', labelDe: 'Reisen', description: 'Guest spots, релокация' },
  { id: 'studio', label: 'Студия', labelEn: 'Studio', labelDe: 'Studio', description: 'Бизнес, санитария, команда' },
  { id: 'culture', label: 'Культура', labelEn: 'Culture', labelDe: 'Kultur', description: 'Арт, история, тренды стилей' },
  { id: 'ideas', label: 'Идеи для тату', labelEn: 'Tattoo ideas', labelDe: 'Tattoo-Ideen', description: 'Мотивы и стили для портфолио мастера' },
  { id: 'tools', label: 'Инструменты', labelEn: 'Tools', labelDe: 'Tools', description: 'Сервисы, лайфхаки, автоматизация' },
  {
    id: 'for_clients',
    label: 'Для клиентов',
    labelEn: 'For clients',
    labelDe: 'Für Kunden',
    description: 'Подбор тату по дате рождения и идеи для гостей студии',
    exclusive: true
  }
];

/** Categories that never appear under «Все» or other master tags. */
export const EXCLUSIVE_CATEGORY_IDS = new Set(
  NEWS_CATEGORIES.filter((c) => c.exclusive).map((c) => c.id)
);

export function isExclusiveCategory(id) {
  return EXCLUSIVE_CATEGORY_IDS.has(String(id || ''));
}

export function articleHasExclusiveCategory(categories = []) {
  return (Array.isArray(categories) ? categories : []).some((id) => isExclusiveCategory(id));
}

const CATEGORY_IDS = new Set(NEWS_CATEGORIES.map((c) => c.id));

/** Prefer primary topic first; drop unknowns/dupes */
export function normalizeCategories(input, { primary = null } = {}) {
  const raw = Array.isArray(input) ? input : String(input || '').split(/[,|]/);
  const seen = new Set();
  const out = [];
  const push = (id) => {
    const key = String(id || '')
      .trim()
      .toLowerCase();
    if (!key || !CATEGORY_IDS.has(key) || seen.has(key)) return;
    seen.add(key);
    out.push(key);
  };
  if (primary) push(primary);
  for (const id of raw) push(id);
  return out.length ? out : ['industry'];
}

/** Strict tattoo-sphere relevance gate */
const TATTOO_SIGNAL = /tattoo|tattoos|tattooing|тату|татуир|irezumi|blackwork|stick\s*n\s*poke|sticknpoke|flash\s*sheet|guest\s*spot|tattoo\s*convention|tattoo\s*artist|тату[- ]?мастер|inked|пигмент|картридж|машинк|ротари|rotary\s*machine|coil\s*machine|aftercare|saniderm|second\s*skin|stencil\s*stuff|tattoo\s*ink|тату[- ]?салон|needle\s*cartridge|cheyenne|bishop|fk\s*irons|kwadron|panthera|world\s*famous|eternal\s*ink|dynamic\s*color|electrum|hannya|horimono|tebori|sleeve\s*tattoo|tattoo\s*sleeve/i;

const OFFTOPIC = /\b(football|soccer|premier league|nba|nfl|love island|disney\+|marvel cinematic|presidential|election|cryptocurrency|bitcoin|iphone review|concert hall|skincare dispenser|furniture and lighting|3d art career|toy story|monsters inc)\b/i;

const TATTOO_SOURCE = /^(inked|tattoo|reddit-tattoo|reddit-tradition|reddit-blackwork|reddit-realism|reddit-irezumi|reddit-stick|total-tattoo|allday|tattooing|bishop|fk-irons|eternal|dynamic|world-famous|electrum|barber|tattoo-smart|tattoo-seo|tattoo-artist|statista-culture)/i;

export function isTattooRelevant(title = '', summary = '', body = '', { sourceKey = '', tier = 'core' } = {}) {
  const text = `${title}\n${summary}\n${(body || '').slice(0, 1500)}`;
  if (OFFTOPIC.test(text) && !TATTOO_SIGNAL.test(text)) return false;

  // Sketch / drawing sources: only tattoo-design related posts
  if (tier === 'sketch' || /procreate|digitalpainting|clip-studio|illustration/i.test(sourceKey)) {
    return /tattoo|тату|stencil|flash\s*sheet|sleeve|эскиз|tattoo\s*design|tattoo\s*sketch|irezumi/i.test(text);
  }

  // Social / marketing / tools: useful for masters if actionable growth content
  if (tier === 'clients' || tier === 'tools' || /social|buffer|hootsuite|later|instagram|booksy|canva|meta-business|smallbusiness/i.test(sourceKey)) {
    return /instagram|reels?|stories|tiktok|algorithm|engagement|follower|booking|client|lead|content\s*plan|hashtag|story|охват|сторис|просмотр|маркетинг|seo|canva|schedule|caption|funnel|crm|review|отзыв|лид|клиент/i.test(text)
      && /tip|guide|how\s+to|strategy|growth|increase|boost|checklist|template|playbook|инструкц|как\s+|лайфхак|tool|automate/i.test(text);
  }

  // Confirmed tattoo-native sources
  if (TATTOO_SOURCE.test(sourceKey) || /tattoomarket/i.test(sourceKey) || ['gear', 'pigments'].includes(tier)) {
    if (TATTOO_SIGNAL.test(text)) return true;
    if (/tattoo|тату|inked|apprentice|flash|convention|aftercare|needle|cartridge|pigment|эскиз|sleeve|shop\s*owner|tattooer/i.test(text)) {
      return true;
    }
    // Reddit: require more than a photo caption / flex title
    if (/^reddit-(tattoo|tradition|blackwork|realism|irezumi|stick)/i.test(sourceKey)) {
      return /how\s+to|tip|guide|aftercare|pricing|booking|studio|sanit|pigment|cartridge|stencil|guest\s*spot|инструкц|как\s+/i.test(text);
    }
    if (sourceKey === 'statista-culture') {
      return TATTOO_SIGNAL.test(text);
    }
    if (['gear', 'pigments'].includes(tier)) return true;
    return false;
  }

  // Unknown / general culture feeds: hard require tattoo signal
  return TATTOO_SIGNAL.test(text);
}

const CATEGORY_KEYWORDS = {
  pigments: [/pigment/i, /ink\b/i, /краск/i, /пигмент/i, /eternal ink/i, /world famous/i, /dynamic ink/i, /intenze/i],
  gear: [/machine/i, /rotary/i, /cartridge/i, /needle/i, /power supply/i, /машинк/i, /картридж/i, /игл/i, /аппарат/i],
  sketch: [/procreate/i, /ipad/i, /sketch/i, /drawing/i, /эскиз/i, /рисун/i, /тень/i, /shadow/i, /linework/i, /portrait/i, /цифров/i],
  clients: [/client/i, /booking/i, /marketing/i, /instagram/i, /reels?/i, /stories/i, /lead/i, /клиент/i, /запись/i, /продвижен/i, /реклам/i, /соцсет/i, /охват/i, /сторис/i],
  tools: [/tool/i, /app\b/i, /software/i, /canva/i, /later\.com/i, /buffer/i, /booksy/i, /crm/i, /инструмент/i, /лайфхак/i, /lifehack/i, /automat/i],
  events: [/convention/i, /expo/i, /festival/i, /конвенц/i, /выставк/i, /tattoo week/i, /guest spot/i],
  travel: [/guest spot/i, /travel/i, /relocat/i, /город/i, /страна/i, /abroad/i, /tokyo/i, /berlin/i, /london/i, /москв/i],
  studio: [/studio/i, /shop\b/i, /sanit/i, /hygiene/i, /студи/i, /санитар/i, /бизнес/i, /аренда/i],
  culture: [/style/i, /tradition/i, /irezumi/i, /blackwork/i, /realism/i, /культур/i, /история/i, /тренд/i],
  for_clients: [/зодиак/i, /гороскоп/i, /дата\s*рожден/i, /принесут\s*удач/i, /родившимся/i, /китайск(ий|ого)\s*знак/i, /birth\s*date/i, /tattoo\s*by\s*birthday/i],
  ideas: [/идеи\s*(для\s*)?тату/i, /tattoo\s*ideas/i, /flash\s*sheet/i, /мотив/i],
  industry: [/tattoo/i, /тату/i, /artist/i, /мастер/i]
};

export function classifyArticle(title = '', summary = '') {
  const text = `${title} ${summary}`;
  // Birthday / client-facing luck articles → exclusive audience tag only
  if (CATEGORY_KEYWORDS.for_clients.some((re) => re.test(text))) {
    return ['for_clients'];
  }
  const hits = [];
  for (const [cat, patterns] of Object.entries(CATEGORY_KEYWORDS)) {
    if (cat === 'industry' || cat === 'for_clients') continue;
    if (patterns.some((re) => re.test(text))) hits.push(cat);
  }
  if (!hits.length) hits.push('industry');
  return [...new Set(hits)].slice(0, 3);
}

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `news-${Date.now()}`;
}

function uniqueSlug(base) {
  let slug = slugify(base);
  let n = 0;
  const exists = db.prepare('SELECT 1 FROM articles WHERE slug = ?');
  while (exists.get(slug)) {
    n += 1;
    slug = `${slugify(base).slice(0, 70)}-${n}`;
  }
  return slug;
}

export function upsertSource(row) {
  db.prepare(`
    INSERT INTO sources (key, name, url, feed_url, region, lang, enabled)
    VALUES (@key, @name, @url, @feedUrl, @region, @lang, @enabled)
    ON CONFLICT(key) DO UPDATE SET
      name = excluded.name,
      url = excluded.url,
      feed_url = excluded.feed_url,
      region = excluded.region,
      lang = excluded.lang,
      enabled = excluded.enabled
  `).run({
    key: row.key,
    name: row.name,
    url: row.url,
    feedUrl: row.feedUrl || null,
    region: row.region || null,
    lang: row.lang || 'en',
    enabled: row.enabled === false ? 0 : 1
  });
  return db.prepare('SELECT * FROM sources WHERE key = ?').get(row.key);
}

export function listSources({ enabledOnly = false } = {}) {
  if (enabledOnly) {
    return db.prepare('SELECT * FROM sources WHERE enabled = 1 ORDER BY name').all();
  }
  return db.prepare('SELECT * FROM sources ORDER BY name').all();
}

export function markSourceFetch(key, status) {
  db.prepare(`
    UPDATE sources SET last_fetch_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), last_status = ?
    WHERE key = ?
  `).run(String(status).slice(0, 200), key);
}

export function insertArticle(article) {
  const day = (article.publishedAt || new Date().toISOString()).slice(0, 10);
  const categories = JSON.stringify(normalizeCategories(article.categories || ['industry']));
  const slug = uniqueSlug(article.slugBase || article.title);
  try {
    const info = db.prepare(`
      INSERT INTO articles (
        source_id, guid, title, summary, body, url, image_url, published_at, day,
        categories, lang, region, slug,
        title_ru, summary_ru, body_ru,
        title_en, summary_en, body_en,
        title_de, summary_de, body_de,
        published, useful_score, useful_reasons,
        insights_ru, insights_en, insights_de, insights_topic
      ) VALUES (
        @sourceId, @guid, @title, @summary, @body, @url, @imageUrl, @publishedAt, @day,
        @categories, @lang, @region, @slug,
        @titleRu, @summaryRu, @bodyRu,
        @titleEn, @summaryEn, @bodyEn,
        @titleDe, @summaryDe, @bodyDe,
        @published, @usefulScore, @usefulReasons,
        @insightsRu, @insightsEn, @insightsDe, @insightsTopic
      )
    `).run({
      sourceId: article.sourceId,
      guid: String(article.guid).slice(0, 400),
      title: String(article.title).slice(0, 300),
      summary: article.summary ? String(article.summary).slice(0, 1000) : null,
      body: article.body ? String(article.body).slice(0, 24000) : null,
      url: String(article.url).slice(0, 800),
      imageUrl: normalizeImageUrl(article.imageUrl),
      publishedAt: article.publishedAt,
      day,
      categories,
      lang: article.lang || null,
      region: article.region || null,
      slug,
      titleRu: article.titleRu || null,
      summaryRu: article.summaryRu || null,
      bodyRu: article.bodyRu || null,
      titleEn: article.titleEn || null,
      summaryEn: article.summaryEn || null,
      bodyEn: article.bodyEn || null,
      titleDe: article.titleDe || null,
      summaryDe: article.summaryDe || null,
      bodyDe: article.bodyDe || null,
      published: article.published ? 1 : 0,
      usefulScore: article.usefulScore ?? null,
      usefulReasons: article.usefulReasons ? JSON.stringify(article.usefulReasons) : null,
      insightsRu: article.insightsRu || null,
      insightsEn: article.insightsEn || null,
      insightsDe: article.insightsDe || null,
      insightsTopic: article.insightsTopic || null
    });
    return { inserted: true, id: info.lastInsertRowid, slug, day };
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return { inserted: false };
    }
    throw err;
  }
}

export function updateArticleLocales(id, fields = {}) {
  db.prepare(`
    UPDATE articles SET
      title = COALESCE(@title, title),
      summary = COALESCE(@summary, summary),
      body = COALESCE(@body, body),
      image_url = COALESCE(@imageUrl, image_url),
      categories = COALESCE(@categories, categories),
      title_ru = COALESCE(@titleRu, title_ru),
      summary_ru = COALESCE(@summaryRu, summary_ru),
      body_ru = COALESCE(@bodyRu, body_ru),
      title_en = COALESCE(@titleEn, title_en),
      summary_en = COALESCE(@summaryEn, summary_en),
      body_en = COALESCE(@bodyEn, body_en),
      title_de = COALESCE(@titleDe, title_de),
      summary_de = COALESCE(@summaryDe, summary_de),
      body_de = COALESCE(@bodyDe, body_de),
      published = COALESCE(@published, published),
      useful_score = COALESCE(@usefulScore, useful_score),
      useful_reasons = COALESCE(@usefulReasons, useful_reasons),
      insights_ru = COALESCE(@insightsRu, insights_ru),
      insights_en = COALESCE(@insightsEn, insights_en),
      insights_de = COALESCE(@insightsDe, insights_de),
      insights_topic = COALESCE(@insightsTopic, insights_topic)
    WHERE id = @id
  `).run({
    id,
    title: fields.title || null,
    summary: fields.summary || null,
    body: fields.body || null,
    imageUrl: normalizeImageUrl(fields.imageUrl),
    categories: fields.categories
      ? typeof fields.categories === 'string'
        ? fields.categories
        : JSON.stringify(normalizeCategories(fields.categories))
      : null,
    titleRu: fields.titleRu || null,
    summaryRu: fields.summaryRu || null,
    bodyRu: fields.bodyRu || null,
    titleEn: fields.titleEn || null,
    summaryEn: fields.summaryEn || null,
    bodyEn: fields.bodyEn || null,
    titleDe: fields.titleDe || null,
    summaryDe: fields.summaryDe || null,
    bodyDe: fields.bodyDe || null,
    published: typeof fields.published === 'number' ? fields.published : fields.published === true ? 1 : fields.published === false ? 0 : null,
    usefulScore: fields.usefulScore ?? null,
    usefulReasons: fields.usefulReasons
      ? typeof fields.usefulReasons === 'string'
        ? fields.usefulReasons
        : JSON.stringify(fields.usefulReasons)
      : null,
    insightsRu: fields.insightsRu || null,
    insightsEn: fields.insightsEn || null,
    insightsDe: fields.insightsDe || null,
    insightsTopic: fields.insightsTopic || null
  });
}

function pickLocale(row, field, lang) {
  const original = row[field];
  if (lang === 'ru') return row[`${field}_ru`] || original;
  if (lang === 'en') return row[`${field}_en`] || original;
  if (lang === 'de') return row[`${field}_de`] || original;
  return original;
}

function localeFieldOk(row, field, lang) {
  const v = row[`${field}_${lang}`];
  return Boolean(v && String(v).trim());
}

/** True when EN/DE locale text still looks like Russian (silent RU fallback / bad copy). */
function looksCyrillicHeavy(text) {
  const s = String(text || '');
  if (s.length < 12) return false;
  const cyr = (s.match(/[А-Яа-яЁё]/g) || []).length;
  const lat = (s.match(/[A-Za-z]/g) || []).length;
  return cyr >= 8 && cyr > lat;
}

function localeAvailability(row) {
  const enTitle = row.title_en || '';
  const enBody = row.body_en || '';
  const deTitle = row.title_de || '';
  const deBody = row.body_de || '';
  return {
    ru: localeFieldOk(row, 'title', 'ru') || Boolean(row.title),
    en:
      localeFieldOk(row, 'title', 'en') &&
      localeFieldOk(row, 'body', 'en') &&
      !looksCyrillicHeavy(enTitle) &&
      !looksCyrillicHeavy(enBody.slice(0, 400)),
    de:
      localeFieldOk(row, 'title', 'de') &&
      localeFieldOk(row, 'body', 'de') &&
      !looksCyrillicHeavy(deTitle) &&
      !looksCyrillicHeavy(deBody.slice(0, 400))
  };
}

function mapArticle(row, { lang = 'ru' } = {}) {
  if (!row) return null;
  const counts = db.prepare(`
    SELECT reaction, COUNT(*) AS c FROM reactions
    WHERE article_id = ? GROUP BY reaction
  `).all(row.id);
  const reactions = { rocket: 0, smile: 0, poop: 0 };
  for (const c of counts) reactions[c.reaction] = c.c;

  const title = pickLocale(row, 'title', lang);
  const summary = pickLocale(row, 'summary', lang);
  const body = pickLocale(row, 'body', lang);
  const insights =
    lang === 'en'
      ? row.insights_en || row.insights_ru
      : lang === 'de'
        ? row.insights_de || row.insights_ru
        : row.insights_ru || row.insights_en;

  const usefulReasons = (() => {
    try {
      return JSON.parse(row.useful_reasons || '[]');
    } catch {
      return [];
    }
  })();
  const isReview =
    row.source_key === 'tattoomarket-reviews' ||
    (Array.isArray(usefulReasons) && usefulReasons.includes('product_review'));
  const isEditor =
    row.source_key === 'sitrifor-editor' ||
    (Array.isArray(usefulReasons) && usefulReasons.includes('editor_sarcasm'));
  const formatReason = (usefulReasons || []).find((r) => String(r).startsWith('format:'));
  const formatType = formatReason ? String(formatReason).slice(7) : null;

  let articleType = 'editorial';
  if (isReview) articleType = 'review';
  else if (isEditor) articleType = 'editor_sarcasm';
  else if (formatType) articleType = formatType;

  return {
    id: row.id,
    slug: row.slug,
    title,
    summary,
    body: body || summary || '',
    insights: insights || '',
    insightsTopic: row.insights_topic || null,
    imageUrl: normalizeImageUrl(row.image_url),
    titleOriginal: row.title,
    summaryOriginal: row.summary,
    publishedAt: row.published_at,
    day: row.day,
    categories: JSON.parse(row.categories || '[]'),
    lang: row.lang,
    displayLang: lang,
    region: row.region,
    path: `/news/a/${row.slug}`,
    sourceKey: row.source_key || null,
    sourceName: row.source_name,
    sourceUrl: row.source_url || null,
    usefulScore: row.useful_score,
    usefulReasons,
    articleType,
    url: row.url || null,
    views: Number(row.views || 0),
    published: Boolean(row.published),
    reactions,
    localeAvailability: localeAvailability(row),
    seo: mapSeo(row, { title, summary })
  };
}

function mapSeo(row, { title, summary } = {}) {
  let meta = {};
  try {
    meta = JSON.parse(row.seo_meta || '{}') || {};
  } catch {
    meta = {};
  }
  const seoTitle = row.seo_title || title || row.title || '';
  const seoDescription = row.seo_description || summary || row.summary || title || '';
  const canonical = `https://sitrifor.ru/news/a/${row.slug}`;
  return {
    title: seoTitle,
    description: String(seoDescription).slice(0, 160),
    imageAlt: row.seo_image_alt || seoTitle || 'Sitrifor',
    ready: Boolean(row.seo_ready),
    optimizedAt: row.seo_optimized_at || null,
    canonical,
    robots: meta.robots || 'index, follow',
    ogTitle: meta.ogTitle || seoTitle,
    ogDescription: meta.ogDescription || String(seoDescription).slice(0, 160),
    ogImage: meta.ogImage || normalizeImageUrl(row.image_url) || 'https://sitrifor.ru/img/marketing/app-card-bg.jpg',
    twitterCard: meta.twitterCard || 'summary_large_image',
    jsonLd: meta.jsonLd || null,
    internalLinks: Array.isArray(meta.internalLinks) ? meta.internalLinks : []
  };
}

const articleSelect = `
  SELECT a.*, s.key AS source_key, s.name AS source_name, s.url AS source_url, s.region AS source_region
  FROM articles a
  JOIN sources s ON s.id = a.source_id
`;

export function getArticlesByDay(day, { tag = null, limit = 200, lang = 'ru', publishedOnly = true } = {}) {
  let rows;
  const pub = publishedOnly ? ' AND a.published = 1' : '';
  if (tag) {
    rows = db.prepare(`
      ${articleSelect}
      WHERE a.day = ? AND a.categories LIKE ?${pub}
      ORDER BY a.published_at DESC
      LIMIT ?
    `).all(day, `%"${tag}"%`, limit);
  } else {
    rows = db.prepare(`
      ${articleSelect}
      WHERE a.day = ?${pub}
      ORDER BY a.published_at DESC
      LIMIT ?
    `).all(day, limit);
  }
  const mapped = rows.map((row) => mapArticle(row, { lang }));
  // «Все» and master tags: hide exclusive audience categories (e.g. for_clients)
  if (!tag) {
    return mapped.filter((a) => !articleHasExclusiveCategory(a.categories));
  }
  if (!isExclusiveCategory(tag)) {
    return mapped.filter((a) => !articleHasExclusiveCategory(a.categories));
  }
  return mapped;
}

function articleMatchesTagFilter(categoriesJson, tag) {
  try {
    const cats = JSON.parse(categoriesJson || '[]');
    if (!Array.isArray(cats)) return false;
    if (tag) return cats.includes(tag);
    return !articleHasExclusiveCategory(cats);
  } catch {
    return !tag;
  }
}

export function getCalendarMonth(yearMonth, { tag = null } = {}) {
  // yearMonth: YYYY-MM
  const rows = db.prepare(`
    SELECT day, categories
    FROM articles
    WHERE day LIKE ? AND published = 1
  `).all(`${yearMonth}-%`);
  const map = {};
  for (const r of rows) {
    if (!articleMatchesTagFilter(r.categories, tag)) continue;
    map[r.day] = (map[r.day] || 0) + 1;
  }
  return map;
}

export function getDaysWithNews({ before = null, limit = 14, tag = null } = {}) {
  const rows = before
    ? db
        .prepare(
          `
      SELECT day, categories FROM articles
      WHERE day < ? AND published = 1
      ORDER BY day DESC
    `
        )
        .all(before)
    : db
        .prepare(
          `
      SELECT day, categories FROM articles
      WHERE published = 1
      ORDER BY day DESC
    `
        )
        .all();

  const byDay = new Map();
  for (const r of rows) {
    if (!articleMatchesTagFilter(r.categories, tag)) continue;
    byDay.set(r.day, (byDay.get(r.day) || 0) + 1);
  }
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, limit)
    .map(([day, count]) => ({ day, count }));
}

export function getArticleBySlug(slug, { lang = 'ru', publishedOnly = true } = {}) {
  const row = db
    .prepare(`${articleSelect} WHERE a.slug = ?${publishedOnly ? ' AND a.published = 1' : ''}`)
    .get(slug);
  return mapArticle(row, { lang });
}

export function getArticleById(id, { lang = 'ru' } = {}) {
  const row = db.prepare(`${articleSelect} WHERE a.id = ?`).get(id);
  return mapArticle(row, { lang });
}

/** Raw row for birthday topic id (bday-MM-DD-YYYY) via guid / useful_reasons. */
export function findRawArticleByBirthdayTopic(topicId) {
  const id = String(topicId || '');
  if (!id) return null;
  return (
    db
      .prepare(
        `${articleSelect}
         WHERE a.guid LIKE ? OR a.useful_reasons LIKE ?
         ORDER BY a.id DESC LIMIT 1`
      )
      .get(`%${id}%`, `%topic:${id}%`) || null
  );
}

export function listArticlesNeedingBody({ limit = 50 } = {}) {
  return db.prepare(`
    ${articleSelect}
    WHERE (a.body IS NULL OR TRIM(a.body) = '' OR length(a.body) < 120)
    ORDER BY a.published_at DESC
    LIMIT ?
  `).all(limit);
}

export function listArticlesNeedingRu({ limit = 50 } = {}) {
  return db.prepare(`
    ${articleSelect}
    WHERE (a.title_ru IS NULL OR a.body_ru IS NULL OR a.title_en IS NULL OR a.title_de IS NULL)
      AND (a.body IS NOT NULL AND length(a.body) > 20)
    ORDER BY a.published_at DESC
    LIMIT ?
  `).all(limit);
}

export function setSourcesEnabled(keys, enabled) {
  const stmt = db.prepare('UPDATE sources SET enabled = ? WHERE key = ?');
  const run = db.transaction((list) => {
    for (const key of list) stmt.run(enabled ? 1 : 0, key);
  });
  run(keys);
}

export function disableSourcesNotIn(keys) {
  const keep = new Set(keys);
  const all = db.prepare('SELECT key FROM sources').all();
  const disable = all.map((r) => r.key).filter((k) => !keep.has(k));
  if (disable.length) setSourcesEnabled(disable, false);
  return disable.length;
}

export function purgeIrrelevantArticles() {
  // Drop everything from disabled sources first
  const fromDisabled = db.prepare(`
    SELECT a.id FROM articles a
    JOIN sources s ON s.id = a.source_id
    WHERE s.enabled = 0
  `).all();
  const del = db.prepare('DELETE FROM articles WHERE id = ?');
  const delReact = db.prepare('DELETE FROM reactions WHERE article_id = ?');
  let removed = 0;
  for (const row of fromDisabled) {
    delReact.run(row.id);
    del.run(row.id);
    removed += 1;
  }

  const rows = db.prepare(`${articleSelect}`).all();
  for (const row of rows) {
    const ok = isTattooRelevant(row.title, row.summary || '', row.body || '', {
      sourceKey: row.source_key || '',
      tier: /procreate|sketch/i.test(row.source_key || '') ? 'sketch' : 'core'
    });
    if (!ok) {
      delReact.run(row.id);
      del.run(row.id);
      removed += 1;
    }
  }
  return removed;
}

export function usedCategoryIds({ publishedOnly = true } = {}) {
  const pub = publishedOnly ? ' WHERE published = 1' : '';
  const rows = db.prepare(`SELECT categories FROM articles${pub}`).all();
  const used = new Set();
  for (const row of rows) {
    try {
      const cats = JSON.parse(row.categories || '[]');
      if (!Array.isArray(cats)) continue;
      for (const id of cats) {
        if (CATEGORY_IDS.has(id)) used.add(id);
      }
    } catch {
      /* ignore bad JSON */
    }
  }
  return used;
}

export function categoriesForLang(lang = 'ru', { onlyWithNews = true } = {}) {
  const used = onlyWithNews ? usedCategoryIds({ publishedOnly: true }) : null;
  return NEWS_CATEGORIES.filter((c) => !used || used.has(c.id)).map((c) => ({
    id: c.id,
    label: lang === 'en' ? c.labelEn : lang === 'de' ? c.labelDe : c.label,
    description: c.description
  }));
}

export function addReaction({ articleId, reaction, visitorId, clientIp }) {
  const allowed = new Set(['rocket', 'smile', 'poop']);
  if (!allowed.has(reaction)) return { ok: false, error: 'invalid_reaction' };
  const hash = createHash('sha256')
    .update(`${visitorId || ''}:${clientIp || ''}:${articleId}`)
    .digest('hex')
    .slice(0, 32);
  try {
    db.prepare(`
      INSERT INTO reactions (article_id, reaction, visitor_hash)
      VALUES (?, ?, ?)
    `).run(articleId, reaction, hash);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      // toggle off
      db.prepare(`
        DELETE FROM reactions WHERE article_id = ? AND reaction = ? AND visitor_hash = ?
      `).run(articleId, reaction, hash);
      return { ok: true, toggled: 'off', article: getArticleById(articleId, { lang: 'ru' }) };
    }
    throw err;
  }
  return { ok: true, toggled: 'on', article: getArticleById(articleId, { lang: 'ru' }) };
}

/** Non-unique page view (+n). */
export function incrementArticleViews(articleId, n = 1) {
  const id = Number(articleId);
  const add = Math.max(0, Math.floor(Number(n) || 0));
  if (!id || !add) return null;
  const info = db.prepare(`
    UPDATE articles SET views = COALESCE(views, 0) + ? WHERE id = ? AND published = 1
  `).run(add, id);
  if (!info.changes) return null;
  const row = db.prepare('SELECT views FROM articles WHERE id = ?').get(id);
  return { ok: true, id, views: Number(row?.views || 0) };
}

function reactionTotals(articleId) {
  const counts = db.prepare(`
    SELECT reaction, COUNT(*) AS c FROM reactions
    WHERE article_id = ? GROUP BY reaction
  `).all(articleId);
  const reactions = { rocket: 0, smile: 0, poop: 0 };
  let total = 0;
  for (const c of counts) {
    reactions[c.reaction] = c.c;
    total += c.c;
  }
  return { reactions, total };
}

function insertBoostReactions(articleId, count) {
  const types = ['rocket', 'smile', 'poop'];
  const insert = db.prepare(`
    INSERT OR IGNORE INTO reactions (article_id, reaction, visitor_hash)
    VALUES (?, ?, ?)
  `);
  let added = 0;
  const stamp = Date.now().toString(36);
  for (let i = 0; i < count; i++) {
    const reaction = types[Math.floor(Math.random() * types.length)];
    const hash = createHash('sha256')
      .update(`boost:${articleId}:${stamp}:${i}:${Math.random()}`)
      .digest('hex')
      .slice(0, 32);
    const info = insert.run(articleId, reaction, hash);
    if (info.changes) added += 1;
  }
  return added;
}

function articleAgeDays(publishedAt) {
  const t = Date.parse(publishedAt || '');
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / (86400 * 1000);
}

/**
 * Hourly engagement:
 * 1) articles younger than 7 days: +rand(1..10) views
 * 2) if views > 10 and reactions <= 10% of views: add rand(0..floor(views/10)) reactions
 */
export function runHourlyEngagementBoost() {
  const rows = db.prepare(`
    SELECT id, published_at, COALESCE(views, 0) AS views
    FROM articles
    WHERE published = 1
  `).all();

  const viewUpd = db.prepare(`
    UPDATE articles SET views = COALESCE(views, 0) + ? WHERE id = ?
  `);

  const summary = {
    scanned: rows.length,
    viewBoosted: 0,
    viewsAdded: 0,
    reactionBoosted: 0,
    reactionsAdded: 0,
    reactionSkippedCap: 0,
    reactionSkippedLowViews: 0,
    viewSkippedAge: 0
  };

  const tx = db.transaction(() => {
    for (const row of rows) {
      const age = articleAgeDays(row.published_at);
      let views = Number(row.views || 0);

      if (age <= 7) {
        const add = 1 + Math.floor(Math.random() * 10); // 1..10
        viewUpd.run(add, row.id);
        views += add;
        summary.viewBoosted += 1;
        summary.viewsAdded += add;
      } else {
        summary.viewSkippedAge += 1;
      }

      if (views <= 10) {
        summary.reactionSkippedLowViews += 1;
        continue;
      }

      const { total: reactTotal } = reactionTotals(row.id);
      if (reactTotal > views * 0.1) {
        summary.reactionSkippedCap += 1;
        continue;
      }

      const x = Math.floor(views / 10);
      const n = Math.floor(Math.random() * (x + 1)); // 0..X
      if (n <= 0) continue;
      const added = insertBoostReactions(row.id, n);
      if (added > 0) {
        summary.reactionBoosted += 1;
        summary.reactionsAdded += added;
      }
    }
  });
  tx();
  return summary;
}

export function listRecentSlugs(limit = 100) {
  return db.prepare(`
    SELECT slug, day, published_at, title FROM articles
    WHERE published = 1
    ORDER BY published_at DESC LIMIT ?
  `).all(limit);
}

/** All published article URLs for sitemap / SEO backfill. */
export function listPublishedForSitemap({ limit = 5000 } = {}) {
  return db.prepare(`
    SELECT id, slug, day, published_at, title, seo_ready, seo_optimized_at
    FROM articles
    WHERE published = 1
    ORDER BY published_at DESC
    LIMIT ?
  `).all(limit);
}

export function updateArticleSeo(id, fields = {}) {
  const meta =
    fields.meta == null
      ? null
      : typeof fields.meta === 'string'
        ? fields.meta
        : JSON.stringify(fields.meta);
  db.prepare(`
    UPDATE articles SET
      seo_title = COALESCE(@seoTitle, seo_title),
      seo_description = COALESCE(@seoDescription, seo_description),
      seo_image_alt = COALESCE(@seoImageAlt, seo_image_alt),
      seo_ready = COALESCE(@seoReady, seo_ready),
      seo_optimized_at = COALESCE(@seoOptimizedAt, seo_optimized_at),
      seo_meta = COALESCE(@seoMeta, seo_meta),
      image_url = COALESCE(@imageUrl, image_url),
      body = COALESCE(@body, body),
      body_ru = COALESCE(@bodyRu, body_ru)
    WHERE id = @id
  `).run({
    id,
    seoTitle: fields.seoTitle || null,
    seoDescription: fields.seoDescription || null,
    seoImageAlt: fields.seoImageAlt || null,
    seoReady: typeof fields.seoReady === 'number' ? fields.seoReady : fields.seoReady === true ? 1 : fields.seoReady === false ? 0 : null,
    seoOptimizedAt: fields.seoOptimizedAt || null,
    seoMeta: meta,
    imageUrl: fields.imageUrl != null ? normalizeImageUrl(fields.imageUrl) : null,
    body: fields.body || null,
    bodyRu: fields.bodyRu || null
  });
}

export function listArticlesForEnrichment({ limit = 30 } = {}) {
  return db.prepare(`
    ${articleSelect}
    WHERE a.published = 1 AND (a.insights_ru IS NULL OR TRIM(a.insights_ru) = '')
    ORDER BY a.published_at DESC
    LIMIT ?
  `).all(limit);
}

export function listAllArticlesRaw({ limit = 500 } = {}) {
  return db.prepare(`${articleSelect} ORDER BY a.published_at DESC LIMIT ?`).all(limit);
}

export function newsStats() {
  const articles = db.prepare('SELECT COUNT(*) AS c FROM articles WHERE published = 1').get().c;
  const draft = db.prepare('SELECT COUNT(*) AS c FROM articles WHERE published = 0').get().c;
  const sources = db.prepare('SELECT COUNT(*) AS c FROM sources WHERE enabled = 1').get().c;
  const days = db.prepare('SELECT COUNT(DISTINCT day) AS c FROM articles WHERE published = 1').get().c;
  return { articles, draft, sources, days };
}

export { db as newsDb };
