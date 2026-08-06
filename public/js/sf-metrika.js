/**
 * Yandex.Metrika helpers for sitrifor.ru
 * Counter: 111332527 (loaded by yandex-metrika.js)
 */
(function (global) {
  'use strict';
  if (global.sfMetrika) return;

  var COUNTER_ID = 111332527;
  var onceKeys = Object.create(null);

  function ymReady(fn) {
    if (typeof global.ym === 'function') {
      fn();
      return;
    }
    var n = 0;
    var t = setInterval(function () {
      n += 1;
      if (typeof global.ym === 'function') {
        clearInterval(t);
        fn();
      } else if (n > 40) {
        clearInterval(t);
      }
    }, 250);
  }

  function goal(name, params) {
    if (!name) return;
    ymReady(function () {
      try {
        if (params) global.ym(COUNTER_ID, 'reachGoal', name, params);
        else global.ym(COUNTER_ID, 'reachGoal', name);
      } catch (e) {}
    });
  }

  function goalOnce(name, params) {
    if (!name || onceKeys[name]) return;
    onceKeys[name] = 1;
    goal(name, params);
  }

  function isApp634StoreUrl(href) {
    if (!href) return false;
    try {
      var u = new URL(href, location.origin);
      if (u.hostname.indexOf('apps.apple.com') === -1) return false;
      return /\/app\/634\b/i.test(u.pathname) || /id6795944683/.test(u.pathname + u.search);
    } catch (e) {
      return /apps\.apple\.com/i.test(href) && (/634/.test(href) || /id6795944683/.test(href));
    }
  }

  document.addEventListener(
    'click',
    function (e) {
      var t = e.target;
      if (!t || !t.closest) return;

      var marked = t.closest('[data-ym-goal]');
      if (marked) {
        var g = marked.getAttribute('data-ym-goal');
        if (g) goal(g);
      }

      var a = t.closest('a[href]');
      if (a && isApp634StoreUrl(a.getAttribute('href'))) {
        goal('app634_store_click', { href: a.href, page: location.pathname });
      }
    },
    true
  );

  global.sfMetrika = {
    id: COUNTER_ID,
    goal: goal,
    goalOnce: goalOnce
  };
})(window);
