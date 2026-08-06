(function () {
  'use strict';

  function formatPhone(value) {
    var digits = value.replace(/\D/g, '');
    if (digits.startsWith('8')) digits = '7' + digits.slice(1);
    if (!digits.startsWith('7')) digits = '7' + digits;
    digits = digits.slice(0, 11);
    var parts = ['+7'];
    if (digits.length > 1) parts.push(' (' + digits.slice(1, 4));
    if (digits.length >= 4) parts[parts.length - 1] += ')';
    if (digits.length > 4) parts.push(' ' + digits.slice(4, 7));
    if (digits.length > 7) parts.push('-' + digits.slice(7, 9));
    if (digits.length > 9) parts.push('-' + digits.slice(9, 11));
    return parts.join('');
  }

  document.querySelectorAll('[data-phone-mask]').forEach(function (input) {
    input.addEventListener('input', function () {
      input.value = formatPhone(input.value);
    });
  });

  async function submitLead(type, payload) {
    var response = await fetch('/api/leads/' + type, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload)
    });
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      throw new Error(
        data.message ||
        ((window.SitriforI18n && window.SitriforI18n.t) ? window.SitriforI18n.t('toast.sendError') : 'Ошибка отправки')
      );
    }
    return data;
  }

  function bindForm(selector, type, onSuccess) {
    var form = document.querySelector(selector);
    if (!form) return;

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var btn = form.querySelector('[type="submit"]');
      if (btn) btn.disabled = true;

      var fd = new FormData(form);
      var payload = {};
      fd.forEach(function (val, key) {
        if (payload[key]) {
          if (!Array.isArray(payload[key])) payload[key] = [payload[key]];
          payload[key].push(val);
        } else {
          payload[key] = val;
        }
      });

      try {
        await submitLead(type, payload);
        if (onSuccess) onSuccess(form);
        else if (window.SitriforUI) {
          window.SitriforUI.showToast(
            (window.SitriforI18n && window.SitriforI18n.t)
              ? window.SitriforI18n.t('toast.leadSent')
              : 'Заявка отправлена!',
            'success'
          );
          window.SitriforUI.closeModal(form.closest('[data-modal]'));
          form.reset();
        }
      } catch (err) {
        if (window.SitriforUI) window.SitriforUI.showToast(err.message, 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  bindForm('[data-form-callback]', 'callback');
  bindForm('[data-form-partnership]', 'partnership');
})();
