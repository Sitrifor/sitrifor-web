(function () {
  'use strict';

  var logo = document.querySelector('[data-logo-s]');
  if (!logo) return;

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function playAnimation() {
    if (reduced) return;
    logo.classList.remove('is-animating');
    void logo.offsetWidth;
    logo.classList.add('is-animating');
  }

  if (!reduced) {
    window.addEventListener('load', playAnimation);
  }

  logo.addEventListener('mouseenter', function () {
    playAnimation();
  });
})();
