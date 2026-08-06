/**
 * Sitrifor News — week calendar + tagged feed (stable navigation)
 */
(function () {
  'use strict';

  const state = {
    selected: null,
    weekStart: null,
    tag: null,
    categories: [],
    calendarDays: {},
    loadedDays: new Set(),
    lang: 'ru',
    ioPaused: false
  };

  const els = {};
  let observer = null;
  let pauseTimer = null;

  function t(key, vars) {
    if (window.SitriforI18n && typeof window.SitriforI18n.t === 'function') {
      return window.SitriforI18n.t(key, vars);
    }
    return key;
  }

  function localeTag() {
    const lang = state.lang || currentLang();
    if (lang === 'en') return 'en-US';
    if (lang === 'de') return 'de-DE';
    return 'ru-RU';
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function ymd(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function today() {
    return ymd(new Date());
  }

  function parseDay(s) {
    const [y, m, d] = String(s).split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(day, n) {
    const d = parseDay(day);
    d.setDate(d.getDate() + n);
    return ymd(d);
  }

  function weekStartOf(day) {
    const d = parseDay(day);
    const wd = d.getDay();
    const shift = wd === 0 ? -6 : 1 - wd;
    d.setDate(d.getDate() + shift);
    return ymd(d);
  }

  function pauseIo(ms) {
    state.ioPaused = true;
    if (pauseTimer) clearTimeout(pauseTimer);
    pauseTimer = setTimeout(() => {
      state.ioPaused = false;
    }, ms || 700);
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

  function formatDayTitle(day) {
    const d = parseDay(day);
    const tDay = today();
    if (day === tDay) return t('news.today');
    if (day === addDays(tDay, -1)) return t('news.yesterday');
    return d.toLocaleDateString(localeTag(), { day: 'numeric', month: 'long', year: 'numeric' });
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

  async function api(path) {
    const res = await fetch(path, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(path + ' ' + res.status);
    return res.json();
  }

  function icon(type) {
    if (type === 'rocket') return '<span class="news-react__emoji" aria-hidden="true">🚀</span>';
    if (type === 'smile') return '<span class="news-react__emoji" aria-hidden="true">👍</span>';
    return '<span class="news-react__emoji" aria-hidden="true">💩</span>';
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

  function renderTags() {
    if (!els.tags) return;
    // Hide categories without published news; drop stale URL tag
    if (state.tag && !state.categories.some((c) => c.id === state.tag)) {
      state.tag = null;
    }
    els.tags.innerHTML = '';
    const all = document.createElement('button');
    all.type = 'button';
    all.className = 'news-tag' + (!state.tag ? ' is-active' : '');
    all.textContent = t('news.tagAll');
    all.addEventListener('click', () => {
      state.tag = null;
      renderTags();
      reloadFeed();
    });
    els.tags.appendChild(all);

    state.categories.forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'news-tag' + (state.tag === c.id ? ' is-active' : '');
      b.textContent = c.label;
      b.title = c.description || '';
      b.addEventListener('click', () => {
        state.tag = state.tag === c.id ? null : c.id;
        renderTags();
        reloadFeed();
      });
      els.tags.appendChild(b);
    });
  }

  function updateWeekSelectionClasses() {
    if (!els.week) return;
    els.week.querySelectorAll('[data-day]').forEach((btn) => {
      const day = btn.getAttribute('data-day');
      btn.classList.toggle('is-selected', day === state.selected);
      btn.classList.toggle('is-today', day === today());
      const has = Boolean(state.calendarDays[day]);
      btn.classList.toggle('has-news', has);
    });
  }

  function renderWeek() {
    if (!els.week) return;
    const start = state.weekStart || weekStartOf(state.selected || today());
    state.weekStart = start;
    const weekHtml = [];
    for (let i = 0; i < 7; i++) {
      const day = addDays(start, i);
      const d = parseDay(day);
      const has = Boolean(state.calendarDays[day]);
      const showMonth = d.getDate() === 1 || i === 0;
      const cls = [
        'news-week__day',
        has ? 'has-news' : '',
        day === state.selected ? 'is-selected' : '',
        day === today() ? 'is-today' : ''
      ]
        .filter(Boolean)
        .join(' ');
      const monthHint = showMonth
        ? `<em class="news-week__month">${esc(t('news.month.' + d.getMonth()))}</em>`
        : '';
      weekHtml.push(
        `<button type="button" class="${cls}" data-day="${day}" aria-pressed="${day === state.selected ? 'true' : 'false'}">` +
          `<strong>${d.getDate()}</strong>` +
          `<span>${esc(t('news.dow.' + i))}</span>${monthHint}</button>`
      );
    }
    els.week.innerHTML = weekHtml.join('');
    els.week.querySelectorAll('[data-day]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const day = btn.getAttribute('data-day');
        selectDay(day, { scroll: true, fromUser: true });
      });
    });
  }

  function groupHtml(byCategory, articles) {
    // When a tag is active — flat list under that tag (not primary-category buckets)
    if (state.tag) {
      const label = (state.categories.find((c) => c.id === state.tag) || {}).label || state.tag;
      const items = articles || byCategory[state.tag] || [];
      if (!items.length) {
        return `<div class="news-empty">${esc(t('news.emptyTag'))}</div>`;
      }
      let html = `<section class="news-cat" data-cat="${state.tag}"><h3 class="news-cat__title">${esc(label)}</h3>`;
      items.forEach((a) => {
        html += articleCard(a);
      });
      html += '</section>';
      return html;
    }

    const order = state.categories.map((c) => c.id);
    let html = '';
    order.forEach((id) => {
      const items = byCategory[id] || [];
      if (!items.length) return;
      const label = (state.categories.find((c) => c.id === id) || {}).label || id;
      html += `<section class="news-cat" data-cat="${id}"><h3 class="news-cat__title">${esc(label)}</h3>`;
      items.forEach((a) => {
        html += articleCard(a);
      });
      html += '</section>';
    });
    return html || `<div class="news-empty">${esc(t('news.emptyTag'))}</div>`;
  }

  function articleCard(a) {
    const r = a.reactions || {};
    const href = a.path || `/news/a/${a.slug}`;
    const rawExcerpt = a.summary || (a.body || '').slice(0, 280);
    const excerpt = String(rawExcerpt)
      .replace(/^#+\s+/gm, '')
      .replace(/\*\*/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 220);
    const cats = (a.categories || []).slice(0, 2);
    const catHtml = cats
      .map((id) => {
        const label = (state.categories.find((c) => c.id === id) || {}).label || id;
        return `<span class="news-card__chip">${esc(label)}</span>`;
      })
      .join('');
    const img = a.imageUrl
      ? `<div class="news-card__media"><img src="${esc(a.imageUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.parentElement.classList.add('is-broken')"></div>`
      : '<div class="news-card__media news-card__media--empty" aria-hidden="true"></div>';
    return `
      <article class="news-card" data-id="${a.id}" data-href="${esc(href)}" role="link" tabindex="0">
        ${img}
        <div class="news-card__content">
        <div class="news-card__meta">
          <span>${esc(a.sourceName || '')}</span>
          <span>${esc((a.publishedAt || '').slice(11, 16) || '')}</span>
          <span class="news-views" title="${esc(t('news.views'))}">${formatViews(a.views)}</span>
          ${catHtml}
        </div>
        <h4 class="news-card__title">${esc(a.title)}</h4>
        ${excerpt ? `<p class="news-card__summary">${esc(excerpt)}</p>` : ''}
        <div class="news-react" role="group" aria-label="${esc(t('news.reactions'))}">
          ${reactBtn('rocket', t('news.react.rocket'), r.rocket || 0)}
          ${reactBtn('smile', t('news.react.smile'), r.smile || 0)}
          ${reactBtn('poop', t('news.react.poop'), r.poop || 0)}
        </div>
        </div>
      </article>`;
  }

  function reactBtn(type, label, count) {
    return `<button type="button" class="news-react__btn" data-reaction="${type}" title="${esc(label)}" aria-label="${esc(label)}">${icon(type)}<span class="news-react__label">${esc(label)}</span><span class="news-react__count">${count}</span></button>`;
  }

  async function loadDay(day, { prepend = false } = {}) {
    if (state.loadedDays.has(day) && document.querySelector(`[data-day-block="${day}"]`)) return;
    const q = new URLSearchParams({ date: day, lang: state.lang });
    if (state.tag) q.set('tag', state.tag);
    const data = await api('/api/news/day?' + q.toString());
    state.loadedDays.add(day);

    const block = document.createElement('section');
    block.className = 'news-day-block';
    block.dataset.dayBlock = day;
    const list = data.articles || [];
    block.innerHTML = `
      <div class="news-day-block__head">
        <h2 class="news-day-block__title">${esc(formatDayTitle(day))}</h2>
        <div class="news-day-block__count">${esc(t('news.materials', { n: data.total }))}</div>
      </div>
      ${
        data.total
          ? groupHtml(data.byCategory || {}, list)
          : `<div class="news-empty">${esc(t('news.emptyDay'))}</div>`
      }
    `;
    bindCards(block);
    bindReactions(block);

    if (prepend && els.feed.firstChild) {
      els.feed.insertBefore(block, els.feed.firstChild);
    } else {
      els.feed.appendChild(block);
    }
    observeDay(block);
  }

  function bindCards(root) {
    root.querySelectorAll('.news-card').forEach((card) => {
      const go = () => {
        const href = card.getAttribute('data-href');
        if (href) location.href = href;
      };
      card.addEventListener('click', (e) => {
        if (e.target.closest('.news-react__btn')) return;
        go();
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          go();
        }
      });
    });
  }

  function bindReactions(root) {
    root.querySelectorAll('.news-react__btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const card = btn.closest('.news-card');
        const id = Number(card?.dataset.id);
        const reaction = btn.dataset.reaction;
        try {
          const res = await fetch('/api/news/react', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ articleId: id, reaction, vid: vid() })
          });
          const data = await res.json();
          if (data.article) {
            const r = data.article.reactions || {};
            card.querySelectorAll('.news-react__btn').forEach((b) => {
              const key = b.dataset.reaction;
              const countEl = b.querySelector('.news-react__count') || b.querySelector('span:last-child');
              if (countEl) countEl.textContent = r[key] || 0;
              b.classList.toggle('is-on', data.toggled === 'on' && key === reaction);
            });
          }
        } catch (err) {}
      });
    });
  }

  function observeDay(block) {
    if (!observer) {
      observer = new IntersectionObserver(
        (entries) => {
          if (state.ioPaused) return;
          const visible = entries
            .filter((e) => e.isIntersecting)
            .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
          if (!visible.length) return;
          const day = visible[0].target.getAttribute('data-day-block');
          if (!day || day === state.selected) return;
          state.selected = day;
          // Keep week strip on the week that contains selected day
          const ws = weekStartOf(day);
          if (ws !== state.weekStart) {
            state.weekStart = ws;
            refreshWeekCounts().then(renderWeek);
          } else {
            updateWeekSelectionClasses();
          }
          history.replaceState(null, '', `/news?date=${day}${state.tag ? '&tag=' + state.tag : ''}`);
        },
        { rootMargin: '-35% 0px -50% 0px', threshold: 0.01 }
      );
    }
    observer.observe(block);
  }

  async function selectDay(day, { scroll = false, fromUser = false } = {}) {
    pauseIo(fromUser || scroll ? 900 : 400);
    state.selected = day;
    // Align week strip to contain selected day (unless only scrolling within same week)
    const ws = weekStartOf(day);
    if (ws !== state.weekStart) {
      state.weekStart = ws;
    }
    await refreshWeekCounts();
    renderWeek();

    if (scroll) {
      els.feed.innerHTML = '';
      state.loadedDays.clear();
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      await loadDay(day);
      for (let i = 1; i <= 2; i++) await loadDay(addDays(day, -i));
      const block = document.querySelector(`[data-day-block="${day}"]`);
      if (block) {
        block.scrollIntoView({ behavior: 'auto', block: 'start' });
      }
    } else if (!state.loadedDays.has(day)) {
      await loadDay(day);
    }

    history.replaceState(null, '', `/news?date=${day}${state.tag ? '&tag=' + state.tag : ''}`);
  }

  async function shiftWeek(deltaWeeks) {
    pauseIo(900);
    const nextStart = addDays(state.weekStart || weekStartOf(state.selected || today()), deltaWeeks * 7);
    state.weekStart = nextStart;
    // Prefer keeping selected if it lands in the new week; else Monday of that week
    let anchor = state.selected;
    const end = addDays(nextStart, 6);
    if (!(anchor >= nextStart && anchor <= end)) {
      const tDay = today();
      anchor = tDay >= nextStart && tDay <= end ? tDay : nextStart;
    }
    state.selected = anchor;
    await refreshWeekCounts();
    renderWeek();

    els.feed.innerHTML = '';
    state.loadedDays.clear();
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    await loadDay(anchor);
    for (let i = 1; i <= 2; i++) await loadDay(addDays(anchor, -i));
    history.replaceState(null, '', `/news?date=${anchor}${state.tag ? '&tag=' + state.tag : ''}`);
  }

  async function goToday() {
    const tDay = today();
    state.weekStart = weekStartOf(tDay);
    await selectDay(tDay, { scroll: true, fromUser: true });
  }

  async function reloadFeed() {
    pauseIo(700);
    els.feed.innerHTML = '';
    state.loadedDays.clear();
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    await loadDay(state.selected);
    // If tag filter yields empty day, jump to nearest day that has matching posts
    if (state.tag) {
      const block = document.querySelector(`[data-day-block="${state.selected}"]`);
      const empty = block && block.querySelector('.news-empty');
      if (empty) {
        try {
          const days = await api(
            '/api/news/days?limit=21' + (state.tag ? '&tag=' + encodeURIComponent(state.tag) : '')
          );
          for (const d of days.days || []) {
            const q = new URLSearchParams({ date: d.day, lang: state.lang, tag: state.tag });
            const data = await api('/api/news/day?' + q.toString());
            if (data.total > 0) {
              state.selected = d.day;
              state.weekStart = weekStartOf(d.day);
              await refreshWeekCounts();
              renderWeek();
              els.feed.innerHTML = '';
              state.loadedDays.clear();
              await loadDay(d.day);
              break;
            }
          }
        } catch (e) {}
      }
    }
    for (let i = 1; i <= 3; i++) await loadDay(addDays(state.selected, -i));
  }

  async function refreshWeekCounts() {
    const start = state.weekStart || weekStartOf(state.selected || today());
    const end = addDays(start, 6);
    const months = new Set([start.slice(0, 7), end.slice(0, 7)]);
    for (const month of months) {
      const data = await api(
      '/api/news/calendar?month=' +
        encodeURIComponent(month) +
        (state.tag ? '&tag=' + encodeURIComponent(state.tag) : '')
    );
      Object.assign(state.calendarDays, data.days || {});
    }
  }

  async function loadOlder() {
    const blocks = [...els.feed.querySelectorAll('[data-day-block]')];
    if (!blocks.length) return;
    const oldest = blocks[blocks.length - 1].getAttribute('data-day-block');
    await loadDay(addDays(oldest, -1));
  }

  let loadingOlder = false;
  function onScroll() {
    const y = window.scrollY || 0;
    const docH = document.documentElement.scrollHeight;
    if (!loadingOlder && y + window.innerHeight > docH - 600) {
      loadingOlder = true;
      loadOlder().finally(() => {
        loadingOlder = false;
      });
    }
  }

  async function init() {
    els.week = document.querySelector('[data-news-week]');
    els.tags = document.querySelector('[data-news-tags]');
    els.feed = document.querySelector('[data-news-feed]');
    els.prev = document.querySelector('[data-news-prev]');
    els.next = document.querySelector('[data-news-next]');
    els.more = document.querySelector('[data-news-more]');
    els.today = document.querySelector('[data-news-today]');

    state.lang = currentLang();

    const params = new URLSearchParams(location.search);
    state.selected = params.get('date') || today();
    state.weekStart = weekStartOf(state.selected);
    if (params.get('tag')) state.tag = params.get('tag');

    document.addEventListener('sitrifor:langchange', async (ev) => {
      const next = (ev && ev.detail && ev.detail.lang) || currentLang();
      if (!next || next === state.lang) return;
      state.lang = next;
      try {
        const m = await api('/api/news/meta?lang=' + encodeURIComponent(state.lang));
        state.categories = m.categories || [];
        renderTags();
        renderWeek();
        await reloadFeed();
      } catch (e) {}
    });

    const meta = await api('/api/news/meta?lang=' + encodeURIComponent(state.lang));
    state.categories = meta.categories || [];
    renderTags();

    els.prev.addEventListener('click', () => shiftWeek(-1));
    els.next.addEventListener('click', () => shiftWeek(1));
    if (els.today) els.today.addEventListener('click', goToday);
    els.more.addEventListener('click', loadOlder);
    window.addEventListener('scroll', onScroll, { passive: true });

    await refreshWeekCounts();
    renderWeek();
    await reloadFeed();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
