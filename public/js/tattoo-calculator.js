/**
 * Sitrifor tattoo calculator — roadmap of sessions, cost and timeline.
 *
 * Pricing rule: every session costs hours × hourly rate (transparent).
 * Total = sum(session prices) = totalHours × hourly.
 * Currency follows UI language: RU→₽, EN→$, DE→€.
 */
(function () {
  'use strict';

  var FX = {
    // Approximate mid-market anchors for estimate conversion
    RUB_PER_USD: 90,
    RUB_PER_EUR: 98
  };

  var CURRENCY = {
    ru: { code: 'RUB', symbol: '₽', locale: 'ru-RU', defaultHourly: 5000, minHourly: 500, step: 100 },
    en: { code: 'USD', symbol: '$', locale: 'en-US', defaultHourly: 60, minHourly: 15, step: 5 },
    de: { code: 'EUR', symbol: '€', locale: 'de-DE', defaultHourly: 55, minHourly: 15, step: 5 }
  };

  /** Relative work difficulty (time multiplier) by zone */
  var ZONE_DIFFICULTY = {
    face: 1.55, neck_front: 1.45, neck_back: 1.4, neck: 1.42,
    chest: 1.25, ribs: 1.4, stomach: 1.2, hip: 1.15,
    shoulder_l: 1.12, shoulder_r: 1.12,
    upper_arm_l: 1.0, upper_arm_r: 1.0,
    forearm_l: 1.08, forearm_r: 1.08,
    hand_l: 1.35, hand_r: 1.35,
    thigh_l: 1.05, thigh_r: 1.05,
    knee_l: 1.28, knee_r: 1.28,
    calf_l: 1.12, calf_r: 1.12,
    foot_l: 1.38, foot_r: 1.38,
    back_upper: 1.22, back_lower: 1.2, glute: 1.18,
    arm: 1.05, leg: 1.1, back: 1.22, hand: 1.3
  };

  /** Typical pain 1–10 by zone (industry-typical averages) */
  var ZONE_PAIN = {
    face: 9, neck_front: 9, neck_back: 8, neck: 9,
    chest: 8, ribs: 10, stomach: 8, hip: 7,
    shoulder_l: 5, shoulder_r: 5,
    upper_arm_l: 3, upper_arm_r: 3,
    forearm_l: 4, forearm_r: 4,
    hand_l: 8, hand_r: 8,
    thigh_l: 4, thigh_r: 4,
    knee_l: 7, knee_r: 7,
    calf_l: 5, calf_r: 5,
    foot_l: 8, foot_r: 8,
    back_upper: 5, back_lower: 6, glute: 5,
    arm: 4, leg: 5, back: 5, hand: 8
  };

  var ZONE_FULL_AREA = {
    face: 160, neck_front: 70, neck_back: 80, neck: 75,
    chest: 520, ribs: 280, stomach: 400, hip: 260,
    shoulder_l: 180, shoulder_r: 180,
    upper_arm_l: 220, upper_arm_r: 220,
    forearm_l: 180, forearm_r: 180,
    hand_l: 90, hand_r: 90,
    thigh_l: 450, thigh_r: 450,
    knee_l: 120, knee_r: 120,
    calf_l: 280, calf_r: 280,
    foot_l: 100, foot_r: 100,
    back_upper: 600, back_lower: 350, glute: 320,
    arm: 220, leg: 400, back: 550, hand: 90
  };

  var SIZE_PRESETS = {
    small: { area: 30, width: 5, height: 6 },
    medium: { area: 120, width: 10, height: 12 },
    large: { area: 280, width: 14, height: 20 },
    full: { area: null, width: null, height: null }
  };

  var ENGINE = {
    // Productive skin work (cm² per hour) at difficulty 1.0, low complexity
    baseCmPerHour: 32,
    // Soft setup once (consultation + stencil) added to session 1 only
    setupHours: 0.5,
    // Comfortable session length band (low pain / easy zones)
    minSessionHours: 1.0,
    maxSessionHoursComfort: 5.5,
    // Healing gap between sessions
    baseHealDays: 18,
    // Hard ceiling only for absurd estimates — never used to lengthen sittings
    maxSessions: 100
  };

  var form = document.querySelector('[data-calc-form]');
  if (!form) return;

  var painRange = form.querySelector('[data-calc-pain]');
  var painVal = form.querySelector('[data-calc-pain-val]');
  var painHint = form.querySelector('[data-calc-pain-hint]');
  var chartCanvas = document.querySelector('[data-calc-chart]');
  var listEl = document.querySelector('[data-calc-session-list]');
  var totalEl = document.querySelector('[data-calc-total]');
  var metaEl = document.querySelector('[data-calc-chart-meta]');
  var pdfButtons = document.querySelectorAll('[data-calc-pdf]');
  var locationInput = form.querySelector('[data-calc-location]');
  var hourlyInput = form.querySelector('[name="hourly_rate"]');
  var lastPlan = null;
  var chart = null;
  var ready = false;
  var painManual = false;
  var currencyCode = 'RUB';

  function tt(key, vars) {
    if (window.SitriforI18n && window.SitriforI18n.t) return window.SitriforI18n.t(key, vars);
    return key;
  }

  function uiLang() {
    if (window.SitriforI18n && window.SitriforI18n.getLang) return window.SitriforI18n.getLang();
    return 'ru';
  }

  function currencyCfg() {
    return CURRENCY[uiLang()] || CURRENCY.ru;
  }

  function toRub(amount, fromCode) {
    if (fromCode === 'RUB') return amount;
    if (fromCode === 'USD') return amount * FX.RUB_PER_USD;
    if (fromCode === 'EUR') return amount * FX.RUB_PER_EUR;
    return amount;
  }

  function fromRub(amountRub, toCode) {
    if (toCode === 'RUB') return amountRub;
    if (toCode === 'USD') return amountRub / FX.RUB_PER_USD;
    if (toCode === 'EUR') return amountRub / FX.RUB_PER_EUR;
    return amountRub;
  }

  function roundMoney(n, cfg) {
    if (cfg.code === 'RUB') return Math.round(n / 10) * 10;
    return Math.round(n);
  }

  function roundHours(h) {
    return Math.round(h * 2) / 2;
  }

  function money(n, cfg) {
    cfg = cfg || currencyCfg();
    var v = roundMoney(n, cfg);
    var formatted = v.toLocaleString(cfg.locale);
    if (cfg.code === 'USD') return cfg.symbol + formatted;
    if (cfg.code === 'EUR') return formatted + ' ' + cfg.symbol;
    return formatted + ' ' + cfg.symbol;
  }

  function hoursLabel(h) {
    return tt('calc.hours.unit', { h: h });
  }

  function zoneLabel(key) {
    var tr = tt('zone.' + key);
    if (tr && tr !== 'zone.' + key) return tr;
    return key;
  }

  function sizePresetLabel(sizeClass) {
    var map = { small: 'calc.size.small', medium: 'calc.size.medium', large: 'calc.size.large', full: 'calc.size.full' };
    var k = map[sizeClass];
    if (k) {
      var tr = tt(k);
      if (tr && tr !== k) return tr;
    }
    return sizeClass;
  }

  function currentLocations() {
    if (window.SitriforBodyMap && window.SitriforBodyMap.getSelected) {
      var fromMap = window.SitriforBodyMap.getSelected();
      if (fromMap && fromMap.length) return fromMap;
    }
    var raw = locationInput ? locationInput.value : 'upper_arm_l';
    return String(raw || 'upper_arm_l').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function suggestedPain(locs) {
    var list = locs && locs.length ? locs : ['upper_arm_l'];
    var sum = 0;
    list.forEach(function (z) { sum += ZONE_PAIN[z] || 5; });
    // Bias toward the most painful selected zone
    var max = maxZonePain(list);
    var avg = sum / list.length;
    return Math.max(1, Math.min(10, Math.round(avg * 0.35 + max * 0.65)));
  }

  function maxZonePain(locs) {
    var list = locs && locs.length ? locs : ['upper_arm_l'];
    var max = 1;
    list.forEach(function (z) { max = Math.max(max, ZONE_PAIN[z] || 5); });
    return max;
  }

  /**
   * Max productive hours in one sitting.
   * Takes the stricter of: client pain tolerance AND inherent zone pain.
   * High pain / ribs / neck must never produce 5–6h sessions.
   */
  function maxSessionHoursFor(pain, locs, allergy) {
    var clientPain = Math.max(1, Math.min(10, pain || 5));
    // pain 1 → ~6.0h, pain 5 → ~3.8h, pain 8 → ~2.15h, pain 10 → ~1.55h
    var byClient = 6.5 - (clientPain - 1) * 0.55;

    var zonePain = maxZonePain(locs);
    // ribs/neck (9–10) → ~2.15–2.6h even if client claims low sensitivity
    var byZone = 6.2 - (zonePain - 1) * 0.45;

    var maxH = Math.min(byClient, byZone);
    if (allergy) maxH *= 0.9;

    var minH = minSessionHoursFor(clientPain, locs);
    return Math.max(minH, Math.min(ENGINE.maxSessionHoursComfort, maxH));
  }

  function minSessionHoursFor(pain, locs) {
    var clientPain = Math.max(1, Math.min(10, pain || 5));
    var zonePain = maxZonePain(locs);
    if (clientPain >= 9 || zonePain >= 9) return 1.0;
    if (clientPain >= 7 || zonePain >= 7) return 1.25;
    return 1.5;
  }

  function locationDifficulty(locs) {
    var list = locs && locs.length ? locs : ['upper_arm_l'];
    var sum = 0;
    var areaSum = 0;
    list.forEach(function (z) {
      var a = ZONE_FULL_AREA[z] || 200;
      var d = ZONE_DIFFICULTY[z] || 1;
      sum += d * a;
      areaSum += a;
    });
    var weighted = areaSum ? sum / areaSum : 1;
    // Multi-zone continuity overhead
    if (list.length > 1) weighted *= 1 + 0.04 * (list.length - 1);
    return weighted;
  }

  function selectedSizeClass() {
    var checked = form.querySelector('[name="size_class"]:checked');
    return (checked && checked.value) || 'medium';
  }

  function syncSizeClassUi() {
    Array.prototype.forEach.call(form.querySelectorAll('.calc-size__opt'), function (label) {
      var input = label.querySelector('input');
      label.classList.toggle('is-active', !!(input && input.checked));
    });
  }

  function resolveSize(locs) {
    var sizeClass = selectedSizeClass();
    var preset = SIZE_PRESETS[sizeClass] || SIZE_PRESETS.medium;
    var loc = (locs && locs[0]) || 'upper_arm_l';

    if (sizeClass === 'full') {
      var list = locs && locs.length ? locs : [loc];
      var fullArea = 0;
      list.forEach(function (z, i) {
        var a = ZONE_FULL_AREA[z] || 300;
        fullArea += i === 0 ? a : a * 0.85;
      });
      fullArea = Math.round(fullArea);
      var side = Math.round(Math.sqrt(fullArea) * 10) / 10;
      return {
        sizeClass: sizeClass,
        sizeLabel: sizePresetLabel(sizeClass),
        width: side,
        height: side,
        area: fullArea,
        exact: false
      };
    }

    return {
      sizeClass: sizeClass,
      sizeLabel: sizePresetLabel(sizeClass),
      width: preset.width,
      height: preset.height,
      area: preset.area,
      exact: false
    };
  }

  function syncCurrencyUi(prevCode) {
    var cfg = currencyCfg();
    var nextCode = cfg.code;
    if (hourlyInput) {
      var current = parseFloat(hourlyInput.value);
      if (!isFinite(current) || current <= 0) current = CURRENCY.ru.defaultHourly;
      if (prevCode && prevCode !== nextCode) {
        var rub = toRub(current, prevCode);
        current = fromRub(rub, nextCode);
      } else if (!prevCode && currencyCode !== nextCode) {
        // initial boot into non-RUB UI
        current = cfg.defaultHourly;
      }
      current = roundMoney(current, cfg);
      if (current < cfg.minHourly) current = cfg.minHourly;
      hourlyInput.value = String(current);
      hourlyInput.min = String(cfg.minHourly);
      hourlyInput.step = String(cfg.step);
    }
    currencyCode = nextCode;
  }

  function syncPainFromZones(force) {
    if (!painRange) return;
    if (painManual && !force) return;
    var pain = suggestedPain(currentLocations());
    painRange.value = String(pain);
    if (painVal) painVal.textContent = String(pain);
    if (painHint) {
      painHint.textContent = tt('calc.pain.hintAuto', { pain: pain });
      painHint.hidden = false;
    }
  }

  function buildPlan() {
    var cfg = currencyCfg();
    var hourly = parseFloat(hourlyInput && hourlyInput.value) || cfg.defaultHourly;
    if (hourly < cfg.minHourly) hourly = cfg.minHourly;

    var locs = currentLocations();
    if (!locs.length) locs = ['upper_arm_l'];
    var size = resolveSize(locs);
    var hasTattoo = !!(form.querySelector('[name="has_tattoo"]') || {}).checked;
    var moles = !!(form.querySelector('[name="moles"]') || {}).checked;
    var allergy = !!(form.querySelector('[name="allergy"]') || {}).checked;
    var pain = parseInt(painRange ? painRange.value : suggestedPain(locs), 10);
    if (!isFinite(pain)) pain = 5;

    var difficulty = locationDifficulty(locs);
    var complexity = 1
      + (hasTattoo ? 0.18 : 0)   // cover-up / existing ink
      + (moles ? 0.1 : 0)        // careful contouring
      + (allergy ? 0.12 : 0);    // slower, more breaks

    // High pain / hard zones: slower needle pace + more breaks → more total hours
    var painPace = 1 + Math.max(0, pain - 5) * 0.06 + Math.max(0, maxZonePain(locs) - 5) * 0.03;
    var cmPerHour = ENGINE.baseCmPerHour / (difficulty * complexity * Math.max(0.9, painPace));

    var minPerSession = minSessionHoursFor(pain, locs);
    var maxPerSession = maxSessionHoursFor(pain, locs, allergy);
    var workHours = Math.max(minPerSession, size.area / cmPerHour);

    // Split by endurance limit — never lengthen sittings to fit a session-count cap
    var sessionsCount = Math.max(1, Math.ceil(workHours / maxPerSession));
    if (sessionsCount > ENGINE.maxSessions) sessionsCount = ENGINE.maxSessions;

    var workPerSession = workHours / sessionsCount;
    // Endurance always wins: prefer truncating the roadmap over 5–6h sittings
    if (workPerSession > maxPerSession) {
      workPerSession = maxPerSession;
    }

    var sessions = [];
    var totalHours = 0;
    var totalPrice = 0;
    var scheduledWork = workPerSession * sessionsCount;
    var cumWork = 0;

    for (var i = 0; i < sessionsCount; i += 1) {
      var needleHours = Math.min(maxPerSession, Math.max(minPerSession, workPerSession));
      var hours = roundHours(needleHours + (i === 0 ? ENGINE.setupHours : 0));
      // Setup may slightly exceed endurance on session 1 only; never exceed max+setup
      var hardCap = roundHours(maxPerSession + (i === 0 ? ENGINE.setupHours : 0));
      if (hours > hardCap) hours = hardCap;
      if (hours < minPerSession) hours = minPerSession;

      var price = roundMoney(hours * hourly, cfg);
      totalHours += hours;
      totalPrice += price;
      cumWork += workPerSession;
      var donePct = Math.min(100, Math.round((cumWork / scheduledWork) * 100));
      if (i === sessionsCount - 1) donePct = 100;

      var zonePain = maxZonePain(locs);
      var healExtra = Math.round(
        (pain - 5) * 1.2 +
        Math.max(0, zonePain - 6) * 0.8 +
        (allergy ? 4 : 0) +
        (hasTattoo ? 2 : 0)
      );
      var dayOffset = i * Math.max(14, ENGINE.baseHealDays + healExtra);

      sessions.push({
        index: i + 1,
        label: tt('calc.session.label', { n: i + 1 }),
        dayOffset: dayOffset,
        when: i === 0 ? tt('calc.session.start') : tt('calc.session.after', { days: dayOffset }),
        hours: hours,
        price: price,
        donePct: donePct,
        note: i === 0 ? tt('calc.session.includesSetup') : ''
      });
    }

    // Tiny rounding drift: keep last session absorbing money delta so sum == hours×rate visually consistent
    var expected = roundMoney(totalHours * hourly, cfg);
    var drift = expected - totalPrice;
    if (sessions.length && Math.abs(drift) >= 1) {
      sessions[sessions.length - 1].price = roundMoney(sessions[sessions.length - 1].price + drift, cfg);
      totalPrice = expected;
    }

    var spanDays = sessions.length > 1 ? sessions[sessions.length - 1].dayOffset : 0;

    return {
      width: size.width,
      height: size.height,
      sizeClass: size.sizeClass,
      sizeLabel: size.sizeLabel,
      exactSize: size.exact,
      location: locs.join(','),
      locations: locs,
      locationLabels: locs.map(zoneLabel),
      gender: (form.querySelector('[name="body_gender"]') || {}).value || 'male',
      hourlyRate: hourly,
      currency: cfg.code,
      currencySymbol: cfg.symbol,
      locale: cfg.locale,
      area: size.area,
      total: totalPrice,
      sessions: sessions,
      sessionHours: roundHours(totalHours / sessions.length),
      hoursNeeded: roundHours(totalHours),
      workHours: roundHours(workHours),
      pain: pain,
      painSuggested: suggestedPain(locs),
      difficulty: Math.round(difficulty * 100) / 100,
      complexity: Math.round(complexity * 100) / 100,
      cmPerHour: Math.round(cmPerHour * 10) / 10,
      spanDays: spanDays,
      factors: {
        hasTattoo: hasTattoo,
        moles: moles,
        allergy: allergy
      }
    };
  }

  function renderList(plan) {
    if (!listEl) return;
    listEl.innerHTML = plan.sessions.map(function (s) {
      var note = s.note ? '<span class="calc-sessions__note">' + s.note + '</span>' : '';
      return '<li><span class="calc-sessions__n">' + s.label + '</span>' +
        '<span class="calc-sessions__when">' + s.when + ' · ' + hoursLabel(s.hours) + note + '</span>' +
        '<span class="calc-sessions__price">' + money(s.price, currencyCfg()) + '</span></li>';
    }).join('');
  }

  function renderChart(plan) {
    if (!chartCanvas || typeof window.Chart === 'undefined') return;
    var panel = document.getElementById('calculator');
    if (panel && panel.hidden) return;

    var labels = plan.sessions.map(function (s) { return s.label; });
    var data = plan.sessions.map(function (s) { return s.price; });
    var doneData = plan.sessions.map(function (s) { return s.donePct; });
    var cfg = currencyCfg();
    try {
      if (chart) chart.destroy();
      chart = new Chart(chartCanvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            {
              type: 'bar',
              label: tt('calc.chart.datasetLabel'),
              data: data,
              backgroundColor: 'rgba(255, 214, 10, 0.75)',
              borderColor: '#FFD60A',
              borderWidth: 1,
              borderRadius: 8,
              maxBarThickness: plan.sessions.length > 20 ? 18 : 48,
              yAxisID: 'y',
              order: 2
            },
            {
              type: 'line',
              label: tt('calc.chart.doneLabel'),
              data: doneData,
              borderColor: 'rgba(255, 255, 255, 0.92)',
              backgroundColor: 'rgba(255, 255, 255, 0.12)',
              borderWidth: 2.5,
              pointRadius: plan.sessions.length > 24 ? 2 : 4,
              pointHoverRadius: 6,
              pointBackgroundColor: '#FFD60A',
              pointBorderColor: '#111',
              pointBorderWidth: 1,
              tension: 0.28,
              fill: false,
              yAxisID: 'yPct',
              order: 1
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: ready,
          interaction: { mode: 'index', intersect: false },
          layout: { padding: { top: 8, bottom: 4 } },
          plugins: {
            legend: {
              display: true,
              position: 'bottom',
              align: 'center',
              labels: {
                color: 'rgba(255,255,255,0.7)',
                boxWidth: 12,
                boxHeight: 12,
                padding: 14,
                font: { size: 11, weight: '600' }
              }
            },
            tooltip: {
              callbacks: {
                label: function (ctx) {
                  var s = plan.sessions[ctx.dataIndex];
                  if (ctx.dataset.yAxisID === 'yPct') {
                    var pct = s ? s.donePct : ctx.parsed.y;
                    return tt('calc.chart.doneTooltip', { pct: pct });
                  }
                  var line = money(ctx.parsed.y, cfg);
                  if (s) line += ' · ' + hoursLabel(s.hours);
                  return line;
                }
              }
            }
          },
          scales: {
            x: {
              ticks: { color: 'rgba(255,255,255,0.55)' },
              grid: { color: 'rgba(255,255,255,0.06)' }
            },
            y: {
              beginAtZero: true,
              position: 'left',
              ticks: {
                color: 'rgba(255,255,255,0.55)',
                callback: function (v) {
                  if (cfg.code === 'RUB') return (v / 1000) + 'k';
                  return cfg.symbol + v;
                }
              },
              grid: { color: 'rgba(255,255,255,0.06)' }
            },
            yPct: {
              beginAtZero: true,
              min: 0,
              max: 124,
              position: 'right',
              ticks: {
                color: 'rgba(255,255,255,0.55)',
                stepSize: 25,
                callback: function (v) {
                  if (v > 100) return '';
                  return v + '%';
                }
              },
              grid: { drawOnChartArea: false }
            }
          }
        },
        plugins: [{
          id: 'donePctLabels',
          afterDatasetsDraw: function (c) {
            var dsIndex = c.data.datasets.findIndex(function (d) { return d.yAxisID === 'yPct'; });
            if (dsIndex < 0) return;
            var meta = c.getDatasetMeta(dsIndex);
            var area = c.chartArea;
            var n = doneData.length;
            // Thin out labels as session count grows: every 1st, 2nd, 3rd…
            var step = 1;
            if (n > 8) step = 2;
            if (n > 14) step = 3;
            if (n > 24) step = 4;
            if (n > 36) step = 5;
            if (n > 48) step = 6;
            if (n > 64) step = Math.max(7, Math.ceil(n / 12));

            var ctx2 = c.ctx;
            var gap = 8;
            ctx2.save();
            ctx2.beginPath();
            ctx2.rect(area.left, area.top, area.right - area.left, area.bottom - area.top);
            ctx2.clip();
            ctx2.font = '700 11px system-ui, sans-serif';
            ctx2.fillStyle = 'rgba(255,255,255,0.9)';
            ctx2.textAlign = 'center';
            ctx2.textBaseline = 'bottom';
            meta.data.forEach(function (pt, i) {
              if (!pt || pt.skip) return;
              var pct = doneData[i];
              if (pct == null) return;
              var isFirst = i === 0;
              var isLast = i === n - 1;
              var onStep = ((i + 1) % step) === 0;
              if (!isFirst && !isLast && !onStep) return;
              // Always above the line; clamp into plot so labels never leave the chart
              var y = Math.max(area.top + 12, pt.y - gap);
              ctx2.fillText(pct + '%', pt.x, y);
            });
            ctx2.restore();
          }
        }]
      });
    } catch (err) {
      console.warn('chart render failed', err);
    }
  }

  function trackCalcUse(plan) {
    if (!plan) return;
    var zones = plan.locationLabels && plan.locationLabels.length;
    if (!zones) return;
    if (window.sfMetrika) {
      window.sfMetrika.goalOnce('calc_use', {
        zones: plan.locationLabels.join(','),
        total: plan.total
      });
    }
  }

  function calculate() {
    var plan = buildPlan();
    lastPlan = plan;
    trackCalcUse(plan);
    var cfg = currencyCfg();
    if (totalEl) totalEl.textContent = money(plan.total, cfg);
    if (metaEl) {
      var sizeTxt = plan.sizeClass === 'full'
        ? plan.sizeLabel
        : tt('calc.meta.sizeApprox', { label: plan.sizeLabel, area: plan.area });
      metaEl.textContent = tt('calc.meta.summary', {
        n: plan.sessions.length,
        hours: plan.hoursNeeded,
        rate: plan.hourlyRate.toLocaleString(cfg.locale),
        currency: cfg.symbol,
        size: sizeTxt,
        zones: plan.locationLabels.join(', ') || tt('calc.meta.zoneFallback'),
        days: plan.spanDays,
        pain: plan.pain
      });
    }
    renderList(plan);
    renderChart(plan);
  }

  if (painRange && painVal) {
    painRange.addEventListener('input', function () {
      painManual = true;
      painVal.textContent = painRange.value;
      if (painHint) {
        painHint.textContent = tt('calc.pain.hintManual');
        painHint.hidden = false;
      }
      calculate();
    });
  }

  Array.prototype.forEach.call(form.querySelectorAll('[name="size_class"]'), function (input) {
    input.addEventListener('change', syncSizeClassUi);
  });

  form.querySelectorAll('input, select').forEach(function (el) {
    el.addEventListener('input', function () {
      if (el === locationInput || el.getAttribute('data-calc-location') != null) {
        syncPainFromZones(false);
      }
      calculate();
    });
    el.addEventListener('change', function () {
      if (el === locationInput || el.getAttribute('data-calc-location') != null) {
        syncPainFromZones(false);
      }
      calculate();
    });
  });

  if (locationInput) {
    locationInput.addEventListener('change', function () {
      syncPainFromZones(false);
      calculate();
    });
  }

  syncSizeClassUi();
  syncCurrencyUi(null);
  syncPainFromZones(true);

  function setPdfButtonsDisabled(disabled) {
    Array.prototype.forEach.call(pdfButtons, function (btn) {
      btn.disabled = disabled;
    });
  }

  async function exportCalcPdf() {
    if (!lastPlan) calculate();
    setPdfButtonsDisabled(true);
    try {
      if (window.SitriforPDF && window.SitriforPDF.exportCalc) {
        var bodyShot = null;
        if (window.SitriforBodyMap && typeof window.SitriforBodyMap.captureSnapshot === 'function') {
          bodyShot = window.SitriforBodyMap.captureSnapshot();
        }
        await window.SitriforPDF.exportCalc(lastPlan, chartCanvas, bodyShot);
        if (window.SitriforUI) window.SitriforUI.showToast(tt('toast.pdfSaved'), 'success');
      }
    } catch (err) {
      console.error(err);
      if (window.SitriforUI) window.SitriforUI.showToast(err.message || tt('toast.pdfError'), 'error');
    } finally {
      setPdfButtonsDisabled(false);
    }
  }

  Array.prototype.forEach.call(pdfButtons, function (btn) {
    btn.addEventListener('click', function () {
      exportCalcPdf();
    });
  });

  var calcTab = document.querySelector('[data-service-tab="calculator"]');
  if (calcTab) {
    calcTab.addEventListener('click', function () {
      window.setTimeout(function () {
        ready = true;
        calculate();
        if (chart) chart.resize();
      }, 50);
    });
  }

  document.addEventListener('sitrifor:langchange', function () {
    var prev = currencyCode;
    syncCurrencyUi(prev);
    // Re-apply i18n labels that include currency symbol via data-i18n
    if (window.SitriforI18n && window.SitriforI18n.apply) window.SitriforI18n.apply(form);
    calculate();
  });

  window.addEventListener('hashchange', function () {
    if (window.location.hash.replace(/^#/, '') === 'calculator') {
      window.setTimeout(function () {
        ready = true;
        calculate();
      }, 50);
    }
  });

  calculate();
  if (window.location.hash.replace(/^#/, '') === 'calculator') {
    ready = true;
    window.setTimeout(calculate, 80);
  }

  window.SitriforCalc = {
    buildPlan: buildPlan,
    money: money,
    getPlan: function () { return lastPlan; }
  };
})();
