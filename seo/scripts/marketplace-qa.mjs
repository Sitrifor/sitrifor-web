/**
 * Marketplace QA: category classification traps + DB sanity.
 *
 *   node seo/scripts/marketplace-qa.mjs
 *   node seo/scripts/marketplace-qa.mjs --json
 *   node seo/scripts/marketplace-qa.mjs --fix-db
 *   npm run marketplace:qa
 */
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const jsonMode = process.argv.includes('--json');
const fixDb = process.argv.includes('--fix-db');

const {
  guessCategory,
  reclassifyAllProducts,
  backfillCoversFromStoredImages,
  sanitizeAllDescriptions,
  cleanProductDescription,
  dedupeOffersByShop,
  getDb,
  getProductBySlug
} = await import(path.join(ROOT, 'backend/marketplace/index.js'));

const cases = [
  // Must NOT be cartridges (historical false positives: rs\b / rl\b / rm\b)
  {
    title: 'Краска Dynamic Colors Dynamic Colors Black - Черный',
    url: 'https://www.tattoomarket.ru/product/black-chernyi',
    expect: 'pigments',
    id: 'ink-colors-not-cartridge'
  },
  {
    title: 'Краска Eternal Eternal Warm Light Gray',
    url: 'https://www.tattoomarket.ru/product/warm-light-gray',
    expect: 'pigments',
    id: 'warm-not-cartridge'
  },
  {
    title: 'Удаление - ремуверы',
    url: 'https://tatu-shop.ru/products/category/removal-removers',
    expect: 'other',
    id: 'removers-not-cartridge'
  },
  {
    title: 'Тату машинка Tattoomarket Machines Tattoo Market brothers SideLiner Blue',
    url: 'https://www.tattoomarket.ru/product/sideliner-blue',
    expect: 'machines',
    id: 'brothers-machine-not-cartridge'
  },
  {
    title: 'Книга/скетч-бук Tattoo Books Art Supply Banners - by Damien Friesz',
    url: 'https://www.tattoomarket.ru/product/banners-by-damien-friesz',
    expect: 'other',
    id: 'banners-not-cartridge'
  },
  {
    title: 'Тату машинка HM Tattoo Machines INVICTUS Cartridge Version',
    url: 'https://www.tattoomarket.ru/product/invictus-micro-glide-cartridge-versions',
    expect: 'machines',
    id: 'machine-cartridge-version'
  },
  {
    title: 'Картриджи для тату машинки',
    url: 'https://tattoomall.ru/cartridges',
    expect: 'cartridges',
    id: 'cartridges-for-machine'
  },
  // Needles with config codes
  {
    title: 'Тату-иглы KWADRON KWADRON 0.25mm long taper - 3RL',
    url: 'https://www.tattoomarket.ru/product/kwadron-0-25mm-long-taper-3rl',
    expect: 'needles',
    id: '3rl-needles'
  },
  // Real cartridges
  {
    title: 'Картриджи KWADRON 3RL 0.25',
    url: 'https://www.tattoomarket.ru/product/kwadron-cartridge-3rl',
    expect: 'cartridges',
    id: 'cartridge-word'
  },
  {
    title: 'Модули Cartel 05RL',
    url: 'https://profftattoo.ru/cartridges/cartel/rl-cartel/05rl-moduli-cartel',
    expect: 'cartridges',
    id: 'moduli-cartridge'
  },
  {
    title: 'Cheyenne Safety Cartridge 7RM',
    url: 'https://example.com/product/cheyenne-safety-cartridge-7rm',
    expect: 'cartridges',
    id: 'cheyenne-cartridge'
  },
  // URL alone must not classify via "url" ending in rl
  {
    title: 'Скетчбук Damien',
    url: 'https://www.tattoomarket.ru/product/something',
    expect: 'other',
    id: 'url-path-not-rl'
  },
  {
    title: 'Блок питания Critical AtomX',
    url: 'https://shop.example/power',
    expect: 'power',
    id: 'power-critical'
  },
  {
    title: 'Перчатки нитриловые черные',
    url: 'https://shop.example/gloves',
    expect: 'consumables',
    id: 'gloves'
  }
];

