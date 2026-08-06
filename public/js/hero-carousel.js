(function () {
  'use strict';

  var HERO_AUTOPLAY = 5000;

  function initHeroCarousel(root) {
    var slides = root.querySelectorAll('.hero-carousel__slide');
    var dots = root.querySelectorAll('.hero-carousel__dot');
    var prevBtn = root.querySelector('[data-hero-prev]');
    var nextBtn = root.querySelector('[data-hero-next]');
    var index = 0;
    var total = slides.length;
    var timer = null;
    var manualMode = false;

    if (total === 0) return;

    function goTo(i, useSlide) {
      index = ((i % total) + total) % total;
      slides.forEach(function (slide, j) {
        slide.classList.toggle('is-active', j === index);
        slide.setAttribute('aria-hidden', j === index ? 'false' : 'true');
      });
      dots.forEach(function (dot, j) {
        dot.classList.toggle('is-active', j === index);
      });
      if (useSlide && !root.classList.contains('hero-carousel--fade-only')) {
        root.classList.add('hero-carousel--sliding');
        window.setTimeout(function () {
          root.classList.remove('hero-carousel--sliding');
        }, 400);
      }
    }

    function next() { goTo(index + 1, manualMode); }
    function prev() { goTo(index - 1, manualMode); }

    function startAutoplay() {
      stopAutoplay();
      timer = setInterval(function () {
        manualMode = false;
        next();
      }, HERO_AUTOPLAY);
    }

    function stopAutoplay() {
      if (timer) { clearInterval(timer); timer = null; }
    }

    if (prevBtn) prevBtn.addEventListener('click', function () { manualMode = true; prev(); startAutoplay(); });
    if (nextBtn) nextBtn.addEventListener('click', function () { manualMode = true; next(); startAutoplay(); });
    dots.forEach(function (dot, i) {
      dot.addEventListener('click', function () { manualMode = true; goTo(i, true); startAutoplay(); });
    });

    root.addEventListener('mouseenter', stopAutoplay);
    root.addEventListener('mouseleave', startAutoplay);

    goTo(0);
    startAutoplay();
  }

  document.querySelectorAll('[data-hero-carousel]').forEach(initHeroCarousel);
})();
