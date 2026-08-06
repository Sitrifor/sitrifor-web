#!/usr/bin/env node
/**
 * Run Lighthouse SEO + performance against sitrifor.ru
 * Usage: node scripts/run-lighthouse.mjs [url]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const lighthouse = (await import("lighthouse")).default;
const chromeLauncher = await import("chrome-launcher");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORTS = path.resolve(__dirname, "../reports");

function argUrl() {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--url");
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  const positional = argv.find((a) => !a.startsWith("-") && /^https?:\/\//.test(a));
  return positional || "https://sitrifor.ru/";
}

const url = argUrl();

fs.mkdirSync(REPORTS, { recursive: true });

const chromePath =
  process.env.CHROME_PATH ||
  ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome"].find((p) =>
    fs.existsSync(p)
  );

const chrome = await chromeLauncher.launch({
  chromePath,
  chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});

try {
  const result = await lighthouse(url, {
    port: chrome.port,
    output: ["json", "html"],
    onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
    formFactor: "mobile",
    screenEmulation: { mobile: true, width: 412, height: 915, deviceScaleFactor: 2.625 },
  });

  const stamp = Date.now();
  const jsonPath = path.join(REPORTS, `lighthouse-${stamp}.json`);
  const htmlPath = path.join(REPORTS, `lighthouse-${stamp}.html`);
  fs.writeFileSync(jsonPath, result.report[0]);
  fs.writeFileSync(htmlPath, result.report[1]);
  fs.writeFileSync(path.join(REPORTS, "lighthouse-latest.json"), result.report[0]);
  fs.writeFileSync(path.join(REPORTS, "lighthouse-latest.html"), result.report[1]);

  const cats = result.lhr.categories;
  console.log(`URL: ${url}`);
  for (const [k, v] of Object.entries(cats)) {
    console.log(`${k}: ${Math.round((v.score || 0) * 100)}`);
  }
  console.log(`HTML: ${htmlPath}`);
} finally {
  await chrome.kill();
}
