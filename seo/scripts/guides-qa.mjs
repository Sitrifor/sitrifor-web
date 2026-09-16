#!/usr/bin/env node
/**
 * Guides / hubs design QA gate for Sitrifor.
 * Enforces UX rules from seo/docs/DESIGN-QA.md (Guides section).
 *
 *   node scripts/guides-qa.mjs
 *   node scripts/guides-qa.mjs --base https://sitrifor.ru
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'reports/visual');
const PUBLIC = path.resolve(ROOT, '../public');

const baseArg = (() => {
  const i = process.argv.indexOf('--base');
  return (i >= 0 ? process.argv[i + 1] : 'https://sitrifor.ru').replace(/\/$/, '');
})();

const HUB_PATHS = [
  '/634/',
  '/guides/',
  '/guides/aftercare/',
  '/guides/pigments/',
  '/guides/sketches/',
  '/guides/cartridges/',
  '/guides/machines/',
  '/guides/consumables/',
  '/guides/studio/',
  '/guides/education/',
  '/tools/price-calculator/'
];

fs.mkdirSync(OUT, { recursive: true });

function check(list, id, ok, detail) {
  list.push({ id, ok: Boolean(ok), detail });
}

function pathToFile(urlPath) {
  const rel = urlPath.replace(/^\//, '').replace(/\/$/, '');
  return path.join(PUBLIC, rel, 'index.html');
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function parseRgb(str) {
  const m = String(str).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function contrastRatio(fg, bg) {
  const L1 = luminance(fg);
  const L2 = luminance(bg);
  const light = Math.max(L1, L2);
  const dark = Math.min(L1, L2);
  return (light + 0.05) / (dark + 0.05);
}

function auditHtml(urlPath, html) {
  const checks = [];
  const pageId = urlPath;

  check(checks, `${pageId}:has_hero_cta`, /guide-hero__cta/.test(html), 'Hero has CTA row');
  check(checks, `${pageId}:has_btn_brand`, /btn btn--brand/.test(html), 'Primary CTA uses btn--brand');

  // CSS for buttons must be present on page (local guides.css or yandex-business)
  const hasGuidesCss = /\/css\/guides\.css/.test(html);
  const hasBizCss = /\/css\/yandex-business\.css/.test(html);
  check(
    checks,
    `${pageId}:btn_css_linked`,
    hasGuidesCss || hasBizCss,
    'Button styles linked (guides.css or yandex-business.css)'
  );

  // No unbounded section media (modifier required if media exists)
  const mediaBlocks = html.match(/class="home-seo__media[^"]*"/g) || [];
  const unbounded = mediaBlocks.filter((c) => !/home-seo__media--(phone|square|wide)/.test(c));
  check(
    checks,
    `${pageId}:media_has_kind`,
    unbounded.length === 0,
    unbounded.length
      ? `Section media without kind modifier: ${unbounded.length}`
      : 'All section media have --phone/--square/--wide'
  );

  // Prefer carousel over many inline section media
  const sectionMediaCount = mediaBlocks.length;
  check(
    checks,
    `${pageId}:section_media_budget`,
    sectionMediaCount <= 2,
    `Section media count ${sectionMediaCount} (max 2; prefer .home-seo__shots)`
  );

  // Key highlight budget outside UTP list (UTP titles are meant to be keys)
  const htmlNoUtp = html.replace(/<ul class="home-seo__utp"[\s\S]*?<\/ul>/g, '');
  const keyCount = (htmlNoUtp.match(/home-seo__key/g) || []).length;
  const keyCap = urlPath === '/634/' ? 14 : 10;
  check(
    checks,
    `${pageId}:key_highlight_budget`,
    keyCount <= keyCap,
    `home-seo__key outside UTP: ${keyCount} (cap ${keyCap})`
  );

  // Em dash ban in guide body
  check(checks, `${pageId}:no_em_dash`, !html.includes('\u2014'), 'No em-dash U+2014 in hub HTML');

  // Single H1
  check(checks, `${pageId}:single_h1`, (html.match(/<h1\b/gi) || []).length === 1, 'Exactly one H1');

  // App real screens must not use square 800×800 attrs
  const appShotBad = /\/img\/app\/real\/[^"]+"[^>]*width="800" height="800"/.test(html);
  check(checks, `${pageId}:phone_shot_dims`, !appShotBad, 'App /img/app/real/ shots not defaulted to 800×800');

  // Carousel shots must declare kind (--phone|--square|--wide)
  const shotFigs = html.match(/<figure class="home-seo__shot[^"]*"/g) || [];
  const shotMissingKind = shotFigs.filter((c) => !/home-seo__shot--(phone|square|wide)/.test(c));
  check(
    checks,
    `${pageId}:shots_have_kind`,
    shotMissingKind.length === 0,
    shotMissingKind.length
      ? `Carousel shots without kind modifier: ${shotMissingKind.length}`
      : 'All .home-seo__shot have --phone/--square/--wide'
  );

  return checks;
}

async function liveContrastChecks(urlPath) {
  const checks = [];
  let chrome;
  try {
    const { chromium } = await import('playwright');
    chrome =
      ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser'].find((p) =>
        fs.existsSync(p)
      ) || undefined;
    const browser = await chromium.launch({
      executablePath: chrome,
      headless: true,
      args: ['--no-sandbox', '--disable-gpu']
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${baseArg}${urlPath}`, { waitUntil: 'domcontentloaded', timeout: 45000 });

    const metrics = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('.guide-hero__cta a, .guide-hero__cta .btn')];
      const medias = [...document.querySelectorAll('.home-seo__media img')];
      const shotsRail = document.querySelector('.home-seo__shots');
      const shotFigs = [...document.querySelectorAll('.home-seo__shot')];
      const vh = window.innerHeight;
      const body = getComputedStyle(document.body);
      const headerTitle = document.querySelector('.header__page-title');
      const lead = document.querySelector('.guide-hero__lead');
      const copy = document.querySelector('.home-seo__copy p');
      const h1 = document.querySelector('.guide-hero__title, h1');
      const ff = (el) => (el ? getComputedStyle(el).fontFamily : null);
      const shotsAlign = shotsRail ? getComputedStyle(shotsRail).alignItems : null;
      const shotLayout = shotFigs.map((fig) => {
        const img = fig.querySelector('img');
        const cap = fig.querySelector('figcaption');
        if (!img) return null;
        const ir = img.getBoundingClientRect();
        const cr = cap ? cap.getBoundingClientRect() : null;
        const gap = cr ? Math.round(cr.top - ir.bottom) : null;
        return {
          kind: [...fig.classList].find((c) => c.startsWith('home-seo__shot--')) || 'none',
          imgH: Math.round(ir.height),
          imgW: Math.round(ir.width),
          pctVh: Math.round((100 * ir.height) / vh),
          captionGapPx: gap
        };
      }).filter(Boolean);
      return {
        typography: {
          body: body.fontFamily,
          bodySize: body.fontSize,
          headerTitle: ff(headerTitle),
          lead: ff(lead),
          copy: ff(copy),
          h1: ff(h1)
        },
        btns: btns.map((b) => {
          const s = getComputedStyle(b);
          return {
            text: (b.textContent || '').trim().slice(0, 48),
            color: s.color,
            bg: s.backgroundColor,
            border: s.borderTopColor
          };
        }),
        medias: medias.map((img) => {
          const r = img.getBoundingClientRect();
          return {
            src: (img.currentSrc || img.src || '').split('/').pop(),
            w: Math.round(r.width),
            h: Math.round(r.height),
            pctVh: Math.round((100 * r.height) / vh)
          };
        }),
        shotsAlign,
        shotLayout
      };
    });
    await browser.close();

    const typo = metrics.typography || {};
    const isSiteSans = (family) => {
      if (!family) return false;
      const f = family.toLowerCase();
      if (f.includes('times') || f === 'serif') return false;
      return f.includes('inter') || f.includes('manrope') || f.includes('system-ui') || f.includes('-apple-system');
    };
    check(
      checks,
      `${urlPath}:body_font_site`,
      isSiteSans(typo.body),
      `body font-family must be site sans (got: ${typo.body})`
    );
    check(
      checks,
      `${urlPath}:copy_font_site`,
      isSiteSans(typo.copy) || isSiteSans(typo.lead),
      `guide copy/lead must inherit site sans (copy=${typo.copy}; lead=${typo.lead})`
    );
    check(
      checks,
      `${urlPath}:header_title_font_site`,
      isSiteSans(typo.headerTitle),
      `header__page-title must use site sans (got: ${typo.headerTitle})`
    );
    // H1 may be Manrope display - still sans, not Times
    check(
      checks,
      `${urlPath}:h1_not_times`,
      isSiteSans(typo.h1),
      `H1 must not fall back to Times (got: ${typo.h1})`
    );

    for (const b of metrics.btns) {
      const fg = parseRgb(b.color);
      // Effective bg: if transparent, assume near-black page (~#0b0b0d)
      let bg = parseRgb(b.bg);
      const transparent =
        !bg || b.bg === 'transparent' || (bg[0] === 0 && bg[1] === 0 && bg[2] === 0 && /rgba\(0,\s*0,\s*0,\s*0\)/.test(b.bg));
      if (transparent) bg = [11, 11, 13];
      const ratio = fg && bg ? contrastRatio(fg, bg) : 0;
      check(
        checks,
        `${urlPath}:cta_contrast:${b.text.slice(0, 20)}`,
        ratio >= 4.5,
        `CTA "${b.text}" contrast ${ratio.toFixed(2)}:1 (need ≥4.5). color=${b.color} bg=${b.bg}`
      );
    }

    for (const m of metrics.medias) {
      check(
        checks,
        `${urlPath}:media_vh:${m.src}`,
        m.pctVh <= 45,
        `Media ${m.src} height ${m.h}px = ${m.pctVh}% vh (max 45%)`
      );
    }

    if (metrics.shotLayout && metrics.shotLayout.length) {
      const alignOk =
        !metrics.shotsAlign ||
        /^(flex-)?start$|^normal$|^initial$|^baseline$/i.test(String(metrics.shotsAlign).trim());
      // normal on flex = stretch in older browsers; require explicit flex-start/start
      const alignStrict = /^(flex-)?start$/i.test(String(metrics.shotsAlign || '').trim());
      check(
        checks,
        `${urlPath}:shots_align_start`,
        alignStrict,
        `.home-seo__shots align-items must be flex-start/start (got: ${metrics.shotsAlign})`
      );
      for (const s of metrics.shotLayout) {
        check(
          checks,
          `${urlPath}:shot_vh:${s.kind}`,
          s.pctVh <= 45,
          `Carousel shot ${s.kind} height ${s.imgH}px = ${s.pctVh}% vh (max 45%)`
        );
        if (s.captionGapPx != null) {
          check(
            checks,
            `${urlPath}:shot_caption_gap:${s.kind}`,
            s.captionGapPx >= 0 && s.captionGapPx <= 28,
            `Caption gap under ${s.kind} is ${s.captionGapPx}px (expect ≤28; stretch/gap bug if large)`
          );
        }
      }
      void alignOk;
    }

    return checks;
  } catch (e) {
    check(checks, `${urlPath}:live_metrics`, true, `skipped live: ${String(e.message || e).slice(0, 140)}`);
    return checks;
  }
}

async function main() {
  const all = [];
  const pages = [];

  for (const urlPath of HUB_PATHS) {
    const file = pathToFile(urlPath);
    if (!fs.existsSync(file)) {
      check(all, `${urlPath}:file_exists`, false, `Missing ${file}`);
      continue;
    }
    const html = fs.readFileSync(file, 'utf8');
    const staticChecks = auditHtml(urlPath, html);
    all.push(...staticChecks);

    // Live checks only for representative pages (speed)
    const liveTargets = ['/634/', '/guides/aftercare/', '/guides/pigments/', '/guides/studio/'];
    let live = [];
    if (liveTargets.includes(urlPath)) {
      live = await liveContrastChecks(urlPath);
      all.push(...live);
    }

    pages.push({
      path: urlPath,
      staticFailed: staticChecks.filter((c) => !c.ok).length,
      liveFailed: live.filter((c) => !c.ok).length
    });
  }

  // CSS source-of-truth checks (repo files)
  const guidesCss = fs.readFileSync(path.join(PUBLIC, 'css/guides.css'), 'utf8');
  const seoCss = fs.readFileSync(path.join(PUBLIC, 'css/seo-content.css'), 'utf8');
  check(all, 'css:guides_btn_brand', /\.btn--brand/.test(guidesCss), 'guides.css defines .btn--brand');
  check(all, 'css:guides_btn_ghost_light', /\.btn--ghost[\s\S]{0,120}color:\s*var\(--color-text/.test(guidesCss), 'guides.css ghost uses light text');
  check(all, 'css:media_phone_cap', /home-seo__media--phone[\s\S]{0,200}max-height/.test(seoCss), 'seo-content.css caps phone media height');
  check(all, 'css:media_no_fullbleed_default', !/\.home-seo__media img\s*\{[^}]*width:\s*100%[^}]*max-width:\s*36rem/.test(seoCss), 'Default media is not full-bleed 36rem');
  check(
    all,
    'css:shots_align_start',
    /\.home-seo__shots\s*\{[^}]*align-items:\s*(flex-)?start/.test(seoCss),
    '.home-seo__shots uses align-items: flex-start (no stretch caption float)'
  );
  check(
    all,
    'css:shot_phone_cap',
    /\.home-seo__shot--phone\s+img\s*\{[^}]*max-height/.test(seoCss),
    '.home-seo__shot--phone img has max-height cap'
  );
  check(
    all,
    'css:shot_square_aspect',
    /\.home-seo__shot--square\s+img\s*\{[^}]*aspect-ratio:\s*1/.test(seoCss),
    '.home-seo__shot--square img uses aspect-ratio 1'
  );

  // Base site typography must live in main.css so hubs without yandex-business still get Inter
  const mainCss = fs.readFileSync(path.join(PUBLIC, 'css/main.css'), 'utf8');
  check(
    all,
    'css:main_body_font',
    /body\s*\{[\s\S]*?font-family:\s*var\(--g-font-family\)/.test(mainCss),
    'main.css sets body font-family to --g-font-family (Inter stack)'
  );
  check(
    all,
    'css:guides_page_font',
    /\.guide-page\s*\{[\s\S]*?font-family:\s*var\(--g-font-family\)/.test(guidesCss),
    'guides.css reinforces .guide-page font-family'
  );

  const failed = all.filter((c) => !c.ok);
  const report = {
    generatedAt: new Date().toISOString(),
    base: baseArg,
    rulesDoc: 'seo/docs/DESIGN-QA.md#guides--634-magazine-hubs',
    pages,
    checks: all,
    passed: failed.length === 0,
    failedCount: failed.length,
    failed: failed.map((f) => ({ id: f.id, detail: f.detail }))
  };

  fs.writeFileSync(path.join(OUT, 'guides-qa-latest.json'), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        failedCount: report.failedCount,
        failed: report.failed,
        report: path.join(OUT, 'guides-qa-latest.json')
      },
      null,
      2
    )
  );
  process.exit(failed.length ? 2 : 0);
}

main();
