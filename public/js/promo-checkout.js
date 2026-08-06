/* Promo purchase checkout + PDF helpers + calc chart */

(function () {
  'use strict';

  /* ——— Promo checkout ——— */
  var promoForm = document.querySelector('[data-promo-checkout]');
  if (promoForm) {
    var stepEls = document.querySelectorAll('[data-promo-step]');
    var barEls = document.querySelectorAll('[data-promo-bar] span');
    var priceEl = document.querySelector('[data-promo-price]');
    var errEl = document.querySelector('[data-promo-error]');
    var codeOut = document.querySelector('[data-promo-code-out]');
    var state = { step: 1, name: '', email: '', phone: '', amountRub: 990 };

    fetch('/api/promo/price')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.amountRub) {
          state.amountRub = d.amountRub;
          if (priceEl) priceEl.textContent = d.amountRub.toLocaleString('ru-RU') + ' ₽';
        }
      })
      .catch(function () {});

    function showStep(n) {
      state.step = n;
      stepEls.forEach(function (el) {
        el.hidden = Number(el.getAttribute('data-promo-step')) !== n;
      });
      barEls.forEach(function (el, i) {
        el.classList.toggle('is-active', i < n);
      });
      if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
    }

    var nextBtn = document.querySelector('[data-promo-next]');
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        var name = promoForm.querySelector('[name="name"]').value.trim();
        var email = promoForm.querySelector('[name="email"]').value.trim();
        var phone = promoForm.querySelector('[name="phone"]').value.trim();
        if (name.length < 2 || !email.includes('@') || phone.replace(/\D/g, '').length < 11) {
          if (errEl) {
            errEl.textContent = 'Заполните имя, email и телефон.';
            errEl.hidden = false;
          }
          return;
        }
        state.name = name;
        state.email = email;
        state.phone = phone;
        showStep(2);
      });
    }

    var payBtn = document.querySelector('[data-promo-pay]');
    if (payBtn) {
      payBtn.addEventListener('click', async function () {
        payBtn.disabled = true;
        try {
          var res = await fetch('/api/promo/purchase', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
              name: state.name,
              email: state.email,
              phone: state.phone
            })
          });
          var data = await res.json().catch(function () { return {}; });
          if (!res.ok) throw new Error(data.message || 'Оплата не прошла');
          if (codeOut) codeOut.textContent = data.code;
          showStep(3);
          if (window.SitriforUI) window.SitriforUI.showToast('Промокод сохранён', 'success');
        } catch (err) {
          if (errEl) {
            errEl.textContent = err.message;
            errEl.hidden = false;
          }
        } finally {
          payBtn.disabled = false;
        }
      });
    }

    document.querySelectorAll('[data-promo-back]').forEach(function (btn) {
      btn.addEventListener('click', function () { showStep(1); });
    });

    // reset on open
    document.querySelectorAll('[data-modal-open="modal-promo-buy"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        promoForm.reset();
        showStep(1);
      });
    });
  }
})();
