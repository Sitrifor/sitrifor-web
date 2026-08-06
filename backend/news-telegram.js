/**
 * Fetch public posts from a Telegram channel preview (t.me/s/<channel>).
 */
const UA =
  'Mozilla/5.0 (compatible; SitriforNewsBot/1.0; +https://sitrifor.ru/news)';

function cleanHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#33;/g, '!')
    .replace(/&#\d+;/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/**
 * @param {string} channel e.g. notepad_ceo
 * @returns {Promise<Array<{id:string,text:string,url:string,date:string|null}>>}
 */
export async function fetchTelegramChannelPosts(channel = 'notepad_ceo', { limit = 20 } = {}) {
  const url = `https://t.me/s/${encodeURIComponent(channel)}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'ru-RU,ru;q=0.9' },
      redirect: 'follow'
    });
    if (!res.ok) throw new Error(`TG HTTP ${res.status}`);
    const html = await res.text();
    const posts = [];
    const blockRe =
      /data-post="([^"]+)"[\s\S]*?(?:<time[^>]*datetime="([^"]*)"[^>]*>)?[\s\S]*?class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    let m;
    while ((m = blockRe.exec(html)) && posts.length < limit) {
      const id = m[1];
      const date = m[2] || null;
      const text = cleanHtml(m[3]);
      if (!text || text.length < 40) continue;
      posts.push({
        id,
        text,
        date,
        url: `https://t.me/${id.replace('/', '/')}`
      });
    }
    // Fix URL: data-post is "notepad_ceo/123"
    for (const p of posts) {
      p.url = `https://t.me/${p.id}`;
    }
    return posts;
  } finally {
    clearTimeout(t);
  }
}
