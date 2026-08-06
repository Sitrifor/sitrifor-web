import Fastify from 'fastify';
import cors from '@fastify/cors';
import {
  countRecentByIp,
  countRecentLeadsByIp,
  createUniquePromoCode,
  getPromoByCode,
  insertLead,
  PROMO_PRICE_KOP
} from './db.js';
import {
  collectHit,
  getSummary,
  getPathSeries,
  listDecisions,
  insertDecision,
  markDecisionApplied
} from './analytics.js';
import {
  NEWS_CATEGORIES,
  categoriesForLang,
  getArticlesByDay,
  getCalendarMonth,
  getDaysWithNews,
  getArticleBySlug,
  addReaction,
  incrementArticleViews,
  runHourlyEngagementBoost,
  listRecentSlugs,
  newsStats
} from './news.js';
import { composeMagazineLayout, magazineEnabled } from './news-magazine.js';
import { renderArticleSsr, renderNotFoundSsr } from './news-seo/index.js';

const marketplaceApi = await import('./marketplace/index.js');

const PORT = Number(process.env.PORT || 8081);
const HOST = process.env.HOST || '127.0.0.1';
const MAX_PER_IP_24H = Number(process.env.PROMO_MAX_PER_IP_24H || 5);
const MAX_LEADS_PER_IP_24H = Number(process.env.LEADS_MAX_PER_IP_24H || 20);
const NODE_ENV = process.env.NODE_ENV || 'development';
// В production mock отключён по умолчанию (иначе любой может получить paid-промокод).
const PAYMENT_MODE =
  process.env.PROMO_PAYMENT_MODE ||
  (NODE_ENV === 'production' ? 'disabled' : 'mock');
const ANALYTICS_TOKEN = process.env.ANALYTICS_TOKEN || '';
const ALLOW_MOCK_PAYMENT =
  process.env.ALLOW_MOCK_PAYMENT === '1' ||
  process.env.ALLOW_MOCK_PAYMENT === 'true';

const app = Fastify({
  logger: true,
  ignoreTrailingSlash: true
});

const corsOrigins = [
  'https://sitrifor.ru',
  'http://sitrifor.ru',
  'https://www.sitrifor.ru',
  'http://www.sitrifor.ru',
  'http://217.26.24.29:8088',
  'http://127.0.0.1:8088'
];

await app.register(cors, {
  origin: corsOrigins,
  methods: ['GET', 'POST']
});

