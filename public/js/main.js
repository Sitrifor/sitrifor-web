(function () {
  'use strict';

  var toggle = document.querySelector('[data-menu-toggle]');
  var drawer = document.querySelector('[data-nav-drawer]');
  var backdrop = drawer && drawer.querySelector('[data-nav-drawer-close]');
  var navLinks = document.querySelectorAll('.nav-drawer__link[data-nav]');

  function openDrawer() {
    if (!drawer || !toggle) return;
    drawer.hidden = false;
    requestAnimationFrame(function () { drawer.classList.add('is-open'); });
    toggle.classList.add('is-open');
    toggle.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer() {
    if (!drawer || !toggle) return;
    drawer.classList.remove('is-open');
    toggle.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    window.setTimeout(function () {
      if (!drawer.classList.contains('is-open')) drawer.hidden = true;
    }, 400);
  }

  function setCurrentNav() {
    var page = document.body.getAttribute('data-page');
    if (!page) return;
    navLinks.forEach(function (link) {
      link.classList.toggle('is-current', link.getAttribute('data-nav') === page);
    });
  }

  if (toggle && drawer) {
    toggle.addEventListener('click', function () {
      if (drawer.classList.contains('is-open')) closeDrawer();
      else openDrawer();
    });
    if (backdrop) backdrop.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeDrawer();
    });

    drawer.querySelectorAll('.nav-drawer__link').forEach(function (link) {
      link.addEventListener('click', closeDrawer);
    });
  }

  setCurrentNav();
})();
