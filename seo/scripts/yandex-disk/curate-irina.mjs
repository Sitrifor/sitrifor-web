#!/usr/bin/env node
/**
 * Curate Irina's dump on Yandex Disk into:
 *   Sitrifor-Portfolio/Tattoo-Projects/{Color|BW}/{Body}/{project}/ + promo.md
 *   Sitrifor-Portfolio/Artist-Irina/...
 *   Sitrifor-Portfolio/Art/...
 *   Sitrifor-Portfolio/_Archive/... (raw leftovers)
 *
 * Usage:
 *   node seo/scripts/yandex-disk/curate-irina.mjs --plan
 *   node seo/scripts/yandex-disk/curate-irina.mjs --apply
 *   node seo/scripts/yandex-disk/curate-irina.mjs --apply --limit 5
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDiskClient, diskPath } from './client.mjs';
import { buildPromo, renderPromoMarkdown } from './promo.mjs';
import {
  BODY_CATS,
  COLOR_CATS,
  isImage,
  isVideo,
  projectFolderName,
  slugify
} from './schema.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.resolve(__dirname, '../../data/yandex-disk-portfolio');
const PLAN = path.join(WORK, 'curate-plan.json');

const PORTFOLIO = 'Sitrifor-Portfolio';
const TATTOO_ROOT = diskPath(PORTFOLIO, 'Tattoo-Projects');
const ARTIST_ROOT = diskPath(PORTFOLIO, 'Artist-Irina');
const ART_ROOT = diskPath(PORTFOLIO, 'Art');
const ARCHIVE_ROOT = diskPath(PORTFOLIO, '_Archive');

const CATEGORY_NAMES = new Set(
  [
    'руки',
    'ноги',
    'торс и спина',
    'шея',
    'жопа',
    'живот',
    'цветные',
    'черно белые',
    'черно-белые',
    'чб + цвет',
    'татухи',
    'татки',
    'контент'
  ].map((s) => s.toLowerCase())
);

const MEDIA_RE = /\.(jpe?g|png|webp|heic|tif|tiff|gif|mp4|mov|m4v|webm)$/i;
const SKIP_FILE_RE = /\.(orf|psd|dng|raw|cr2)$/i;

function argVal(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}
function has(args, name) {
  return args.includes(name);
}

function mapColor(parts) {
  const s = parts.join(' ').toLowerCase();
  if (/черно\s*бел|черно-бел|\bчб\b|black/.test(s)) return 'bw';
  return 'color';
}

function mapBody(parts, name) {
  const s = `${parts.join(' ')} ${name}`.toLowerCase();
  if (/шея|ухо|за ухом/.test(s)) return 'neck';
  if (/стопа|лодыж/.test(s)) return 'foot';
  if (/ног|икр|бедр|колен/.test(s)) return 'leg';
  if (/кист|палец|ладон/.test(s)) return 'hand';
  if (/рук|плеч|предплеч|рукав|локт|предплечье/.test(s)) return 'arm';
  if (/спин/.test(s)) return 'back';
  if (/груд|торс|живот|соск/.test(s)) return 'chest';
  if (/ребр|бок/.test(s)) return 'rib';
  if (/голова|лиц/.test(s)) return 'head';
  return 'other';
}

function isCategoryName(name) {
  return CATEGORY_NAMES.has(String(name || '').trim().toLowerCase());
}

function scoreSketch(f) {
  const n = f.name.toLowerCase();
  let s = 0;
  if (/эскиз|sketch|иллюстрац|illustration|design|procreate|line/.test(n)) s += 50;
  if (/\.png$/i.test(n)) s += 20;
  if (/arm_|design|stencil|трафарет/.test(n)) s += 25;
  if (/копия/.test(n)) s -= 10;
  if (f.size > 40e6) s -= 15; // huge png dumps
  if (f.size < 80e3) s -= 20;
  return s;
}

function scorePhoto(f) {
  const n = f.name.toLowerCase();
  let s = 0;
  if (/\.jpe?g$/i.test(n)) s += 30;
  if (/^p[a-z0-9]/i.test(n) || /^pb|^pc|^p[0-9]/i.test(n)) s += 10; // camera
  if (/fullsizerender|snapseed/.test(n)) s += 5;
  if (/копия|copy|\(\d+\)/.test(n)) s -= 15;
  if (/\.tif/i.test(n)) s -= 20;
  if (/\.heic/i.test(n)) s += 5;
  if (f.size > 2e6 && f.size < 12e6) s += 10;
  if (f.size < 200e3) s -= 10;
  return s;
}

function scoreVideo(f) {
  const n = f.name.toLowerCase();
  let s = 0;
  if (/\.(mp4|mov)$/i.test(n)) s += 20;
  // prefer shorter reels-ish over huge dumps
  if (f.size > 3e6 && f.size < 80e6) s += 15;
  if (f.size > 200e6) s -= 20;
  if (/копия/.test(n)) s -= 10;
  return s;
}

function pickAssets(files) {
  const usable = files.filter((f) => MEDIA_RE.test(f.name) && !SKIP_FILE_RE.test(f.name));
  const images = usable.filter((f) => isImage(f.name));
  const videos = usable.filter((f) => isVideo(f.name));

  const sketches = [...images].sort((a, b) => scoreSketch(b) - scoreSketch(a));
  const photos = [...images].sort((a, b) => scorePhoto(b) - scorePhoto(a));
  const vids = [...videos].sort((a, b) => scoreVideo(b) - scoreVideo(a));

  const sketch = sketches[0] && scoreSketch(sketches[0]) >= 10 ? sketches[0] : null;
  let photo = photos.find((p) => !sketch || p.path !== sketch.path) || null;
  // if no strong sketch, still keep a second photo labeled extra
  const photo2 =
    photos.find((p) => p !== photo && (!sketch || p.path !== sketch.path)) || null;
  const video = vids[0] || null;

  return { sketch, photo, photo2, video, images: images.length, videos: videos.length };
}

async function listFilesDeep(client, dirPath, { maxDepth = 1, depth = 0 } = {}) {
  const items = await client.list(dirPath, { recursive: false });
  let files = items.filter((i) => i.type === 'file');
  if (depth >= maxDepth) return files;
  for (const d of items.filter((i) => i.type === 'dir')) {
    files = files.concat(await listFilesDeep(client, d.path, { maxDepth, depth: depth + 1 }));
  }
  return files;
}

async function collectLeafProjects(client, rootPath, parts = []) {
  const items = await client.list(rootPath, { recursive: false });
  const dirs = items.filter((i) => i.type === 'dir');
  const files = items.filter((i) => i.type === 'file');
  const out = [];

  if (dirs.length === 0) {
    if (parts.length >= 2 && !isCategoryName(parts[parts.length - 1])) {
      out.push({ path: rootPath, name: parts[parts.length - 1], parts, files });
    }
    return out;
  }

  for (const d of dirs) {
    out.push(...(await collectLeafProjects(client, d.path, [...parts, d.name])));
  }

  // Loose files sitting in a category folder → synthetic unsorted project
  const media = files.filter((f) => MEDIA_RE.test(f.name));
  if (media.length >= 3 && parts.length >= 2 && isCategoryName(parts[parts.length - 1])) {
    out.push({
      path: rootPath,
      name: `${parts[parts.length - 1]}-unsorted`,
      parts: [...parts, 'unsorted'],
      files: media,
      keepInPlace: true
    });
  }

  return out;
}

function artistPromoExtras(title) {
  return {
    title,
    notes:
      'Работа тату-мастера Ирины. Эскиз и готовая татуировка из одного проекта - так удобно вести сеансы в 634.'
  };
}

async function buildPlan(client) {
  fs.mkdirSync(WORK, { recursive: true });
  const tatkiRoot = diskPath(PORTFOLIO, 'Контент', 'ТАТКИ', 'ТАТУХИ');
  const processRoot = diskPath(PORTFOLIO, 'ПРОЦЕССИКИ');

  const leafs = await collectLeafProjects(client, tatkiRoot, ['ТАТУХИ']);

  // Extra tattoo-ish process folders
  for (const name of ['рукав Барыги', 'русалка на бумаге']) {
    try {
      const p = diskPath(PORTFOLIO, 'ПРОЦЕССИКИ', name);
      const files = await listFilesDeep(client, p, { maxDepth: 1 });
      if (files.length) {
        leafs.push({
          path: p,
          name,
          parts: ['ПРОЦЕССИКИ', name],
          files,
          fromProcess: true
        });
      }
    } catch {
      /* missing ok */
    }
  }

  const projects = [];
  for (const leaf of leafs) {
    if (isCategoryName(leaf.name) && !leaf.name.includes('unsorted')) continue;
    const color = mapColor(leaf.parts);
    const body = mapBody(leaf.parts, leaf.name);
    const assets = pickAssets(leaf.files || []);
    if (assets.images + assets.videos === 0) continue;

    const folderName = projectFolderName({
      date: '2026',
      title: leaf.name,
      color,
      body
    }).replace(/^2026_/, ''); // shorter: Color_Arm_slug

    const dest = diskPath(
      PORTFOLIO,
      'Tattoo-Projects',
      COLOR_CATS[color].id,
      BODY_CATS[body].id,
      `${COLOR_CATS[color].id}_${BODY_CATS[body].id}_${slugify(leaf.name)}`
    );

    projects.push({
      title: leaf.name.trim(),
      source: leaf.path,
      dest,
      color,
      body,
      color_ru: COLOR_CATS[color].ru,
      body_ru: BODY_CATS[body].ru,
      keepInPlace: !!leaf.keepInPlace,
      fromProcess: !!leaf.fromProcess,
      assets: {
        sketch: assets.sketch
          ? { name: assets.sketch.name, path: assets.sketch.path, size: assets.sketch.size }
          : null,
        photo: assets.photo
          ? { name: assets.photo.name, path: assets.photo.path, size: assets.photo.size }
          : null,
        photo2: assets.photo2
          ? { name: assets.photo2.name, path: assets.photo2.path, size: assets.photo2.size }
          : null,
        video: assets.video
          ? { name: assets.video.name, path: assets.video.path, size: assets.video.size }
          : null,
        images: assets.images,
        videos: assets.videos
      }
    });
  }

  const topMoves = [
    {
      from: diskPath(PORTFOLIO, 'Фотосеты'),
      to: diskPath(PORTFOLIO, 'Artist-Irina', 'Фотосеты'),
      why: 'портреты и съёмки Ирины'
    },
    {
      from: diskPath(PORTFOLIO, 'Контент', 'Ирен на работе (съемка)'),
      to: diskPath(PORTFOLIO, 'Artist-Irina', 'На-работе'),
      why: 'Ирина за работой'
    },
    {
      from: diskPath(PORTFOLIO, 'Контент', 'Я за работой'),
      to: diskPath(PORTFOLIO, 'Artist-Irina', 'Я-за-работой'),
      why: 'мастер за работой'
    },
    {
      from: diskPath(PORTFOLIO, 'Контент', 'Селфачи разных лет'),
      to: diskPath(PORTFOLIO, 'Artist-Irina', 'Селфи'),
      why: 'личное'
    },
    {
      from: diskPath(PORTFOLIO, 'Контент', 'селфачи в зеркале'),
      to: diskPath(PORTFOLIO, 'Artist-Irina', 'Селфи-зеркало'),
      why: 'личное'
    },
    {
      from: diskPath(PORTFOLIO, 'Видео картин'),
      to: diskPath(PORTFOLIO, 'Art', 'Видео-картин'),
      why: 'живопись / процесс'
    },
    {
      from: diskPath(PORTFOLIO, 'Старые арты'),
      to: diskPath(PORTFOLIO, 'Art', 'Старые-арты'),
      why: 'иллюстрации'
    },
    {
      from: diskPath(PORTFOLIO, 'ПРОЦЕССИКИ', 'Масло '),
      to: diskPath(PORTFOLIO, 'Art', 'Масло'),
      why: 'живопись маслом'
    },
    {
      from: diskPath(PORTFOLIO, 'ПРОЦЕССИКИ', 'Скульптуры '),
      to: diskPath(PORTFOLIO, 'Art', 'Скульптуры'),
      why: 'скульптура'
    },
    {
      from: diskPath(PORTFOLIO, 'Контент', 'Картины маслом'),
      to: diskPath(PORTFOLIO, 'Art', 'Картины-маслом'),
      why: 'живопись'
    },
    {
      from: diskPath(PORTFOLIO, 'Контент', 'арты'),
      to: diskPath(PORTFOLIO, 'Art', 'Арты'),
      why: 'арты'
    },
    {
      from: diskPath(PORTFOLIO, 'Контент', 'ТАТКИ'),
      to: diskPath(PORTFOLIO, '_Archive', 'ТАТКИ-полный-архив'),
      why: 'полный сырой архив тату после выноса curated'
    },
    {
      from: diskPath(PORTFOLIO, 'Контент'),
      to: diskPath(PORTFOLIO, '_Archive', 'Контент-прочее'),
      why: 'остальной контент Ирины'
    },
    {
      from: diskPath(PORTFOLIO, 'ПРОЦЕССИКИ'),
      to: diskPath(PORTFOLIO, '_Archive', 'ПРОЦЕССИКИ-остаток'),
      why: 'остатки процессов'
    }
  ];

  const plan = {
    created_at: new Date().toISOString(),
    stats: {
      projects: projects.length,
      color: projects.filter((p) => p.color === 'color').length,
      bw: projects.filter((p) => p.color === 'bw').length,
      with_sketch: projects.filter((p) => p.assets.sketch).length,
      with_photo: projects.filter((p) => p.assets.photo).length,
      with_video: projects.filter((p) => p.assets.video).length
    },
    projects,
    topMoves
  };
  fs.writeFileSync(PLAN, JSON.stringify(plan, null, 2));
  return plan;
}

