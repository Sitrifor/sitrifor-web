(function (global) {
  'use strict';

  var BRAND = {
    bg: [17, 17, 20],
    surface: [44, 44, 46],
    accent: [255, 214, 10],
    text: [255, 255, 255],
    muted: [180, 180, 188],
    logoPath: '/img/logo-s-yellow.png',
    pageBgPath: '/img/bg/pdf-page-bg.jpg',
    coverPath: '/img/care/cover.jpg',
    fontRegular: '/fonts/DejaVuSans.ttf',
    fontBold: '/fonts/DejaVuSans-Bold.ttf',
    footerH: 16,
    footerText: 'SITRIFOR.RU - мы создаем партнерскую экосистему цифровых сервисов для тату-индустрии! Присоединяйтесь!'
  };

  var fontBytes = null;
  var pageBgDataUrl = null;
  var logoDataUrl = null;
  var imageCache = {};
  var carePanelHost = null;

  function currentLang() {
    if (global.SitriforI18n && typeof global.SitriforI18n.getLang === 'function') {
      return global.SitriforI18n.getLang();
    }
    return 'ru';
  }

  function syncTitleArts(root) {
    var lang = currentLang();
    Array.prototype.forEach.call(root.querySelectorAll('[data-care-title-art]'), function (img) {
      var attr = 'data-src-' + lang;
      var src = img.getAttribute(attr) || img.getAttribute('data-src-ru');
      if (src && img.getAttribute('src') !== src) img.setAttribute('src', src);
    });
  }

  function removeCarePanelHost() {
    if (carePanelHost && carePanelHost.parentNode) {
      carePanelHost.parentNode.removeChild(carePanelHost);
    }
    carePanelHost = null;
  }

  async function ensureCarePanels() {
    var existing = document.querySelectorAll('[data-care-panel]');
    if (existing.length) {
      return { panels: existing, owned: false };
    }

    var res = await fetch('/masters', { credentials: 'same-origin' });
    if (!res.ok) throw new Error(tt('pdf.error.noCareContent'));
    var parsed = new DOMParser().parseFromString(await res.text(), 'text/html');
    var sourcePanels = parsed.querySelectorAll('[data-care-panel]');
    if (!sourcePanels.length) throw new Error(tt('pdf.error.noCareContent'));

    carePanelHost = document.createElement('div');
    carePanelHost.id = 'sitrifor-care-pdf-host';
    carePanelHost.hidden = true;
    carePanelHost.setAttribute('aria-hidden', 'true');
    carePanelHost.style.cssText = 'position:absolute;left:-9999px;width:0;height:0;overflow:hidden;';

    sourcePanels.forEach(function (panel) {
      var clone = document.importNode(panel, true);
      clone.removeAttribute('hidden');
      carePanelHost.appendChild(clone);
    });
    document.body.appendChild(carePanelHost);

    if (global.SitriforI18n && typeof global.SitriforI18n.apply === 'function') {
      global.SitriforI18n.apply(carePanelHost);
    }
    syncTitleArts(carePanelHost);

    return {
      panels: carePanelHost.querySelectorAll('[data-care-panel]'),
      owned: true
    };
  }

  function carePdfFilename() {
    var lang = currentLang();
    if (lang === 'en') return 'sitrifor-aftercare.pdf';
    if (lang === 'de') return 'sitrifor-pflege.pdf';
    return 'sitrifor-uhod.pdf';
  }

  function tt(key, vars) {
    if (global.SitriforI18n && typeof global.SitriforI18n.t === 'function') {
      return global.SitriforI18n.t(key, vars);
    }
    return key;
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-pdf-lib="' + src + '"]');
      if (existing) {
        if (existing.getAttribute('data-loaded') === '1') resolve();
        else existing.addEventListener('load', resolve);
        return;
      }
      var s = document.createElement('script');
      s.src = src;
      s.setAttribute('data-pdf-lib', src);
      s.onload = function () {
        s.setAttribute('data-loaded', '1');
        resolve();
      };
      s.onerror = function () { reject(new Error(tt('pdf.error.scriptLoad', { src: src }))); };
      document.head.appendChild(s);
    });
  }

  function arrayBufferToBase64(buffer) {
    var bytes = new Uint8Array(buffer);
    var chunk = 0x8000;
    var binary = '';
    for (var i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  async function ensureJsPdf() {
    if (!(global.jspdf && global.jspdf.jsPDF)) {
      await loadScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js');
    }
    if (!(global.jspdf && global.jspdf.jsPDF)) {
      throw new Error(tt('pdf.error.jspdfLoad'));
    }
  }

  async function loadFontBytes() {
    if (fontBytes) return fontBytes;
    var regularBuf = await fetch(BRAND.fontRegular).then(function (r) {
      if (!r.ok) throw new Error(tt('pdf.error.fontMissing'));
      return r.arrayBuffer();
    });
    var boldBuf = await fetch(BRAND.fontBold).then(function (r) {
      if (!r.ok) throw new Error(tt('pdf.error.fontBoldMissing'));
      return r.arrayBuffer();
    });
    fontBytes = {
      regular: arrayBufferToBase64(regularBuf),
      bold: arrayBufferToBase64(boldBuf)
    };
    return fontBytes;
  }

  async function registerFonts(doc) {
    var fonts = await loadFontBytes();
    doc.addFileToVFS('DejaVuSans.ttf', fonts.regular);
    doc.addFont('DejaVuSans.ttf', 'DejaVu', 'normal');
    doc.addFileToVFS('DejaVuSans-Bold.ttf', fonts.bold);
    doc.addFont('DejaVuSans-Bold.ttf', 'DejaVu', 'bold');
  }

  function setFont(doc, style) {
    doc.setFont('DejaVu', style || 'normal');
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error(tt('pdf.error.imageLoad'))); };
      img.src = src;
    });
  }

  function canvasFromImage(img, type) {
    var c = document.createElement('canvas');
    c.width = img.naturalWidth || img.width;
    c.height = img.naturalHeight || img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL(type || 'image/png');
  }

  async function ensurePageBg() {
    if (pageBgDataUrl) return pageBgDataUrl;
    try {
      pageBgDataUrl = canvasFromImage(await loadImage(BRAND.pageBgPath), 'image/jpeg');
    } catch (e) {
      pageBgDataUrl = null;
    }
    return pageBgDataUrl;
  }

  async function getJpegDataUrl(src) {
    if (!src) return null;
    if (imageCache[src]) return imageCache[src];
    try {
      var img = await loadImage(src);
      var entry = {
        dataUrl: canvasFromImage(img, 'image/jpeg'),
        width: img.naturalWidth || img.width || 1,
        height: img.naturalHeight || img.height || 1
      };
      imageCache[src] = entry;
      return entry;
    } catch (e) {
      return null;
    }
  }

  function fitImageBox(srcW, srcH, maxW, maxH) {
    var ratio = srcW / srcH;
    var w = maxW;
    var h = w / ratio;
    if (h > maxH) {
      h = maxH;
      w = h * ratio;
    }
    return { w: w, h: h };
  }

  function composeSectionBanner(entry, label, outW, outH, titleArtUrl) {
    var canvas = document.createElement('canvas');
    canvas.width = Math.round(outW);
    canvas.height = Math.round(outH);
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#111114';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    function drawLabelFallback() {
      if (!label) return;
      ctx.fillStyle = '#FFD60A';
      ctx.font = '800 ' + Math.round(canvas.height * 0.14) + 'px Manrope, DejaVu Sans, sans-serif';
      ctx.textBaseline = 'bottom';
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = 18;
      ctx.fillText(label, Math.round(canvas.width * 0.05), canvas.height - Math.round(canvas.height * 0.08));
      ctx.shadowBlur = 0;
    }

    function finishWithTitleArt() {
      if (!titleArtUrl) {
        drawLabelFallback();
        return Promise.resolve(canvas.toDataURL('image/jpeg', 0.9));
      }
      return new Promise(function (resolve) {
        var titleImg = new Image();
        titleImg.onload = function () {
          var maxH = canvas.height * 0.28;
          var maxW = canvas.width * 0.78;
          var scale = Math.min(maxW / titleImg.naturalWidth, maxH / titleImg.naturalHeight);
          var tw = titleImg.naturalWidth * scale;
          var th = titleImg.naturalHeight * scale;
          var tx = canvas.width * 0.04;
          var ty = canvas.height - th - canvas.height * 0.06;
          ctx.drawImage(titleImg, tx, ty, tw, th);
          resolve(canvas.toDataURL('image/jpeg', 0.9));
        };
        titleImg.onerror = function () {
          drawLabelFallback();
          resolve(canvas.toDataURL('image/jpeg', 0.9));
        };
        titleImg.src = titleArtUrl;
      });
    }

    if (entry && entry.dataUrl) {
      return new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () {
          var ir = img.naturalWidth / img.naturalHeight;
          var cr = canvas.width / canvas.height;
          var dw;
          var dh;
          var dx;
          var dy;
          if (ir > cr) {
            dh = canvas.height;
            dw = dh * ir;
            dx = (canvas.width - dw) / 2;
            dy = 0;
          } else {
            dw = canvas.width;
            dh = dw / ir;
            dx = 0;
            dy = (canvas.height - dh) / 2;
          }
          ctx.drawImage(img, dx, dy, dw, dh);

          var grd = ctx.createLinearGradient(0, canvas.height * 0.35, 0, canvas.height);
          grd.addColorStop(0, 'rgba(17,17,20,0)');
          grd.addColorStop(1, 'rgba(17,17,20,0.88)');
          ctx.fillStyle = grd;
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          finishWithTitleArt().then(resolve);
        };
        img.onerror = function () { resolve(null); };
        img.src = entry.dataUrl;
      });
    }
    return Promise.resolve(null);
  }

  function drawCoverPage(doc, pageW, pageH, bg, coverEntry) {
    drawPageBackground(doc, pageW, pageH, bg);
    drawWatermark(doc, pageW, pageH);
    doc.setFillColor.apply(doc, BRAND.accent);
    doc.rect(0, 0, pageW, 8, 'F');

    setFont(doc, 'bold');
    doc.setTextColor.apply(doc, BRAND.accent);
    doc.setFontSize(12);
    doc.text('SITRIFOR', pageW / 2, 26, { align: 'center' });

    var titleY = 56;
    if (coverEntry && coverEntry.dataUrl) {
      var box = fitImageBox(coverEntry.width, coverEntry.height, pageW - 48, 110);
      var imgX = (pageW - box.w) / 2;
      var imgY = 36;
      try {
        doc.setFillColor(28, 28, 30);
        doc.roundedRect(imgX - 1, imgY - 1, box.w + 2, box.h + 2, 3, 3, 'F');
        doc.addImage(coverEntry.dataUrl, 'JPEG', imgX, imgY, box.w, box.h);
      } catch (e) {}
      titleY = imgY + box.h + 22;
    }

    setFont(doc, 'bold');
    doc.setTextColor.apply(doc, BRAND.text);
    doc.setFontSize(28);
    var title = tt('pdf.care.title');
    var titleLines = doc.splitTextToSize(title, pageW - 36);
    titleLines.forEach(function (line, i) {
      doc.text(line, pageW / 2, titleY + i * 13, { align: 'center' });
    });

    setFont(doc, 'normal');
    doc.setTextColor.apply(doc, BRAND.muted);
    doc.setFontSize(11);
    doc.text(
      tt('pdf.care.subtitle'),
      pageW / 2,
      titleY + titleLines.length * 13 + 12,
      { align: 'center' }
    );

    footer(doc, pageW, pageH);
  }

  function drawPageBackground(doc, pageW, pageH, bgDataUrl) {
    doc.setFillColor.apply(doc, BRAND.bg);
    doc.rect(0, 0, pageW, pageH, 'F');
    if (bgDataUrl) {
      try {
        doc.addImage(bgDataUrl, 'JPEG', 0, 0, pageW, pageH);
      } catch (e) {}
    }
  }

  function drawWatermark(doc, pageW, pageH) {
    setFont(doc, 'bold');
    doc.setTextColor(255, 214, 10);
    doc.setFontSize(34);
    for (var y = 50; y < pageH - 24; y += 58) {
      for (var x = 10; x < pageW; x += 72) {
        try {
          doc.saveGraphicsState();
          if (doc.GState) doc.setGState(new doc.GState({ opacity: 0.035 }));
          doc.text('Sitrifor', x, y, { angle: 28 });
          doc.restoreGraphicsState();
        } catch (e) {
          try { doc.restoreGraphicsState(); } catch (e2) {}
        }
      }
    }
    // Always reset text style after watermark so content never inherits it
    setFont(doc, 'normal');
    doc.setFontSize(10);
    doc.setTextColor.apply(doc, BRAND.muted);
  }

  async function ensureLogo() {
    if (logoDataUrl) return logoDataUrl;
    try {
      logoDataUrl = canvasFromImage(await loadImage(BRAND.logoPath), 'image/png');
    } catch (e) {
      logoDataUrl = null;
    }
    return logoDataUrl;
  }

  function footer(doc, pageW, pageH) {
    var h = BRAND.footerH;
    var y0 = pageH - h;
    doc.setFillColor(28, 28, 30);
    doc.rect(0, y0, pageW, h, 'F');

    var logoSize = 8;
    var textX = 14;
    var logo = logoDataUrl;
    if (logo) {
      try {
        doc.addImage(logo, 'PNG', 8, y0 + (h - logoSize) / 2, logoSize, logoSize);
        textX = 8 + logoSize + 3;
      } catch (e) {}
    }

    setFont(doc, 'bold');
    doc.setTextColor(255, 214, 10);
    doc.setFontSize(7.2);
    var lines = doc.splitTextToSize(tt('pdf.footer.text') || BRAND.footerText, pageW - textX - 8);
    var lineH = 3.2;
    var textBlockH = lines.length * lineH;
    var textY = y0 + (h - textBlockH) / 2 + 2.4;
    lines.forEach(function (line, i) {
      doc.text(line, textX, textY + i * lineH);
    });

    setFont(doc, 'normal');
    doc.setFontSize(10);
    doc.setTextColor.apply(doc, BRAND.muted);
  }

  function cleanText(value) {
    return String(value || '')
      .replace(/[—–]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function collectBlocks(panel) {
    var blocks = [];
    Array.prototype.forEach.call(panel.children, function (node) {
      var tag = (node.tagName || '').toLowerCase();
      if (tag === 'figure' || (tag === 'img')) {
        return;
      }
      if (tag === 'p') {
        var lead = cleanText(node.textContent);
        if (lead) blocks.push({ type: 'lead', text: lead });
      } else if (tag === 'h4') {
        var heading = cleanText(node.textContent);
        if (heading) blocks.push({ type: 'h4', text: heading });
      } else if (tag === 'ul' || tag === 'ol') {
        var items = [];
        Array.prototype.forEach.call(node.children, function (li) {
          if ((li.tagName || '').toLowerCase() !== 'li') return;
          var item = cleanText(li.textContent);
          if (item) items.push(item);
        });
        if (items.length) {
          blocks.push({
            type: tag === 'ol' ? 'ol' : 'ul',
            items: items,
            danger: node.classList.contains('care-apple__dont')
          });
        }
      } else if (node.classList && node.classList.contains('care-apple__callout')) {
        var callout = cleanText(node.textContent);
        if (callout) blocks.push({ type: 'lead', text: callout });
      } else if (node.classList && node.classList.contains('care-apple__rows')) {
        Array.prototype.forEach.call(node.children, function (row) {
          var rowText = cleanText(row.textContent);
          if (rowText) blocks.push({ type: 'ul', items: [rowText], danger: false });
        });
      }
    });
    return blocks;
  }

  function ensureSpace(ctx, needed) {
    if (ctx.y + needed <= ctx.pageH - (BRAND.footerH + 8)) return false;
    footer(ctx.doc, ctx.pageW, ctx.pageH);
    ctx.doc.addPage();
    paintPageChrome(ctx);
    ctx.y = 22;
    return true;
  }

  function paintPageChrome(ctx) {
    drawPageBackground(ctx.doc, ctx.pageW, ctx.pageH, ctx.bg);
    drawWatermark(ctx.doc, ctx.pageW, ctx.pageH);
    ctx.doc.setFillColor.apply(ctx.doc, BRAND.accent);
    ctx.doc.rect(0, 0, ctx.pageW, 8, 'F');
  }

  function applyTextStyle(ctx, opts) {
    opts = opts || {};
    setFont(ctx.doc, opts.style || 'normal');
    ctx.doc.setFontSize(opts.size || 10);
    ctx.doc.setTextColor.apply(ctx.doc, opts.color || BRAND.muted);
  }

  function drawWrapped(ctx, text, opts) {
    opts = opts || {};
    var size = opts.size || 10;
    var color = opts.color || BRAND.muted;
    var style = opts.style || 'normal';
    var indent = opts.indent || 0;
    var lineH = opts.lineH || 5.2;
    var maxW = ctx.pageW - 28 - indent;
    applyTextStyle(ctx, { size: size, color: color, style: style });
    var lines = ctx.doc.splitTextToSize(text, maxW);
    lines.forEach(function (line) {
      if (ensureSpace(ctx, lineH + 1)) {
        applyTextStyle(ctx, { size: size, color: color, style: style });
      }
      ctx.doc.text(line, 14 + indent, ctx.y);
      ctx.y += lineH;
    });
  }

  function estimateBlockHeight(ctx, block) {
    var maxW = ctx.pageW - 28;
    if (block.type === 'lead') {
      applyTextStyle(ctx, { size: 10.5, color: BRAND.text, style: 'normal' });
      return ctx.doc.splitTextToSize(block.text, maxW).length * 5.4 + 4;
    }
    if (block.type === 'h4') {
      applyTextStyle(ctx, { size: 11.5, color: BRAND.accent, style: 'bold' });
      return 3 + 7 + ctx.doc.splitTextToSize(block.text, maxW).length * 5.6 + 3;
    }
    if (block.type === 'ul' || block.type === 'ol') {
      var h = 0;
      applyTextStyle(ctx, { size: 10, color: BRAND.muted, style: 'normal' });
      block.items.forEach(function (item) {
        h += ctx.doc.splitTextToSize(item, ctx.pageW - 36).length * 5.4 + 2.2;
      });
      return h + 2;
    }
    return 0;
  }

  function groupBlocks(blocks) {
    var groups = [];
    var current = [];
    blocks.forEach(function (block) {
      if (block.type === 'h4' && current.length) {
        groups.push(current);
        current = [block];
      } else {
        current.push(block);
      }
    });
    if (current.length) groups.push(current);
    return groups;
  }

  function estimateGroupHeight(ctx, group) {
    var total = 0;
    group.forEach(function (block) {
      total += estimateBlockHeight(ctx, block);
    });
    return total;
  }

  function renderBlocks(ctx, blocks) {
    var groups = groupBlocks(blocks);
    groups.forEach(function (group) {
      var needed = estimateGroupHeight(ctx, group);
      // Keep whole subsection (h4 + body) together when it fits on one page
      if (needed > 0 && needed < ctx.pageH - 60) {
        ensureSpace(ctx, needed + 4);
      }

      group.forEach(function (block) {
        if (block.type === 'lead') {
          drawWrapped(ctx, block.text, { size: 10.5, color: BRAND.text, style: 'normal', lineH: 5.4 });
          ctx.y += 4;
          return;
        }

        if (block.type === 'h4') {
          ctx.y += 3;
          ctx.doc.setDrawColor.apply(ctx.doc, BRAND.accent);
          ctx.doc.setLineWidth(0.35);
          ctx.doc.line(14, ctx.y, ctx.pageW - 14, ctx.y);
          ctx.y += 7;
          drawWrapped(ctx, block.text, {
            size: 11.5,
            color: BRAND.accent,
            style: 'bold',
            lineH: 5.6
          });
          ctx.y += 3;
          return;
        }

        if (block.type === 'ul' || block.type === 'ol') {
          block.items.forEach(function (item, i) {
            var bullet = block.type === 'ol' ? (i + 1) + '.' : '•';
            var color = block.danger ? [255, 170, 160] : BRAND.muted;
            var bulletColor = block.danger ? [255, 140, 120] : BRAND.accent;
            ensureSpace(ctx, 8);
            applyTextStyle(ctx, { size: 10, color: bulletColor, style: 'bold' });
            ctx.doc.text(bullet, 14, ctx.y);

            applyTextStyle(ctx, { size: 10, color: color, style: 'normal' });
            var lines = ctx.doc.splitTextToSize(item, ctx.pageW - 36);
            lines.forEach(function (line, li) {
              if (li > 0 && ensureSpace(ctx, 5.4)) {
                applyTextStyle(ctx, { size: 10, color: color, style: 'normal' });
              }
              ctx.doc.text(line, 22, ctx.y);
              ctx.y += 5.4;
            });
            ctx.y += 2.2;
          });
          ctx.y += 2;
        }
      });
    });
  }

  async function exportCare() {
    await ensureJsPdf();
    var panelState = await ensureCarePanels();
    var ownedPanels = panelState.owned;
    var doc = new global.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
    await registerFonts(doc);
    await ensureLogo();

    var pageW = doc.internal.pageSize.getWidth();
    var pageH = doc.internal.pageSize.getHeight();
    var bg = await ensurePageBg();
    var cover = await getJpegDataUrl(BRAND.coverPath);
    var panels = Array.prototype.slice.call(panelState.panels);
    if (!panels.length) throw new Error(tt('pdf.error.noCareContent'));

    try {
      drawCoverPage(doc, pageW, pageH, bg, cover);

      for (var idx = 0; idx < panels.length; idx++) {
        var panel = panels[idx];
        doc.addPage();

        var ctx = { doc: doc, pageW: pageW, pageH: pageH, bg: bg, y: 20 };
        paintPageChrome(ctx);

        setFont(doc, 'bold');
        doc.setTextColor.apply(doc, BRAND.accent);
        doc.setFontSize(11);
        doc.text(tt('pdf.care.kicker'), 14, 20);

        var headingKey = panel.getAttribute('data-care-heading-key');
        var title = cleanText(
          (headingKey ? tt(headingKey) : null) ||
          panel.getAttribute('data-care-heading') ||
          tt('pdf.section.fallback', { n: idx + 1 })
        );
        var label = cleanText(panel.getAttribute('data-care-label') || title);
        setFont(doc, 'bold');
        doc.setTextColor.apply(doc, BRAND.text);
        doc.setFontSize(14);
        var titleLines = doc.splitTextToSize(title, pageW - 28);
        doc.text(titleLines, 14, 32);

        ctx.y = 32 + titleLines.length * 6.5 + 2;
        doc.setDrawColor.apply(doc, BRAND.accent);
        doc.setLineWidth(0.5);
        doc.line(14, ctx.y, pageW - 14, ctx.y);
        ctx.y += 8;

        var sectionEntry = await getJpegDataUrl(panel.getAttribute('data-care-image'));
        if (sectionEntry) {
          var maxW = pageW - 28;
          var maxH = 62;
          var box = fitImageBox(16, 9, maxW, maxH);
          var titleArtEl = panel.querySelector('[data-care-title-art]');
          var titleArtUrl = titleArtEl ? titleArtEl.getAttribute('src') : '';
          var bannerLabel = cleanText(label);
          var banner = await composeSectionBanner(sectionEntry, bannerLabel, box.w * 8, box.h * 8, titleArtUrl);
          if (banner) {
            ensureSpace(ctx, box.h + 6);
            try {
              doc.addImage(banner, 'JPEG', 14, ctx.y, box.w, box.h);
              ctx.y += box.h + 8;
            } catch (e) {}
          }
        }

        renderBlocks(ctx, collectBlocks(panel));
        footer(doc, pageW, pageH);
      }

      doc.save(carePdfFilename());
      if (global.sfMetrika) global.sfMetrika.goal('care_pdf_download', { page: location.pathname });
    } finally {
      if (ownedPanels) removeCarePanelHost();
    }
  }

  async function exportCalc(plan, chartCanvas, bodyShot) {
    await ensureJsPdf();
    var doc = new global.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
    await registerFonts(doc);
    await ensureLogo();

    var pageW = doc.internal.pageSize.getWidth();
    var pageH = doc.internal.pageSize.getHeight();
    var bg = await ensurePageBg();
    var ctx = { doc: doc, pageW: pageW, pageH: pageH, bg: bg, y: 20 };

    paintPageChrome(ctx);

    setFont(doc, 'bold');
    doc.setTextColor.apply(doc, BRAND.accent);
    doc.setFontSize(11);
    doc.text(tt('pdf.calc.kicker'), 14, ctx.y);
    ctx.y += 10;

    setFont(doc, 'bold');
    doc.setTextColor.apply(doc, BRAND.text);
    doc.setFontSize(18);
    doc.text(tt('pdf.calc.title'), 14, ctx.y);
    ctx.y += 12;

    var locale = plan.locale || 'ru-RU';
    var currencySymbol = plan.currencySymbol || '₽';
    function fmtMoney(n) {
      if (global.SitriforCalc && global.SitriforCalc.money) {
        return global.SitriforCalc.money(n, {
          code: plan.currency || 'RUB',
          symbol: currencySymbol,
          locale: locale
        });
      }
      var formatted = Number(n).toLocaleString(locale);
      if (plan.currency === 'USD') return currencySymbol + formatted;
      return formatted + ' ' + currencySymbol;
    }

    setFont(doc, 'bold');
    doc.setTextColor.apply(doc, BRAND.accent);
    doc.setFontSize(26);
    doc.text(fmtMoney(plan.total), 14, ctx.y);
    ctx.y += 10;

    setFont(doc, 'normal');
    doc.setTextColor.apply(doc, BRAND.muted);
    doc.setFontSize(11);
    var sessionsLine = tt('pdf.calc.sessionsLine', {
      n: plan.sessions.length,
      hours: plan.hoursNeeded != null ? plan.hoursNeeded : plan.sessionHours,
      days: plan.spanDays
    });
    if (plan.pain) sessionsLine += ' · ' + tt('pdf.calc.painSuffix', { pain: plan.pain });
    doc.text(sessionsLine, 14, ctx.y);
    ctx.y += 12;

    // —— Parameters ——
    ensureSpace(ctx, 42);
    setFont(doc, 'bold');
    doc.setTextColor.apply(doc, BRAND.text);
    doc.setFontSize(12);
    doc.text(tt('pdf.calc.paramsTitle'), 14, ctx.y);
    ctx.y += 7;

    var sizePart = plan.exactSize
      ? tt('pdf.calc.sizeExact', { w: plan.width, h: plan.height, area: plan.area })
      : (plan.width && plan.height
        ? tt('pdf.calc.sizeApprox', {
            label: plan.sizeLabel || tt('calc.size.label'),
            area: plan.area,
            w: plan.width,
            h: plan.height
          })
        : tt('pdf.calc.sizeApproxShort', {
            label: plan.sizeLabel || tt('calc.size.label'),
            area: plan.area
          }));

    var yes = tt('pdf.calc.yes');
    var no = tt('pdf.calc.no');
    var factors = plan.factors || {};
    var genderKey = plan.gender === 'female' ? 'calc.body.genderFemale' : 'calc.body.genderMale';
    var paramLines = [
      tt('pdf.calc.zonesLine', {
        zones: (plan.locationLabels && plan.locationLabels.length)
          ? plan.locationLabels.join(', ')
          : tt('calc.meta.zoneFallback')
      }),
      tt('pdf.calc.sizeLine', { size: sizePart }),
      tt('pdf.calc.rateLine', {
        rate: plan.hourlyRate.toLocaleString(locale),
        currency: currencySymbol
      }),
      tt('pdf.calc.genderLine', { gender: tt(genderKey) }),
      tt('pdf.calc.painLine', { pain: plan.pain || '—' }),
      tt('pdf.calc.coverLine', { value: factors.hasTattoo ? yes : no }),
      tt('pdf.calc.molesLine', { value: factors.moles ? yes : no }),
      tt('pdf.calc.allergyLine', { value: factors.allergy ? yes : no })
    ];

    setFont(doc, 'normal');
    doc.setFontSize(10);
    doc.setTextColor.apply(doc, BRAND.muted);
    paramLines.forEach(function (line) {
      var wrapped = doc.splitTextToSize(line, pageW - 28);
      ensureSpace(ctx, wrapped.length * 5 + 2);
      doc.text(wrapped, 14, ctx.y);
      ctx.y += wrapped.length * 5 + 1.5;
    });
    ctx.y += 6;

    // —— Body map (fills remainder of page 1 almost to footer) ——
    if (bodyShot && bodyShot.dataUrl) {
      setFont(doc, 'bold');
      doc.setTextColor.apply(doc, BRAND.text);
      doc.setFontSize(12);
      doc.text(tt('pdf.calc.bodyTitle'), 14, ctx.y);
      ctx.y += 5;

      var footerGap = BRAND.footerH + 10;
      var availH = Math.max(40, pageH - footerGap - ctx.y);
      var availW = pageW - 28;
      var ratio = bodyShot.height / Math.max(1, bodyShot.width);
      var bodyH = availH;
      var bodyW = bodyH / ratio;
      if (bodyW > availW) {
        bodyW = availW;
        bodyH = bodyW * ratio;
      }
      var bodyX = 14 + (availW - bodyW) / 2;
      try {
        doc.addImage(bodyShot.dataUrl, 'JPEG', bodyX, ctx.y, bodyW, bodyH);
      } catch (e) {}
      ctx.y += bodyH + 4;

      footer(doc, pageW, pageH);
      doc.addPage();
      paintPageChrome(ctx);
      ctx.y = 22;
    }

    // —— Chart ——
    if (chartCanvas && chartCanvas.width > 0) {
      ensureSpace(ctx, 82);
      setFont(doc, 'bold');
      doc.setTextColor.apply(doc, BRAND.text);
      doc.setFontSize(12);
      doc.text(tt('pdf.calc.chartTitle'), 14, ctx.y);
      ctx.y += 4;
      try {
        doc.addImage(chartCanvas.toDataURL('image/png', 1.0), 'PNG', 14, ctx.y, pageW - 28, 70);
      } catch (e) {}
      ctx.y += 78;
    }

    // —— Sessions (compact: ~15 rows per page) ——
    ensureSpace(ctx, 20);
    setFont(doc, 'bold');
    doc.setTextColor.apply(doc, BRAND.text);
    doc.setFontSize(11);
    doc.text(tt('pdf.calc.visitsTitle'), 14, ctx.y);
    ctx.y += 6;

    var sessionRowH = 10.2;
    var sessionBoxH = 8.6;
    plan.sessions.forEach(function (s) {
      ensureSpace(ctx, sessionRowH + 1);
      doc.setFillColor.apply(doc, BRAND.surface);
      doc.roundedRect(14, ctx.y - 3.2, pageW - 28, sessionBoxH, 1.5, 1.5, 'F');
      setFont(doc, 'bold');
      doc.setTextColor.apply(doc, BRAND.accent);
      doc.setFontSize(8);
      doc.text(s.label, 17, ctx.y + 1.6);
      setFont(doc, 'normal');
      doc.setTextColor.apply(doc, BRAND.muted);
      var whenLine = s.when + ' · ' + tt('pdf.calc.hoursUnit', { hours: s.hours });
      if (s.donePct != null) whenLine += ' · ' + s.donePct + '%';
      if (s.note) whenLine += s.note;
      var whenWrapped = doc.splitTextToSize(whenLine, pageW - 88);
      doc.text(whenWrapped[0] || whenLine, 46, ctx.y + 1.6);
      setFont(doc, 'bold');
      doc.setTextColor.apply(doc, BRAND.text);
      doc.text(fmtMoney(s.price), pageW - 17, ctx.y + 1.6, { align: 'right' });
      ctx.y += sessionRowH;
    });

    ensureSpace(ctx, 16);
    setFont(doc, 'normal');
    doc.setTextColor.apply(doc, BRAND.muted);
    doc.setFontSize(8);
    var disc = doc.splitTextToSize(tt('pdf.calc.disclaimer'), pageW - 28);
    doc.text(disc, 14, ctx.y);

    footer(doc, pageW, pageH);
    doc.save('sitrifor-kalkulyator.pdf');
    if (global.sfMetrika) global.sfMetrika.goal('calc_pdf_download', { page: location.pathname });
  }

  function bindPdfButtons() {
    document.querySelectorAll('[data-care-pdf]').forEach(function (btn) {
      if (btn.getAttribute('data-bound') === '1') return;
      btn.setAttribute('data-bound', '1');
      btn.addEventListener('click', async function () {
        btn.disabled = true;
        try {
          await exportCare();
          if (global.SitriforUI) global.SitriforUI.showToast(tt('toast.pdfSaved'), 'success');
        } catch (err) {
          console.error(err);
          if (global.SitriforUI) global.SitriforUI.showToast(err.message || tt('toast.pdfError'), 'error');
          else alert(err.message || tt('toast.pdfError'));
        } finally {
          btn.disabled = false;
        }
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindPdfButtons);
  } else {
    bindPdfButtons();
  }

  global.SitriforPDF = {
    exportCare: exportCare,
    exportCalc: exportCalc
  };
})(window);
