/**
 * Regenerate public/sitemap-marketplace.xml with product + catalog URLs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listProductSlugsForSitemap } from './api.js';
import { productPublicPath } from './render-ssr.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(__dirname, '../../public');
const SITE = 'https://sitrifor.ru';

function escXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function writeMarketplaceSitemap({ limit = 20000 } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const products = listProductSlugsForSitemap({ limit });
  const urls = [
    { loc: `${SITE}/marketplace`, lastmod: today, priority: '0.85', changefreq: 'daily' },
    ...products.map((p) => ({
      loc: `${SITE}${productPublicPath(p.slug)}`,
      lastmod: (p.updatedAt || today).slice(0, 10),
      priority: '0.6',
      changefreq: 'weekly'
    }))
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${escXml(u.loc)}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`
  )
  .join('\n')}
</urlset>
`;

  const outPath = path.join(PUBLIC, 'sitemap-marketplace.xml');
  fs.writeFileSync(outPath, xml);

  const mainPath = path.join(PUBLIC, 'sitemap.xml');
  if (fs.existsSync(mainPath)) {
    let main = fs.readFileSync(mainPath, 'utf8');
    if (!main.includes(`${SITE}/marketplace`)) {
      main = main.replace(
        '</urlset>',
        `  <url>
    <loc>${SITE}/marketplace</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.85</priority>
  </url>
</urlset>`
      );
      fs.writeFileSync(mainPath, main);
    }
  }

  const robotsPath = path.join(PUBLIC, 'robots.txt');
  if (fs.existsSync(robotsPath)) {
    let robots = fs.readFileSync(robotsPath, 'utf8');
    if (!robots.includes('sitemap-marketplace.xml')) {
      robots = robots.trimEnd() + `\nSitemap: ${SITE}/sitemap-marketplace.xml\n`;
      fs.writeFileSync(robotsPath, robots);
    }
  }

  return { path: outPath, urls: urls.length, products: products.length };
}
