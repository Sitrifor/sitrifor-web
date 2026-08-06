#!/usr/bin/env node
/**
 * Technical SEO audit for sitrifor.ru (live or local file paths).
 * Usage:
 *   node scripts/seo-audit.mjs
 *   node scripts/seo-audit.mjs --url https://sitrifor.ru
 *   node scripts/seo-audit.mjs --url http://127.0.0.1:8080
 */
import * as cheerio from "cheerio";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import robotsParser from "robots-parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const REPORTS = path.join(ROOT, "reports");

const DEFAULT_PATHS = [
  "/",
  "/masters",
  "/partners",
  "/about",
  "/exclusive",
  "/privacy/",
  "/support/",
  "/robots.txt",
  "/sitemap.xml",
  "/favicon.svg",
  "/favicon.ico",
];

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const base = (arg("--url", "https://sitrifor.ru") || "https://sitrifor.ru").replace(/\/$/, "");

async function fetchText(url) {
  const res = await fetch(url, {
    redirect: "manual",
    headers: { "User-Agent": "SitriforSeoToolkit/1.0 (+https://sitrifor.ru)" },
  });
  const text = res.status < 400 || res.status === 404 ? await res.text() : "";
  return {
    url,
    status: res.status,
    location: res.headers.get("location"),
    contentType: res.headers.get("content-type") || "",
    text,
    finalUrl: url,
  };
}

function analyzeHtml(url, html) {
  const $ = cheerio.load(html);
  const title = $("title").first().text().trim();
  const description = $('meta[name="description"]').attr("content") || "";
  const robots = $('meta[name="robots"]').attr("content") || "";
  const canonical = $('link[rel="canonical"]').attr("href") || "";
  const og = {};
  $('meta[property^="og:"]').each((_, el) => {
    og[$(el).attr("property")] = $(el).attr("content") || "";
  });
  const h1 = $("h1")
    .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
    .get();
  const jsonLd = $('script[type="application/ld+json"]').length;
  const imgs = $("img").length;
  const emptyAlt = $("img").filter((_, el) => ($(el).attr("alt") ?? "") === "").length;
  const text = $("body").text().replace(/\s+/g, " ").trim();
  const words = text ? text.split(" ").filter(Boolean).length : 0;
  const issues = [];
  if (!title) issues.push("missing_title");
  if (!description) issues.push("missing_description");
  if (!canonical) issues.push("missing_canonical");
  if (!og["og:title"]) issues.push("missing_og");
  if (jsonLd === 0) issues.push("missing_json_ld");
  if (h1.length === 0) issues.push("missing_h1");
  if (h1.length > 1) issues.push("multiple_h1");
  if (words < 120 && !url.includes("/privacy") && !url.includes("/support")) issues.push("thin_content");
  if (words < 80 && url.includes("/support")) issues.push("thin_content");
  return {
    url,
    title,
    titleLen: title.length,
    description,
    descriptionLen: description.length,
    robots,
    canonical,
    ogKeys: Object.keys(og),
    h1,
    jsonLd,
    imgs,
    emptyAlt,
    words,
    issues,
  };
}

async function main() {
  fs.mkdirSync(REPORTS, { recursive: true });
  const results = { base, generatedAt: new Date().toISOString(), pages: [], tech: {} };

  for (const p of DEFAULT_PATHS) {
    const url = base + p;
    try {
      const r = await fetchText(url);
      const row = {
        path: p,
        status: r.status,
        location: r.location,
        contentType: r.contentType,
      };
      if (p === "/robots.txt") {
        results.tech.robots = { status: r.status, bodyPreview: r.text.slice(0, 500) };
        if (r.status === 200) {
          const robots = robotsParser(url, r.text);
          results.tech.robots.allowsRoot = robots.isAllowed(base + "/", "Googlebot");
        }
      } else if (p === "/sitemap.xml") {
        results.tech.sitemap = { status: r.status, bytes: r.text.length };
      } else if (r.contentType.includes("html") && r.status === 200) {
        Object.assign(row, analyzeHtml(url, r.text));
      }
      results.pages.push(row);
      console.log(`${r.status}\t${p}\t${row.issues ? row.issues.join(",") : ""}`);
    } catch (e) {
      results.pages.push({ path: p, error: String(e) });
      console.error(`ERR\t${p}\t${e}`);
    }
  }

  // Host duplicate check
  try {
    const www = await fetchText(base.replace("://", "://www."));
    results.tech.www = {
      status: www.status,
      location: www.location,
      duplicateRisk: www.status === 200,
    };
  } catch (e) {
    results.tech.www = { error: String(e) };
  }

  const out = path.join(REPORTS, `seo-audit-${Date.now()}.json`);
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  const latest = path.join(REPORTS, "seo-audit-latest.json");
  fs.writeFileSync(latest, JSON.stringify(results, null, 2));
  console.log(`\nWrote ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
