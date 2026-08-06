(function () {
  'use strict';

  var form = document.querySelector('[data-promo-email]');
  if (!form) return;

  var scope = form.closest('.app634-hero__copy') || form.parentElement || document;
  var errorEl = scope.querySelector('[data-promo-email-error]');
  var successEl = scope.querySelector('[data-promo-email-success]');
  var codeEl = scope.querySelector('[data-promo-email-code]');

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    errorEl.hidden = true;
    successEl.hidden = true;
    codeEl.hidden = true;

    var email = form.querySelector('[name="email"]').value.trim();
    var btn = form.querySelector('[type="submit"]');
    btn.disabled = true;

    try {
      var response = await fetch('/api/promo/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email: email })
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(data.message || 'Не удалось получить промокод');

      successEl.textContent = 'Промокод отправлен на ' + email;
      successEl.hidden = false;
      if (data.code) {
        codeEl.textContent = 'Ваш код: ' + data.code;
        codeEl.hidden = false;
      }
      form.querySelector('[name="email"]').value = '';
      if (window.sfMetrika) window.sfMetrika.goal('app634_promo_email');
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });
})();