function assertCategoryCases() {
  const failed = [];
  const passed = [];
  for (const c of cases) {
    const got = guessCategory(c.title, c.url);
    if (got === c.expect) passed.push(c.id);
    else failed.push({ id: c.id, expect: c.expect, got, title: c.title });
  }
  return { passed, failed, total: cases.length };
}

function assertDescriptionAndOffers() {
  const failed = [];
  const passed = [];

  const dirty =
    'Бахилы медицинские одноразовые синие купить в интернет-магазине TatuShop с доставкой. Большой выбор, низкие цены. Телефон: 8-800 700-56-27';
  const cleaned = cleanProductDescription(dirty, 'Бахилы медицинские одноразовые синие');
  if (cleaned == null || !/8-800|телефон|TatuShop|доставк/i.test(cleaned)) {
    passed.push('desc-strip-phone-crm');
  } else {
    failed.push({ id: 'desc-strip-phone-crm', got: cleaned });
  }

  const deduped = dedupeOffersByShop([
    { shopKey: 'tatu-shop', shopName: 'Tatu-Shop', priceRub: 2, url: 'https://a', inStock: true },
    { shopKey: 'tatu-shop', shopName: 'Tatu-Shop', priceRub: 2, url: 'https://b', inStock: true },
    { shopKey: 'tatu-shop', shopName: 'Tatu-Shop', priceRub: 2, url: 'https://c', inStock: true },
    { shopKey: 'other', shopName: 'Other', priceRub: 5, url: 'https://d', inStock: true }
  ]);
  if (deduped.length === 2 && deduped.filter((o) => o.shopKey === 'tatu-shop').length === 1) {
    passed.push('offers-dedupe-same-shop');
  } else {
    failed.push({ id: 'offers-dedupe-same-shop', got: deduped.length });
  }

  return { passed, failed, total: passed.length + failed.length };
}

function assertDbSanity() {
  const db = getDb();
  const issues = [];

  const cart = db.prepare(`SELECT id FROM mp_categories WHERE slug='cartridges'`).get();
  if (!cart) {
    return { ok: false, issues: ['missing cartridges category'], stats: {} };
  }

  // Pigment-looking titles stuck in cartridges
  const pigmentTrap = db
    .prepare(
      `SELECT COUNT(*) AS n FROM mp_products p
       WHERE p.category_id = ?
         AND lower(p.title) LIKE '%краск%'
         AND lower(p.title) NOT LIKE '%картридж%'
         AND lower(p.title) NOT LIKE '%модул%'`
    )
    .get(cart.id).n;
  if (pigmentTrap > 0) {
    issues.push(`cartridges_contains_ink_titles:${pigmentTrap}`);
  }

  // Machine product titles wrongly in cartridges (allow "картриджи для машинки")
  const machineTrapRows = db
    .prepare(
      `SELECT p.title,
        (SELECT o.source_url FROM mp_offers o WHERE o.product_id=p.id LIMIT 1) AS url
       FROM mp_products p
       WHERE p.category_id = ?
         AND lower(p.title) LIKE '%машинк%'`
    )
    .all(cart.id)
    .filter((r) => guessCategory(r.title, r.url || '') === 'machines');
  const machineTrap = machineTrapRows.length;
  if (machineTrap > 0) {
    issues.push(`cartridges_contains_machine_titles:${machineTrap}`);
  }

  // Sample: re-guess mismatch rate for cartridges (should be near 0 after fix-db)
  const sample = db
    .prepare(
      `SELECT p.title,
        (SELECT o.source_url FROM mp_offers o WHERE o.product_id=p.id LIMIT 1) AS url
       FROM mp_products p WHERE p.category_id=?`
    )
    .all(cart.id);
  let mismatch = 0;
  for (const r of sample) {
    if (guessCategory(r.title, r.url || '') !== 'cartridges') mismatch += 1;
  }
  const mismatchRate = sample.length ? mismatch / sample.length : 0;
  if (mismatchRate > 0.05) {
    issues.push(`cartridges_reclassify_mismatch_rate:${(mismatchRate * 100).toFixed(1)}%`);
  }

  const cover = db
    .prepare(
      `SELECT
        COUNT(*) AS products,
        SUM(CASE WHEN cover_url IS NULL OR cover_url='' THEN 1 ELSE 0 END) AS no_cover
       FROM mp_products`
    )
    .get();
  const coverRate = cover.products ? 1 - cover.no_cover / cover.products : 1;
  // Soft warn only in report; hard-fail if tattoomarket (YML) missing covers
  const tmMissing = db
    .prepare(
      `SELECT COUNT(*) AS n FROM mp_products p
       WHERE (p.cover_url IS NULL OR p.cover_url='')
         AND EXISTS (
           SELECT 1 FROM mp_offers o
           JOIN mp_shops s ON s.id=o.shop_id
           WHERE o.product_id=p.id AND s.key='tattoomarket'
         )`
    )
    .get().n;
  if (tmMissing > 0) issues.push(`tattoomarket_missing_covers:${tmMissing}`);

  // Descriptions must not expose shop phones (exclude RPM specs like 8-8000 об/мин)
  const phoneLeft = db
    .prepare(
      `SELECT COUNT(*) AS n FROM mp_products
       WHERE description LIKE '%Телефон:%'
          OR description LIKE '%телефон:%'
          OR description LIKE '%8-800 %'
          OR description LIKE '%8-800-%'`
    )
    .get().n;
  if (phoneLeft > 0) issues.push(`descriptions_with_phone:${phoneLeft}`);

  return {
    ok: issues.length === 0,
    issues,
    stats: {
      cartridgesTotal: sample.length,
      cartridgesMismatch: mismatch,
      cartridgesMismatchRate: mismatchRate,
      pigmentTrap,
      machineTrap,
      products: cover.products,
      noCover: cover.no_cover,
      coverRate,
      phoneLeft
    }
  };
}

