/**
 * Regenerate public/sitemap-news.xml with published article URLs only.
 * Drops date-facet URLs (?date=) to avoid near-duplicate indexing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listPublishedForSitemap, newsStats } from '../news.js';

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

export function writeNewsSitemap({ limit = 5000 } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const articles = listPublishedForSitemap({ limit });
  const urls = [
    { loc: `${SITE}/news`, lastmod: today, priority: '0.85', changefreq: 'hourly' },
    ...articles.map((a) => ({
      loc: `${SITE}/news/a/${a.slug}`,
      lastmod: (a.published_at || a.day || today).slice(0, 10),
      priority: '0.75',
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

  const outPath = path.join(PUBLIC, 'sitemap-news.xml');
  fs.writeFileSync(outPath, xml);

  // Ensure main sitemap mentions /news
  const mainPath = path.join(PUBLIC, 'sitemap.xml');
  if (fs.existsSync(mainPath)) {
    let main = fs.readFileSync(mainPath, 'utf8');
    if (!main.includes(`${SITE}/news`)) {
      main = main.replace(
        '</urlset>',
        `  <url>
    <loc>${SITE}/news</loc>
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
    if (!robots.includes('sitemap-news.xml')) {
      robots = robots.trimEnd() + `\nSitemap: ${SITE}/sitemap-news.xml\n`;
      fs.writeFileSync(robotsPath, robots);
    }
  }

  return {
    path: outPath,
    urls: urls.length,
    articles: articles.length,
    stats: newsStats()
  };
}
