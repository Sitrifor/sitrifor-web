(function () {
  'use strict';

  var state = {
    category: null,
    brands: [],
    categoryBrands: [],
    brandLimit: 19,
    offset: 0,
    total: 0,
    loaded: 0,
    q: '',
    favoritesOnly: false,
    meta: null
  };

  var BRAND_PAGE = 19;
  var PAGE_SIZE = 60;

  var loadSeq = 0;
  var loadAbort = null;

  function t(key, fallback) {
    if (window.SitriforI18n && typeof window.SitriforI18n.t === 'function') {
      var v = window.SitriforI18n.t(key);
      if (v && v !== key) return v;
    }
    return fallback || key;
  }

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function fmtPrice(n) {
    if (n == null || !Number.isFinite(Number(n))) return '-';
    return new Intl.NumberFormat('ru-RU').format(Math.round(Number(n))) + ' ₽';
  }

  async function api(path, signal) {
    var res = await fetch(path, { credentials: 'same-origin', signal: signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  function hasBrand(slug) {
    return state.brands.indexOf(slug) !== -1;
  }

  function toggleBrand(slug) {
    if (!slug) {
      state.brands = [];
      return;
    }
    var next = state.brands.slice();
    var idx = next.indexOf(slug);
    if (idx === -1) next.push(slug);
    else next.splice(idx, 1);
    state.brands = next;
  }

  function pruneSelectedBrands() {
    if (!state.brands.length) return;
    var allowed = {};
    (state.categoryBrands || []).forEach(function (b) {
      allowed[b.slug] = true;
    });
    state.brands = state.brands.filter(function (slug) {
      return allowed[slug];
    });
  }

  function syncCategoryActive() {
    $$('[data-mp-cat]').forEach(function (btn) {
      var on = state.category && btn.getAttribute('data-mp-cat') === state.category;
      btn.classList.toggle('is-active', !!on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function renderCategories() {
    var wrap = $('[data-mp-categories]');
    if (!wrap || !state.meta) return;
    // Build once - later switches only toggle is-active to avoid image reload jank
    if (wrap.dataset.ready === '1') {
      syncCategoryActive();
      return;
    }
    wrap.innerHTML = state.meta.categories
      .map(function (c) {
        var active = state.category === c.slug ? ' is-active' : '';
        return (
          '<button type="button" class="mp-cat' +
          active +
          '" data-mp-cat="' +
          c.slug +
          '" aria-pressed="' +
          (state.category === c.slug ? 'true' : 'false') +
          '">' +
          '<img src="' +
          (c.imageUrl || '') +
          '" alt="" width="320" height="96" decoding="async">' +
          '<span class="mp-cat__label">' +
          c.title +
          '</span></button>'
        );
      })
      .join('');
    wrap.dataset.ready = '1';
  }

  function renderBrands() {
    var wrap = $('[data-mp-brands]');
    var box = $('[data-mp-brands-wrap]');
    if (!wrap || !box) return;

    if (!state.category) {
      box.hidden = true;
      box.classList.remove('is-loading');
      wrap.innerHTML = '';
      state.brandLimit = BRAND_PAGE;
      return;
    }

    var brands = (state.categoryBrands || [])
      .filter(function (b) {
        return b && b.slug && Number(b.productCount || 0) > 0;
      })
      .slice()
      .sort(function (a, b) {
        var d = Number(b.productCount || 0) - Number(a.productCount || 0);
        if (d) return d;
        return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
      });

    // Keep section mounted while loading so toolbar/grid don't jump up
    box.hidden = false;
    if (!brands.length) {
      if (box.classList.contains('is-loading')) {
        wrap.innerHTML =
          '<span class="mp-brands__placeholder">' + t('marketplace.loading', 'Загрузка…') + '</span>';
      } else {
        wrap.innerHTML = '';
      }
      return;
    }

    box.classList.remove('is-loading');
    if (state.brandLimit < BRAND_PAGE) state.brandLimit = BRAND_PAGE;
    // Expand enough to keep selected tags visible
    state.brands.forEach(function (slug) {
      var idx = -1;
      for (var i = 0; i < brands.length; i++) {
        if (brands[i].slug === slug) {
          idx = i;
          break;
        }
      }
      if (idx >= state.brandLimit) state.brandLimit = idx + 1;
    });

    var visible = brands.slice(0, state.brandLimit);
    var remaining = brands.length - visible.length;

    wrap.innerHTML =
      '<button type="button" class="mp-brand' +
      (!state.brands.length ? ' is-active' : '') +
      '" data-mp-brand="" aria-pressed="' +
      (!state.brands.length ? 'true' : 'false') +
      '">' +
      t('marketplace.brands.all', 'Все бренды') +
      '</button>' +
      visible
        .map(function (b) {
          var active = hasBrand(b.slug);
          return (
            '<button type="button" class="mp-brand' +
            (active ? ' is-active' : '') +
            '" data-mp-brand="' +
            b.slug +
            '" aria-pressed="' +
            (active ? 'true' : 'false') +
            '">' +
            escapeHtml(b.name) +
            '</button>'
          );
        })
        .join('') +
      (remaining > 0
        ? '<button type="button" class="mp-brand mp-brand--more" data-mp-brands-more>' +
          t('marketplace.brands.more', 'Ещё производители') +
          '</button>'
        : '');
  }

  function favs() {
    return window.SitriforMpFavs || null;
  }

  function productCardHtml(p) {
    var img = p.coverUrl || '/img/marketplace/categories/other.jpg';
    var href = '/marketplace/p/' + encodeURIComponent(p.slug);
    var favApi = favs();
    var heart = favApi
      ? favApi.heartButtonHtml(p.slug, favApi.has(p.slug))
      : '';
    return (
      '<article class="mp-card">' +
      heart +
      '<a class="mp-card__link" href="' +
      href +
      '">' +
      '<img class="mp-card__img" src="' +
      img +
      '" alt="" loading="lazy" decoding="async" width="400" height="400">' +
      '<div class="mp-card__body">' +
      '<p class="mp-card__brand">' +
      escapeHtml((p.brand && p.brand.name) || '') +
      '</p>' +
      '<h2 class="mp-card__title">' +
      escapeHtml(p.title) +
      '</h2>' +
      '<div class="mp-card__meta">' +
      '<span class="mp-card__price">' +
      (p.minPriceRub != null ? t('marketplace.from', 'от') + ' ' + fmtPrice(p.minPriceRub) : '-') +
      '</span>' +
      '<span class="mp-card__shops">' +
      (p.offerCount || 0) +
      ' ' +
      t('marketplace.shops', 'магаз.') +
      '</span>' +
      '</div></div></a></article>'
    );
  }

  function updateFavFilterUi() {
    var btn = $('[data-mp-fav-filter]');
    var countEl = $('[data-mp-fav-count]');
    var favApi = favs();
    var n = favApi ? favApi.count() : 0;
    if (btn) {
      btn.classList.toggle('is-active', !!state.favoritesOnly);
      btn.setAttribute('aria-pressed', state.favoritesOnly ? 'true' : 'false');
    }
    if (countEl) {
      countEl.textContent = String(n);
      countEl.hidden = n < 1;
    }
  }

  function renderProducts(data, append) {
    var grid = $('[data-mp-grid]');
    var empty = $('[data-mp-empty]');
    var emptyFavs = $('[data-mp-empty-favs]');
    if (!grid) return;
    var items = data.items || [];
    if (!append && !items.length) {
      grid.innerHTML = '';
      if (empty) empty.hidden = !!state.favoritesOnly;
      if (emptyFavs) emptyFavs.hidden = !state.favoritesOnly;
      updateMoreButton();
      return;
    }
    if (empty) empty.hidden = true;
    if (emptyFavs) emptyFavs.hidden = true;
    var html = items.map(productCardHtml).join('');
    if (append) grid.insertAdjacentHTML('beforeend', html);
    else grid.innerHTML = html;
    updateMoreButton();
  }

  function updateMoreButton() {
    var wrap = $('[data-mp-more-wrap]');
    var countEl = $('[data-mp-more-count]');
    var btn = $('[data-mp-more]');
    if (!wrap) return;
    if (!state.total) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    if (countEl) {
      countEl.textContent = t('marketplace.shownOf', 'Показано {loaded} из {total}')
        .replace('{loaded}', String(state.loaded))
        .replace('{total}', String(state.total));
    }
    var hasMore = state.loaded < state.total;
    if (btn) {
      btn.hidden = !hasMore;
      btn.disabled = !hasMore;
    }
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setLoading(on, append) {
    var grid = $('[data-mp-grid]');
    var brands = $('[data-mp-brands-wrap]');
    var moreBtn = $('[data-mp-more]');
    if (!append && grid) grid.classList.toggle('is-loading', !!on);
    if (!append && brands && state.category) brands.classList.toggle('is-loading', !!on);
    if (moreBtn) moreBtn.classList.toggle('is-loading', !!on);
  }

  async function loadProducts(opts) {
    var append = !!(opts && opts.append);
    if (loadAbort && !append) loadAbort.abort();
    if (!append) {
      loadAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;
      state.offset = 0;
      state.loaded = 0;
      state.total = 0;
    }
    var seq = append ? loadSeq : ++loadSeq;
    var myAbort = append ? null : loadAbort;
    setLoading(true, append);
    if (state.category) {
      var brandsBox = $('[data-mp-brands-wrap]');
      if (brandsBox) brandsBox.hidden = false;
    }

    var params = new URLSearchParams();
    if (state.favoritesOnly) {
      var favApi = favs();
      var slugs = favApi ? favApi.list() : [];
      if (!slugs.length) {
        if (!append && seq !== loadSeq) return;
        state.total = 0;
        state.offset = 0;
        state.loaded = 0;
        renderProducts({ items: [], total: 0 }, false);
        setLoading(false, append);
        return;
      }
      slugs.forEach(function (slug) {
        params.append('slugs', slug);
      });
      // Prefer compact form when many favorites (URL length)
      if (slugs.length > 20) {
        params.delete('slugs');
        params.set('slugs', slugs.join(','));
      }
      params.set('limit', String(Math.min(Math.max(slugs.length, 1), 200)));
      params.set('offset', '0');
    } else {
      if (state.category) params.set('category', state.category);
      if (state.brands.length) {
        state.brands.forEach(function (slug) {
          params.append('brand', slug);
        });
      }
      if (state.q) params.set('q', state.q);
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(append ? state.offset : 0));
    }

    try {
      var data = await api(
        '/api/marketplace/products?' + params.toString(),
        myAbort ? myAbort.signal : undefined
      );
      if (!append && seq !== loadSeq) return;
      if (!append && !state.favoritesOnly) {
        state.categoryBrands = Array.isArray(data.brands) ? data.brands : [];
        pruneSelectedBrands();
        renderBrands();
      }
      if (state.favoritesOnly) {
        state.categoryBrands = [];
        renderBrands();
      }
      state.total = Number(data.total || 0);
      var got = (data.items && data.items.length) || 0;
      state.offset = (append ? state.offset : 0) + got;
      state.loaded = append ? state.loaded + got : got;
      renderProducts(data, append);
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      throw err;
    } finally {
      if (append || seq === loadSeq) setLoading(false, append);
    }
  }

  async function boot() {
    state.meta = await api('/api/marketplace/meta');
    var stats = state.meta.stats || {};
    var statsEl = $('[data-mp-stats]');
    if (statsEl) {
      statsEl.textContent =
        (stats.products || 0) +
        ' ' +
        t('marketplace.statProducts', 'товаров') +
        ' · ' +
        (stats.offers || 0) +
        ' ' +
        t('marketplace.statOffers', 'предложений') +
        ' · ' +
        (stats.shops || 0) +
        ' ' +
        t('marketplace.statShops', 'магазинов');
    }
    renderCategories();
    updateFavFilterUi();
    if (favs()) favs().bindClicks(document);
    await loadProducts();

    document.addEventListener('click', function (e) {
      var favFilter = e.target.closest('[data-mp-fav-filter]');
      if (favFilter) {
        state.favoritesOnly = !state.favoritesOnly;
        if (state.favoritesOnly) {
          state.category = null;
          state.brands = [];
          state.categoryBrands = [];
          state.brandLimit = BRAND_PAGE;
          state.q = '';
          var searchClear = $('[data-mp-search]');
          if (searchClear) searchClear.value = '';
          syncCategoryActive();
          renderBrands();
        }
        updateFavFilterUi();
        loadProducts();
        return;
      }
      var cat = e.target.closest('[data-mp-cat]');
      if (cat) {
        state.favoritesOnly = false;
        updateFavFilterUi();
        var slug = cat.getAttribute('data-mp-cat');
        state.category = state.category === slug ? null : slug;
        state.brands = [];
        state.brandLimit = BRAND_PAGE;
        // Keep previous brand chips until new payload arrives to avoid collapse jump
        syncCategoryActive();
        if (!state.category) {
          state.categoryBrands = [];
          renderBrands();
        } else {
          var brandsBox = $('[data-mp-brands-wrap]');
          if (brandsBox) {
            brandsBox.hidden = false;
            brandsBox.classList.add('is-loading');
          }
        }
        loadProducts();
        return;
      }
      var moreBrands = e.target.closest('[data-mp-brands-more]');
      if (moreBrands) {
        state.brandLimit += BRAND_PAGE;
        renderBrands();
        return;
      }
      var moreProducts = e.target.closest('[data-mp-more]');
      if (moreProducts) {
        if (state.favoritesOnly) return;
        loadProducts({ append: true });
        return;
      }
      var brand = e.target.closest('[data-mp-brand]');
      if (brand) {
        state.favoritesOnly = false;
        updateFavFilterUi();
        toggleBrand(brand.getAttribute('data-mp-brand') || '');
        renderBrands();
        loadProducts();
        return;
      }
      if (e.target.closest('[data-mp-reset]')) {
        state.category = null;
        state.brands = [];
        state.categoryBrands = [];
        state.brandLimit = BRAND_PAGE;
        state.q = '';
        state.favoritesOnly = false;
        var search = $('[data-mp-search]');
        if (search) search.value = '';
        syncCategoryActive();
        updateFavFilterUi();
        renderBrands();
        loadProducts();
      }
    });

    window.addEventListener('mp:favorites', function () {
      updateFavFilterUi();
      if (state.favoritesOnly) loadProducts();
    });

    var search = $('[data-mp-search]');
    var timer = null;
    if (search) {
      search.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          state.favoritesOnly = false;
          updateFavFilterUi();
          state.q = search.value.trim();
          loadProducts();
        }, 250);
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
