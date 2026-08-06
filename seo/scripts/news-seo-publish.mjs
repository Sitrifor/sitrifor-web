#!/usr/bin/env node
/**
 * Publish news SEO artifacts: sitemap (all published articles) + IndexNow ping.
 * Prefer news-seo-optimize.mjs for full per-article optimization.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { writeNewsSitemap } from "../../backend/news-seo/index.js";
import { listPublishedForSitemap, newsStats } from "../../backend/news.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const sitemap = writeNewsSitemap();
const recent = listPublishedForSitemap({ limit: 40 });

const pingPaths = ["/news", ...recent.slice(0, 20).map((a) => `/news/a/${a.slug}`)];
try {
  const out = execFileSync("node", ["scripts/indexnow.mjs", ...pingPaths], {
    cwd: ROOT,
    encoding: "utf8",
  });
  console.log(out);
} catch (e) {
  console.warn("IndexNow warn:", e.message);
}

fs.writeFileSync(
  path.join(ROOT, "reports/news-seo-latest.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      articles: sitemap.articles,
      urls: sitemap.urls,
      stats: newsStats(),
      note: "Date facet URLs removed; use news-seo-optimize for per-article meta",
    },
    null,
    2
  )
);

console.log(JSON.stringify({ ok: true, sitemap, stats: newsStats() }, null, 2));
