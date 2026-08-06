/**
 * Sitrifor first-party analytics tracker.
 * Counts visits (non-unique users): each new session = +1 visit.
 * Privacy: anonymous IDs only; no cookies for third parties; IP hashed server-side.
 */
(function () {
  'use strict';
  if (window.__SF_ANALYTICS__) return;
  window.__SF_ANALYTICS__ = true;

  var ENDPOINT = '/api/analytics/collect';
  var VID_KEY = 'sf_vid';
  var SID_KEY = 'sf_sid';
  var SID_TS_KEY = 'sf_sid_ts';
  var SESSION_MS = 30 * 60 * 1000;

  function rid(n) {
    var a = new Uint8Array(n || 12);
    (window.crypto || window.msCrypto).getRandomValues(a);
    var s = '';
    for (var i = 0; i < a.length; i++) s += ('0' + a[i].toString(16)).slice(-2);
    return 'sf_' + s;
  }

  function getVisitorId() {
    try {
      var v = localStorage.getItem(VID_KEY);
      if (v && /^sf_[a-f0-9]+$/.test(v)) return v;
      v = rid(12);
      localStorage.setItem(VID_KEY, v);
      return v;
    } catch (e) {
      return rid(12);
    }
  }

  function getSession() {
    var now = Date.now();
    var sid = null;
    var ts = 0;
    try {
      sid = sessionStorage.getItem(SID_KEY);
      ts = parseInt(sessionStorage.getItem(SID_TS_KEY) || '0', 10) || 0;
    } catch (e) {}
    var isNew = !sid || !ts || now - ts > SESSION_MS;
    if (isNew) {
      sid = rid(10);
      try {
        sessionStorage.setItem(SID_KEY, sid);
      } catch (e) {}
    }
    try {
      sessionStorage.setItem(SID_TS_KEY, String(now));
    } catch (e) {}
    return { sid: sid, isNew: isNew };
  }

  function qp(name) {
    try {
      return new URLSearchParams(location.search).get(name) || '';
    } catch (e) {
      return '';
    }
  }

  function payload(extra) {
    var sess = getSession();
    return Object.assign(
      {
        path: location.pathname || '/',
        referrer: document.referrer || '',
        utm_source: qp('utm_source'),
        utm_medium: qp('utm_medium'),
        utm_campaign: qp('utm_campaign'),
        vid: getVisitorId(),
        sid: sess.sid,
        ns: sess.isNew ? 1 : 0,
        lang: (navigator.language || '').slice(0, 16),
        screen: (window.screen && window.screen.width ? window.screen.width + 'x' + window.screen.height : '')
      },
      extra || {}
    );
  }

  function send(data) {
    var body = JSON.stringify(data);
    try {
      if (navigator.sendBeacon) {
        var blob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon(ENDPOINT, blob)) return;
      }
    } catch (e) {}
    try {
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true,
        credentials: 'same-origin'
      }).catch(function () {});
    } catch (e) {}
  }

  function trackPageview() {
    send(payload());
  }

  // initial
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    trackPageview();
  } else {
    document.addEventListener('DOMContentLoaded', trackPageview);
  }

  // SPA-ish hash/tab changes on masters
  window.addEventListener('hashchange', function () {
    send(payload({ path: location.pathname + location.hash }));
  });

  window.sfAnalytics = {
    track: function (path) {
      send(payload(path ? { path: path } : {}));
    }
  };
})();
