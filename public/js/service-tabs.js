(function () {
  'use strict';

  var HASH_MAP = {
    app: 'app',
    masters: 'app',
    calculator: 'calculator',
    care: 'care'
  };

  var root = document.querySelector('[data-service-tabs]');
  if (!root) return;

  var tabs = root.querySelectorAll('[data-service-tab]');
  var panels = root.querySelectorAll('[data-service-panel]');

  function activateTab(id, updateHash) {
    var found = false;
    tabs.forEach(function (tab) {
      var tabId = tab.getAttribute('data-service-tab');
      var active = tabId === id;
      if (active) found = true;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (!found) return;

    panels.forEach(function (panel) {
      var active = panel.getAttribute('data-service-panel') === id;
      panel.classList.toggle('is-active', active);
      panel.hidden = !active;
    });

    if (updateHash && window.history && window.history.replaceState) {
      window.history.replaceState(null, '', '#' + id);
    }

    if (window.sfMetrika) {
      if (id === 'care') window.sfMetrika.goalOnce('care_use', { source: 'tab' });
      if (id === 'calculator') window.sfMetrika.goalOnce('calc_open', { source: 'tab' });
      if (id === 'app') window.sfMetrika.goalOnce('app634_tab', { source: 'tab' });
    }
  }

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      activateTab(tab.getAttribute('data-service-tab'), true);
    });
  });

  function resolveHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var tabId = HASH_MAP[hash] || hash;
    if (root.querySelector('[data-service-tab="' + tabId + '"]')) {
      activateTab(tabId, false);
    }
  }

  resolveHash();
  window.addEventListener('hashchange', resolveHash);
})();
