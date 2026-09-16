#!/usr/bin/env node
/**
 * Fast curation for Irina's Yandex Disk dump.
 * 1) Remap big tattoo branches into Tattoo-Projects/Color|BW/{Body}
 * 2) Write promo.md + meta.json into every leaf project
 * 3) Sort Artist-Irina / Art / _Archive at top level
 *
 *   node seo/scripts/yandex-disk/curate-fast.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDiskClient, diskPath } from './client.mjs';
import { buildPromo, renderPromoMarkdown } from './promo.mjs';
import { BODY_CATS, COLOR_CATS, isImage, isVideo, slugify } from './schema.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.resolve(__dirname, '../../data/yandex-disk-portfolio');
const PORTFOLIO = 'Sitrifor-Portfolio';

const MEDIA_RE = /\.(jpe?g|png|webp|heic|tif|tiff|gif|mp4|mov|m4v|webm)$/i;

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

async function movePath(client, from, to) {
  const parent = to.replace(/\/[^/]+\/?$/, '');
  if (parent.startsWith('disk:')) await client.ensureDir(parent);
  try {
    const op = await client.move(from, to, { overwrite: false, forceAsync: true });
    if (op?.href) await client.waitOperation(op.href, { timeoutMs: 900000 });
    return { ok: true };
  } catch (e) {
    const msg = e.message || String(e);
    if (/404|не найден|NotFound/i.test(msg) || e.status === 404) return { ok: false, error: 'not-found' };
    if (/409|уже существует|DiskResourceAlreadyExists/i.test(msg) || e.status === 409)
      return { ok: false, error: 'exists' };
    return { ok: false, error: msg };
  }
}

async function exists(client, p) {
  try {
    await client.meta(p);
    return true;
  } catch {
    return false;
  }
}

function mapBodyFromName(name) {
  const s = String(name).toLowerCase();
  if (/шея|ухо/.test(s)) return 'neck';
  if (/ног/.test(s)) return 'leg';
  if (/стоп/.test(s)) return 'foot';
  if (/рук|плеч|предплеч|рукав/.test(s)) return 'arm';
  if (/спин|торс/.test(s)) return 'back';
  if (/груд|живот/.test(s)) return 'chest';
  if (/ребр|бок/.test(s)) return 'rib';
  if (/жоп/.test(s)) return 'other';
  return 'other';
}

function mapColorFromPath(p) {
  const s = p.toLowerCase();
  if (/черно|\/bw\b|\bbw\//.test(s)) return 'bw';
  return 'color';
}

function scoreSketch(name, size) {
  const n = name.toLowerCase();
  let s = 0;
  if (/эскиз|sketch|иллюстрац|illustration|design|procreate|arm_/.test(n)) s += 50;
  if (/\.png$/i.test(n)) s += 15;
  if (/копия/.test(n)) s -= 10;
  if (size > 40e6) s -= 10;
  return s;
}

function scorePhoto(name, size) {
  const n = name.toLowerCase();
  let s = 0;
  if (/\.jpe?g$/i.test(n)) s += 30;
  if (/копия|\(\d+\)/.test(n)) s -= 15;
  if (size > 1.5e6 && size < 15e6) s += 10;
  return s;
}

function scoreVideo(name, size) {
  let s = /\.(mp4|mov)$/i.test(name) ? 20 : 0;
  if (size > 3e6 && size < 100e6) s += 15;
  if (size > 250e6) s -= 20;
  return s;
}

function pickSuggested(files) {
  const media = files.filter((f) => MEDIA_RE.test(f.name));
  const images = media.filter((f) => isImage(f.name));
  const videos = media.filter((f) => isVideo(f.name));
  const sketch = [...images].sort((a, b) => scoreSketch(b.name, b.size) - scoreSketch(a.name, a.size))[0];
  const photo = [...images]
    .filter((f) => !sketch || f.path !== sketch.path)
    .sort((a, b) => scorePhoto(b.name, b.size) - scorePhoto(a.name, a.size))[0];
  const video = [...videos].sort((a, b) => scoreVideo(b.name, b.size) - scoreVideo(a.name, a.size))[0];
  const sketchOk = sketch && scoreSketch(sketch.name, sketch.size) >= 10 ? sketch : null;
  return {
    sketch: sketchOk?.name || null,
    photo: photo?.name || null,
    video: video?.name || null,
    images: images.length,
    videos: videos.length
  };
}

async function collectLeaves(client, root, parts = []) {
  const items = await client.list(root, { recursive: false });
  const dirs = items.filter((i) => i.type === 'dir');
  const files = items.filter((i) => i.type === 'file');
  const out = [];
  if (!dirs.length) {
    out.push({ path: root, name: parts[parts.length - 1] || root, parts, files });
    return out;
  }
  for (const d of dirs) out.push(...(await collectLeaves(client, d.path, [...parts, d.name])));
  // also treat folder with both files+dirs as project if it has media and looks like a named work
  const media = files.filter((f) => MEDIA_RE.test(f.name));
  if (media.length >= 2) {
    out.push({ path: root, name: parts[parts.length - 1] || root, parts, files: media, mixed: true });
  }
  return out;
}

async function writePromo(client, project, color, body) {
  const suggested = pickSuggested(project.files || []);
  const title = String(project.name || 'tattoo').trim();
  const promo = buildPromo({
    title,
    color,
    body,
    bodyRu: BODY_CATS[body].ru,
    notes:
      'Работа тату-мастера Ирины. Эскиз и готовая татуировка из одного проекта - так удобно вести сеансы в 634.'
  });
  const md =
    renderPromoMarkdown(promo, {
      color,
      colorRu: COLOR_CATS[color].ru,
      body,
      bodyRu: BODY_CATS[body].ru,
      date: new Date().toISOString().slice(0, 10)
    }) +
    [
      '',
      '## Что выкладывать из этой папки',
      '',
      suggested.sketch ? `- Эскиз: \`${suggested.sketch}\`` : '- Эскиз: файл иллюстрации / PNG, если есть',
      suggested.photo ? `- Фото: \`${suggested.photo}\`` : '- Фото: лучший JPG результата',
      suggested.video ? `- Видео: \`${suggested.video}\`` : '- Видео: процесс или результат, если есть',
      '',
      '## Мастер',
      '',
      '- Ирина',
      `- Папка: \`${project.path}\``,
      ''
    ].join('\n');

  await client.uploadText(md, `${project.path}/promo.md`);
  await client.uploadText(
    `${JSON.stringify(
      {
        title,
        artist: 'Ирина',
        color,
        body,
        suggested,
        tags: promo.tags,
        links: promo.links,
        curated_at: new Date().toISOString()
      },
      null,
      2
    )}\n`,
    `${project.path}/meta.json`
  );
  return suggested;
}

async function main() {
  fs.mkdirSync(WORK, { recursive: true });
  const client = createDiskClient();
  const report = { moves: [], promos: [], errors: [] };

  await client.ensureDir(diskPath(PORTFOLIO, 'Tattoo-Projects'));
  await client.ensureDir(diskPath(PORTFOLIO, 'Artist-Irina'));
  await client.ensureDir(diskPath(PORTFOLIO, 'Art'));
  await client.ensureDir(diskPath(PORTFOLIO, '_Archive'));

  // Prefer sources still under Контент/ТАТКИ; also accept already-moved branches
  const branchMoves = [
    // Color body branches
    {
      from: diskPath(PORTFOLIO, 'Контент', 'ТАТКИ', 'ТАТУХИ', 'Цветные', 'Руки'),
      to: diskPath(PORTFOLIO, 'Tattoo-Projects', 'Color', 'Arm')
    },
    {
      from: diskPath(PORTFOLIO, 'Контент', 'ТАТКИ', 'ТАТУХИ', 'Цветные', 'Ноги'),
      to: diskPath(PORTFOLIO, 'Tattoo-Projects', 'Color', 'Leg')
    },
    {
      from: diskPath(PORTFOLIO, 'Контент', 'ТАТКИ', 'ТАТУХИ', 'Цветные', 'Торс и спина'),
      to: diskPath(PORTFOLIO, 'Tattoo-Projects', 'Color', 'Back')
    },
    {
      from: diskPath(PORTFOLIO, 'Контент', 'ТАТКИ', 'ТАТУХИ', 'Цветные', 'Шея'),
      to: diskPath(PORTFOLIO, 'Tattoo-Projects', 'Color', 'Neck')
    },
    {
      from: diskPath(PORTFOLIO, 'Контент', 'ТАТКИ', 'ТАТУХИ', 'Цветные', 'Жопа'),
      to: diskPath(PORTFOLIO, 'Tattoo-Projects', 'Color', 'Other', 'Hip')
    },
    // BW
    {
      from: diskPath(PORTFOLIO, 'Контент', 'ТАТКИ', 'ТАТУХИ', 'Черно белые ', 'Руки'),
      to: diskPath(PORTFOLIO, 'Tattoo-Projects', 'BW', 'Arm')
    },
    {
      from: diskPath(PORTFOLIO, 'Контент', 'ТАТКИ', 'ТАТУХИ', 'Черно белые', 'Руки'),
      to: diskPath(PORTFOLIO, 'Tattoo-Projects', 'BW', 'Arm')
    },
    {
      from: diskPath(PORTFOLIO, 'Контент', 'ТАТКИ', 'ТАТУХИ', 'Черно белые ', 'Ноги'),
      to: diskPath(PORTFOLIO, 'Tattoo-Projects', 'BW', 'Leg')
    },
    {
      from: diskPath(PORTFOLIO, 'Контент', 'ТАТКИ', 'ТАТУХИ', 'Черно белые', 'Ноги'),
      to: diskPath(PORTFOLIO, 'Tattoo-Projects', 'BW', 'Leg')
    },
    {
      from: diskPath(PORTFOLIO, 'Контент', 'ТАТКИ', 'ТАТУХИ', 'Черно белые ', 'Торс и спина'),
      to: diskPath(PORTFOLIO, 'Tattoo-Projects', 'BW', 'Back')
    },
    {
      from: diskPath(PORTFOLIO, 'Контент', 'ТАТКИ', 'ТАТУХИ', 'Черно белые', 'Торс и спина'),
      to: diskPath(PORTFOLIO, 'Tattoo-Projects', 'BW', 'Back')
    },
    {
      from: diskPath(PORTFOLIO, 'Контент', 'ТАТКИ', 'ТАТУХИ', 'Черно белые', 'живот'),
      to: diskPath(PORTFOLIO, 'Tattoo-Projects', 'BW', 'Chest', 'живот')
    },
    {
      from: diskPath(PORTFOLIO, 'Контент', 'ТАТКИ', 'ТАТУХИ', 'Черно белые', 'цветок за ухом '),
      to: diskPath(PORTFOLIO, 'Tattoo-Projects', 'BW', 'Neck', 'цветок за ухом')
    },
    // Mixed + leftovers under color root
    {
      from: diskPath(PORTFOLIO, 'Контент', 'ТАТКИ', 'ТАТУХИ', 'Чб + цвет '),
      to: diskPath(PORTFOLIO, 'Tattoo-Projects', 'Color', 'Other', 'Mixed-BW-Color')
    },
    {
      from: diskPath(PORTFOLIO, 'Контент', 'ТАТКИ', 'ТАТУХИ', 'Чб + цвет'),
      to: diskPath(PORTFOLIO, 'Tattoo-Projects', 'Color', 'Other', 'Mixed-BW-Color')
    },
    // Process tattoo projects
    {
      from: diskPath(PORTFOLIO, 'ПРОЦЕССИКИ', 'рукав Барыги'),
      to: diskPath(PORTFOLIO, 'Tattoo-Projects', 'Color', 'Arm', 'рукав Барыги')
    },
    {
      from: diskPath(PORTFOLIO, 'ПРОЦЕССИКИ', 'русалка на бумаге'),
      to: diskPath(PORTFOLIO, 'Tattoo-Projects', 'Color', 'Other', 'русалка на бумаге')
    }
  ];

  // Move remaining loose projects under Цветные / Черно белые roots into Other
  const looseColorParents = [
    diskPath(PORTFOLIO, 'Контент', 'ТАТКИ', 'ТАТУХИ', 'Цветные'),
    diskPath(PORTFOLIO, 'Контент', 'ТАТКИ', 'ТАТУХИ', 'Черно белые'),
    diskPath(PORTFOLIO, 'Контент', 'ТАТКИ', 'ТАТУХИ', 'Черно белые ')
  ];

  log('=== Branch moves ===');
  for (const m of branchMoves) {
    if (!(await exists(client, m.from))) {
      report.moves.push({ ...m, ok: false, error: 'not-found' });
      continue;
    }
    // If dest exists, move into dest as subfolder with original name
    let to = m.to;
    if (await exists(client, to)) {
      const base = m.from.split('/').pop();
      to = `${m.to.replace(/\/$/, '')}/${base}`;
      if (await exists(client, to)) {
        log(`skip exists ${to}`);
        report.moves.push({ from: m.from, to, ok: false, error: 'exists' });
        continue;
      }
    }
    log(`MOVE ${m.from} → ${to}`);
    const r = await movePath(client, m.from, to);
    report.moves.push({ from: m.from, to, ...r });
    log(r.ok ? '  ok' : `  fail: ${r.error}`);
  }

  // Sweep leftover project folders still under Цветные/Черно-белые
  log('=== Sweep leftovers under color roots ===');
  for (const parent of looseColorParents) {
    if (!(await exists(client, parent))) continue;
    const color = /черно/i.test(parent) ? 'bw' : 'color';
    const items = await client.list(parent, { recursive: false });
    for (const it of items.filter((x) => x.type === 'dir')) {
      const body = mapBodyFromName(it.name);
      const to = diskPath(
        PORTFOLIO,
        'Tattoo-Projects',
        COLOR_CATS[color].id,
        BODY_CATS[body].id,
        it.name.trim()
      );
      if (await exists(client, to)) {
        report.moves.push({ from: it.path, to, ok: false, error: 'exists' });
        continue;
      }
      log(`MOVE leftover ${it.name} → ${COLOR_CATS[color].id}/${BODY_CATS[body].id}`);
      const r = await movePath(client, it.path, to);
      report.moves.push({ from: it.path, to, ...r });
    }
    // leftover files in color root
    const files = items.filter((x) => x.type === 'file' && MEDIA_RE.test(x.name));
    if (files.length) {
      const bucket = diskPath(
        PORTFOLIO,
        'Tattoo-Projects',
        COLOR_CATS[color].id,
        'Other',
        `_loose-${slugify(parent.split('/').pop())}`
      );
      await client.ensureDir(bucket);
      for (const f of files) {
        const r = await movePath(client, f.path, `${bucket}/${f.name}`);
        report.moves.push({ from: f.path, to: `${bucket}/${f.name}`, ...r });
      }
    }
  }

  // Also recover folder moved earlier by slow script (Грудак сова etc.)
  // Promo pass over entire Tattoo-Projects
  log('=== Promo pass ===');
  const tattooRoot = diskPath(PORTFOLIO, 'Tattoo-Projects');
  const leaves = await collectLeaves(client, tattooRoot, ['Tattoo-Projects']);
  // de-dupe by path; skip pure category shells with only dirs and no files handled above
  const seen = new Set();
  let i = 0;
  for (const leaf of leaves) {
    if (seen.has(leaf.path)) continue;
    seen.add(leaf.path);
    const media = (leaf.files || []).filter((f) => MEDIA_RE.test(f.name));
    if (media.length === 0) continue;
    // skip top template empties
    if (/\/(Color|BW)\/(Arm|Leg|Back|Chest|Neck|Hand|Foot|Head|Rib|Other)\/?$/i.test(leaf.path))
      continue;
    leaf.files = media;
    const color = mapColorFromPath(leaf.path);
    const body = mapBodyFromName(leaf.parts.slice(-3).join(' ') + ' ' + leaf.name);
    i += 1;
    try {
      const suggested = await writePromo(client, leaf, color, body);
      report.promos.push({ path: leaf.path, title: leaf.name, suggested });
      log(`[${i}] promo ${leaf.name}`);
    } catch (e) {
      report.errors.push({ path: leaf.path, error: e.message });
      log(`[${i}] ERR ${leaf.name}: ${e.message}`);
    }
  }

  // Top-level artist / art organization
  log('=== Artist / Art / Archive ===');
  const topMoves = [
    {
      from: diskPath(PORTFOLIO, 'Фотосеты'),
      to: diskPath(PORTFOLIO, 'Artist-Irina', 'Фотосеты')
    },
    {
      from: diskPath(PORTFOLIO, 'Контент', 'Ирен на работе (съемка)'),
      to: diskPath(PORTFOLIO, 'Artist-Irina', 'На-работе')
    },
    {
      from: diskPath(PORTFOLIO, 'Контент', 'Я за работой'),
      to: diskPath(PORTFOLIO, 'Artist-Irina', 'Я-за-работой')
    },
    {
      from: diskPath(PORTFOLIO, 'Контент', 'Селфачи разных лет'),
      to: diskPath(PORTFOLIO, 'Artist-Irina', 'Селфи')
    },
    {
      from: diskPath(PORTFOLIO, 'Контент', 'селфачи в зеркале'),
      to: diskPath(PORTFOLIO, 'Artist-Irina', 'Селфи-зеркало')
    },
    {
      from: diskPath(PORTFOLIO, 'Контент', 'Съемка в зелени и на сеновале'),
      to: diskPath(PORTFOLIO, 'Artist-Irina', 'Съемка-зелень')
    },
    {
      from: diskPath(PORTFOLIO, 'Контент', 'Съемка на море'),
      to: diskPath(PORTFOLIO, 'Artist-Irina', 'Съемка-море')
    },
    {
      from: diskPath(PORTFOLIO, 'Видео картин'),
      to: diskPath(PORTFOLIO, 'Art', 'Видео-картин')
    },
    {
      from: diskPath(PORTFOLIO, 'Старые арты'),
      to: diskPath(PORTFOLIO, 'Art', 'Старые-арты')
    },
    {
      from: diskPath(PORTFOLIO, 'ПРОЦЕССИКИ', 'Масло '),
      to: diskPath(PORTFOLIO, 'Art', 'Масло')
    },
    {
      from: diskPath(PORTFOLIO, 'ПРОЦЕССИКИ', 'Скульптуры '),
      to: diskPath(PORTFOLIO, 'Art', 'Скульптуры')
    },
    {
      from: diskPath(PORTFOLIO, 'Контент', 'Картины маслом'),
      to: diskPath(PORTFOLIO, 'Art', 'Картины-маслом')
    },
    {
      from: diskPath(PORTFOLIO, 'Контент', 'арты'),
      to: diskPath(PORTFOLIO, 'Art', 'Арты')
    },
    // archives last
    {
      from: diskPath(PORTFOLIO, 'Контент', 'ТАТКИ'),
      to: diskPath(PORTFOLIO, '_Archive', 'ТАТКИ-остаток')
    },
    {
      from: diskPath(PORTFOLIO, 'Контент'),
      to: diskPath(PORTFOLIO, '_Archive', 'Контент-прочее')
    },
    {
      from: diskPath(PORTFOLIO, 'ПРОЦЕССИКИ'),
      to: diskPath(PORTFOLIO, '_Archive', 'ПРОЦЕССИКИ-остаток')
    }
  ];

  for (const m of topMoves.sort((a, b) => b.from.length - a.from.length)) {
    if (!(await exists(client, m.from))) {
      report.moves.push({ ...m, ok: false, error: 'not-found' });
      continue;
    }
    let to = m.to;
    if (await exists(client, to)) {
      to = `${m.to}-${Date.now()}`;
    }
    log(`TOP ${m.from} → ${to}`);
    const r = await movePath(client, m.from, to);
    report.moves.push({ from: m.from, to, ...r });
  }

  const readme = `# Портфолио Ирины (Sitrifor / 634)

## Структура

- \`Tattoo-Projects/Color|BW/{Arm,Leg,Back,...}/<проект>/\`
  - все исходники проекта (фото, видео, эскизы)
  - \`promo.md\` - тексты для TikTok / Instagram / VK / LinkedIn
  - \`meta.json\` - теги и рекомендованные файлы для поста
- \`Artist-Irina/\` - фотосеты и съёмки мастера
- \`Art/\` - картины, арты, скульптура
- \`_Archive/\` - всё остальное без потерь

Мастер: **Ирина**. Продвижение: приложение **634** + https://sitrifor.ru
`;
  await client.uploadText(readme, diskPath(PORTFOLIO, 'README.md'));

  // Remove empty template Color/BW at portfolio root if still empty shells from init
  // (leave them; harmless)

  const reportPath = path.join(WORK, `curate-fast-${Date.now()}.json`);
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        moves_ok: report.moves.filter((m) => m.ok).length,
        promos: report.promos.length,
        errors: report.errors,
        report
      },
      null,
      2
    )
  );
  log(`DONE promos=${report.promos.length} moves_ok=${report.moves.filter((m) => m.ok).length}`);
  log(`Report: ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
