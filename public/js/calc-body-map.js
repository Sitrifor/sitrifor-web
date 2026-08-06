/**
 * Pixel-perfect body map: body photo + mask picking + clean pattern paint.
 */
(function () {
  'use strict';

  var mount = document.querySelector('[data-calc-body-mount]');
  if (!mount) return;

  var META = window.SitriforBodyMaskMeta;
  if (!META) {
    mount.innerHTML = '<p class="calc-body__hint">Не удалось загрузить маски зон.</p>';
    return;
  }

  var LABELS = (META.labels) || {
    face: 'Лицо', neck_front: 'Шея спереди', neck_back: 'Шея сзади',
    chest: 'Грудь', ribs: 'Рёбра', stomach: 'Живот', hip: 'Пояс',
    shoulder_l: 'Плечо Л', shoulder_r: 'Плечо П',
    upper_arm_l: 'Бицепс Л', upper_arm_r: 'Бицепс П',
    forearm_l: 'Предплечье Л', forearm_r: 'Предплечье П',
    hand_l: 'Кисть Л', hand_r: 'Кисть П',
    thigh_l: 'Бедро Л', thigh_r: 'Бедро П',
    knee_l: 'Колено Л', knee_r: 'Колено П',
    calf_l: 'Голень Л', calf_r: 'Голень П',
    foot_l: 'Стопа Л', foot_r: 'Стопа П',
    back_upper: 'Верх спины', back_lower: 'Поясница', glute: 'Ягодицы'
  };

  var selected = [];
  var gender = 'male';
  var views = {}; // key gender-view -> {img, paint, maskData, w, h}

  var locationInput = document.querySelector('[data-calc-location]');
  var genderInput = document.querySelector('[data-calc-gender]');
  var chipsEl = document.querySelector('[data-calc-body-chips]');

  function rgbKey(r, g, b) { return r + ',' + g + ',' + b; }

  var colorToZone = {};
  var paletteList = [];
  META.zones.forEach(function (z) {
    var p = META.palette[z];
    if (!p) return;
    colorToZone[rgbKey(p[0], p[1], p[2])] = z;
    paletteList.push({ id: z, rgb: p });
  });

  function nearestZone(r, g, b) {
    if (r < 8 && g < 8 && b < 8) return null;
    var exact = colorToZone[rgbKey(r, g, b)];
    if (exact) return exact;
    var best = null;
    var bestD = 40; // max distance
    paletteList.forEach(function (p) {
      var dr = r - p.rgb[0];
      var dg = g - p.rgb[1];
      var db = b - p.rgb[2];
      var d = dr * dr + dg * dg + db * db;
      if (d < bestD) {
        bestD = d;
        best = p.id;
      }
    });
    return best;
  }

  function snapMaskData(imageData) {
    var d = imageData.data;
    var i, z, p;
    for (i = 0; i < d.length; i += 4) {
      z = nearestZone(d[i], d[i + 1], d[i + 2]);
      if (!z) {
        d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = 0;
        continue;
      }
      p = META.palette[z];
      d[i] = p[0]; d[i + 1] = p[1]; d[i + 2] = p[2]; d[i + 3] = 255;
    }
    return imageData;
  }

  function zoneHasPixels(maskData, zoneId) {
    var rgb = META.palette[zoneId];
    if (!rgb) return false;
    var d = maskData.data;
    var i;
    for (i = 0; i < d.length; i += 4) {
      if (d[i] === rgb[0] && d[i + 1] === rgb[1] && d[i + 2] === rgb[2]) return true;
    }
    return false;
  }

  function patternFill(ctx, type, w, h) {
    ctx.fillStyle = 'rgba(255, 214, 10, 0.12)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255, 214, 10, 0.95)';
    ctx.lineWidth = 1.25;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    var step = 28;
    var x, y, i;
    if (type === 'geo') {
      for (y = 0; y < h + step; y += step) {
        for (x = 0; x < w + step; x += step) {
          ctx.beginPath();
          ctx.moveTo(x + 10, y);
          ctx.lineTo(x + 20, y + 10);
          ctx.lineTo(x + 10, y + 20);
          ctx.lineTo(x, y + 10);
          ctx.closePath();
          ctx.stroke();
        }
      }
    } else if (type === 'wave') {
      for (y = 10; y < h; y += 16) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        for (x = 0; x <= w; x += 12) {
          ctx.quadraticCurveTo(x + 6, y + ((x / 12) % 2 ? -7 : 7), x + 12, y);
        }
        ctx.stroke();
      }
    } else if (type === 'floral') {
      for (y = 12; y < h; y += 26) {
        for (x = 12; x < w; x += 26) {
          for (i = 0; i < 4; i++) {
            ctx.beginPath();
            ctx.ellipse(x, y, 7, 3.5, (Math.PI / 2) * i, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.beginPath();
          ctx.arc(x, y, 1.6, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,214,10,0.9)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(255, 214, 10, 0.95)';
        }
      }
    } else if (type === 'dotwork') {
      ctx.fillStyle = 'rgba(255,214,10,0.9)';
      for (y = 6; y < h; y += 10) {
        for (x = 6 + (y % 20 === 6 ? 0 : 5); x < w; x += 10) {
          ctx.beginPath();
          ctx.arc(x, y, 1.3 + ((x + y) % 5) * 0.25, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (type === 'scale') {
      for (y = 0; y < h + step; y += 14) {
        for (x = (y / 14) % 2 ? 8 : 0; x < w + step; x += 16) {
          ctx.beginPath();
          ctx.arc(x, y, 9, Math.PI, 0);
          ctx.stroke();
        }
      }
    } else {
      // ornamental
      for (y = 8; y < h; y += 22) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        for (x = 0; x <= w; x += 18) {
          ctx.quadraticCurveTo(x + 9, y - 10, x + 18, y);
        }
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, y + 8);
        for (x = 0; x <= w; x += 18) {
          ctx.quadraticCurveTo(x + 9, y + 18, x + 18, y + 8);
        }
        ctx.stroke();
      }
    }
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = reject;
      img.src = src;
    });
  }

  /** Match overlay to the letterboxed object-fit:contain image box. */
  function syncPaintToImage(v) {
    if (!v || !v.img || !v.paint || !v.frame) return;
    var img = v.img;
    var nw = img.naturalWidth || META.width;
    var nh = img.naturalHeight || META.height;
    var cw = img.clientWidth;
    var ch = img.clientHeight;
    if (cw < 1 || ch < 1 || nw < 1 || nh < 1) return;
    var scale = Math.min(cw / nw, ch / nh);
    var dw = nw * scale;
    var dh = nh * scale;
    var left = (cw - dw) / 2;
    var top = (ch - dh) / 2;
    v.paint.style.left = left + 'px';
    v.paint.style.top = top + 'px';
    v.paint.style.width = dw + 'px';
    v.paint.style.height = dh + 'px';
  }

  function syncAllPaintLayouts() {
    Object.keys(views).forEach(function (key) {
      syncPaintToImage(views[key]);
    });
  }

  function zoneLabel(id) {
    if (window.SitriforI18n && window.SitriforI18n.t) {
      var tr = window.SitriforI18n.t('zone.' + id);
      if (tr && tr !== 'zone.' + id) return tr;
    }
    return LABELS[id] || id;
  }

  function syncInputs() {
    if (locationInput) {
      locationInput.value = selected.join(',') || '';
      locationInput.dispatchEvent(new Event('input', { bubbles: true }));
      locationInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (genderInput) genderInput.value = gender;
    if (chipsEl) {
      if (!selected.length) {
        var empty = (window.SitriforI18n && window.SitriforI18n.t)
          ? window.SitriforI18n.t('calc.body.chipEmpty')
          : 'Выберите зону на схеме';
        chipsEl.innerHTML = '<li class="calc-body__chip calc-body__chip--empty">' + empty + '</li>';
      } else {
        chipsEl.innerHTML = selected.map(function (id) {
          return '<li class="calc-body__chip">' + zoneLabel(id) + '</li>';
        }).join('');
      }
    }
  }

  function paintView(key) {
    var v = views[key];
    if (!v || !v.maskData) return;
    var ctx = v.paint.getContext('2d');
    var w = v.w;
    var h = v.h;
    ctx.clearRect(0, 0, w, h);

    selected.forEach(function (zoneId) {
      var rgb = META.palette[zoneId];
      if (!rgb) return;
      // Do not paint a zone that does not exist on this view
      // (e.g. neck_front on back, or opposite-side artifact)
      if (!zoneHasPixels(v.maskData, zoneId)) return;
      var pat = (META.patterns && META.patterns[zoneId]) || 'ornamental';
      var md = v.maskData.data;

      // 1) soft gold underlay clipped to zone
      var under = document.createElement('canvas');
      under.width = w; under.height = h;
      var uctx = under.getContext('2d');
      uctx.fillStyle = 'rgba(255, 214, 10, 0.28)';
      uctx.fillRect(0, 0, w, h);
      var uimg = uctx.getImageData(0, 0, w, h);
      var ud = uimg.data;
      var i;
      for (i = 0; i < md.length; i += 4) {
        if (!(md[i] === rgb[0] && md[i + 1] === rgb[1] && md[i + 2] === rgb[2])) {
          ud[i + 3] = 0;
        }
      }
      uctx.putImageData(uimg, 0, 0);
      ctx.drawImage(under, 0, 0);

      // 2) crisp tattoo pattern clipped to same zone
      var tmp = document.createElement('canvas');
      tmp.width = w; tmp.height = h;
      var tctx = tmp.getContext('2d');
      patternFill(tctx, pat, w, h);
      var img = tctx.getImageData(0, 0, w, h);
      var pd = img.data;
      for (i = 0; i < md.length; i += 4) {
        if (!(md[i] === rgb[0] && md[i + 1] === rgb[1] && md[i + 2] === rgb[2])) {
          pd[i + 3] = 0;
        } else {
          pd[i + 3] = Math.min(255, pd[i + 3] + 30);
        }
      }
      tctx.putImageData(img, 0, 0);
      ctx.drawImage(tmp, 0, 0);
    });
  }

  function paintAllVisible() {
    ['front', 'back'].forEach(function (view) {
      paintView(gender + '-' + view);
    });
  }

  // Anatomical adjacency: zones may be multi-selected only if connected
  var ADJACENT = {
    face: ['neck_front'],
    neck_front: ['face', 'chest', 'shoulder_l', 'shoulder_r', 'neck_back'],
    neck_back: ['neck_front', 'back_upper', 'shoulder_l', 'shoulder_r'],
    chest: ['neck_front', 'ribs', 'shoulder_l', 'shoulder_r', 'back_upper'],
    ribs: ['chest', 'stomach', 'shoulder_l', 'shoulder_r'],
    stomach: ['ribs', 'hip'],
    hip: ['stomach', 'thigh_l', 'thigh_r', 'glute'],
    shoulder_l: ['neck_front', 'neck_back', 'chest', 'ribs', 'upper_arm_l', 'back_upper'],
    shoulder_r: ['neck_front', 'neck_back', 'chest', 'ribs', 'upper_arm_r', 'back_upper'],
    upper_arm_l: ['shoulder_l', 'forearm_l'],
    upper_arm_r: ['shoulder_r', 'forearm_r'],
    forearm_l: ['upper_arm_l', 'hand_l'],
    forearm_r: ['upper_arm_r', 'hand_r'],
    hand_l: ['forearm_l'],
    hand_r: ['forearm_r'],
    thigh_l: ['hip', 'knee_l', 'glute'],
    thigh_r: ['hip', 'knee_r', 'glute'],
    knee_l: ['thigh_l', 'calf_l'],
    knee_r: ['thigh_r', 'calf_r'],
    calf_l: ['knee_l', 'foot_l'],
    calf_r: ['knee_r', 'foot_r'],
    foot_l: ['calf_l'],
    foot_r: ['calf_r'],
    back_upper: ['neck_back', 'back_lower', 'shoulder_l', 'shoulder_r', 'chest'],
    back_lower: ['back_upper', 'glute', 'stomach'],
    glute: ['back_lower', 'hip', 'thigh_l', 'thigh_r']
  };

  function isAdjacent(a, b) {
    return (ADJACENT[a] || []).indexOf(b) !== -1;
  }

  function isAdjacentToSelection(id, sel) {
    for (var i = 0; i < sel.length; i++) {
      if (isAdjacent(sel[i], id)) return true;
    }
    return false;
  }

  function largestConnected(sel) {
    if (sel.length <= 1) return sel.slice();
    var set = {};
    sel.forEach(function (z) { set[z] = true; });
    var visited = {};
    var best = [];

    sel.forEach(function (start) {
      if (visited[start]) return;
      var queue = [start];
      var comp = [];
      visited[start] = true;
      while (queue.length) {
        var cur = queue.shift();
        comp.push(cur);
        (ADJACENT[cur] || []).forEach(function (n) {
          if (set[n] && !visited[n]) {
            visited[n] = true;
            queue.push(n);
          }
        });
      }
      if (comp.length > best.length) best = comp;
    });
    return best;
  }

  function toggleZone(id) {
    if (!id) return;
    var idx = selected.indexOf(id);
    if (idx !== -1) {
      selected = selected.filter(function (z) { return z !== id; });
      selected = largestConnected(selected);
    } else if (!selected.length || isAdjacentToSelection(id, selected)) {
      selected.push(id);
    } else {
      // Non-adjacent: start a new contiguous selection
      selected = [id];
    }
    paintAllVisible();
    syncInputs();
  }

  function pickZone(viewKey, clientX, clientY) {
    var v = views[viewKey];
    if (!v) return null;
    var rect = v.paint.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    var x = Math.floor((clientX - rect.left) / rect.width * v.w);
    var y = Math.floor((clientY - rect.top) / rect.height * v.h);
    if (x < 0 || y < 0 || x >= v.w || y >= v.h) return null;

    function zoneAt(px, py) {
      if (px < 0 || py < 0 || px >= v.w || py >= v.h) return null;
      var i = (py * v.w + px) * 4;
      var d = v.maskData.data;
      if (d[i + 3] === 0) return null;
      if (d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 0) return null;
      return colorToZone[rgbKey(d[i], d[i + 1], d[i + 2])] || nearestZone(d[i], d[i + 1], d[i + 2]);
    }

    var direct = zoneAt(x, y);
    if (direct) return direct;

    // Thin zones (neck): search nearest labeled pixel in small radius
    var r, dx, dy, hit, best = null, bestDist = 1e9;
    for (r = 1; r <= 6; r++) {
      for (dy = -r; dy <= r; dy++) {
        for (dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          hit = zoneAt(x + dx, y + dy);
          if (!hit) continue;
          var dist = dx * dx + dy * dy;
          if (dist < bestDist) {
            bestDist = dist;
            best = hit;
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  async function setupView(frame, genderName, view) {
    var key = genderName + '-' + view;
    var img = frame.querySelector('img');
    var paint = frame.querySelector('[data-body-paint]');
    var w = META.width;
    var h = META.height;
    paint.width = w;
    paint.height = h;

    var maskImg = await loadImage('/img/calc/masks/' + key + '.png?v=12');
    var off = document.createElement('canvas');
    off.width = w; off.height = h;
    var octx = off.getContext('2d', { willReadFrequently: true });
    octx.drawImage(maskImg, 0, 0, w, h);
    var maskData = snapMaskData(octx.getImageData(0, 0, w, h));
    octx.putImageData(maskData, 0, 0);

    views[key] = { img: img, paint: paint, maskData: maskData, w: w, h: h, frame: frame };
    if (img.complete && img.naturalWidth) syncPaintToImage(views[key]);
    else img.addEventListener('load', function () { syncPaintToImage(views[key]); });

    frame.addEventListener('click', function (e) {
      if (genderName !== gender) return;
      var id = pickZone(key, e.clientX, e.clientY);
      if (id) toggleZone(id);
    });
  }

  function setGender(next) {
    gender = next;
    Array.prototype.forEach.call(mount.querySelectorAll('[data-body-gender]'), function (btn) {
      var on = btn.getAttribute('data-body-gender') === gender;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    Array.prototype.forEach.call(mount.parentElement.querySelectorAll('[data-body-figure]'), function (fig) {
      var show = fig.getAttribute('data-body-figure') === gender;
      fig.hidden = !show;
    });
    // also search in mount
    Array.prototype.forEach.call(mount.querySelectorAll('[data-body-figure]'), function (fig) {
      var show = fig.getAttribute('data-body-figure') === gender;
      fig.hidden = !show;
    });
    if (genderInput) genderInput.value = gender;
    syncAllPaintLayouts();
    paintAllVisible();
  }

  function figureHtml(g, labelKey) {
    return [
      '<div class="calc-body__figure" data-body-figure="' + g + '"' + (g === 'male' ? '' : ' hidden') + '>',
      '  <div class="calc-body__pair">',
      '    <figure class="calc-body__view">',
      '      <div class="calc-body__frame" data-body-frame data-gender="' + g + '" data-view="front">',
      '        <img src="/img/calc/body/body-' + g + '-front.jpg" alt="" width="300" height="400" draggable="false" data-i18n-alt="calc.body.altFront">',
      '        <canvas class="calc-body__paint" data-body-paint aria-hidden="true"></canvas>',
      '      </div>',
      '      <figcaption data-i18n="calc.body.captionFront">Спереди</figcaption>',
      '    </figure>',
      '    <figure class="calc-body__view">',
      '      <div class="calc-body__frame" data-body-frame data-gender="' + g + '" data-view="back">',
      '        <img src="/img/calc/body/body-' + g + '-back.jpg" alt="" width="300" height="400" draggable="false" data-i18n-alt="calc.body.altBack">',
      '        <canvas class="calc-body__paint" data-body-paint aria-hidden="true"></canvas>',
      '      </div>',
      '      <figcaption data-i18n="calc.body.captionBack">Сзади</figcaption>',
      '    </figure>',
      '  </div>',
      '</div>'
    ].join('\n');
  }

  mount.innerHTML = [
    '<div class="calc-body__gender" role="tablist" aria-label="Тип фигуры" data-i18n-aria-label="calc.body.genderAria">',
    '  <button type="button" class="calc-body__gender-btn is-active" role="tab" aria-selected="true" data-body-gender="male" data-i18n="calc.body.genderMale">Мужчина</button>',
    '  <button type="button" class="calc-body__gender-btn" role="tab" aria-selected="false" data-body-gender="female" data-i18n="calc.body.genderFemale">Женщина</button>',
    '</div>',
    '<div class="calc-body__stage">',
    figureHtml('male'),
    figureHtml('female'),
    '</div>'
  ].join('\n');

  if (window.SitriforI18n && window.SitriforI18n.apply) {
    window.SitriforI18n.apply(mount);
  }

  mount.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-body-gender]');
    if (btn) setGender(btn.getAttribute('data-body-gender'));
  });

  Promise.all(
    Array.prototype.map.call(mount.querySelectorAll('[data-body-frame]'), function (frame) {
      return setupView(frame, frame.getAttribute('data-gender'), frame.getAttribute('data-view'));
    })
  ).then(function () {
    syncAllPaintLayouts();
    paintAllVisible();
    syncInputs();
    if (typeof ResizeObserver !== 'undefined') {
      var ro = new ResizeObserver(function () {
        syncAllPaintLayouts();
      });
      Array.prototype.forEach.call(mount.querySelectorAll('[data-body-frame]'), function (frame) {
        ro.observe(frame);
      });
    } else {
      window.addEventListener('resize', syncAllPaintLayouts);
    }
  }).catch(function (err) {
    console.error(err);
    mount.insertAdjacentHTML('beforeend', '<p class="calc-body__hint">Ошибка загрузки схемы.</p>');
  });

  // Expose for calculator sync / PDF
  window.SitriforBodyMap = {
    getSelected: function () { return selected.slice(); },
    getGender: function () { return gender; },
    captureSnapshot: function () {
      paintAllVisible();
      function viewCanvas(view) {
        var key = gender + '-' + view;
        var v = views[key];
        if (!v || !v.img || !v.paint) return null;
        paintView(key);
        var c = document.createElement('canvas');
        c.width = v.w;
        c.height = v.h;
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#09090b';
        ctx.fillRect(0, 0, c.width, c.height);
        try {
          ctx.drawImage(v.img, 0, 0, c.width, c.height);
        } catch (err) {
          return null;
        }
        ctx.drawImage(v.paint, 0, 0, c.width, c.height);
        return c;
      }

      var front = viewCanvas('front');
      var back = viewCanvas('back');
      if (!front && !back) return null;

      var gap = 24;
      var fw = front ? front.width : (back ? back.width : 300);
      var fh = front ? front.height : (back ? back.height : 400);
      var bw = back ? back.width : fw;
      var bh = back ? back.height : fh;
      var labelH = 36;
      var out = document.createElement('canvas');
      out.width = fw + gap + bw;
      out.height = Math.max(fh, bh) + labelH;
      var octx = out.getContext('2d');
      octx.fillStyle = '#111114';
      octx.fillRect(0, 0, out.width, out.height);
      octx.fillStyle = 'rgba(255,255,255,0.55)';
      octx.font = '600 22px system-ui, sans-serif';
      octx.textAlign = 'center';
      octx.textBaseline = 'middle';

      var frontLabel = (window.SitriforI18n && window.SitriforI18n.t)
        ? window.SitriforI18n.t('calc.body.captionFront')
        : 'Front';
      var backLabel = (window.SitriforI18n && window.SitriforI18n.t)
        ? window.SitriforI18n.t('calc.body.captionBack')
        : 'Back';

      if (front) {
        octx.drawImage(front, 0, 0);
        octx.fillText(frontLabel, fw / 2, fh + labelH / 2);
      }
      if (back) {
        octx.drawImage(back, fw + gap, 0);
        octx.fillText(backLabel, fw + gap + bw / 2, bh + labelH / 2);
      }

      return {
        gender: gender,
        zones: selected.slice(),
        dataUrl: out.toDataURL('image/jpeg', 0.9),
        width: out.width,
        height: out.height
      };
    }
  };

  document.addEventListener('sitrifor:langchange', function () {
    syncInputs();
  });
})();
