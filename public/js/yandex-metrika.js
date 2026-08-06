/**
 * Yandex.Metrika counter for sitrifor.ru
 * Counter id: 111332527
 */
(function (m, e, t, r, i, k, a) {
  if (window.__SF_METRIKA__) return;
  window.__SF_METRIKA__ = true;
  m[i] =
    m[i] ||
    function () {
      (m[i].a = m[i].a || []).push(arguments);
    };
  m[i].l = 1 * new Date();
  for (var j = 0; j < document.scripts.length; j++) {
    if (document.scripts[j].src === r) return;
  }
  k = e.createElement(t);
  a = e.getElementsByTagName(t)[0];
  k.async = 1;
  k.src = r;
  a.parentNode.insertBefore(k, a);
})(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js?id=111332527', 'ym');

ym(111332527, 'init', {
  ssr: true,
  webvisor: true,
  clickmap: true,
  ecommerce: 'dataLayer',
  referrer: document.referrer,
  url: location.href,
  accurateTrackBounce: true,
  trackLinks: true,
  /* /masters#care|#calculator|#app - отдельные просмотры */
  trackHash: true
});

/* Goal helper (reachGoal) - load after counter init */
(function () {
  if (document.querySelector('script[data-sf-metrika]')) return;
  var s = document.createElement('script');
  s.src = '/js/sf-metrika.js';
  s.defer = true;
  s.setAttribute('data-sf-metrika', '1');
  document.head.appendChild(s);
})();