async function movePath(client, from, to, { overwrite = false } = {}) {
  await client.ensureDir(to.replace(/\/[^/]+$/, '') || to);
  // ensure parent of to
  const parent = to.replace(/\/[^/]+\/?$/, '');
  if (parent && parent !== 'disk:') await client.ensureDir(parent);
  try {
    const op = await client.move(from, to, { overwrite, forceAsync: true });
    if (op?.href) await client.waitOperation(op.href, { timeoutMs: 600000 });
    return { ok: true };
  } catch (e) {
    if (e.status === 404) return { ok: false, error: 'not-found' };
    // if dest exists
    if (String(e.message || '').includes('уже существует') || e.status === 409) {
      return { ok: false, error: 'exists' };
    }
    return { ok: false, error: e.message };
  }
}

async function copyFile(client, from, to) {
  try {
    const op = await client.copy(from, to, { overwrite: true });
    if (op?.href) await client.waitOperation(op.href, { timeoutMs: 600000 });
    return true;
  } catch (e) {
    console.error('copy fail', from, '→', to, e.message);
    return false;
  }
}

async function applyProjects(client, projects, { limit = Infinity } = {}) {
  const results = [];
  let n = 0;
  for (const p of projects) {
    if (n >= limit) break;
    n += 1;

    let dest = p.dest;
    let moved = false;

    if (p.keepInPlace) {
      // Leave media where it is; write promo beside or into a curated twin folder with links only
      dest = p.dest;
      await client.ensureDir(dest);
    } else {
      // Move entire project folder (keeps ALL originals: ORF, videos, sketches…)
      const parent = dest.replace(/\/[^/]+\/?$/, '');
      await client.ensureDir(parent);
      const mv = await movePath(client, p.source, dest, { overwrite: false });
      if (mv.ok) {
        moved = true;
      } else if (mv.error === 'exists' || mv.error === 'not-found') {
        // Fallback: ensure dest and continue with promo; if source still there, try copy key assets
        await client.ensureDir(dest);
        if (mv.error === 'not-found') {
          // maybe already moved in a previous run
          moved = false;
        } else {
          // dest exists from partial run - keep it
          moved = false;
        }
      } else {
        console.error('move fail', p.title, mv.error);
        await client.ensureDir(dest);
      }
    }

    // Select role labels from files now at dest (or source if not moved)
    let files = [];
    try {
      files = await client.list(dest, { recursive: false });
      files = files.filter((f) => f.type === 'file');
    } catch {
      try {
        files = (await client.list(p.source, { recursive: false })).filter((f) => f.type === 'file');
      } catch {
        files = [];
      }
    }
    const picked = pickAssets(files);

    const extras = artistPromoExtras(p.title);
    const promo = buildPromo({
      title: p.title,
      color: p.color,
      body: p.body,
      bodyRu: p.body_ru,
      notes: extras.notes
    });
    const md = renderPromoMarkdown(promo, {
      color: p.color,
      colorRu: p.color_ru,
      body: p.body,
      bodyRu: p.body_ru,
      style: null,
      date: new Date().toISOString().slice(0, 10)
    });
    const guide = [
      '',
      '## Что выкладывать',
      '',
      picked.sketch ? `- Эскиз: \`${picked.sketch.name}\`` : '- Эскиз: выберите файл иллюстрации / PNG из папки',
      picked.photo ? `- Фото тату: \`${picked.photo.name}\`` : '- Фото тату: лучший JPG из папки',
      picked.video ? `- Видео: \`${picked.video.name}\`` : '- Видео: если есть процесс или результат',
      '',
      '## Мастер',
      '',
      '- Ирина (тату-мастер)',
      `- Исходный путь до сортировки: \`${p.source}\``,
      ''
    ].join('\n');

    await client.uploadText(md + guide, `${dest}/promo.md`);
    const meta = {
      title: p.title,
      artist: 'Ирина',
      color: p.color,
      body: p.body,
      source: p.source,
      moved,
      suggested: {
        sketch: picked.sketch?.name || null,
        photo: picked.photo?.name || null,
        video: picked.video?.name || null
      },
      file_counts: { images: picked.images, videos: picked.videos },
      tags: promo.tags,
      links: promo.links,
      curated_at: new Date().toISOString()
    };
    await client.uploadText(`${JSON.stringify(meta, null, 2)}\n`, `${dest}/meta.json`);

    results.push({
      title: p.title,
      dest,
      moved,
      suggested: meta.suggested
    });
    const line = `[${n}/${Math.min(projects.length, limit)}] ${moved ? 'MOVE' : 'PROMO'} ${p.title}\n`;
    process.stdout.write(line);
  }
  return results;
}

