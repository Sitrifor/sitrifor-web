#!/usr/bin/env node
/**
 * Organize a Yandex Disk dump into matched tattoo projects.
 *
 * Expected flow:
 * 1) User dumps mixed sketch/photo/video into disk:/Sitrifor-Portfolio/Входящие
 * 2) node seo/scripts/yandex-disk/organize.mjs --init
 * 3) node seo/scripts/yandex-disk/organize.mjs --plan
 * 4) Review plan JSON, optionally edit pairs
 * 5) node seo/scripts/yandex-disk/organize.mjs --apply
 *
 * Optional local dump:
 *   --local-inbox /path/to/dump  (process local files, upload to Disk)
 *
 * Pairing rules (auto):
 * - Same stem prefix (floral_arm_sketch + floral_arm_photo)
 * - Explicit pairs file: Входящие/pairs.json
 * - Leftovers go to На-проверку
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDiskClient, diskPath, loadEnv } from './client.mjs';
import { buildPromo, renderPromoMarkdown } from './promo.mjs';
import {
  BODY_CATS,
  COLOR_CATS,
  INBOX_FOLDER,
  MANIFEST_NAME,
  PROJECTS_FOLDER,
  REVIEW_FOLDER,
  ROOT_FOLDER,
  detectBody,
  detectColor,
  detectRole,
  isImage,
  isVideo,
  pathBasename,
  projectDiskPath,
  projectFolderName,
  roleFileName,
  stemKey
} from './schema.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEO_ROOT = path.resolve(__dirname, '../..');
const WORK = path.join(SEO_ROOT, 'data/yandex-disk-portfolio');
const PLAN_PATH = path.join(WORK, 'plan.json');

function argValue(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}

function has(args, name) {
  return args.includes(name);
}

async function initTree(client) {
  await client.ensureDir(diskPath(ROOT_FOLDER, INBOX_FOLDER));
  await client.ensureDir(diskPath(ROOT_FOLDER, REVIEW_FOLDER));
  for (const color of Object.values(COLOR_CATS)) {
    for (const body of Object.values(BODY_CATS)) {
      await client.ensureDir(diskPath(ROOT_FOLDER, PROJECTS_FOLDER, color.id, body.id));
    }
  }
  const readme = [
    '# Портфолио Sitrifor',
    '',
    `Сюда складывайте сырой материал: ${INBOX_FOLDER}/`,
    '',
    'Имена файлов лучше размечать ролями и категориями, например:',
    '- dragon_рука_цвет_sketch.jpg',
    '- dragon_рука_цвет_photo.jpg',
    '- dragon_рука_цвет_video.mp4',
    '',
    `Или положите pairs.json в ${INBOX_FOLDER}/`,
    '',
    `Готовые проекты: ${PROJECTS_FOLDER}/Цветные|Черно-белые/{Рука,Нога,Спина,Грудь,Шея,Другое}/`,
    '',
    'В каждом проекте:',
    '- исходники (эскиз / фото / видео)',
    '- promo.md (TikTok / Instagram / VK / LinkedIn)',
    '- meta.json',
    ''
  ].join('\n');
  await client.uploadText(readme, diskPath(ROOT_FOLDER, 'README.md'));
  return { root: diskPath(ROOT_FOLDER) };
}

function localFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const walk = (d) => {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else out.push({ name, path: p, size: st.size, mtime: st.mtimeMs });
    }
  };
  walk(dir);
  return out;
}

async function listInbox(client, localInbox) {
  if (localInbox) {
    return localFiles(localInbox)
      .filter((f) => isImage(f.name) || isVideo(f.name) || f.name === 'pairs.json')
      .map((f) => ({
        name: f.name,
        path: f.path,
        local: true,
        size: f.size,
        media_type: isVideo(f.name) ? 'video' : isImage(f.name) ? 'image' : 'file'
      }));
  }
  const items = await client.list(diskPath(ROOT_FOLDER, INBOX_FOLDER), { recursive: false });
  return items
    .filter((it) => it.type === 'file')
    .map((it) => ({
      name: it.name,
      path: it.path,
      local: false,
      size: it.size,
      media_type: it.media_type,
      preview: it.preview
    }));
}

function loadPairs(items, localInbox) {
  const pairItem = items.find((i) => i.name.toLowerCase() === 'pairs.json');
  if (!pairItem) return [];
  if (pairItem.local) {
    return JSON.parse(fs.readFileSync(pairItem.path, 'utf8'));
  }
  return null; // remote pairs loaded later
}

async function loadRemotePairs(client, items) {
  const pairItem = items.find((i) => i.name.toLowerCase() === 'pairs.json');
  if (!pairItem || pairItem.local) return loadPairs(items) || [];
  const tmp = path.join(WORK, 'pairs.json');
  await client.downloadTo(pairItem.path, tmp);
  return JSON.parse(fs.readFileSync(tmp, 'utf8'));
}

function autoGroup(mediaItems) {
  const byStem = new Map();
  for (const it of mediaItems) {
    const key = stemKey(it.name) || normalizeLoose(it.name);
    if (!byStem.has(key)) byStem.set(key, []);
    byStem.get(key).push(it);
  }

  const projects = [];
  const singles = [];

  for (const [stem, files] of byStem) {
    const roles = files.map((f) => ({ ...f, role: detectRole(f.name) }));
    const hasSketch = roles.some((r) => r.role === 'sketch');
    const hasPhoto = roles.some((r) => r.role === 'photo');
    const hasVideo = roles.some((r) => r.role === 'video');
    const joined = files.map((f) => f.name).join(' ');
    const color = detectColor(joined) || detectColor(stem) || 'color';
    const body = detectBody(joined) || detectBody(stem) || 'other';

    // Promote unlabeled images: if 2+ images and one looks like sketch by name elsewhere -
    // if only one image + video, treat image as photo; if two images without roles, first=sketch second=photo
    const images = roles.filter((r) => isImage(r.name));
    const videos = roles.filter((r) => isVideo(r.name));
    let assigned = roles;

    if (!hasSketch && !hasPhoto && images.length >= 2) {
      assigned = roles.map((r) => {
        if (!isImage(r.name)) return r;
        return r;
      });
      // sort images by name; first → sketch, rest → photo
      const imgs = images.sort((a, b) => a.name.localeCompare(b.name));
      const mapRole = new Map();
      imgs.forEach((img, idx) => mapRole.set(img.path, idx === 0 ? 'sketch' : 'photo'));
      assigned = roles.map((r) =>
        mapRole.has(r.path) ? { ...r, role: mapRole.get(r.path) } : r
      );
    } else if (!hasSketch && hasPhoto === false && images.length === 1 && videos.length >= 1) {
      assigned = roles.map((r) => (isImage(r.name) ? { ...r, role: 'photo' } : r));
    }

    const sketchN = assigned.filter((r) => r.role === 'sketch').length;
    const photoN = assigned.filter((r) => r.role === 'photo').length;
    const videoN = assigned.filter((r) => r.role === 'video').length;
    const matched = (sketchN >= 1 && photoN >= 1) || (photoN >= 1 && videoN >= 1) || files.length >= 2;

    const project = {
      id: stem || `p-${projects.length + 1}`,
      title: humanTitle(stem),
      color,
      body,
      style: null,
      confidence: matched && (sketchN + photoN + videoN >= 2) ? 'auto' : 'low',
      files: assigned.map((r) => ({
        name: r.name,
        path: r.path,
        local: !!r.local,
        role: r.role,
        size: r.size
      }))
    };

    if (matched && project.confidence === 'auto') projects.push(project);
    else if (files.length === 1) singles.push(...files);
    else {
      project.confidence = 'review';
      projects.push(project);
    }
  }

  return { projects, singles };
}

function normalizeLoose(name) {
  return pathBasename(name)
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9а-я]+/gi, '_')
    .replace(/^_+|_+$/g, '');
}

function humanTitle(stem) {
  if (!stem) return 'Tattoo project';
  return stem
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .slice(0, 60);
}

function fromExplicitPairs(pairs, items) {
  const byName = new Map(items.map((i) => [i.name, i]));
  const used = new Set();
  const projects = [];
  for (const [idx, p] of pairs.entries()) {
    const files = (p.files || [])
      .map((name) => {
        const it = byName.get(name);
        if (!it) return null;
        used.add(it.path);
        return {
          name: it.name,
          path: it.path,
          local: !!it.local,
          role: p.roles?.[name] || detectRole(it.name),
          size: it.size
        };
      })
      .filter(Boolean);

    // fix roles if missing
    const imgs = files.filter((f) => isImage(f.name));
    if (!files.some((f) => f.role === 'sketch') && imgs.length >= 2) {
      imgs.sort((a, b) => a.name.localeCompare(b.name));
      files.forEach((f) => {
        if (f.name === imgs[0].name) f.role = 'sketch';
        else if (isImage(f.name) && f.role !== 'sketch') f.role = 'photo';
      });
    }

    projects.push({
      id: p.id || `pair-${idx + 1}`,
      title: p.title || humanTitle(stemKey(files[0]?.name || `pair-${idx}`)),
      color: p.color || detectColor([p.title, ...(p.files || [])].join(' ')) || 'color',
      body: p.body || detectBody([p.title, ...(p.files || [])].join(' ')) || 'other',
      style: p.style || null,
      notes: p.notes || '',
      confidence: 'manual',
      files
    });
  }
  return { projects, used };
}

async function buildPlan(client, { localInbox } = {}) {
  fs.mkdirSync(WORK, { recursive: true });
  const items = await listInbox(client, localInbox);
  const media = items.filter((i) => i.name.toLowerCase() !== 'pairs.json');
  const pairs = localInbox ? loadPairs(items, localInbox) || [] : await loadRemotePairs(client, items);

  const explicit = fromExplicitPairs(pairs, media);
  const remaining = media.filter((m) => !explicit.used.has(m.path));
  const auto = autoGroup(remaining);

  const projects = [...explicit.projects, ...auto.projects];
  const reviewFiles = auto.singles.map((f) => ({
    name: f.name,
    path: f.path,
    local: !!f.local,
    reason: 'unmatched-single'
  }));

  // low-confidence also flagged
  for (const p of projects) {
    if (p.confidence === 'review' || p.confidence === 'low') {
      p.needs_review = true;
    }
  }

  const plan = {
    created_at: new Date().toISOString(),
    root: diskPath(ROOT_FOLDER),
    inbox: localInbox || diskPath(ROOT_FOLDER, INBOX_FOLDER),
    local_inbox: localInbox || null,
    stats: {
      files: media.length,
      projects: projects.length,
      review_files: reviewFiles.length,
      manual_pairs: explicit.projects.length
    },
    projects,
    review_files: reviewFiles
  };

  fs.writeFileSync(PLAN_PATH, JSON.stringify(plan, null, 2));
  return plan;
}

async function applyPlan(client, plan, { dry = false, moveReview = true } = {}) {
  const results = [];

  for (const project of plan.projects) {
    if (project.needs_review && project.confidence !== 'manual') {
      // send whole project bundle to review unless --force-all
      if (!plan.force_all) {
        results.push({ id: project.id, status: 'skipped-review' });
        continue;
      }
    }

    const date = new Date().toISOString().slice(0, 10);
    const folderName = projectFolderName({
      date,
      title: project.title,
      color: project.color,
      body: project.body
    });
    const dest = projectDiskPath({
      color: project.color,
      body: project.body,
      folderName
    });

    if (dry) {
      results.push({ id: project.id, status: 'dry', dest });
      continue;
    }

    await client.ensureDir(dest);

    // copy/move files with normalized names
    const counters = { sketch: 0, photo: 0, video: 0, other: 0 };
    const placed = [];
    for (const f of project.files) {
      const role = f.role || detectRole(f.name);
      counters[role] = (counters[role] || 0) + 1;
      const destName = roleFileName(role, f.name, counters[role]);
      const destPath = `${dest}/${destName}`;

      if (f.local || plan.local_inbox) {
        const localPath = f.local ? f.path : path.join(plan.local_inbox, f.name);
        await client.uploadFile(localPath, destPath, { overwrite: true });
      } else {
        const op = await client.move(f.path, destPath, { overwrite: true });
        if (op?.href) await client.waitOperation(op.href);
      }
      placed.push({ role, name: destName, from: f.name });
    }

    const colorRu = COLOR_CATS[project.color]?.ru;
    const bodyRu = BODY_CATS[project.body]?.ru;
    const promo = buildPromo({
      title: project.title,
      style: project.style,
      color: project.color,
      body: project.body,
      bodyRu,
      notes: project.notes
    });
    const md = renderPromoMarkdown(promo, {
      color: project.color,
      colorRu,
      body: project.body,
      bodyRu,
      style: project.style,
      date
    });
    await client.uploadText(md, `${dest}/promo.md`);

    const meta = {
      title: project.title,
      color: project.color,
      color_ru: colorRu,
      body: project.body,
      body_ru: bodyRu,
      style: project.style || null,
      notes: project.notes || '',
      confidence: project.confidence,
      files: placed,
      promo_tags: promo.tags,
      links: promo.links,
      created_at: new Date().toISOString()
    };
    await client.uploadText(JSON.stringify(meta, null, 2) + '\n', `${dest}/${MANIFEST_NAME}`);

    results.push({ id: project.id, status: 'ok', dest, files: placed.length });
  }

  if (moveReview && plan.review_files?.length && !dry) {
    await client.ensureDir(diskPath(ROOT_FOLDER, REVIEW_FOLDER));
    for (const f of plan.review_files) {
      const dest = diskPath(ROOT_FOLDER, REVIEW_FOLDER, f.name);
      try {
        if (f.local || plan.local_inbox) {
          const localPath = f.local ? f.path : path.join(plan.local_inbox, f.name);
          await client.uploadFile(localPath, dest, { overwrite: true });
        } else {
          const op = await client.move(f.path, dest, { overwrite: true });
          if (op?.href) await client.waitOperation(op.href);
        }
        results.push({ id: f.name, status: 'review', dest });
      } catch (e) {
        results.push({ id: f.name, status: 'review-error', error: e.message });
      }
    }
  }

  const reportPath = path.join(WORK, `apply-${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify({ plan_stats: plan.stats, results }, null, 2));
  return { results, reportPath };
}

function printPlan(plan) {
  console.log(`Файлов: ${plan.stats.files}`);
  console.log(`Проектов: ${plan.stats.projects}`);
  console.log(`На ревью: ${plan.stats.review_files}`);
  console.log('');
  for (const p of plan.projects) {
    const flag = p.needs_review ? ' [REVIEW]' : '';
    console.log(
      `- ${p.title} | ${COLOR_CATS[p.color]?.id}/${BODY_CATS[p.body]?.id} | ${p.confidence}${flag}`
    );
    for (const f of p.files) {
      console.log(`    [${f.role}] ${f.name}`);
    }
  }
  if (plan.review_files.length) {
    console.log('\nНе смэтчились:');
    for (const f of plan.review_files) console.log(`  - ${f.name}`);
  }
  console.log(`\nПлан: ${PLAN_PATH}`);
}

async function main() {
  const args = process.argv.slice(2);
  const env = loadEnv();
  const localInbox = argValue(args, '--local-inbox');
  const dry = has(args, '--dry');
  const forceAll = has(args, '--force-all');

  if (has(args, '--help') || args.length === 0) {
    console.log(`Usage:
  node seo/scripts/yandex-disk/organize.mjs --init
  node seo/scripts/yandex-disk/organize.mjs --plan [--local-inbox DIR]
  node seo/scripts/yandex-disk/organize.mjs --apply [--dry] [--force-all]
  node seo/scripts/yandex-disk/organize.mjs --promo-sample
`);
    return;
  }

  if (has(args, '--promo-sample')) {
    const promo = buildPromo({
      title: 'Змей на предплечье',
      style: 'neo-trad',
      color: 'color',
      body: 'arm',
      bodyRu: 'Рука',
      notes: 'Эскиз собран в 634, на сеансе сверили пигменты по проекту.'
    });
    console.log(renderPromoMarkdown(promo, { colorRu: 'Цветные', bodyRu: 'Рука', style: 'neo-trad' }));
    return;
  }

  const client = createDiskClient();

  if (has(args, '--init')) {
    const r = await initTree(client);
    console.log('Дерево портфолио готово:', r.root);
    console.log(`Скидывайте файлы в: ${r.root}/${INBOX_FOLDER}`);
    return;
  }

  if (has(args, '--plan')) {
    const plan = await buildPlan(client, { localInbox });
    printPlan(plan);
    return;
  }

  if (has(args, '--apply')) {
    if (!fs.existsSync(PLAN_PATH)) {
      console.error('Нет plan.json. Сначала --plan');
      process.exit(1);
    }
    const plan = JSON.parse(fs.readFileSync(PLAN_PATH, 'utf8'));
    if (forceAll) plan.force_all = true;
    const { results, reportPath } = await applyPlan(client, plan, { dry });
    const ok = results.filter((r) => r.status === 'ok' || r.status === 'dry').length;
    const skipped = results.filter((r) => r.status === 'skipped-review').length;
    console.log(`Готово: ${ok}, пропущено (review): ${skipped}`);
    console.log('Отчёт:', reportPath);
    return;
  }

  console.error('Неизвестная команда. См. --help');
  process.exit(1);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
