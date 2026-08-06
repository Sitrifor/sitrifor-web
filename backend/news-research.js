/**
 * Web research helper (DuckDuckGo HTML) for Sitrifor AI insights.
 */
import * as cheerio from 'cheerio';

const UA = 'Mozilla/5.0 SitriforNewsBot/1.0 (+https://sitrifor.ru/news)';

export async function searchWeb(query, { limit = 5 } = {}) {
  const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    redirect: 'follow'
  });
  if (!res.ok) return [];
  const html = await res.text();
  const $ = cheerio.load(html);
  const out = [];
  $('.result').each((_, el) => {
    if (out.length >= limit) return;
    const a = $(el).find('a.result__a').first();
    const snippet = $(el).find('.result__snippet').text().replace(/\s+/g, ' ').trim();
    let href = a.attr('href') || '';
    const m = href.match(/[?&]uddg=([^&]+)/);
    if (m) {
      try {
        href = decodeURIComponent(m[1]);
      } catch {
        /* keep */
      }
    }
    const title = a.text().replace(/\s+/g, ' ').trim();
    if (!title || !href || !/^https?:/i.test(href)) return;
    if (/duckduckgo\.com|youtube\.com\/watch/i.test(href)) return;
    out.push({ title, url: href, snippet });
  });
  return out;
}

export async function fetchPageSnippet(url, { maxChars = 1800 } = {}) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      redirect: 'follow'
    });
    clearTimeout(t);
    if (!res.ok) return '';
    const html = await res.text();
    const $ = cheerio.load(html);
    $('script, style, nav, footer, header, aside, iframe, noscript, form, .ads').remove();
    const text = $('article, main, .entry-content, .post-content, body')
      .first()
      .text()
      .replace(/\s+/g, ' ')
      .trim();
    return text.slice(0, maxChars);
  } catch {
    return '';
  }
}

export async function researchTopic(query, { limit = 4 } = {}) {
  const results = await searchWeb(query, { limit });
  const enriched = [];
  for (const r of results) {
    const page = await fetchPageSnippet(r.url, { maxChars: 1200 });
    enriched.push({ ...r, pageText: page });
  }
  return enriched;
}
