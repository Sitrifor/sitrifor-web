/**
 * Sitrifor i18n — language switcher + DOM apply.
 * Depends on window.SitriforI18nDict from i18n-dict.js
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'sitrifor_lang';
  var SUPPORTED = ['ru', 'en', 'de'];
  var dict = window.SitriforI18nDict || { ru: {}, en: {}, de: {} };

  function detectLang() {
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (SUPPORTED.indexOf(stored) !== -1) return stored;
    } catch (e) { /* ignore */ }
    var nav = (navigator.language || 'ru').toLowerCase();
    if (nav.indexOf('de') === 0) return 'de';
    if (nav.indexOf('en') === 0) return 'en';
    return 'ru';
  }

  var lang = detectLang();

  function t(key, vars) {
    var pack = dict[lang] || dict.ru || {};
    var fallback = dict.ru || {};
    var str = pack[key];
    if (str == null || str === '') str = fallback[key];
    if (str == null) str = key;
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        str = String(str).split('{' + k + '}').join(String(vars[k]));
      });
    }
    return str;
  }

  function rememberDefault(el, attr) {
    var storeKey = 'data-i18n-default-' + (attr || 'text');
    if (!el.hasAttribute(storeKey)) {
      if (attr === 'html') el.setAttribute(storeKey, el.innerHTML);
      else if (attr && attr !== 'text') el.setAttribute(storeKey, el.getAttribute(attr) || '');
      else el.setAttribute(storeKey, el.textContent);
    }
    return el.getAttribute(storeKey);
  }

  function applyElement(el) {
    var key = el.getAttribute('data-i18n');
    if (!key) return;

    if (el.hasAttribute('data-i18n-html')) {
      rememberDefault(el, 'html');
      if (lang === 'ru') {
        el.innerHTML = el.getAttribute('data-i18n-default-html');
      } else {
        el.innerHTML = t(key);
      }
      return;
    }

    rememberDefault(el, 'text');
    if (lang === 'ru') {
      el.textContent = el.getAttribute('data-i18n-default-text');
    } else {
      el.textContent = t(key);
    }

    // Optional attribute translations: data-i18n-aria-label="key" etc.
  }

  function applyAttr(el, dataAttr, targetAttr) {
    var key = el.getAttribute(dataAttr);
    if (!key) return;
    var storeKey = 'data-i18n-default-' + targetAttr;
    if (!el.hasAttribute(storeKey)) {
      el.setAttribute(storeKey, el.getAttribute(targetAttr) || '');
    }
    if (lang === 'ru') {
      el.setAttribute(targetAttr, el.getAttribute(storeKey));
    } else {
      el.setAttribute(targetAttr, t(key));
    }
  }

  function syncTitleArts() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-care-title-art]'), function (img) {
      var attr = 'data-src-' + lang;
      var src = img.getAttribute(attr) || img.getAttribute('data-src-ru');
      if (src && img.getAttribute('src') !== src) img.setAttribute('src', src);
    });
  }

  function syncPartnerLetters() {
    var letters = {
      ru: ['а', 'б', 'в', 'г', 'д', 'е', 'ж', 'з', 'и', 'к'],
      en: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
      de: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']
    };
    var pack = letters[lang] || letters.ru;
    Array.prototype.forEach.call(document.querySelectorAll('[data-partner-letter]'), function (el) {
      var li = el.parentElement;
      var list = li && li.parentElement;
      if (!list) return;
      var i = Array.prototype.indexOf.call(list.children, li);
      if (i < 0 || i >= pack.length) return;
      el.textContent = pack[i] + ')';
    });
  }

  function syncMailtoSubjects() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-mailto][data-i18n-mailto-subject]'), function (el) {
      var email = el.getAttribute('data-mailto') || 'php.grishan@yandex.ru';
      var key = el.getAttribute('data-i18n-mailto-subject');
      var subject = t(key);
      el.setAttribute('href', 'mailto:' + email + '?subject=' + encodeURIComponent(subject));
    });
  }

  function applyAll(root) {
    root = root || document;
    Array.prototype.forEach.call(root.querySelectorAll('[data-i18n]'), applyElement);
    Array.prototype.forEach.call(root.querySelectorAll('[data-i18n-placeholder]'), function (el) {
      applyAttr(el, 'data-i18n-placeholder', 'placeholder');
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-i18n-aria-label]'), function (el) {
      applyAttr(el, 'data-i18n-aria-label', 'aria-label');
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-i18n-alt]'), function (el) {
      applyAttr(el, 'data-i18n-alt', 'alt');
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-i18n-title]'), function (el) {
      applyAttr(el, 'data-i18n-title', 'title');
    });
    document.documentElement.lang = lang === 'ru' ? 'ru' : lang;
    syncTitleArts();
    syncPartnerLetters();
    syncMailtoSubjects();
  }

  function setLang(next) {
    if (SUPPORTED.indexOf(next) === -1) return;
    lang = next;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) { /* ignore */ }
    applyAll(document);
    syncSwitcher();
    document.dispatchEvent(new CustomEvent('sitrifor:langchange', { detail: { lang: lang } }));
  }

  function syncSwitcher() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-lang-switch]'), function (btn) {
      var on = btn.getAttribute('data-lang-switch') === lang;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function buildSwitcher() {
    var wrap = document.createElement('div');
    wrap.className = 'lang-switch';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', t('lang.switcher'));

    [
      { code: 'ru', label: 'RU' },
      { code: 'en', label: 'EN' },
      { code: 'de', label: 'DE' }
    ].forEach(function (item) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lang-switch__btn' + (item.code === lang ? ' is-active' : '');
      btn.setAttribute('data-lang-switch', item.code);
      btn.setAttribute('aria-pressed', item.code === lang ? 'true' : 'false');
      btn.setAttribute('data-i18n-aria-label', 'lang.' + item.code);
      btn.setAttribute('aria-label', t('lang.' + item.code));
      btn.textContent = item.label;
      btn.addEventListener('click', function () { setLang(item.code); });
      wrap.appendChild(btn);
    });
    return wrap;
  }

  function injectSwitcher() {
    var header = document.querySelector('.header__inner');
    if (!header) return;

    var existing = header.querySelector('.lang-switch');
    if (existing) {
      // Wire static markup buttons
      Array.prototype.forEach.call(existing.querySelectorAll('[data-lang-switch]'), function (btn) {
        if (btn.getAttribute('data-bound') === '1') return;
        btn.setAttribute('data-bound', '1');
        btn.addEventListener('click', function () {
          setLang(btn.getAttribute('data-lang-switch'));
        });
      });
      return;
    }

    var switcher = buildSwitcher();
    var actions = header.querySelector('.header__actions');
    var toggle = header.querySelector('.menu-toggle');
    if (actions && toggle) actions.insertBefore(switcher, toggle);
    else if (actions) actions.appendChild(switcher);
    else if (toggle) header.insertBefore(switcher, toggle);
    else header.appendChild(switcher);
  }

  function boot() {
    injectSwitcher();
    applyAll(document);
    syncSwitcher();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.SitriforI18n = {
    t: t,
    getLang: function () { return lang; },
    setLang: setLang,
    apply: applyAll,
    supported: SUPPORTED.slice()
  };
})();
