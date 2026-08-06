/**
 * Marketplace favorites (localStorage).
 * Shared by catalog listing and product pages.
 */
(function (global) {
  'use strict';

  var KEY = 'sitrifor.mp.favorites';
  var MAX = 200;

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map(function (s) {
          return String(s || '').trim();
        })
        .filter(Boolean)
        .slice(0, MAX);
    } catch (e) {
      return [];
    }
  }

  function write(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
    } catch (e) {
      /* quota / private mode */
    }
  }

  function list() {
    return read();
  }

  function has(slug) {
    if (!slug) return false;
    return read().indexOf(String(slug)) !== -1;
  }

  function toggle(slug) {
    if (!slug) return false;
    var s = String(slug);
    var cur = read();
    var idx = cur.indexOf(s);
    var on;
    if (idx === -1) {
      cur.unshift(s);
      on = true;
    } else {
      cur.splice(idx, 1);
      on = false;
    }
    write(cur);
    try {
      global.dispatchEvent(
        new CustomEvent('mp:favorites', { detail: { slug: s, on: on, list: cur.slice() } })
      );
    } catch (e) {
      /* IE ignore */
    }
    return on;
  }

  function count() {
    return read().length;
  }

  function heartButtonHtml(slug, active) {
    var on = !!active;
    return (
      '<button type="button" class="mp-fav' +
      (on ? ' is-active' : '') +
      '" data-mp-fav="' +
      String(slug).replace(/"/g, '&quot;') +
      '" aria-pressed="' +
      (on ? 'true' : 'false') +
      '" aria-label="' +
      (on ? 'Убрать из избранного' : 'В избранное') +
      '">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">' +
      '<path fill="currentColor" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>' +
      '</svg></button>'
    );
  }

  function bindClicks(root) {
    (root || document).addEventListener('click', function (e) {
      var btn = e.target.closest('[data-mp-fav]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      var slug = btn.getAttribute('data-mp-fav');
      var on = toggle(slug);
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.setAttribute('aria-label', on ? 'Убрать из избранного' : 'В избранное');
    });
  }

  function syncButtons(root) {
    var scope = root || document;
    var nodes = scope.querySelectorAll('[data-mp-fav]');
    for (var i = 0; i < nodes.length; i++) {
      var btn = nodes[i];
      var on = has(btn.getAttribute('data-mp-fav'));
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  global.SitriforMpFavs = {
    KEY: KEY,
    list: list,
    has: has,
    toggle: toggle,
    count: count,
    heartButtonHtml: heartButtonHtml,
    bindClicks: bindClicks,
    syncButtons: syncButtons
  };
})(typeof window !== 'undefined' ? window : globalThis);
