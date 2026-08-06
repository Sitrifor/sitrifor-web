#!/usr/bin/env node
/**
 * Crawl internal links from homepage and report status codes.
 * Usage: node scripts/crawl-internal.mjs [startUrl]
 */
import * as cheerio from "cheerio";

const start = (process.argv[2] || "https://sitrifor.ru/").replace(/\/$/, "") + "/";
const origin = new URL(start).origin;
const queue = [start];
const seen = new Set();
const rows = [];

while (queue.length && seen.size < 80) {
  const url = queue.shift();
  if (seen.has(url)) continue;
  seen.add(url);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "SitriforSeoToolkit/1.0" },
    });
    const ct = res.headers.get("content-type") || "";
    rows.push({ url: res.url, status: res.status, ct });
    console.log(`${res.status}\t${res.url}`);
    if (!ct.includes("html") || res.status >= 400) continue;
    const html = await res.text();
    const $ = cheerio.load(html);
    $("a[href]").each((_, el) => {
      let href = $(el).attr("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:"))
        return;
      try {
        const abs = new URL(href, url);
        if (abs.origin !== origin) return;
        abs.hash = "";
        const next = abs.toString();
        if (!seen.has(next) && !queue.includes(next)) queue.push(next);
      } catch {
        /* ignore bad urls */
      }
    });
  } catch (e) {
    rows.push({ url, error: String(e) });
    console.error(`ERR\t${url}\t${e}`);
  }
}

const broken = rows.filter((r) => r.status && r.status >= 400);
console.log(`\nCrawled ${rows.length}, broken ${broken.length}`);
