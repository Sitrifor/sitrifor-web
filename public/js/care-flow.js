(function () {
  'use strict';

  var root = document.querySelector('[data-care-flow]');
  if (!root) return;

  var steps = Array.prototype.slice.call(root.querySelectorAll('[data-care-step]'));
  var panels = Array.prototype.slice.call(root.querySelectorAll('[data-care-panel]'));
  var lineProgress = root.querySelector('[data-care-line-progress]');
  var headingEl = root.querySelector('[data-care-heading]');
  var indexEl = root.querySelector('[data-care-index]');
  var copyBtn = root.querySelector('[data-care-copy]');
  var copyLabel = root.querySelector('[data-care-copy-label]');
  var bodyEl = root.querySelector('[data-care-body]');
  var scrollHint = root.querySelector('[data-care-scroll-hint]');
  var current = 0;
  var copyTimer = null;
  var hintFrame = 0;

  function activePanel() {
    return panels[current] || null;
  }

  function updateScrollHint() {
    if (!bodyEl || !scrollHint) return;

    var overflow = bodyEl.scrollHeight - bodyEl.clientHeight > 12;
    var remaining = bodyEl.scrollHeight - bodyEl.clientHeight - bodyEl.scrollTop;
    var canScrollMore = overflow && remaining > 16;

    scrollHint.hidden = !canScrollMore;
    scrollHint.classList.toggle('is-visible', canScrollMore);
    root.classList.toggle('has-scroll-hint', canScrollMore);
  }

  function scheduleScrollHint() {
    if (hintFrame) cancelAnimationFrame(hintFrame);
    hintFrame = requestAnimationFrame(function () {
      hintFrame = 0;
      updateScrollHint();
    });
  }

  function setStep(index, focus) {
    current = ((index % steps.length) + steps.length) % steps.length;

    steps.forEach(function (step, i) {
      var active = i === current;
      step.classList.toggle('is-active', active);
      step.setAttribute('aria-selected', active ? 'true' : 'false');
      step.setAttribute('tabindex', active ? '0' : '-1');
      if (active && focus) step.focus({ preventScroll: true });
      if (active) {
        try {
          step.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        } catch (e) {}
      }
    });

    panels.forEach(function (panel, i) {
      var active = i === current;
      panel.classList.toggle('is-active', active);
      if (active) panel.removeAttribute('hidden');
      else panel.setAttribute('hidden', '');
    });

    var panel = activePanel();
    if (headingEl && panel) {
      var key = panel.getAttribute('data-care-heading-key');
      if (key && window.SitriforI18n && window.SitriforI18n.t) {
        headingEl.textContent = window.SitriforI18n.t(key);
      } else {
        headingEl.textContent = panel.getAttribute('data-care-heading') || '';
      }
    }
    if (indexEl) {
      indexEl.textContent = current + 1 + ' / ' + steps.length;
    }
    if (lineProgress) {
      var pct = steps.length > 1 ? (current / (steps.length - 1)) * 100 : 100;
      lineProgress.style.width = pct + '%';
    }
    if (bodyEl) bodyEl.scrollTop = 0;
    resetCopyLabel();
    scheduleScrollHint();
  }

  function resetCopyLabel() {
    if (!copyLabel) return;
    copyLabel.textContent = (window.SitriforI18n && window.SitriforI18n.t)
      ? window.SitriforI18n.t('care.copy.label')
      : 'Копировать';
    if (copyBtn) copyBtn.classList.remove('is-copied');
  }

  function panelPlainText(panel) {
    if (!panel) return '';
    var key = panel.getAttribute('data-care-heading-key');
    var title = (key && window.SitriforI18n && window.SitriforI18n.t)
      ? window.SitriforI18n.t(key)
      : (panel.getAttribute('data-care-heading') || '');
    var body = (panel.innerText || panel.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
    return (title + '\n\n' + body).trim();
  }

  function copyActive() {
    var text = panelPlainText(activePanel());
    if (!text) return;

    function done(ok) {
      if (ok && window.sfMetrika) window.sfMetrika.goal('care_copy');
      if (!copyLabel) return;
      var i18n = window.SitriforI18n && window.SitriforI18n.t;
      copyLabel.textContent = ok
        ? (i18n ? window.SitriforI18n.t('care.copy.done') : 'Скопировано')
        : (i18n ? window.SitriforI18n.t('care.copy.fail') : 'Не удалось');
      if (copyBtn) copyBtn.classList.toggle('is-copied', ok);
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(resetCopyLabel, 1800);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        done(true);
      }).catch(function () {
        fallbackCopy(text, done);
      });
      return;
    }
    fallbackCopy(text, done);
  }

  function fallbackCopy(text, done) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }
    document.body.removeChild(area);
    done(ok);
  }

  steps.forEach(function (step, i) {
    step.addEventListener('click', function () {
      setStep(i, false);
      if (window.sfMetrika) window.sfMetrika.goalOnce('care_use', { step: i + 1 });
    });

    step.addEventListener('keydown', function (event) {
      var next = null;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = i + 1;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = i - 1;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = steps.length - 1;
      if (next === null) return;
      event.preventDefault();
      setStep(next, true);
    });
  });

  if (copyBtn) {
    copyBtn.addEventListener('click', copyActive);
  }

  if (bodyEl) {
    bodyEl.addEventListener('scroll', updateScrollHint, { passive: true });
  }

  if (scrollHint && bodyEl) {
    scrollHint.addEventListener('click', function () {
      bodyEl.scrollBy({
        top: Math.max(140, Math.round(bodyEl.clientHeight * 0.72)),
        behavior: 'smooth'
      });
    });
  }

  window.addEventListener('resize', scheduleScrollHint);

  if (typeof ResizeObserver !== 'undefined' && bodyEl) {
    var ro = new ResizeObserver(scheduleScrollHint);
    ro.observe(bodyEl);
  }

  setStep(0, false);
  scheduleScrollHint();

  document.addEventListener('sitrifor:langchange', function () {
    setStep(current, false);
  });
})();
