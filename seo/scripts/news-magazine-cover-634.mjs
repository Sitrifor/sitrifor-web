#!/usr/bin/env node
/**
 * Build magazine cover collage for 634 App Store launch article.
 */
import { buildPhoneCollageCover } from '../../backend/news-magazine-images.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('../../backend/node_modules/better-sqlite3');
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '../../backend/data/news.db');

const shots = [
  '/img/app/real/home.png',
  '/img/app/real/match.png',
  '/img/app/real/inventory.png',
  '/img/app/real/clients.png'
];

const url = await buildPhoneCollageCover({
  shots,
  outName: '634-app-store.jpg',
  title: '634 · App Store'
});
console.log('cover', url);

const db = new Database(dbPath);
const info = db
  .prepare(`UPDATE articles SET image_url = ? WHERE slug = ?`)
  .run(`https://sitrifor.ru${url}`, '634-app-store-launch');
console.log('updated rows', info.changes);
db.close();
