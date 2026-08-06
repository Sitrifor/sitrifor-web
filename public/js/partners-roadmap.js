(function () {
  'use strict';

  function initGallery(root) {
    var slides = Array.prototype.slice.call(root.querySelectorAll('[data-gallery-slide]'));
    var prevBtn = root.querySelector('[data-gallery-prev]');
    var nextBtn = root.querySelector('[data-gallery-next]');
    var dotsWrap = root.querySelector('[data-gallery-dots]');
    if (slides.length < 1) return;

    var index = 0;
    var touchX = null;

    function renderDots() {
      if (!dotsWrap) return;
      dotsWrap.innerHTML = slides.map(function (_, i) {
        return '<button type="button" class="partners-gallery__dot' +
          (i === index ? ' is-active' : '') +
          '" data-gallery-dot="' + i + '" aria-label="Слайд ' + (i + 1) + '"></button>';
      }).join('');
    }

    function setIndex(next) {
      if (!slides.length) return;
      index = (next + slides.length) % slides.length;
      slides.forEach(function (slide, i) {
        var on = i === index;
        slide.classList.toggle('is-active', on);
        if (on) {
          slide.hidden = false;
        } else {
          slide.hidden = true;
        }
      });
      if (prevBtn) prevBtn.disabled = slides.length < 2;
      if (nextBtn) nextBtn.disabled = slides.length < 2;
      renderDots();
    }

    if (prevBtn) {
      prevBtn.addEventListener('click', function () { setIndex(index - 1); });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', function () { setIndex(index + 1); });
    }
    if (dotsWrap) {
      dotsWrap.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-gallery-dot]');
        if (!btn) return;
        setIndex(parseInt(btn.getAttribute('data-gallery-dot'), 10) || 0);
      });
    }

    root.addEventListener('touchstart', function (e) {
      if (!e.changedTouches || !e.changedTouches[0]) return;
      touchX = e.changedTouches[0].clientX;
    }, { passive: true });

    root.addEventListener('touchend', function (e) {
      if (touchX == null || !e.changedTouches || !e.changedTouches[0]) return;
      var dx = e.changedTouches[0].clientX - touchX;
      touchX = null;
      if (Math.abs(dx) < 40) return;
      if (dx < 0) setIndex(index + 1);
      else setIndex(index - 1);
    }, { passive: true });

    setIndex(0);

    return {
      reset: function () { setIndex(0); }
    };
  }

  function init() {
    var root = document.querySelector('[data-partners-roadmap]');
    if (!root) return;

    var points = Array.prototype.slice.call(root.querySelectorAll('[data-roadmap-point]'));
    var panels = Array.prototype.slice.call(document.querySelectorAll('[data-roadmap-panel]'));
    if (!points.length || !panels.length) return;

    var galleries = {};
    panels.forEach(function (panel) {
      var id = panel.getAttribute('data-roadmap-panel');
      var gal = panel.querySelector('[data-partners-gallery]');
      if (gal) galleries[id] = initGallery(gal);
    });

    function setActive(id) {
      points.forEach(function (btn) {
        var active = btn.getAttribute('data-roadmap-point') === id;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      });

      panels.forEach(function (panel) {
        var match = panel.getAttribute('data-roadmap-panel') === id;
        if (match) {
          panel.hidden = false;
          void panel.offsetWidth;
          panel.classList.add('is-visible');
          if (galleries[id] && galleries[id].reset) galleries[id].reset();
        } else {
          panel.classList.remove('is-visible');
          panel.hidden = true;
        }
      });

      root.setAttribute('data-active', id);
    }

    points.forEach(function (btn) {
      btn.addEventListener('click', function () {
        setActive(btn.getAttribute('data-roadmap-point'));
      });
      btn.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        var idx = points.indexOf(btn);
        var next = e.key === 'ArrowRight'
          ? points[(idx + 1) % points.length]
          : points[(idx - 1 + points.length) % points.length];
        next.focus();
        setActive(next.getAttribute('data-roadmap-point'));
      });
    });

    var initial = root.getAttribute('data-active') || '1';
    setActive(initial);

    requestAnimationFrame(function () {
      root.classList.add('is-ready');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
