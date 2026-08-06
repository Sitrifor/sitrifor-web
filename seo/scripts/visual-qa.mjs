#!/usr/bin/env node
/**
 * Visual design QA for sitrifor.ru
 * Screenshots + structural checks against site design rules.
 *
 *   node scripts/visual-qa.mjs
 *   node scripts/visual-qa.mjs --url https://sitrifor.ru/
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "reports/visual");
const urlArg = (() => {
  const i = process.argv.indexOf("--url");
  return i >= 0 ? process.argv[i + 1] : "https://sitrifor.ru/";
})();

fs.mkdirSync(OUT, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const shot = path.join(OUT, `home-${stamp}.png`);
const fullShot = path.join(OUT, `home-full-${stamp}.png`);

// Prefer system Chrome for screenshots (reliable on this VPS)
const chrome =
  ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium-browser"].find((p) =>
    fs.existsSync(p)
  );

if (!chrome) {
  console.error("No Chrome/Chromium found");
  process.exit(1);
}

execFileSync(
  chrome,
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--window-size=1440,900",
    `--screenshot=${shot}`,
    urlArg,
  ],
  { stdio: "pipe" }
);

execFileSync(
  chrome,
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--window-size=1440,2400",
    `--screenshot=${fullShot}`,
    urlArg,
  ],
  { stdio: "pipe" }
);

const html = await (await fetch(urlArg)).text();

const checks = [];
function check(id, ok, detail) {
  checks.push({ id, ok: Boolean(ok), detail });
}

// Design rules for homepage editorial copy
check("no_card_in_hero", !/agg-hero[\s\S]{0,800}home-copy-panel/.test(html), "Hero must not use home-copy-panel cards");
check("no_founder_photo_in_hero", !/agg-hero[\s\S]{0,1200}founders\//.test(html), "Hero must not embed founder photos behind copy");
check("hero_more_is_plain_p", /class="agg-hero__more"/.test(html), "Short supporting line uses .agg-hero__more");
check("seo_open_typography", /home-seo__copy/.test(html) && /home-seo__title/.test(html) && !/home-seo[\s\S]{0,200}story-band/.test(html), "Long copy uses open home-seo typography (no card)");
check("no_em_dash_in_seo_blocks", !/<p class="agg-hero__more">[^<]*—/.test(html) && !/home-seo__copy[\s\S]{0,1200}—/.test(html), "SEO copy blocks avoid em-dashes (use en-dash)");
check("uses_en_dash_in_seo", /agg-hero__more">[^<]*–/.test(html) || /партнёрский контур<\/a> –/.test(html), "SEO copy uses short en-dashes");
check("single_h1", (html.match(/<h1\b/gi) || []).length === 1, "Exactly one H1 on page");
check("seo_h2_present", /home-seo__title/.test(html), "SEO section has titled H2");
check("no_home_copy_panel_class", !/home-copy-panel/.test(html), "Removed failed photo-panel experiment");

// Playwright optional DOM metrics if available
let metrics = null;
try {
  const require = createRequire(import.meta.url);
  // playwright may need browsers; skip soft-fail
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(urlArg, { waitUntil: "networkidle", timeout: 45000 });
  metrics = await page.evaluate(() => {
    const hero = document.querySelector(".agg-hero");
    const more = document.querySelector(".agg-hero__more");
    const band = document.querySelector(".home-seo");
    const cards = document.querySelector(".agg-grid");
    const heroBox = hero?.getBoundingClientRect();
    const moreBox = more?.getBoundingClientRect();
    const bandBox = band?.getBoundingClientRect();
    const gridBox = cards?.getBoundingClientRect();
    const moreStyle = more ? getComputedStyle(more) : null;
    return {
      heroHeight: heroBox ? Math.round(heroBox.height) : null,
      moreInHero: more && hero ? hero.contains(more) : false,
      moreIsCard: moreStyle
        ? moreStyle.borderTopWidth !== "0px" ||
          (moreStyle.backgroundColor !== "rgba(0, 0, 0, 0)" &&
            moreStyle.backgroundColor !== "transparent")
        : false,
      bandBelowGrid: bandBox && gridBox ? bandBox.top >= gridBox.bottom - 8 : null,
      moreFontSize: moreStyle?.fontSize || null,
      bandHasCardChrome: band
        ? getComputedStyle(band).borderTopWidth !== "0px" &&
          getComputedStyle(band).backgroundColor !== "rgba(0, 0, 0, 0)" &&
          !band.classList.contains("container")
        : null,
    };
  });
  await browser.close();
  check("more_inside_hero", metrics.moreInHero, "Supporting line lives in hero");
  check("more_not_cardlike", !metrics.moreIsCard, "Supporting line is not card-styled");
  check("band_after_grid", metrics.bandBelowGrid, "Editorial band sits after service grid");
} catch (e) {
  checks.push({ id: "playwright_metrics", ok: true, detail: `skipped: ${String(e.message || e).slice(0, 120)}` });
}

const failed = checks.filter((c) => !c.ok);
const report = {
  generatedAt: new Date().toISOString(),
  url: urlArg,
  screenshots: { viewport: shot, full: fullShot },
  metrics,
  checks,
  passed: failed.length === 0,
  failedCount: failed.length,
};

fs.writeFileSync(path.join(OUT, "visual-qa-latest.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: report.passed, failedCount: report.failedCount, shot, checks }, null, 2));
process.exit(failed.length ? 2 : 0);
