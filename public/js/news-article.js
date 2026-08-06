/**
 * Single news article page — editorial + product-review layouts
 */
(function () {
  'use strict';

  let langBound = false;

  function t(key, vars) {
    if (window.SitriforI18n && typeof window.SitriforI18n.t === 'function') {
      return window.SitriforI18n.t(key, vars);
    }
    return key;
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatViews(n) {
    const v = Math.max(0, Number(n) || 0);
    if (v >= 1000) {
      const compact = (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(/\.0$/, '');
      return t('news.viewsShortK', { n: compact });
    }
    return t('news.viewsShort', { n: v });
  }

  function currentLang() {
    try {
      if (window.SitriforI18n && typeof window.SitriforI18n.getLang === 'function') {
        return window.SitriforI18n.getLang();
      }
      const stored = localStorage.getItem('sitrifor_lang');
      if (stored) return stored;
    } catch (e) {}
    const active = document.querySelector('[data-lang-switch].is-active');
    return (active && active.getAttribute('data-lang-switch')) || 'ru';
  }

  function slugFromPath() {
    const m = location.pathname.match(/\/news\/a\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function healBrokenHttpUrls(text) {
    return String(text || '').replace(
      /https?:\/\/(?:[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%\-]| (?=[A-Za-z0-9%._~+\-?=&#/]))+/g,
      (raw) => {
        const compact = raw.replace(/ /g, '');
        try {
          const u = new URL(compact);
          u.hostname = u.hostname.toLowerCase();
          return u.toString();
        } catch (e) {
          return compact;
        }
      }
    );
  }

  function linkify(htmlEscaped) {
    return healBrokenHttpUrls(htmlEscaped).replace(/(https?:\/\/[^\s<&]+)/g, (url) => {
      const clean = url.replace(/[.,;:!?)]+$/, '');
      const trail = url.slice(clean.length);
      return `<a href="${clean}" target="_blank" rel="noopener noreferrer">${clean}</a>${trail}`;
    });
  }

  function renderMarkdownImages(chunk) {
    const figs = [];
    const re = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
    let m;
    while ((m = re.exec(chunk))) {
      const alt = esc(m[1] || '');
      let src = String(m[2] || '').trim();
      if (src.startsWith('https://sitrifor.ru/')) src = src.slice('https://sitrifor.ru'.length);
      if (!src.startsWith('/img/')) continue;
      figs.push(
        `<figure class="news-article__shot"><img src="${esc(src)}" alt="${alt}" loading="lazy" decoding="async" width="473" height="1024"></figure>`
      );
    }
    return figs.length ? `<div class="news-article__shots">${figs.join('')}</div>` : '';
  }

  function parseMdLink(raw) {
    const s = String(raw || '').trim();
    const md = s.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (md && /^(https?:\/\/|\/|#)/i.test(md[2].trim())) {
      return { label: md[1].trim(), href: md[2].trim() };
    }
    return null;
  }

  function isRelatedHeading(text) {
    return /Ещё на Sitrifor|Еще на Sitrifor|Читайте также|More on Sitrifor|Also on Sitrifor|Auch auf Sitrifor/i.test(
      String(text || '')
    );
  }

  function relatedNavHtml(title, links) {
    if (!links?.length) return '';
    return `<nav class="news-article__related" aria-label="${esc(title || 'Ещё на Sitrifor')}">
      <h2 class="news-article__related-title">${esc(title || 'Ещё на Sitrifor')}</h2>
      <div class="news-article__related-row">
        ${links
          .map((l) => {
            const href = String(l.href || '#');
            const ext = /^https?:\/\//i.test(href);
            return `<a class="news-article__related-btn" href="${esc(href)}"${
              ext ? ' target="_blank" rel="noopener noreferrer"' : ''
            }>${esc(l.label || href)}</a>`;
          })
          .join('')}
      </div>
    </nav>`;
  }

  function inlineMdLinks(escapedChunk) {
    return String(escapedChunk || '').replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
      const h = String(href).trim();
      const safe = /^(https?:\/\/|\/|#)/i.test(h) ? h : '#';
      const rel = safe.startsWith('http') ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<a href="${esc(safe)}"${rel}>${label}</a>`;
    });
  }

  function paras(text) {
    const normalized = healBrokenHttpUrls(String(text || ''))
      .replace(/\r\n/g, '\n')
      .replace(/^([ \t]*)[•●]\s+/gm, '$1- ');
    const lines = normalized.split('\n');
    const blocks = [];
    let buf = [];
    let imgBuf = [];
    const flush = () => {
      const chunk = buf.join('\n').trim();
      if (chunk) blocks.push(chunk);
      buf = [];
    };
    const flushImgs = () => {
      if (!imgBuf.length) return;
      blocks.push(imgBuf.join('\n'));
      imgBuf = [];
    };
    const isListLine = (s) => /^([-*•●]|\d+\.)\s+\S/.test(s);
    for (const line of lines) {
      const trimmed = line.trim();
      // Heading possibly glued to images: "## Title![alt](url)"
      const glued = trimmed.match(/^(#{1,3})\s+(.+?)(!\[[^\]]*\]\([^)]+\).*)$/);
      if (glued) {
        flush();
        flushImgs();
        blocks.push(`${glued[1]} ${glued[2].trim()}`);
        imgBuf.push(glued[3]);
        continue;
      }
      if (/^#{1,3}\s+\S/.test(trimmed)) {
        flush();
        flushImgs();
        blocks.push(trimmed);
        continue;
      }
      if (/^!\[[^\]]*\]\([^)]+\)/.test(trimmed)) {
        flush();
        imgBuf.push(trimmed);
        continue;
      }
      if (isListLine(trimmed)) {
        flushImgs();
        if (buf.length && !isListLine(buf[buf.length - 1].trim())) flush();
        buf.push(line);
        continue;
      }
      if (!trimmed) {
        flush();
        flushImgs();
        continue;
      }
      flushImgs();
      if (buf.length && isListLine(buf[buf.length - 1].trim())) flush();
      buf.push(line);
    }
    flush();
    flushImgs();

    const out = [];
    for (let i = 0; i < blocks.length; i += 1) {
      const p = blocks[i];
      if (/^##\s+/.test(p) || /^#\s+/.test(p)) {
        const title = p.replace(/^#{1,3}\s+/, '');
        const next = blocks[i + 1] || '';
        const nextLines = next.split('\n').map((l) => l.trim()).filter(Boolean);
        const nextIsList =
          nextLines.length > 0 && nextLines.every((l) => isListLine(l) || /^(\*\*|•|-|\d+\.)/.test(l));
        if (isRelatedHeading(title) && nextIsList) {
          const links = nextLines
            .map((l) => l.replace(/^(\*\*|[•●\-*\s]+|\d+\.\s*)/, '').trim())
            .map(parseMdLink)
            .filter(Boolean);
          out.push(relatedNavHtml(title, links));
          i += 1;
          continue;
        }
        if (/^##\s+/.test(p)) out.push(`<h3 class="news-article__h">${esc(title)}</h3>`);
        else out.push(`<h2 class="news-article__h">${esc(title)}</h2>`);
        continue;
      }
      if (/!\[[^\]]*\]\([^)]+\)/.test(p)) {
        const shots = renderMarkdownImages(p);
        if (shots) {
          const rest = p.replace(/!\[[^\]]*\]\([^)\s]+\)/g, '').trim();
          if (!rest) {
            out.push(shots);
            continue;
          }
          const rich = linkify(inlineMdLinks(esc(rest).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')));
          out.push(`<p>${rich}</p>${shots}`);
          continue;
        }
      }
      const listLines = p.split('\n').map((l) => l.trim()).filter(Boolean);
      const allList = listLines.length > 0 && listLines.every((l) => isListLine(l) || /^(\*\*|•|-|\d+\.)/.test(l));
      if (allList || /^(\*\*|•|-|\d+\.)/.test(p) || p.includes('\n•') || p.includes('\n-')) {
        const items = listLines
          .map((l) => l.replace(/^(\*\*|[•●\-*\s]+|\d+\.\s*)/, '').replace(/\*\*/g, ''))
          .filter(Boolean)
          .map((l) => {
            const link = parseMdLink(l);
            if (link) {
              const ext = /^https?:\/\//i.test(link.href);
              return `<li><a href="${esc(link.href)}"${
                ext ? ' target="_blank" rel="noopener noreferrer"' : ''
              }>${esc(link.label)}</a></li>`;
            }
            return `<li>${linkify(inlineMdLinks(esc(l)))}</li>`;
          })
          .join('');
        if (items) out.push(`<ul class="news-article__list">${items}</ul>`);
        continue;
      }
      const rich = linkify(inlineMdLinks(esc(p).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')));
      out.push(`<p>${rich}</p>`);
    }
    return out.join('');
  }

  function icon(type) {
    if (type === 'rocket') return '<span class="news-react__emoji" aria-hidden="true">🚀</span>';
    if (type === 'smile') return '<span class="news-react__emoji" aria-hidden="true">👍</span>';
    return '<span class="news-react__emoji" aria-hidden="true">💩</span>';
  }

  function vid() {
    try {
      let v = localStorage.getItem('sf_vid');
      if (!v) {
        v = 'sf_' + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
        localStorage.setItem('sf_vid', v);
      }
      return v;
    } catch (e) {
      return 'sf_anon';
    }
  }

  function extractBuyLinks(a) {
    const links = [];
    const seen = new Set();
    const push = (label, url, primary) => {
      const healed = healBrokenHttpUrls(String(url || '').trim()).replace(/[.,;)]+$/, '');
      if (!healed || !/^https?:\/\//i.test(healed) || seen.has(healed)) return;
      seen.add(healed);
      links.push({ label, url: healed, primary: Boolean(primary) });
    };

    if (a.url && /tattoomarket\.ru/i.test(a.url)) {
      push('TattooMarket', a.url, true);
    }

    const body = healBrokenHttpUrls(String(a.body || ''));
    const shopSection = body.match(/##\s*(Где купить|Where to buy|Wo kaufen)([\s\S]*?)(?=\n##\s|\n_|$)/i);
    const chunk = shopSection ? shopSection[2] : body;
    // Allow intra-URL spaces from older polish bugs; stop at newlines
    const re =
      /(?:^|\n)\s*(?:[-•*])?\s*(TattooMarket|Ozon|Wildberries|Яндекс Маркет|Yandex Market)\s*:\s*(https?:\/\/[^\s\n]+(?:[ \t]+[^\s\n]+)*)/gi;
    let m;
    while ((m = re.exec(chunk))) {
      push(m[1], m[2], /tattoomarket/i.test(m[1]));
    }

    if (!links.length && a.url) push(t('news.buy.openSource'), a.url, true);

    const q = encodeURIComponent(
      String(a.title || '')
        .replace(/^(Обзор для мастера|Review for the artist|Review für Meister):\s*/i, '')
        .slice(0, 100)
    );
    if (!links.some((l) => /ozon/i.test(l.label))) {
      push('Ozon', `https://www.ozon.ru/search/?text=${q}`);
    }
    if (!links.some((l) => /wildberries/i.test(l.label))) {
      push('Wildberries', `https://www.wildberries.ru/catalog/0/search.aspx?search=${q}`);
    }
    if (!links.some((l) => /яндекс|yandex/i.test(l.label))) {
      push(t('news.buy.yandex'), `https://market.yandex.ru/search?text=${q}`);
    }
    return links;
  }

  function parseReviewPrices(a) {
    const text = `${a.summary || ''}\n${a.body || ''}`;
    const out = [];
    const seen = new Set();
    const push = (label, price) => {
      const l = String(label || '').trim();
      const p = String(price || '').trim();
      if (!l || !p || seen.has(l.toLowerCase())) return;
      seen.add(l.toLowerCase());
      out.push({ label: l, price: p });
    };
    const line = text.match(/(?:Цены|Prices|Preise):\s*([^\n]+)/i);
    if (line) {
      for (const part of line[1].split(/;\s*/)) {
        const m = part.match(/^(.+?):\s*(.+)$/);
        if (m) push(m[1], m[2]);
      }
    }
    const sec = text.match(/##\s*Цены[^\n]*\n([\s\S]*?)(?=\n##\s|\n_[^\n]*$|$)/i);
    if (sec) {
      for (const raw of sec[1].split('\n')) {
        const row = raw.replace(/^[-•*]\s*/, '').trim();
        if (!row) continue;
        const m = row.match(/^(.+?)\s+[–\-—]\s+(.+)$/) || row.match(/^(.+?):\s*(.+)$/);
        if (m) push(m[1], m[2]);
      }
    }
    return out.slice(0, 8);
  }

  function productCardBlock(a, links) {
    const name = String(a.title || '')
      .replace(/^(Обзор для мастера|Review for the artist|Review für Meister):\s*/i, '')
      .trim();
    let desc = String(a.summary || '')
      .replace(/\s*(?:Цены|Prices|Preise):\s*[^\n]+/i, '')
      .trim()
      .slice(0, 320);
    const prices = parseReviewPrices(a);
    const img = a.imageUrl && !/placeholder/i.test(String(a.imageUrl)) ? a.imageUrl : '';
    const media = img
      ? `<div class="news-product-card__media"><figure class="news-product-card__shot"><img src="${esc(
          img
        )}" alt="${esc(name)}" loading="eager" decoding="async" referrerpolicy="no-referrer" onerror="this.closest('figure')?.remove()"></figure></div>`
      : '';
    const priceRows = prices.length
      ? `<ul class="news-product-card__prices">${prices
          .map((p) => `<li><span>${esc(p.label)}</span><strong>${esc(p.price)}</strong></li>`)
          .join('')}</ul>`
      : '';
    const buy =
      links.length
        ? `<div class="news-product-card__buy">
            <h3 class="news-buy__title">${esc(t('news.buy.title'))}</h3>
            <div class="news-buy__row">
              ${links
                .map(
                  (l) =>
                    `<a class="news-buy__btn${l.primary ? ' news-buy__btn--primary' : ''}" href="${esc(
                      l.url
                    )}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a>`
                )
                .join('')}
            </div>
          </div>`
        : '';
    const nameHtml = a.url
      ? `<a class="news-product-card__name" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(
          name
        )}</a>`
      : `<h2 class="news-product-card__name">${esc(name)}</h2>`;
    return `<section class="news-product-card" aria-label="${esc(name || t('news.badge.review'))}">
      ${media}
      <div class="news-product-card__copy">
        ${nameHtml}
        ${desc ? `<p class="news-product-card__desc">${esc(desc)}</p>` : ''}
        ${priceRows}
        ${buy}
      </div>
    </section>`;
  }

  function stripReviewShopSections(body) {
    return String(body || '')
      .replace(/\n##\s*(Где купить|Where to buy|Wo kaufen)[\s\S]*?(?=\n##\s|\n_[^\n]*$|$)/gi, '\n')
      .replace(/\n##\s*Цены[^\n]*\n[\s\S]*?(?=\n##\s|\n_[^\n]*$|$)/gi, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function promoBlock() {
    return `
      <aside class="news-promo" aria-label="${esc(t('news.promo.aria'))}">
        <h2 class="news-promo__title">${esc(t('news.promo.title'))}</h2>
        <p class="news-promo__lead">${esc(t('news.promo.lead'))}</p>
        <div class="news-promo__grid">
          <a class="news-promo__card" href="/masters#calculator">
            <strong>${esc(t('news.promo.calc'))}</strong>
            <span>${esc(t('news.promo.calcDesc'))}</span>
          </a>
          <a class="news-promo__card" href="https://apps.apple.com/ru/app/634/id6795944683" target="_blank" rel="noopener noreferrer">
            <strong>${esc(t('news.promo.app'))}</strong>
            <span>${esc(t('news.promo.appDesc'))}</span>
          </a>
          <a class="news-promo__card" href="/masters#care">
            <strong>${esc(t('news.promo.care'))}</strong>
            <span>${esc(t('news.promo.careDesc'))}</span>
          </a>
        </div>
      </aside>`;
  }

  function insightsBlock(a, isReview) {
    if (!a.insights) return '';
    const title = isReview ? t('news.insights.reviewTitle') : t('news.insights.title');
    const lead = isReview ? t('news.insights.reviewLead') : t('news.insights.lead');
    return `
      <hr class="news-article__rule" />
      <section class="news-insights" aria-label="${esc(title)}">
        <h2 class="news-insights__title">${esc(title)}</h2>
        <p class="news-insights__lead${isReview ? ' news-insights__lead--summary' : ''}">${esc(lead)}</p>
        <div class="news-insights__body">${paras(a.insights)}</div>
      </section>`;
  }

  function stripBuySection(body) {
    return String(body || '').replace(
      /\n##\s*(Где купить|Where to buy|Wo kaufen)[\s\S]*?(?=\n##\s|\n_[^\n]*$|$)/i,
      '\n'
    );
  }

  function reactGroup(a) {
    const r = a.reactions || {};
    return `<div class="news-react" role="group" aria-label="${esc(t('news.reactions'))}" data-article-id="${a.id}">
      <button type="button" class="news-react__btn" data-reaction="rocket" title="${esc(t('news.react.rocket'))}" aria-label="${esc(t('news.react.rocket'))}">${icon('rocket')}<span class="news-react__label">${esc(t('news.react.rocket'))}</span><span class="news-react__count">${r.rocket || 0}</span></button>
      <button type="button" class="news-react__btn" data-reaction="smile" title="${esc(t('news.react.smile'))}" aria-label="${esc(t('news.react.smile'))}">${icon('smile')}<span class="news-react__label">${esc(t('news.react.smile'))}</span><span class="news-react__count">${r.smile || 0}</span></button>
      <button type="button" class="news-react__btn" data-reaction="poop" title="${esc(t('news.react.poop'))}" aria-label="${esc(t('news.react.poop'))}">${icon('poop')}<span class="news-react__label">${esc(t('news.react.poop'))}</span><span class="news-react__count">${r.poop || 0}</span></button>
    </div>`;
  }

  function sourceNote(a) {
    const base = t('news.sourceNote');
    return a.sourceName ? `${esc(base)} («${esc(a.sourceName)}»).` : `${esc(base)}.`;
  }

  function renderMagBlock(b) {
    if (!b || !b.type) return '';
    switch (b.type) {
      case 'hero': {
        if (b.variant === 'phones' && Array.isArray(b.phones) && b.phones.length) {
          return `<div class="news-mag__hero news-mag__hero--phones" aria-hidden="true">
            <div class="news-mag__hero-phones">
              ${b.phones
                .map(
                  (p, i) =>
                    `<img src="${esc(p.src)}" alt="" width="473" height="1024" loading="${i ? 'lazy' : 'eager'}">`
                )
                .join('')}
            </div>
          </div>`;
        }
        if (b.variant === 'birthday') {
          const frames = Array.isArray(b.frames) ? b.frames.filter((f) => f && f.src) : [];
          if (frames.length >= 2) {
            const cards = frames
              .slice(0, 4)
              .map(
                (f, i) =>
                  `<img class="news-mag__hero-tattoo-shot" src="${esc(f.src)}" alt="${esc(f.alt || '')}" width="480" height="640" loading="${i ? 'lazy' : 'eager'}" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">`
              )
              .join('');
            return `<div class="news-mag__hero news-mag__hero--birthday news-mag__hero--birthday-phones" role="img" aria-label="${esc(
              b.kickerOverlay || 'Sitrifor'
            )}">
              <div class="news-mag__hero-tattoo-row">${cards}</div>
              <div class="news-mag__hero-brand">
                <span class="news-mag__hero-brand-mark">${esc(b.brand || 'SITRIFOR')}</span>
                ${b.kickerOverlay ? `<span class="news-mag__hero-brand-kicker">${esc(b.kickerOverlay)}</span>` : ''}
              </div>
            </div>`;
          }
          if (b.image) {
            const wrapTag = b.href ? 'a' : 'div';
            const wrapOpen = b.href
              ? `<a class="news-mag__hero news-mag__hero--birthday news-mag__hero--birthday-cover news-mag__hero--birthday-care" href="${esc(b.href)}">`
              : `<figure class="news-mag__hero news-mag__hero--birthday news-mag__hero--birthday-cover${b.promoCare ? ' news-mag__hero--birthday-care' : ''}">`;
            const wrapClose = b.href ? '</a>' : '</figure>';
            return `${wrapOpen}
              <img src="${esc(b.image)}" alt="${esc(b.kickerOverlay || 'Sitrifor')}" loading="eager" decoding="async" referrerpolicy="no-referrer" onerror="this.closest('.news-mag__hero')?.remove()">
              <div class="news-mag__hero-brand news-mag__hero-brand--oncover">
                <span class="news-mag__hero-brand-mark">${esc(b.brand || 'SITRIFOR')}</span>
                ${b.kickerOverlay ? `<span class="news-mag__hero-brand-kicker">${esc(b.kickerOverlay)}</span>` : ''}
              </div>
            ${wrapClose}`;
          }
          return '';
        }
        if (!b.image) return '';
        const v = b.variant === 'product' ? 'product' : 'editorial';
        return `<figure class="news-mag__hero news-mag__hero--${v}"><img src="${esc(b.image)}" alt="" loading="eager" decoding="async" referrerpolicy="no-referrer" onerror="this.closest('figure')?.remove()"></figure>`;
      }
      case 'kicker':
        return `<div class="news-mag__kicker">${esc(b.text)}</div>`;
      case 'title':
        return `<h1 class="news-mag__title">${esc(b.text)}</h1>`;
      case 'deck':
        return `<p class="news-mag__deck">${esc(b.text)}</p>`;
      case 'byline':
        return `<div class="news-mag__byline">
          <span>${esc(b.source || '')}</span>
          <span>${esc(b.date || '')}</span>
          <span class="news-views" data-news-views title="${esc(t('news.views'))}">${formatViews(b.views)}</span>
          ${b.readingMinutes ? `<span class="news-mag__byline-read">${esc(t('news.minutes', { n: b.readingMinutes }))}</span>` : ''}
        </div>`;
      case 'lead':
        return `<p class="news-mag__lead${b.dropCap ? ' news-mag__lead--drop' : ''}">${b.html || esc(b.text)}</p>`;
      case 'prose':
        return `<p class="news-mag__prose">${b.html || esc(b.text)}</p>`;
      case 'chapter':
        return `<h2 class="news-mag__chapter">${esc(b.text)}</h2>`;
      case 'list': {
        const tag = b.ordered ? 'ol' : 'ul';
        const items = (b.items || [])
          .map((it) => `<li>${it.html || esc(it.text || it)}</li>`)
          .join('');
        return `<${tag} class="news-mag__list">${items}</${tag}>`;
      }
      case 'related': {
        const links = Array.isArray(b.links) ? b.links : [];
        if (!links.length) return '';
        return `<nav class="news-article__related" aria-label="${esc(b.title || 'Ещё на Sitrifor')}">
          <h2 class="news-article__related-title">${esc(b.title || 'Ещё на Sitrifor')}</h2>
          <div class="news-article__related-row">
            ${links
              .map((l) => {
                const href = String(l.href || '#');
                const ext = /^https?:\/\//i.test(href);
                return `<a class="news-article__related-btn" href="${esc(href)}"${
                  ext ? ' target="_blank" rel="noopener noreferrer"' : ''
                }>${esc(l.label || href)}</a>`;
              })
              .join('')}
          </div>
        </nav>`;
      }
      case 'pullquote':
        return `<blockquote class="news-mag__pull">${esc(b.text)}</blockquote>`;
      case 'gallery': {
        const variant =
          b.variant === 'grid' ? 'grid' : b.variant === 'tattoos' ? 'tattoos' : 'phones';
        const figs = (b.images || [])
          .map(
            (img) =>
              `<figure><img src="${esc(img.src)}" alt="${esc(img.alt || '')}" loading="lazy" decoding="async" ${
                variant === 'tattoos' ? 'width="480" height="640"' : 'width="473" height="1024"'
              } referrerpolicy="no-referrer" onerror="this.closest('figure')?.remove()">${
                img.alt ? `<figcaption>${esc(img.alt)}</figcaption>` : ''
              }</figure>`
          )
          .join('');
        return `<div class="news-mag__gallery news-mag__gallery--${variant}" tabindex="0" role="region" aria-label="Галерея">${figs}</div>`;
      }
      case 'figure':
        return `<figure class="news-mag__figure${b.variant === 'bleed' ? ' news-mag__figure--bleed' : ''}">
          <img src="${esc(b.src)}" alt="" loading="lazy" decoding="async">
          ${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}
        </figure>`;
      case 'divider':
        return `<hr class="news-mag__divider">`;
      case 'cta':
        return `<aside class="news-mag__cta${b.variant === 'care' ? ' news-mag__cta--care' : ''}">
          ${
            b.image
              ? `<a class="news-mag__cta-visual" href="${esc(b.href || '/masters#care')}"${
                  String(b.href || '').startsWith('http') ? ' target="_blank" rel="noopener noreferrer"' : ''
                }><img src="${esc(b.image)}" alt="" loading="lazy" decoding="async"></a>`
              : ''
          }
          <div class="news-mag__cta-copy">
            <h2>${esc(b.title || '')}</h2>
            ${b.text ? `<p>${esc(b.text)}</p>` : ''}
            <a class="btn btn--brand" href="${esc(b.href || '#')}"${
              String(b.href || '').startsWith('http') ? ' target="_blank" rel="noopener noreferrer"' : ''
            }>${esc(b.label || t('news.cta.open'))}</a>
          </div>
        </aside>`;
      case 'buy': {
        const links = Array.isArray(b.links) ? b.links : [];
        if (!links.length) return '';
        return `<section class="news-buy news-mag__buy" aria-label="${esc(b.title || t('news.buy.title'))}">
          <h2 class="news-buy__title">${esc(b.title || t('news.buy.title'))}</h2>
          <div class="news-buy__row">
            ${links
              .map(
                (l) =>
                  `<a class="news-buy__btn${l.primary ? ' news-buy__btn--primary' : ''}" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a>`
              )
              .join('')}
          </div>
        </section>`;
      }
      case 'productCard': {
        const links = Array.isArray(b.links) ? b.links : [];
        const prices = Array.isArray(b.prices) ? b.prices : [];
        const imgs = Array.isArray(b.images) && b.images.length
          ? b.images
          : b.image
            ? [{ src: b.image, alt: b.name || '' }]
            : [];
        const media = imgs.length
          ? `<div class="news-product-card__media">${imgs
              .slice(0, 4)
              .map(
                (img, i) =>
                  `<figure class="news-product-card__shot"><img src="${esc(img.src)}" alt="${esc(
                    img.alt || b.name || ''
                  )}" loading="${i ? 'lazy' : 'eager'}" decoding="async" referrerpolicy="no-referrer" onerror="this.closest('figure')?.remove()"></figure>`
              )
              .join('')}</div>`
          : '';
        const priceRows = prices.length
          ? `<ul class="news-product-card__prices">${prices
              .map(
                (p) =>
                  `<li><span>${esc(p.label)}</span><strong>${esc(p.price)}</strong></li>`
              )
              .join('')}</ul>`
          : '';
        const buy =
          links.length
            ? `<div class="news-product-card__buy">
                <h3 class="news-buy__title">${esc(b.buyTitle || t('news.buy.title'))}</h3>
                <div class="news-buy__row">
                  ${links
                    .map(
                      (l) =>
                        `<a class="news-buy__btn${l.primary ? ' news-buy__btn--primary' : ''}" href="${esc(
                          l.url
                        )}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a>`
                    )
                    .join('')}
                </div>
              </div>`
            : '';
        const nameHtml = b.href
          ? `<a class="news-product-card__name" href="${esc(b.href)}" target="_blank" rel="noopener noreferrer">${esc(
              b.name || ''
            )}</a>`
          : `<h2 class="news-product-card__name">${esc(b.name || '')}</h2>`;
        return `<section class="news-product-card" aria-label="${esc(b.name || t('news.badge.review'))}">
          ${media}
          <div class="news-product-card__copy">
            ${nameHtml}
            ${b.description ? `<p class="news-product-card__desc">${esc(b.description)}</p>` : ''}
            ${priceRows}
            ${buy}
          </div>
        </section>`;
      }
      default:
        return '';
    }
  }

  function renderMagazine(a, layout) {
    const date = (a.publishedAt || '').slice(0, 10);
    const theme = layout.theme || 'editorial';
    const blocks = Array.isArray(layout.blocks) ? layout.blocks : [];
    // inject reading time into byline block
    const enriched = blocks.map((b) =>
      b.type === 'byline' ? { ...b, readingMinutes: layout.readingMinutes || b.readingMinutes } : b
    );
    return `
      <a class="news-mag__back" href="/news?date=${esc(date)}">${esc(t('news.backToFeed'))}</a>
      <article class="news-mag news-mag--${esc(theme)}">
        ${enriched.map(renderMagBlock).join('\n')}
        ${insightsBlock(a, theme === 'review')}
        ${reactGroup(a)}
        ${promoBlock()}
        <p class="news-mag__footer-note">${sourceNote(a)}</p>
      </article>`;
  }

  async function load() {
    const root = document.querySelector('[data-news-article]');
    const slug = slugFromPath();
    if (!slug) {
      root.innerHTML = `<div class="news-empty">${esc(t('news.notFound'))}</div>`;
      return;
    }

    const lang = currentLang();
    let a = null;
    const ssr = window.__NEWS_SSR__;
    const ssrOk =
      ssr &&
      ssr.slug === slug &&
      (lang === 'ru' || lang === (ssr.displayLang || 'ru'));

    if (ssrOk) {
      a = ssr;
    } else {
      const res = await fetch(
        '/api/news/item/' + encodeURIComponent(slug) + '?lang=' + encodeURIComponent(lang)
      );
      if (!res.ok) {
        root.innerHTML = `<div class="news-empty">${esc(t('news.notFound'))}</div>`;
        return;
      }
      a = await res.json();
    }

    const r = a.reactions || {};
    a.reactions = r;
    const isReview = a.articleType === 'review' || a.sourceKey === 'tattoomarket-reviews';
    const isEditor = a.articleType === 'editor_sarcasm' || a.sourceKey === 'sitrifor-editor';
    const isSocial = a.articleType === 'social_playbook';
    const bodyRaw = a.body || a.summary || '';
    const body = isReview ? stripReviewShopSections(stripBuySection(bodyRaw)) : bodyRaw;
    const date = (a.publishedAt || '').slice(0, 10);
    const typeBadge = isReview
      ? t('news.badge.review')
      : isEditor
        ? t('news.badge.editor')
        : isSocial
          ? t('news.badge.social')
          : a.articleType && a.articleType !== 'editorial'
            ? String(a.articleType).replace(/_/g, ' ')
            : '';

    const seoTitle = (a.seo && a.seo.title) || a.title || t('news.fallbackTitle');
    const seoDesc = ((a.seo && a.seo.description) || a.summary || a.title || '').slice(0, 160);
    document.title = seoTitle + ' | Sitrifor';
    const desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute('content', seoDesc);
    const canon = document.querySelector('link[rel="canonical"]');
    if (canon) canon.setAttribute('href', 'https://sitrifor.ru/news/a/' + a.slug);
    const robots = document.querySelector('meta[name="robots"]');
    if (robots && a.seo && a.seo.robots) robots.setAttribute('content', a.seo.robots);

    root.className = 'container news-article';
    root.classList.toggle('news-article--review', isReview);
    root.classList.toggle('news-article--editor', isEditor);
    root.classList.toggle('news-article--social', isSocial);

    if (a.layout && Array.isArray(a.layout.blocks) && a.layout.blocks.length) {
      root.classList.add('news-article--magazine');
      root.innerHTML = renderMagazine(a, a.layout);
    } else {
      const buyLinks = isReview ? extractBuyLinks(a) : [];
      const productTop = isReview ? productCardBlock(a, buyLinks) : '';
      const imgAlt = (a.seo && a.seo.imageAlt) || a.title || '';
      root.innerHTML = `
      <a class="news-article__back" href="/news?date=${esc(date)}">${esc(t('news.backToFeed'))}</a>
      ${typeBadge ? `<div class="news-article__badge">${esc(typeBadge)}</div>` : ''}
      <div class="news-article__meta">
        <span>${esc(a.sourceName || '')}</span>
        <span>${esc(date)}</span>
        <span class="news-views" data-news-views title="${esc(t('news.views'))}">${formatViews(a.views)}</span>
      </div>
      <h1 class="news-article__title">${esc(a.title)}</h1>
      ${productTop}
      ${
        !isReview && a.imageUrl
          ? `<figure class="news-article__figure"><img src="${esc(a.imageUrl)}" alt="${esc(imgAlt)}" loading="eager" decoding="async" referrerpolicy="no-referrer" onerror="this.closest('figure')?.remove()"></figure>`
          : ''
      }
      <div class="news-article__body">${paras(body)}</div>
      ${insightsBlock(a, isReview)}
      ${reactGroup(a)}
      ${promoBlock()}
      <p class="news-article__source">${sourceNote(a)}</p>
    `;
    }

    root.querySelectorAll('.news-react__btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const reaction = btn.dataset.reaction;
        const out = await fetch('/api/news/react', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ articleId: a.id, reaction, vid: vid() })
        });
        const data = await out.json();
        if (data.article) {
          const rr = data.article.reactions || {};
          root.querySelectorAll('.news-react__btn').forEach((b) => {
            const key = b.dataset.reaction;
            const countEl = b.querySelector('.news-react__count') || b.querySelector('span:last-child');
            if (countEl) countEl.textContent = rr[key] || 0;
            b.classList.toggle('is-on', data.toggled === 'on' && key === reaction);
          });
        }
      });
    });

    try {
      const viewRes = await fetch('/api/news/view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleId: a.id })
      });
      if (viewRes.ok) {
        const vd = await viewRes.json();
        const el = root.querySelector('[data-news-views]');
        if (el && typeof vd.views === 'number') el.textContent = formatViews(vd.views);
      }
    } catch (e) {}
  }

  function bindLang() {
    if (langBound) return;
    langBound = true;
    document.addEventListener('sitrifor:langchange', () => setTimeout(load, 40));
  }

  function boot() {
    bindLang();
    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