function ext(name) {
  const m = String(name).match(/(\.[a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : '';
}

async function applyTopMoves(client, moves) {
  const out = [];
  // Non-archive first; within archive: deeper paths (ТАТКИ) before parent (Контент)
  const ordered = [...moves].sort((a, b) => {
    const as = a.to.includes('_Archive') ? 1 : 0;
    const bs = b.to.includes('_Archive') ? 1 : 0;
    if (as !== bs) return as - bs;
    return b.from.length - a.from.length;
  });
  for (const m of ordered) {
    console.log('move', m.from, '→', m.to);
    const r = await movePath(client, m.from, m.to);
    out.push({ ...m, ...r });
  }
  return out;
}

async function writeRootReadme(client) {
  const text = `# Портфолио Ирины (Sitrifor)

Структура после сортировки:

- \`Tattoo-Projects/\` - тату-проекты для контента (эскиз/фото/видео + promo.md)
  - \`Color/\` и \`BW/\` → части тела (Arm, Leg, …)
- \`Artist-Irina/\` - фотосеты, съёмки, мастер за работой
- \`Art/\` - картины, арты, скульптура, видео живописи
- \`_Archive/\` - полный сырой архив без потерь
- \`Color/\` и \`BW/\` в корне - служебные шаблоны (можно не использовать)

Каждый проект в \`Tattoo-Projects\` содержит:
- \`01-sketch.*\` (если нашёлся)
- \`02-photo.*\`
- \`03-video.*\` (если есть)
- \`promo.md\` - тексты для TikTok / Instagram / VK / LinkedIn под 634 и sitrifor.ru
- \`meta.json\`

Мастер: Ирина. Продвижение: приложение 634 + https://sitrifor.ru
`;
  await client.uploadText(text, diskPath(PORTFOLIO, 'README.md'));
}

async function main() {
  const args = process.argv.slice(2);
  const client = createDiskClient();

  if (has(args, '--plan') || args.length === 0) {
    const plan = await buildPlan(client);
    console.log(JSON.stringify(plan.stats, null, 2));
    console.log('Plan:', PLAN);
    console.log('Projects sample:');
    for (const p of plan.projects.slice(0, 12)) {
      console.log(
        `- [${p.color}/${p.body}] ${p.title}  s:${!!p.assets.sketch} p:${!!p.assets.photo} v:${!!p.assets.video}`
      );
    }
    return;
  }

  if (has(args, '--apply')) {
    if (!fs.existsSync(PLAN)) {
      console.log('Building plan first...');
      await buildPlan(client);
    }
    const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
    const limit = Number(argVal(args, '--limit') || Infinity);
    const skipMoves = has(args, '--skip-moves');
    const onlyMoves = has(args, '--only-moves');

    await client.ensureDir(TATTOO_ROOT);
    await client.ensureDir(ARTIST_ROOT);
    await client.ensureDir(ART_ROOT);
    await client.ensureDir(ARCHIVE_ROOT);

    let projectResults = [];
    if (!onlyMoves) {
      projectResults = await applyProjects(client, plan.projects, { limit });
    }

    let moveResults = [];
    if (!skipMoves && !Number.isFinite(limit)) {
      // only do big moves when processing full set
      moveResults = await applyTopMoves(client, plan.topMoves);
    } else if (!skipMoves && has(args, '--with-moves')) {
      moveResults = await applyTopMoves(client, plan.topMoves);
    }

    await writeRootReadme(client);

    const report = {
      at: new Date().toISOString(),
      projects: projectResults,
      moves: moveResults
    };
    const reportPath = path.join(WORK, `curate-report-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log('Done. Report:', reportPath);
    console.log(
      `Curated projects: ${projectResults.length}, moves: ${moveResults.filter((m) => m.ok).length}`
    );
    return;
  }

  console.log('Use --plan or --apply [--limit N] [--skip-moves|--with-moves|--only-moves]');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
