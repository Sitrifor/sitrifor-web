#!/usr/bin/env node
/**
 * Submit URLs to IndexNow (Bing / Yandex).
 * Requires INDEXNOW_KEY in seo/.env and public key file at https://sitrifor.ru/<key>.txt
 *
 * Usage:
 *   node scripts/indexnow.mjs
 *   node scripts/indexnow.mjs / /masters /about
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const env = loadEnv();
const key = env.INDEXNOW_KEY || process.env.INDEXNOW_KEY;
const host = env.SITE_HOST || "sitrifor.ru";
const origin = (env.SITE_ORIGIN || `https://${host}`).replace(/\/$/, "");

if (!key) {
  console.error("Missing INDEXNOW_KEY in seo/.env — copy from .env.example");
  process.exit(1);
}

const rawArgs = process.argv.slice(2);
const paths = [];
for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a === "--urls" && rawArgs[i + 1]) {
    paths.push(
      ...rawArgs[++i]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    );
    continue;
  }
  if (a.startsWith("--")) continue;
  paths.push(a);
}
const urlList =
  paths.length > 0
    ? paths.map((p) => (p.startsWith("http") ? p : origin + (p.startsWith("/") ? p : `/${p}`)))
    : [
        `${origin}/`,
        `${origin}/masters`,
        `${origin}/partners`,
        `${origin}/about`,
        `${origin}/exclusive`,
        `${origin}/privacy/`,
        `${origin}/support/`,
        `${origin}/634/`,
        `${origin}/guides/`,
        `${origin}/guides/aftercare/`,
      ];

const body = {
  host,
  key,
  keyLocation: `${origin}/${key}.txt`,
  urlList,
};

const endpoints = [
  "https://api.indexnow.org/indexnow",
  "https://yandex.com/indexnow",
];

for (const endpoint of endpoints) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  console.log(`${endpoint} → ${res.status} ${res.statusText}`);
  const t = await res.text();
  if (t) console.log(t.slice(0, 300));
}
