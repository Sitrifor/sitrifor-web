#!/usr/bin/env node
/**
 * Hourly news engagement boost (views + soft reactions).
 * Usage: node scripts/news-engagement-hourly.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, '../../backend');
const news = await import(path.join(BACKEND, 'news.js'));

const summary = news.runHourlyEngagementBoost();
console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
