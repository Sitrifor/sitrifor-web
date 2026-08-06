(function () {
  'use strict';

  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function bindGalleryErrors() {
    var gallery = document.querySelector('.mp-product__gallery');
    if (!gallery) return;
    $$('img', gallery).forEach(function (img) {
      img.addEventListener('error', function () {
        img.remove();
        var left = $$('img', gallery);
        gallery.classList.toggle('is-multi', left.length > 1);
        gallery.classList.toggle('is-empty', !left.length);
        if (!left.length) {
          gallery.innerHTML = '<span class="mp-product__noimg">Нет фото</span>';
        }
      });
    });
  }

  function syncFavorite() {
    var favs = window.SitriforMpFavs;
    if (!favs) return;
    favs.bindClicks(document);
    favs.syncButtons(document);
  }

  function slugFromPath() {
    var m = location.pathname.match(/\/marketplace\/p\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  async function hydrateFromApi() {
    if (document.querySelector('[data-ssr="1"]')) {
      bindGalleryErrors();
      syncFavorite();
      return;
    }
    var slug = slugFromPath();
    if (!slug) return;
    try {
      var res = await fetch('/api/marketplace/products/' + encodeURIComponent(slug), {
        credentials: 'same-origin'
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      location.replace('/marketplace/p/' + encodeURIComponent(slug));
    } catch (err) {
      var main = document.querySelector('main.mp');
      if (main) {
        main.innerHTML =
          '<div class="container mp-product-missing">' +
          '<h1>Товар не найден</h1>' +
          '<p><a class="btn btn--brand" href="/marketplace">← В каталог</a></p></div>';
      }
    }
  }

  function boot() {
    bindGalleryErrors();
    syncFavorite();
    hydrateFromApi();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
