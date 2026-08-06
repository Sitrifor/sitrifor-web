#!/usr/bin/env node
/**
 * News UI regression QA gate for Sitrifor (static checks).
 *
 * Catches layout/SEO/UI bugs before release:
 * 1) SSR crawl index between calendar and feed must be visually hidden (sr-only)
 * 2) .news-ssr-index / .sr-only CSS clips out of document flow
 * 3) Autopilot inject template keeps sr-only
 * 4) Magazine brand button contrast override
 * 5) News header title sits next to logo (margin-left: 0 with masters/partners)
 * 6) Product review buy links + markdown list renderers present
 *
 * Usage:
 *   node seo/scripts/news-ui-qa.mjs
 *   node seo/scripts/news-ui-qa.mjs --json
 *   npm run news:ui-qa   (from seo/)
 *
 * Exit 1 on failures.
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const PUBLIC = join(ROOT, 'public');
const SEO = join(ROOT, 'seo');
const asJson = process.argv.includes('--json');

function read(rel) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return null;
  return readFileSync(abs, 'utf8');
}

function issue(type, detail, file) {
  return { type, detail, file: file || null };
}

/** Visually-hidden / clip-out-of-flow CSS signals */
function cssIsVisuallyHidden(ruleBody) {
  const body = String(ruleBody || '');
  const hasAbs = /position\s*:\s*absolute/i.test(body);
  const hasClip =
    /clip(?:-path)?\s*:/i.test(body) || /clip\s*:\s*rect\s*\(/i.test(body);
  const hasTiny =
    /width\s*:\s*1px/i.test(body) && /height\s*:\s*1px/i.test(body);
  const hasOverflow = /overflow\s*:\s*hidden/i.test(body);
  return hasAbs && (hasClip || (hasTiny && hasOverflow));
}

function extractRule(css, selector) {
  // First top-level rule matching selector (no nested @media preference)
  const re = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`,
    'i'
  );
  const m = css.match(re);
  return m ? m[1] : null;
}

function extractSsrIndexBlock(html) {
  const m = html.match(
    /<!--seo-autopilot:news-ssr-index-->([\s\S]*?)<!--\/seo-autopilot:news-ssr-index-->/
  );
  return m ? m[0] : null;
}

function checkSsrIndexHtml() {
  const issues = [];
  const file = 'public/news.html';
  const html = read(file);
  if (html == null) {
    issues.push(issue('missing_file', file, file));
    return issues;
  }

  const block = extractSsrIndexBlock(html);
  if (!block) {
    // Index is optional only if autopilot never ran; warn as fail for release readiness
    issues.push(
      issue(
        'ssr_index_missing',
        'news.html has no seo-autopilot:news-ssr-index block (run seo:autopilot)',
        file
      )
    );
    return issues;
  }

  const sectionMatch = block.match(/<section\b[^>]*>/i);
  if (!sectionMatch) {
    issues.push(issue('ssr_index_no_section', 'SSR index block has no <section>', file));
    return issues;
  }
  const open = sectionMatch[0];
  const classAttr = (open.match(/class=["']([^"']+)["']/i) || [])[1] || '';
  const classes = classAttr.split(/\s+/).filter(Boolean);

  if (!classes.includes('news-ssr-index')) {
    issues.push(
      issue('ssr_index_missing_class', 'section must include class news-ssr-index', file)
    );
  }
  if (!classes.includes('sr-only')) {
    issues.push(
      issue(
        'ssr_index_not_sr_only',
        'section must include sr-only (visible index between calendar and feed creates a huge gap)',
        file
      )
    );
  }

  // Visible layout classes that historically caused the gap if used without clip
  const forbiddenVisible = ['container', 'news-feed', 'news-bar'];
  for (const bad of forbiddenVisible) {
    if (classes.includes(bad)) {
      issues.push(
        issue(
          'ssr_index_visible_layout_class',
          `section must not use layout class "${bad}" (takes space in the page)`,
          file
        )
      );
    }
  }

  // Placement: between .news-bar and main.news-feed
  const barIdx = html.search(/class=["'][^"']*\bnews-bar\b/);
  const indexIdx = html.indexOf('<!--seo-autopilot:news-ssr-index-->');
  const feedIdx = html.search(/<main\b[^>]*\bnews-feed\b/);
  if (barIdx < 0 || feedIdx < 0) {
    issues.push(
      issue('news_structure', 'expected .news-bar and main.news-feed in news.html', file)
    );
  } else if (indexIdx > 0 && !(barIdx < indexIdx && indexIdx < feedIdx)) {
    issues.push(
      issue(
        'ssr_index_placement',
        'SSR index must sit between .news-bar and main.news-feed',
        file
      )
    );
  }

  // Links must remain crawlable inside the hidden block
  if (!/<a\s+[^>]*href=["']\/news\/a\//i.test(block)) {
    issues.push(
      issue('ssr_index_no_article_links', 'SSR index should list /news/a/... links', file)
    );
  }

  return issues;
}

function checkHiddenCss() {
  const issues = [];
  const newsCssFile = 'public/css/news.css';
  const landingCssFile = 'public/css/landing.css';
  const newsCss = read(newsCssFile);
  const landingCss = read(landingCssFile);

  if (newsCss == null) {
    issues.push(issue('missing_file', newsCssFile, newsCssFile));
  } else {
    const rule = extractRule(newsCss, '.news-ssr-index');
    if (!rule) {
      issues.push(
        issue(
          'missing_css_rule',
          '.news-ssr-index rule missing in news.css (index must clip out of flow)',
          newsCssFile
        )
      );
    } else if (!cssIsVisuallyHidden(rule)) {
      issues.push(
        issue(
          'ssr_index_css_not_hidden',
          '.news-ssr-index must use absolute + clip/1px overflow (no layout gap)',
          newsCssFile
        )
      );
    }
    // Guard against accidental min-height that reopens the gap
    if (rule && /min-height\s*:\s*[1-9]/i.test(rule)) {
      issues.push(
        issue(
          'ssr_index_min_height',
          '.news-ssr-index must not set a positive min-height',
          newsCssFile
        )
      );
    }
  }

  if (landingCss == null) {
    issues.push(issue('missing_file', landingCssFile, landingCssFile));
  } else {
    const rule = extractRule(landingCss, '.sr-only');
    if (!rule) {
      issues.push(issue('missing_css_rule', '.sr-only rule missing in landing.css', landingCssFile));
    } else if (!cssIsVisuallyHidden(rule)) {
      issues.push(
        issue(
          'sr_only_css_not_hidden',
          '.sr-only must clip content out of layout flow',
          landingCssFile
        )
      );
    }
  }

  return issues;
}

function checkAutopilotTemplate() {
  const issues = [];
  const file = 'seo/scripts/seo-autopilot.mjs';
  const src = read(file);
  if (src == null) {
    issues.push(issue('missing_file', file, file));
    return issues;
  }
  if (!/function\s+injectNewsListSsr\s*\(/.test(src)) {
    issues.push(issue('autopilot_inject_missing', 'injectNewsListSsr not found', file));
    return issues;
  }
  // Template string for the section open tag must include both classes
  if (!/class="news-ssr-index sr-only"/i.test(src) && !/class="sr-only news-ssr-index"/i.test(src)) {
    issues.push(
      issue(
        'autopilot_inject_not_sr_only',
        'injectNewsListSsr must emit class="news-ssr-index sr-only" (regression: visible gap)',
        file
      )
    );
  }
  return issues;
}

function checkMagazineBtnContrast() {
  const issues = [];
  const file = 'public/css/news-magazine.css';
  const css = read(file);
  if (css == null) {
    issues.push(issue('missing_file', file, file));
    return issues;
  }
  // .news-mag a { color: accent } must be overridden for brand buttons
  if (!/\.news-mag\s+a\.btn--brand\b/.test(css)) {
    issues.push(
      issue(
        'mag_btn_contrast_selector',
        'missing .news-mag a.btn--brand override (yellow text on yellow button)',
        file
      )
    );
    return issues;
  }
  const rule =
    extractRule(css, '.news-mag a.btn--brand') ||
    (() => {
      const m = css.match(
        /\.news-mag\s+a\.btn--brand[\s\S]*?\{([^}]*)\}/i
      );
      return m ? m[1] : null;
    })();
  if (!rule || !/color\s*:\s*var\(\s*--color-accent-ink\s*\)/i.test(rule)) {
    issues.push(
      issue(
        'mag_btn_contrast_color',
        '.news-mag a.btn--brand must set color: var(--color-accent-ink)',
        file
      )
    );
  }
  return issues;
}

function checkHeaderTitlePlacement() {
  const issues = [];
  const file = 'public/css/landing.css';
  const css = read(file);
  if (css == null) {
    issues.push(issue('missing_file', file, file));
    return issues;
  }
  // News must share the masters/partners rule that sets margin-left: 0
  const hasNewsInGroup =
    /body\[data-page="news"\]\s*\.header__page-title/.test(css) &&
    /body\[data-page="masters"\]\s*\.header__page-title/.test(css);
  if (!hasNewsInGroup) {
    issues.push(
      issue(
        'header_title_selector',
        'news .header__page-title must be styled with masters/partners',
        file
      )
    );
  }
  // Find a rule block that includes news page title and margin-left: 0
  const blocks = css.match(
    /body\[data-page="[^"]+"\]\s*\.header__page-title[\s\S]*?\{[^}]*\}/g
  ) || [];
  const newsBlocks = blocks.filter((b) => /data-page="news"/.test(b));
  const hasMarginFix = newsBlocks.some((b) => /margin-left\s*:\s*0\b/.test(b));
  if (!hasMarginFix) {
    issues.push(
      issue(
        'header_title_margin',
        'body[data-page="news"] .header__page-title must use margin-left: 0 (title next to logo)',
        file
      )
    );
  }

  const newsHtml = read('public/news.html') || '';
  if (!/class="header__page-title"/.test(newsHtml)) {
    issues.push(
      issue('header_title_markup', 'news.html must use .header__page-title', 'public/news.html')
    );
  }
  return issues;
}

function checkReviewUi() {
  const issues = [];
  const file = 'public/js/news-article.js';
  const src = read(file);
  if (src == null) {
    issues.push(issue('missing_file', file, file));
    return issues;
  }
  if (!/news-buy__btn/.test(src) || !/function\s+buyBlock\s*\(/.test(src)) {
    issues.push(
      issue(
        'review_buy_buttons',
        'buy links must render as .news-buy__btn buttons (not raw spaced URLs)',
        file
      )
    );
  }
  if (!/news-mag__list/.test(src) && !/news-article__list/.test(src)) {
    issues.push(
      issue('review_markdown_lists', 'markdown lists must render as ul/ol list classes', file)
    );
  }
  if (!/isListLine/.test(src)) {
    issues.push(
      issue('review_list_parser', 'markdown list line parser (isListLine) missing', file)
    );
  }
  return issues;
}

function main() {
  const report = {
    ok: true,
    ssrIndexHtml: checkSsrIndexHtml(),
    hiddenCss: checkHiddenCss(),
    autopilotTemplate: checkAutopilotTemplate(),
    magazineContrast: checkMagazineBtnContrast(),
    headerTitle: checkHeaderTitlePlacement(),
    reviewUi: checkReviewUi()
  };

  const all = [
    ...report.ssrIndexHtml,
    ...report.hiddenCss,
    ...report.autopilotTemplate,
    ...report.magazineContrast,
    ...report.headerTitle,
    ...report.reviewUi
  ];
  report.ok = all.length === 0;
  report.failCount = all.length;

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('=== Sitrifor news UI QA ===');
    const sections = [
      ['SSR index HTML (gap bug)', report.ssrIndexHtml],
      ['Hidden CSS (.news-ssr-index / .sr-only)', report.hiddenCss],
      ['Autopilot inject template', report.autopilotTemplate],
      ['Magazine btn contrast', report.magazineContrast],
      ['Header title placement', report.headerTitle],
      ['Product review UI', report.reviewUi]
    ];
    for (const [label, items] of sections) {
      console.log(`${label}:`, items.length ? `FAIL (${items.length})` : 'ok');
      for (const i of items) {
        console.log(`  - [${i.type}] ${i.detail}${i.file ? ` (${i.file})` : ''}`);
      }
    }
    console.log(report.ok ? 'PASS' : 'FAIL');
  }

  process.exit(report.ok ? 0 : 1);
}

main();
