/**
 * Subtle pointer tilt for about-page visual panels.
 * Respects prefers-reduced-motion and coarse pointers.
 */
(function () {
  'use strict';

  var reduce =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer =
    window.matchMedia && window.matchMedia('(pointer: fine)').matches;
  if (reduce || !finePointer) return;

  var panels = document.querySelectorAll('[data-about-tilt]');
  if (!panels.length) return;

  var maxTilt = 5;

  function onMove(el, e) {
    var rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    var x = (e.clientX - rect.left) / rect.width;
    var y = (e.clientY - rect.top) / rect.height;
    var rx = (0.5 - y) * maxTilt;
    var ry = (x - 0.5) * maxTilt;
    el.style.transform =
      'perspective(900px) rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg)';
  }

  function onLeave(el) {
    el.style.transform = '';
  }

  Array.prototype.forEach.call(panels, function (el) {
    el.addEventListener('pointermove', function (e) {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      onMove(el, e);
    });
    el.addEventListener('pointerleave', function () {
      onLeave(el);
    });
  });
})();
