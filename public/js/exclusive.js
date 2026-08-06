/**
 * Sitrifor Exclusive catalog - grid + painting modal with poster calculator.
 */
(function () {
  'use strict';

  var ASSET_V = '15';
  var FAV_KEY = 'sitrifor_exclusive_favorites';
  var TOP_TAGS = 8;
  var GROWTH_START = new Date(2024, 0, 1);
  var SITRIFOR_MARKUP = 1.2;
  var SITRIFOR_FEE = 6748;

  var MAT = {
    photo: 200,
    banner: 180,
    backlit: 260,
    vinyl_gloss_opaque: 200,
    vinyl_gloss_clear: 200,
    vinyl_matte_opaque: 200,
    vinyl_matte_clear: 200,
    vinyl_removable: 250
  };

  var SIZE_M2 = {
    a4: 0.06754,
    a3: 0.13201,
    a2: 0.25972,
    a1: 0.514,
    a0: 1.02
  };

  var FINISH = {
    tube: 0,
    pvc3: 700,
    pvc5: 1100,
    foam5: 1200,
    stretcher: 700,
    frame: 2000
  };

  var grid = document.querySelector('[data-exclusive-grid]');
  var modal = document.querySelector('[data-exclusive-modal]');
  if (!grid || !modal) return;

  var filtersEl = document.querySelector('[data-exclusive-filters]');
  var tagsEl = document.querySelector('[data-exclusive-filter-tags]');
  var favFilterBtn = document.querySelector('[data-exclusive-filter-fav]');
  var favToggleBtn = modal.querySelector('[data-exclusive-fav-toggle]');
  var thumbsEl = modal.querySelector('[data-exclusive-thumbs]');
  var heroImg = modal.querySelector('[data-exclusive-hero]');
  var heroLabel = modal.querySelector('[data-exclusive-hero-label]');
  var turntable = modal.querySelector('[data-exclusive-turntable]');
  var titleEl = modal.querySelector('[data-exclusive-title]');
  var storyEl = modal.querySelector('[data-exclusive-story]');
  var audienceEl = modal.querySelector('[data-exclusive-audience]');
  var buyLicense = null;
  var placeCta = document.querySelector('[data-exclusive-place]');
  var panelInfo = modal.querySelector('[data-exclusive-panel-info]');
  var panelCalc = modal.querySelector('[data-exclusive-panel-calc]');
  var panelLicense = modal.querySelector('[data-exclusive-panel-license]');
  var calcForm = modal.querySelector('[data-exclusive-calc]');
  var totalEl = modal.querySelector('[data-calc-total]');
  var orderBtn = modal.querySelector('[data-exclusive-order-poster]');
  var orderLicenseBtn = modal.querySelector('[data-exclusive-order-license]');

  var catalog = [];
  var activeItem = null;
  var activeKind = 'char';
  var gallerySlides = [];
  var rotY = 0;
  var dragging = false;
  var lastX = 0;
  var autoSpin = true;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var activeFilter = null;
  var favorites = loadFavorites();
  var activePanel = 'info'; // info | calc | license
  var lastTotal = 0;
  var lastCalcSnapshot = null;

  function lang() {
    if (window.SitriforI18n && window.SitriforI18n.getLang) return window.SitriforI18n.getLang();
    return 'ru';
  }

  function tt(key, vars) {
    if (window.SitriforI18n && window.SitriforI18n.t) return window.SitriforI18n.t(key, vars);
    return key;
  }

  function loc(obj) {
    if (!obj) return '';
    return obj[lang()] || obj.ru || obj.en || '';
  }

  function loadFavorites() {
    try {
      var raw = sessionStorage.getItem(FAV_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.map(String) : [];
    } catch (e) {
      return [];
    }
  }

  function saveFavorites() {
    try {
      sessionStorage.setItem(FAV_KEY, JSON.stringify(favorites));
    } catch (e) { /* ignore */ }
  }

  function isFavorite(id) {
    return favorites.indexOf(String(id)) !== -1;
  }

  function toggleFavorite(id) {
    id = String(id);
    var i = favorites.indexOf(id);
    if (i === -1) favorites.push(id);
    else favorites.splice(i, 1);
    saveFavorites();
    if (!favorites.length && activeFilter === '__fav__') activeFilter = null;
    syncFavFilter();
    syncModalFav();
    renderFilters();
    renderGrid();
  }

  function asset(item, kind) {
    var id = item.id;
    var map = {
      framed: '/img/exclusive/framed/' + id + '.jpg',
      cleaned: '/img/exclusive/cleaned/' + id + '.jpg',
      original: '/img/exclusive/framed/' + id + '.jpg',
      room: '/img/exclusive/room/' + id + '.jpg',
      dark: '/img/exclusive/dark/' + id + '.jpg',
      char: '/img/exclusive/char/' + id + '.jpg',
      teemale: '/img/exclusive/tee-m/' + id + '.jpg',
      teefemale: '/img/exclusive/tee-f/' + id + '.jpg',
      thumb: '/img/exclusive/char/' + id + '.jpg'
    };
    return (map[kind] || map.char) + '?v=' + ASSET_V;
  }

  function galleryItems(item) {
    return [
      { kind: 'char', labelKey: 'exclusive.view.char' },
      { kind: 'teemale', labelKey: 'exclusive.view.teeMale' },
      { kind: 'teefemale', labelKey: 'exclusive.view.teeFemale' }
    ].map(function (v) {
      return {
        src: asset(item, v.kind),
        label: tt(v.labelKey),
        kind: v.kind
      };
    });
  }

  function mailto(kind, item, extraBody) {
    var title = item ? loc(item.title) : '';
    var subject;
    var body;
    if (kind === 'place') {
      subject = tt('exclusive.mail.placeSubject');
      body = tt('exclusive.mail.placeBody');
    } else if (kind === 'poster') {
      subject = tt('exclusive.mail.posterSubject', { title: title });
      body = extraBody || '';
    } else if (kind === 'license') {
      subject = tt('exclusive.mail.licenseSubject', { title: title });
      body = extraBody || tt('exclusive.mail.licenseBody', { title: title, id: item.id });
    } else if (kind === 'art') {
      subject = tt('exclusive.mail.artSubject', { title: title });
      body = tt('exclusive.mail.artBody', { title: title, id: item.id });
    } else {
      subject = tt('exclusive.mail.licenseSubject', { title: title });
      body = tt('exclusive.mail.licenseBody', { title: title, id: item.id });
    }
    return 'mailto:php.grishan@yandex.ru?subject=' + encodeURIComponent(subject) +
      '&body=' + encodeURIComponent(body);
  }

  function syncPlaceCta() {
    if (placeCta) placeCta.href = mailto('place');
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function tagLabel(tagId) {
    return tt('exclusive.tag.' + tagId) || tagId;
  }

  function topTags() {
    var counts = {};
    catalog.forEach(function (item) {
      (item.tags || []).forEach(function (t) {
        counts[t] = (counts[t] || 0) + 1;
      });
    });
    return Object.keys(counts)
      .sort(function (a, b) {
        if (counts[b] !== counts[a]) return counts[b] - counts[a];
        return a.localeCompare(b);
      })
      .slice(0, TOP_TAGS);
  }

  function filteredCatalog() {
    if (activeFilter === '__fav__') {
      return catalog.filter(function (item) { return isFavorite(item.id); });
    }
    if (activeFilter) {
      return catalog.filter(function (item) {
        return (item.tags || []).indexOf(activeFilter) !== -1;
      });
    }
    return catalog.slice();
  }

  function syncFavFilter() {
    if (!favFilterBtn) return;
    var has = favorites.length > 0;
    favFilterBtn.classList.toggle('has-items', has);
    favFilterBtn.classList.toggle('is-disabled', !has);
    favFilterBtn.disabled = !has;
    favFilterBtn.classList.toggle('is-active', activeFilter === '__fav__');
    favFilterBtn.setAttribute('aria-pressed', activeFilter === '__fav__' ? 'true' : 'false');
    favFilterBtn.setAttribute('aria-label', tt('exclusive.filters.fav'));
  }

  function syncModalFav() {
    if (!favToggleBtn || !activeItem) return;
    var on = isFavorite(activeItem.id);
    favToggleBtn.classList.toggle('is-on', on);
    favToggleBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    favToggleBtn.setAttribute('aria-label', tt(on ? 'exclusive.fav.remove' : 'exclusive.fav.add'));
  }

  function renderFilters() {
    if (!tagsEl) return;
    var tags = topTags();
    tagsEl.innerHTML = tags.map(function (tag) {
      var active = activeFilter === tag ? ' is-active' : '';
      var pressed = activeFilter === tag ? 'true' : 'false';
      return '<button type="button" class="exclusive-filters__tag' + active + '" data-exclusive-filter-tag="' + escapeHtml(tag) + '" aria-pressed="' + pressed + '">' +
        escapeHtml(tagLabel(tag)) +
      '</button>';
    }).join('');
    syncFavFilter();
  }

  function applyRot() {
    if (!heroImg) return;
    heroImg.style.transform =
      'perspective(900px) rotateY(' + rotY.toFixed(1) + 'deg) rotateX(6deg)';
  }

  function resetSpin() {
    rotY = 0;
    autoSpin = true;
    applyRot();
  }

  function renderGrid() {
    var items = filteredCatalog();
    if (!items.length) {
      grid.innerHTML = '<p class="exclusive-grid__empty">' + escapeHtml(tt('exclusive.filters.empty')) + '</p>';
      return;
    }
    grid.innerHTML = items.map(function (item) {
      return '<article class="exclusive-card">' +
        '<button type="button" class="exclusive-card__open" data-exclusive-open="' + item.id + '">' +
          '<span class="exclusive-card__glow" aria-hidden="true"></span>' +
          '<span class="exclusive-card__media">' +
            '<img src="' + asset(item, 'char') + '" alt="" loading="lazy" width="600" height="600">' +
          '</span>' +
          '<span class="exclusive-card__body">' +
            '<span class="exclusive-card__title">' + escapeHtml(loc(item.title)) + '</span>' +
          '</span>' +
        '</button>' +
      '</article>';
    }).join('');
  }

  function setHero(kind) {
    var slide = gallerySlides.find(function (s) { return s.kind === kind; }) || gallerySlides[0];
    if (!slide || !heroImg) return;
    activeKind = slide.kind;
    heroImg.src = slide.src;
    heroImg.alt = loc(activeItem.title) + ' - ' + slide.label;
    if (heroLabel) heroLabel.textContent = slide.label;
    if (thumbsEl) {
      Array.prototype.forEach.call(thumbsEl.querySelectorAll('[data-kind]'), function (btn) {
        btn.classList.toggle('is-active', btn.getAttribute('data-kind') === activeKind);
        btn.setAttribute('aria-selected', btn.getAttribute('data-kind') === activeKind ? 'true' : 'false');
      });
    }
    resetSpin();
  }

  function renderGallery(item) {
    gallerySlides = galleryItems(item);
    if (!thumbsEl) return;
    thumbsEl.innerHTML = gallerySlides.map(function (s) {
      return '<button type="button" class="exclusive-gallery__thumb" role="tab" data-kind="' + s.kind + '" aria-label="' + escapeHtml(s.label) + '">' +
        '<img src="' + s.src + '" alt="" loading="lazy" width="240" height="180">' +
        '<span>' + escapeHtml(s.label) + '</span>' +
      '</button>';
    }).join('');
    setHero('char');
  }

  /* —— Poster calculator (Pappermint-like) —— */

  function growthMultiplier() {
    var now = new Date();
    var end = new Date(now.getFullYear(), now.getMonth(), 1);
    var months =
      (end.getFullYear() - GROWTH_START.getFullYear()) * 12 +
      (end.getMonth() - GROWTH_START.getMonth()) + 1;
    return 1 + months / 100;
  }

  function zakupPred(sebes) {
    if (sebes < 237) return 236;
    if (sebes < 2000) return sebes;
    if (sebes < 2500) return sebes * 0.975;
    if (sebes < 3000) return sebes * 0.95;
    if (sebes < 3500) return sebes * 0.925;
    if (sebes < 4000) return sebes * 0.9;
    if (sebes < 4500) return sebes * 0.875;
    if (sebes < 5000) return sebes * 0.85;
    if (sebes < 5500) return sebes * 0.825;
    if (sebes < 6000) return sebes * 0.8;
    if (sebes < 10000) return sebes * 0.75;
    if (sebes < 12000) return sebes * 0.725;
    return sebes * 0.7;
  }

  function roundTotalPrice(total, quantity) {
    total = total * 100;
    var unitPrice = total / quantity;
    var roundedUnitPrice = Number((Math.ceil(unitPrice * 100) / 100).toFixed());
    var newTotal = roundedUnitPrice * quantity / 100;
    if (!Number.isInteger(newTotal)) {
      newTotal = Math.ceil(roundedUnitPrice / 100) * quantity;
    }
    return newTotal;
  }

  function isMarketingNumber(n) {
    // Round marketing prices: 1000, 2000, 5500, xxx00
    return n % 100 === 0;
  }

  function finalizeSitriforPrice(base) {
    var n = Math.ceil(base * SITRIFOR_MARKUP + SITRIFOR_FEE);
    var guard = 0;
    while (guard < 40) {
      guard += 1;
      if (isMarketingNumber(n)) {
        n -= 10; // 1000 → 990 style
        continue;
      }
      if (n % 6 === 0) {
        n += 1; // never divisible by 6 — bump up
        continue;
      }
      break;
    }
    if (n < 1) n = 1;
    return n;
  }

  function selectedOptionLabel(select) {
    if (!select || !select.options.length) return '';
    var opt = select.options[select.selectedIndex];
    return opt ? String(opt.textContent || opt.value).trim() : '';
  }

  function readCalcState() {
    if (!calcForm) return null;
    var material = calcForm.querySelector('[data-calc-material]').value;
    var lamination = calcForm.querySelector('[data-calc-lamination]').value;
    var sizeKey = calcForm.querySelector('[data-calc-size]').value;
    var qtyKey = calcForm.querySelector('[data-calc-qty]').value;
    var finish = calcForm.querySelector('[data-calc-finish]').value;

    var tir = Math.max(1, Number(qtyKey) || 1);
    var size = SIZE_M2[sizeKey] || SIZE_M2.a3;
    var sizeLabel = selectedOptionLabel(calcForm.querySelector('[data-calc-size]'));
    var mat = MAT[material] != null ? MAT[material] : 200;
    var lam = lamination === 'none' ? 0 : 140;
    var oformlenie = FINISH[finish] != null ? FINISH[finish] : 0;

    return {
      material: material,
      materialLabel: selectedOptionLabel(calcForm.querySelector('[data-calc-material]')),
      lamination: lamination,
      laminationLabel: selectedOptionLabel(calcForm.querySelector('[data-calc-lamination]')),
      sizeKey: sizeKey,
      size: size,
      sizeLabel: sizeLabel,
      tir: tir,
      qtyLabel: selectedOptionLabel(calcForm.querySelector('[data-calc-qty]')),
      types: 1,
      finish: finish,
      finishLabel: selectedOptionLabel(calcForm.querySelector('[data-calc-finish]')),
      mat: mat,
      lam: lam,
      oformlenie: oformlenie
    };
  }

  function computePappermintBase(state) {
    var sebes = (state.mat * 3 + state.lam * 3 + state.oformlenie) * state.size * state.tir + 100;
    var pred = zakupPred(sebes) * growthMultiplier();
    pred = Math.ceil(pred);
    var roznitsa = Math.ceil(
      pred * 2.5 +
      600 +
      150 * state.types +
      150 +
      100
    );
    if (roznitsa < 1990 && state.lam === 0) roznitsa = 1990;
    if (roznitsa < 2290 && state.lam !== 0) roznitsa = 2290;
    return roundTotalPrice(roznitsa, state.tir);
  }

  function formatMoney(n) {
    try {
      return Number(n).toLocaleString(lang() === 'en' ? 'en-US' : lang() === 'de' ? 'de-DE' : 'ru-RU');
    } catch (e) {
      return String(n);
    }
  }

  function recalculate() {
    if (!calcForm || !totalEl) return;
    var state = readCalcState();
    if (!state) return;
    var base = computePappermintBase(state);
    var total = finalizeSitriforPrice(base);
    lastTotal = total;
    lastCalcSnapshot = state;
    totalEl.textContent = formatMoney(total);
    if (orderBtn && activeItem) {
      orderBtn.href = buildPosterMailto(activeItem, state, total);
    }
  }

  function buildPosterMailto(item, state, total) {
    var lines = [
      tt('exclusive.mail.posterBodyIntro', { title: loc(item.title), id: item.id }),
      '',
      tt('exclusive.calc.material') + ': ' + state.materialLabel,
      tt('exclusive.calc.lamination') + ': ' + state.laminationLabel,
      tt('exclusive.calc.size') + ': ' + state.sizeLabel,
      tt('exclusive.calc.qty') + ': ' + state.qtyLabel,
      tt('exclusive.calc.finish') + ': ' + state.finishLabel,
      '',
      tt('exclusive.calc.totalLabel') + ': ' + formatMoney(total) + ' ' + tt('exclusive.calc.currency')
    ];
    return mailto('poster', item, lines.join('\n'));
  }

  function localizeCalcOptions() {
    if (!calcForm) return;
    var map = [
      ['[data-calc-material]', 'exclusive.calc.opt.material.'],
      ['[data-calc-lamination]', 'exclusive.calc.opt.lamination.'],
      ['[data-calc-size]', 'exclusive.calc.opt.size.'],
      ['[data-calc-qty]', 'exclusive.calc.opt.qty.'],
      ['[data-calc-finish]', 'exclusive.calc.opt.finish.']
    ];
    map.forEach(function (pair) {
      var sel = calcForm.querySelector(pair[0]);
      if (!sel) return;
      Array.prototype.forEach.call(sel.options, function (opt) {
        var key = pair[1] + opt.value;
        var label = tt(key);
        if (label && label !== key) opt.textContent = label;
      });
    });
  }

  function buildLicenseMailto(item) {
    var title = loc(item.title);
    var body = [
      tt('exclusive.mail.licenseBodyIntro', { title: title, id: item.id }),
      '',
      tt('exclusive.license.title'),
      tt('exclusive.license.lead'),
      '',
      tt('exclusive.license.includesTitle'),
      '- ' + tt('exclusive.license.item1.title') + ': ' + tt('exclusive.license.item1.text'),
      '- ' + tt('exclusive.license.item2.title') + ': ' + tt('exclusive.license.item2.text'),
      '- ' + tt('exclusive.license.item3.title') + ': ' + tt('exclusive.license.item3.text'),
      '- ' + tt('exclusive.license.item4.title') + ': ' + tt('exclusive.license.item4.text'),
      '',
      tt('exclusive.license.priceLabel') + ': ' + tt('exclusive.license.price')
    ].join('\n');
    return mailto('license', item, body);
  }

  function syncLicenseOrderLink() {
    if (orderLicenseBtn && activeItem) {
      orderLicenseBtn.href = buildLicenseMailto(activeItem);
    }
  }

  function setPanel(name) {
    activePanel = name || 'info';
    var panels = [
      { el: panelInfo, id: 'info', keepMounted: true },
      { el: panelCalc, id: 'calc', keepMounted: false },
      { el: panelLicense, id: 'license', keepMounted: false }
    ];
    panels.forEach(function (p) {
      if (!p.el) return;
      var on = p.id === activePanel;
      if (on) {
        p.el.hidden = false;
        void p.el.offsetWidth;
        p.el.classList.add('is-active');
      } else {
        p.el.classList.remove('is-active');
        window.setTimeout(function () {
          if (activePanel !== p.id && !p.keepMounted) p.el.hidden = true;
        }, reduceMotion ? 0 : 420);
      }
    });
    if (activePanel === 'calc') {
      localizeCalcOptions();
      recalculate();
    }
    if (activePanel === 'license') syncLicenseOrderLink();
  }

  function resetCalcDefaults() {
    if (!calcForm) return;
    calcForm.querySelector('[data-calc-material]').value = 'photo';
    calcForm.querySelector('[data-calc-lamination]').value = 'none';
    calcForm.querySelector('[data-calc-size]').value = 'a3';
    calcForm.querySelector('[data-calc-qty]').value = '1';
    calcForm.querySelector('[data-calc-finish]').value = 'tube';
  }

  function openItem(id) {
    var item = catalog.find(function (x) { return x.id === id; });
    if (!item) return;
    activeItem = item;
    titleEl.textContent = loc(item.title);
    storyEl.textContent = loc(item.story);
    audienceEl.textContent = loc(item.audience);
    renderGallery(item);
    syncModalFav();
    resetCalcDefaults();
    if (panelCalc) {
      panelCalc.hidden = true;
      panelCalc.classList.remove('is-active');
    }
    if (panelLicense) {
      panelLicense.hidden = true;
      panelLicense.classList.remove('is-active');
    }
    if (panelInfo) panelInfo.classList.add('is-active');
    activePanel = 'info';
    syncLicenseOrderLink();
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    var layout = modal.querySelector('.exclusive-modal__layout');
    if (layout) layout.scrollTop = 0;
    var panel = modal.querySelector('.exclusive-modal__panel');
    if (panel) panel.scrollTop = 0;
  }

  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = '';
    activeItem = null;
    dragging = false;
    setPanel('info');
  }

  function setFilter(next) {
    activeFilter = activeFilter === next ? null : next;
    renderFilters();
    renderGrid();
  }

  grid.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-exclusive-open]');
    if (!btn) return;
    openItem(btn.getAttribute('data-exclusive-open'));
  });

  if (filtersEl) {
    filtersEl.addEventListener('click', function (e) {
      var favBtn = e.target.closest('[data-exclusive-filter-fav]');
      if (favBtn && !favBtn.disabled) {
        setFilter('__fav__');
        return;
      }
      var tagBtn = e.target.closest('[data-exclusive-filter-tag]');
      if (tagBtn) setFilter(tagBtn.getAttribute('data-exclusive-filter-tag'));
    });
  }

  modal.addEventListener('click', function (e) {
    if (e.target.closest('[data-exclusive-close]')) closeModal();
    var thumb = e.target.closest('[data-kind]');
    if (thumb && thumbsEl && thumbsEl.contains(thumb)) {
      setHero(thumb.getAttribute('data-kind'));
    }
    if (e.target.closest('[data-exclusive-fav-toggle]') && activeItem) {
      toggleFavorite(activeItem.id);
    }
    if (e.target.closest('[data-exclusive-open-calc]')) {
      e.preventDefault();
      setPanel('calc');
    }
    if (e.target.closest('[data-exclusive-open-license]')) {
      e.preventDefault();
      setPanel('license');
    }
    if (e.target.closest('[data-exclusive-close-panel]') || e.target.closest('[data-exclusive-close-calc]')) {
      e.preventDefault();
      setPanel('info');
    }
  });

  if (calcForm) {
    calcForm.addEventListener('change', recalculate);
    calcForm.addEventListener('input', recalculate);
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modal.hidden) {
      if (activePanel !== 'info') setPanel('info');
      else closeModal();
    }
  });

  if (turntable && heroImg) {
    turntable.addEventListener('pointerdown', function (e) {
      if (e.target.closest('[data-kind]')) return;
      dragging = true;
      autoSpin = false;
      lastX = e.clientX;
      turntable.setPointerCapture(e.pointerId);
    });
    turntable.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var dx = e.clientX - lastX;
      lastX = e.clientX;
      rotY += dx * 0.55;
      applyRot();
    });
    function endDrag() {
      dragging = false;
      window.setTimeout(function () { autoSpin = true; }, 1800);
    }
    turntable.addEventListener('pointerup', endDrag);
    turntable.addEventListener('pointercancel', endDrag);

    if (!reduceMotion) {
      window.setInterval(function () {
        if (modal.hidden || dragging || !autoSpin || !activeItem) return;
        rotY += 0.35;
        applyRot();
      }, 32);
    }
  }

  document.addEventListener('sitrifor:langchange', function () {
    syncPlaceCta();
    renderFilters();
    renderGrid();
    localizeCalcOptions();
    if (activeItem) {
      var keep = activePanel;
      openItem(activeItem.id);
      if (keep !== 'info') setPanel(keep);
      else recalculate();
    }
  });

  syncPlaceCta();
  syncFavFilter();
  localizeCalcOptions();

  fetch('/js/exclusive-catalog.json?v=6')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      catalog = (data && data.items) || [];
      renderFilters();
      renderGrid();
      var hash = (window.location.hash || '').replace(/^#/, '');
      if (hash) {
        var bySlug = catalog.find(function (x) { return x.slug === hash || x.id === hash; });
        if (bySlug) openItem(bySlug.id);
      }
    })
    .catch(function (err) {
      console.error(err);
      grid.innerHTML = '<p style="color:rgba(255,255,255,.55)">Catalog unavailable</p>';
    });
})();
