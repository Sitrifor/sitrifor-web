(function () {
  'use strict';

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.width = '1px';
    ta.style.height = '1px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    var ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }

  function setCopiedState(btn, ok) {
    if (!btn) return;
    if (!btn.getAttribute('data-label-default')) {
      btn.setAttribute('data-label-default', (btn.textContent || '').trim());
    }
    var def = btn.getAttribute('data-label-default') ||
      ((window.SitriforI18n && window.SitriforI18n.t) ? window.SitriforI18n.t('utm.copy.default') : 'Скопировать ссылку');
    if (btn._copyTimer) {
      clearTimeout(btn._copyTimer);
      btn._copyTimer = null;
    }
    var i18n = window.SitriforI18n && window.SitriforI18n.t;
    if (!ok) {
      btn.textContent = i18n ? window.SitriforI18n.t('utm.copy.fail') : 'Не удалось';
      btn._copyTimer = setTimeout(function () {
        btn.textContent = def;
        btn.classList.remove('is-copied');
        btn._copyTimer = null;
      }, 5000);
      return;
    }
    btn.textContent = i18n ? window.SitriforI18n.t('utm.copy.success') : 'Ссылка скопирована';
    btn.classList.add('is-copied');
    btn._copyTimer = setTimeout(function () {
      btn.textContent = def;
      btn.classList.remove('is-copied');
      btn._copyTimer = null;
    }, 5000);
  }

  function copyLink(path, btn) {
    var url = window.location.origin + path;
    function done(ok) {
      setCopiedState(btn, ok);
      if (window.SitriforUI) {
        var i18n = window.SitriforI18n && window.SitriforI18n.t;
        window.SitriforUI.showToast(
          ok
            ? (i18n ? window.SitriforI18n.t('utm.copy.success') : 'Ссылка скопирована')
            : (i18n ? window.SitriforI18n.t('utm.copy.failToast') : 'Не удалось скопировать'),
          ok ? 'success' : 'error'
        );
      }
    }

    if (navigator.clipboard && window.isSecureContext && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () {
        done(true);
      }).catch(function () {
        done(fallbackCopy(url));
      });
      return;
    }
    done(fallbackCopy(url));
  }

  document.querySelectorAll('[data-share-care]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      copyLink('/masters#care', btn);
    });
  });

  document.querySelectorAll('[data-share-calc]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      copyLink('/masters#calculator', btn);
    });
  });
})();
