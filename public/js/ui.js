(function (global) {
  'use strict';

  // Non-blocking webfonts (was @import in tokens.css - blocked LCP).
  (function loadFonts() {
    if (document.getElementById('sf-fonts')) return;
    var pre1 = document.createElement('link');
    pre1.rel = 'preconnect';
    pre1.href = 'https://fonts.googleapis.com';
    document.head.appendChild(pre1);
    var pre2 = document.createElement('link');
    pre2.rel = 'preconnect';
    pre2.href = 'https://fonts.gstatic.com';
    pre2.crossOrigin = 'anonymous';
    document.head.appendChild(pre2);
    var link = document.createElement('link');
    link.id = 'sf-fonts';
    link.rel = 'stylesheet';
    link.href =
      'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Manrope:wght@600;700;800&display=swap';
    document.head.appendChild(link);
  })();

  var stack = null;

  function ensureStack() {
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      stack.setAttribute('aria-live', 'polite');
      document.body.appendChild(stack);
    }
    return stack;
  }

  function showToast(message, type) {
    var el = document.createElement('div');
    el.className = 'toast' + (type === 'success' ? ' toast--success' : '');
    el.textContent = message;
    ensureStack().appendChild(el);
    window.setTimeout(function () {
      el.remove();
    }, 4000);
  }

  function openModal(id) {
    var modal = document.getElementById(id);
    if (!modal) return;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    var focusable = modal.querySelector('input, button, select, textarea');
    if (focusable) focusable.focus();
  }

  function closeModal(modal) {
    if (!modal) return;
    modal.hidden = true;
    document.body.style.overflow = '';
  }

  function initModals() {
    document.querySelectorAll('[data-modal-open]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openModal(btn.getAttribute('data-modal-open'));
      });
    });

    document.querySelectorAll('[data-modal]').forEach(function (modal) {
      var backdrop = modal.querySelector('[data-modal-close]');
      if (backdrop) backdrop.addEventListener('click', function () { closeModal(modal); });
      modal.querySelectorAll('[data-modal-dismiss]').forEach(function (closeBtn) {
        closeBtn.addEventListener('click', function () { closeModal(modal); });
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      document.querySelectorAll('[data-modal]:not([hidden])').forEach(closeModal);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initModals);
  } else {
    initModals();
  }

  global.SitriforUI = {
    showToast: showToast,
    openModal: openModal,
    closeModal: closeModal
  };
})(window);