function getClientIp(request) {
  return request.headers['x-real-ip']
    || request.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || request.ip;
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

app.get('/health', async () => ({ ok: true, paymentMode: PAYMENT_MODE }));

app.get('/api/promo/price', async () => ({
  amountKop: PROMO_PRICE_KOP,
  amountRub: PROMO_PRICE_KOP / 100,
  currency: 'RUB',
  title: 'Ранний доступ 6:34'
}));

app.get('/api/promo/validate/:code', async (request, reply) => {
  const code = String(request.params.code || '').trim().toUpperCase();
  if (!code) {
    return reply.code(400).send({ valid: false, error: 'missing_code' });
  }
  const row = getPromoByCode(code);
  if (!row) {
    return reply.code(404).send({ valid: false, error: 'not_found' });
  }
  const ok = row.status === 'paid' || row.status === 'issued';
  // Без email/name - код угадываемый, PII не отдаём публично.
  return {
    valid: ok,
    code: row.code,
    status: row.status,
    paidAt: row.paid_at,
    createdAt: row.created_at
  };
});

app.post('/api/promo/generate', async (request, reply) => {
  const clientIp = getClientIp(request);
  const userAgent = request.headers['user-agent'] || '';

  if (countRecentByIp(clientIp, 24) >= MAX_PER_IP_24H) {
    return reply.code(429).send({
      error: 'limit_exceeded',
      message: 'Превышен лимит промокодов. Попробуйте позже.'
    });
  }

  try {
    const row = createUniquePromoCode({ clientIp, userAgent, status: 'issued' });
    return { code: row.code, createdAt: row.created_at };
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({
      error: 'server_error',
      message: 'Не удалось создать промокод. Попробуйте позже.'
    });
  }
});

app.post('/api/promo/email', async (request, reply) => {
  const clientIp = getClientIp(request);
  const userAgent = request.headers['user-agent'] || '';
  const { email } = request.body || {};

  if (!isValidEmail(email)) {
    return reply.code(400).send({
      error: 'invalid_email',
      message: 'Укажите корректный email.'
    });
  }

  if (countRecentByIp(clientIp, 24) >= MAX_PER_IP_24H) {
    return reply.code(429).send({
      error: 'limit_exceeded',
      message: 'Превышен лимит. Попробуйте позже.'
    });
  }

  try {
    const row = createUniquePromoCode({
      clientIp,
      userAgent,
      email: email.trim(),
      status: 'issued'
    });
    request.log.info({ email: email.trim(), code: row.code }, 'promo email');
    return {
      code: row.code,
      createdAt: row.created_at,
      message: 'Промокод создан.'
    };
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({
      error: 'server_error',
      message: 'Не удалось создать промокод.'
    });
  }
});

/** Paid promo: collect profile + mock payment, store in DB for app validate */
app.post('/api/promo/purchase', async (request, reply) => {
  const clientIp = getClientIp(request);
  const userAgent = request.headers['user-agent'] || '';
  const body = request.body || {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const paymentToken = body.paymentToken || body.payment_token || '';

  if (!name || name.length < 2) {
    return reply.code(400).send({ error: 'invalid_name', message: 'Укажите имя.' });
  }
  if (!isValidEmail(email)) {
    return reply.code(400).send({ error: 'invalid_email', message: 'Укажите корректный email.' });
  }
  if (!phone || phone.replace(/\D/g, '').length < 11) {
    return reply.code(400).send({ error: 'invalid_phone', message: 'Укажите телефон.' });
  }

  if (countRecentByIp(clientIp, 24) >= MAX_PER_IP_24H) {
    return reply.code(429).send({
      error: 'limit_exceeded',
      message: 'Превышен лимит покупок. Попробуйте позже.'
    });
  }

  const mockAllowed =
    PAYMENT_MODE === 'mock' &&
    (NODE_ENV !== 'production' || ALLOW_MOCK_PAYMENT);

  if (mockAllowed) {
    if (paymentToken !== 'mock_ok') {
      return reply.code(402).send({
        error: 'payment_required',
        message: 'Оплата не подтверждена.',
        amountKop: PROMO_PRICE_KOP
      });
    }
  } else if (PAYMENT_MODE === 'mock') {
    return reply.code(403).send({
      error: 'mock_disabled',
      message: 'Тестовая оплата отключена на продакшене.'
    });
  } else {
    return reply.code(501).send({
      error: 'payment_not_configured',
      message: 'Платёжный шлюз ещё не подключён. Напишите нам, если нужен ранний доступ.'
    });
  }

  try {
    const paymentRef = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const row = createUniquePromoCode({
      clientIp,
      userAgent,
      email,
      name,
      phone,
      status: 'paid',
      amountKop: PROMO_PRICE_KOP,
      paymentRef
    });
    request.log.info({ email, code: row.code, paymentRef }, 'promo purchased');
    return {
      ok: true,
      code: row.code,
      status: row.status,
      amountKop: PROMO_PRICE_KOP,
      amountRub: PROMO_PRICE_KOP / 100,
      paidAt: row.paid_at,
      message: 'Оплата прошла. Промокод сохранён и доступен приложению.'
    };
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({
      error: 'server_error',
      message: 'Не удалось выдать промокод после оплаты.'
    });
  }
});

const LEAD_TYPES = ['consultation', 'earn', 'education', 'callback', 'partnership', 'review'];

LEAD_TYPES.forEach((type) => {
  app.post(`/api/leads/${type}`, async (request, reply) => {
    const clientIp = getClientIp(request);
    const payload = request.body;

    if (!payload || typeof payload !== 'object') {
      return reply.code(400).send({
        error: 'invalid_payload',
        message: 'Некорректные данные формы.'
      });
    }

    if (countRecentLeadsByIp(clientIp, 24) >= MAX_LEADS_PER_IP_24H) {
      return reply.code(429).send({
        error: 'limit_exceeded',
        message: 'Слишком много заявок. Попробуйте позже.'
      });
    }

    try {
      const row = insertLead({ type, payload, clientIp });
      request.log.info({ leadId: row.id, type }, 'lead created');
      return { ok: true, id: row.id };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({
        error: 'server_error',
        message: 'Не удалось отправить заявку.'
      });
    }
  });
});

/** First-party analytics collect (pageview / visit) */
app.post('/api/analytics/collect', async (request, reply) => {
  const body = request.body || {};
  const result = collectHit({
    path: body.path || body.p,
    referrer: body.referrer || body.r || request.headers.referer || '',
    utmSource: body.utm_source || body.us,
    utmMedium: body.utm_medium || body.um,
    utmCampaign: body.utm_campaign || body.uc,
    visitorId: body.vid || body.visitor_id,
    sessionId: body.sid || body.session_id,
    isNewSession: Boolean(body.ns || body.is_new_session),
    lang: body.lang || body.l,
    screen: body.screen || body.s,
    clientIp: getClientIp(request),
    userAgent: request.headers['user-agent'] || ''
  });

  if (!result.ok) {
    const code = result.error === 'rate_limited' ? 429 : 400;
    return reply.code(code).send(result);
  }
  return reply.code(204).send();
});

function analyticsAuthorized(request) {
  if (!ANALYTICS_TOKEN) {
    // no token configured: allow only loopback
    const ip = getClientIp(request);
    return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
  }
  const hdr = request.headers['x-analytics-token'] || '';
  // Query-token отключён: токен попадал в access-логи и Referer.
  return hdr === ANALYTICS_TOKEN;
}

/** Summary: non-unique users (= visits) + breakdown */
app.get('/api/analytics/summary', async (request, reply) => {
  if (!analyticsAuthorized(request)) {
    return reply.code(401).send({ error: 'unauthorized' });
  }
  const days = Math.min(90, Math.max(1, Number(request.query.days || 7)));
  return getSummary({ days });
});

app.get('/api/analytics/path', async (request, reply) => {
  if (!analyticsAuthorized(request)) {
    return reply.code(401).send({ error: 'unauthorized' });
  }
  const path = request.query.path || '/';
  const days = Math.min(90, Math.max(1, Number(request.query.days || 14)));
  return { path, series: getPathSeries(path, days) };
});

app.get('/api/analytics/decisions', async (request, reply) => {
  if (!analyticsAuthorized(request)) {
    return reply.code(401).send({ error: 'unauthorized' });
  }
  return { decisions: listDecisions({ days: Number(request.query.days || 30) }) };
});

/** Internal: record a decision (used by SEO engine on localhost) */
app.post('/api/analytics/decisions', async (request, reply) => {
  if (!analyticsAuthorized(request)) {
    return reply.code(401).send({ error: 'unauthorized' });
  }
  const body = request.body || {};
  if (!body.decisionType || !body.rationale) {
    return reply.code(400).send({ error: 'missing_fields' });
  }
  const id = insertDecision(body);
  return { ok: true, id };
});

app.post('/api/analytics/decisions/:id/apply', async (request, reply) => {
  if (!analyticsAuthorized(request)) {
    return reply.code(401).send({ error: 'unauthorized' });
  }
  markDecisionApplied(Number(request.params.id), { action: request.body?.action });
  return { ok: true };
});

/** —— News SSR (public HTML for /news/a/:slug via nginx proxy) —— */
app.get('/news/a/:slug', async (request, reply) => {
  const raw = decodeURIComponent(String(request.params.slug || ''));
  const lang = String(request.query.lang || 'ru').slice(0, 2);
  const item = getArticleBySlug(raw, { lang, publishedOnly: true });
  if (!item) {
    const miss = renderNotFoundSsr();
    return reply.code(miss.status).type(miss.contentType).send(miss.html);
  }
  if (magazineEnabled()) {
    try {
      item.layout = composeMagazineLayout(item);
    } catch (err) {
      request.log.warn({ err }, 'magazine layout failed (ssr)');
    }
  }
  const page = renderArticleSsr(item);
  return reply
    .code(page.status)
    .type(page.contentType)
    .header('Cache-Control', 'public, max-age=60, must-revalidate')
    .send(page.html);
});

/** —— Marketplace product SSR (/marketplace/p/:slug via nginx proxy) —— */
app.get('/marketplace/p/:slug', async (request, reply) => {
  const page = marketplaceApi.renderProductSsr(request.params.slug);
  return reply
    .code(page.status)
    .type(page.contentType)
    .header('Cache-Control', 'public, max-age=60, must-revalidate')
    .send(page.html);
});

/** —— News API —— */
app.get('/api/news/meta', async (request) => {
  const lang = String(request.query.lang || 'ru').slice(0, 2);
  return {
    categories: categoriesForLang(lang),
    stats: newsStats()
  };
});

app.get('/api/news/calendar', async (request) => {
  const month = String(request.query.month || new Date().toISOString().slice(0, 7));
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return { error: 'invalid_month' };
  }
  const tag = request.query.tag || null;
  return { month, tag, days: getCalendarMonth(month, { tag }) };
});

app.get('/api/news/days', async (request) => {
  const before = request.query.before || null;
  const limit = Math.min(30, Math.max(1, Number(request.query.limit || 14)));
  const tag = request.query.tag || null;
  return { days: getDaysWithNews({ before, limit, tag }), tag };
});

app.get('/api/news/day', async (request, reply) => {
  const day = String(request.query.date || new Date().toISOString().slice(0, 10));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return reply.code(400).send({ error: 'invalid_date' });
  }
  const tag = request.query.tag || null;
  const lang = String(request.query.lang || 'ru').slice(0, 2);
  const articles = getArticlesByDay(day, { tag, lang });
  const byCategory = {};
  for (const cat of NEWS_CATEGORIES) byCategory[cat.id] = [];
  for (const a of articles) {
    const cats = Array.isArray(a.categories) ? a.categories : [];
    // With active tag — bucket under that tag so filter matches what user sees
    if (tag && cats.includes(tag)) {
      if (!byCategory[tag]) byCategory[tag] = [];
      byCategory[tag].push(a);
      continue;
    }
    const primary = cats[0] || 'industry';
    if (!byCategory[primary]) byCategory[primary] = [];
    byCategory[primary].push(a);
  }
  return { day, tag, lang, total: articles.length, byCategory, articles };
});