const unit = assertCategoryCases();
const unitExtra = assertDescriptionAndOffers();
let fix = null;
if (fixDb) {
  fix = {
    reclassify: reclassifyAllProducts(),
    covers: backfillCoversFromStoredImages(),
    descriptions: sanitizeAllDescriptions()
  };
}
const dbCheck = assertDbSanity();

const unitFailed = unit.failed.length + unitExtra.failed.length;
const unitPassed = unit.passed.length + unitExtra.passed.length;
const unitTotal = unit.total + unitExtra.total;

const report = {
  ok: unitFailed === 0 && dbCheck.ok,
  unit: {
    passed: [...unit.passed, ...unitExtra.passed],
    failed: [...unit.failed, ...unitExtra.failed],
    total: unitTotal
  },
  db: dbCheck,
  fix
};

if (jsonMode) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(report.ok ? 'PASS marketplace-qa' : 'FAIL marketplace-qa');
  console.log(`unit: ${unitPassed}/${unitTotal} passed`);
  if (unitFailed) {
    for (const f of report.unit.failed) {
      console.log(`  FAIL ${f.id}: ${JSON.stringify(f)}`);
    }
  }
  console.log('db issues:', dbCheck.issues.length ? dbCheck.issues.join(', ') : 'none');
  console.log('db stats:', JSON.stringify(dbCheck.stats));
  if (fix) console.log('fix:', JSON.stringify(fix));
}

// Live API smoke when shoe-cover product exists
try {
  const item = getProductBySlug('item-бахилы-медицинские-одноразовые-синие');
  if (item) {
    const shopKeys = (item.offers || []).map((o) => o.shopKey);
    const uniq = new Set(shopKeys);
    if (shopKeys.length !== uniq.size) {
      console.log('FAIL live-offers-dedupe');
      process.exit(1);
    }
    if (item.description && /8-800|телефон/i.test(item.description)) {
      console.log('FAIL live-desc-phone', item.description);
      process.exit(1);
    }
    console.log('live shoe-cover ok:', {
      offers: item.offers.length,
      desc: item.description
    });
  }
} catch (err) {
  console.warn('live smoke skipped', err.message || err);
}

process.exit(report.ok ? 0 : 1);