app.get('/api/news/item/:slug', async (request, reply) => {
  const lang = String(request.query.lang || 'ru').slice(0, 2);
  const item = getArticleBySlug(request.params.slug, { lang });
  if (!item) return reply.code(404).send({ error: 'not_found' });
  if (magazineEnabled()) {
    try {
      item.layout = composeMagazineLayout(item);
    } catch (err) {
      request.log.warn({ err }, 'magazine layout failed');
    }
  }
  return item;
});

app.get('/api/news/index', async (request) => {
  const limit = Math.min(200, Math.max(1, Number(request.query.limit || 50)));
  return { items: listRecentSlugs(limit) };
});

app.post('/api/news/react', async (request, reply) => {
  const body = request.body || {};
  const articleId = Number(body.articleId || body.id);
  const reaction = body.reaction;
  if (!articleId || !reaction) {
    return reply.code(400).send({ error: 'missing_fields' });
  }
  const result = addReaction({
    articleId,
    reaction,
    visitorId: body.vid || body.visitor_id || '',
    clientIp: getClientIp(request)
  });
  if (!result.ok) return reply.code(400).send(result);
  return result;
});

app.post('/api/news/view', async (request, reply) => {
  const body = request.body || {};
  const articleId = Number(body.articleId || body.id);
  if (!articleId) {
    return reply.code(400).send({ error: 'missing_article' });
  }
  const result = incrementArticleViews(articleId, 1);
  if (!result) return reply.code(404).send({ error: 'not_found' });
  return result;
});

app.get('/api/marketplace/meta', async () => marketplaceApi.listMeta());

app.get('/api/marketplace/products', async (request) => {
  const q = request.query || {};
  const slugsRaw = q.slugs || q.slug || null;
  const slugs = Array.isArray(slugsRaw)
    ? slugsRaw
    : typeof slugsRaw === 'string'
      ? slugsRaw.split(',')
      : null;
  return marketplaceApi.listProducts({
    category: q.category || null,
    brand: q.brand || null,
    brands: q.brands || null,
    q: q.q || null,
    slugs,
    limit: q.limit,
    offset: q.offset
  });
});

app.get('/api/marketplace/products/:slug', async (request, reply) => {
  const item = marketplaceApi.getProductBySlug(request.params.slug);
  if (!item) return reply.code(404).send({ error: 'not_found' });
  return item;
});

try {
  await app.listen({ port: PORT, host: HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
