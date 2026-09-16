#!/usr/bin/env node
/**
 * Finish Irina curation: promos for Tattoo-Projects + Artist/Art/Archive moves.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDiskClient, diskPath } from './client.mjs';
import { buildPromo, renderPromoMarkdown } from './promo.mjs';
import { BODY_CATS, COLOR_CATS, isImage, isVideo } from './schema.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.resolve(__dirname, '../../data/yandex-disk-portfolio');
const PORTFOLIO = 'Sitrifor-Portfolio';
const MEDIA_RE = /\.(jpe?g|png|webp|heic|tif|tiff|gif|mp4|mov|m4v|webm)$/i;
const CATEGORY = new Set(
  ['arm','leg','back','chest','neck','hand','foot','head','rib','other','color','bw','hip','mixed-bw-color','tattoo-projects'].map((s)=>s.toLowerCase())
);

function log(m){ process.stdout.write(m+'\n'); }

async function exists(client, p){ try { await client.meta(p); return true; } catch { return false; } }

async function movePath(client, from, to) {
  const parent = to.replace(/\/[^/]+\/?$/, '');
  if (parent.startsWith('disk:')) await client.ensureDir(parent);
  const op = await client.move(from, to, { overwrite: false, forceAsync: true });
  if (op?.href) await client.waitOperation(op.href, { timeoutMs: 900000 });
}

function mapBody(parts, name) {
  const s = `${parts.join(' ')} ${name}`.toLowerCase();
  if (/шея|ухо|neck/.test(s)) return 'neck';
  if (/ног|leg/.test(s)) return 'leg';
  if (/стоп|foot/.test(s)) return 'foot';
  if (/рук|плеч|предплеч|рукав|arm/.test(s)) return 'arm';
  if (/спин|торс|back/.test(s)) return 'back';
  if (/груд|живот|chest/.test(s)) return 'chest';
  if (/ребр|бок|rib/.test(s)) return 'rib';
  if (/голова|head/.test(s)) return 'head';
  return 'other';
}
function mapColor(p){ return /\/bw\b|черно/i.test(p) ? 'bw' : 'color'; }

function pickSuggested(files) {
  const media = files.filter((f) => MEDIA_RE.test(f.name));
  const images = media.filter((f) => isImage(f.name));
  const videos = media.filter((f) => isVideo(f.name));
  const sketchScore = (n) => {
    const x = n.toLowerCase();
    let s = 0;
    if (/эскиз|sketch|иллюстрац|illustration|design|arm_/.test(x)) s += 50;
    if (/\.png$/i.test(x)) s += 15;
    if (/копия/.test(x)) s -= 10;
    return s;
  };
  const photoScore = (n, size) => {
    const x = n.toLowerCase();
    let s = /\.jpe?g$/i.test(x) ? 30 : 0;
    if (/копия|\(\d+\)/.test(x)) s -= 15;
    if (size > 1.5e6 && size < 15e6) s += 10;
    return s;
  };
  const videoScore = (n, size) => {
    let s = /\.(mp4|mov)$/i.test(n) ? 20 : 0;
    if (size > 3e6 && size < 100e6) s += 15;
    if (size > 250e6) s -= 20;
    return s;
  };
  const sketch = [...images].sort((a,b)=>sketchScore(b.name)-sketchScore(a.name))[0];
  const sketchOk = sketch && sketchScore(sketch.name) >= 10 ? sketch : null;
  const photo = [...images].filter(f=>!sketchOk || f.path!==sketchOk.path).sort((a,b)=>photoScore(b.name,b.size)-photoScore(a.name,a.size))[0];
  const video = [...videos].sort((a,b)=>videoScore(b.name,b.size)-videoScore(a.name,a.size))[0];
  return { sketch: sketchOk?.name||null, photo: photo?.name||null, video: video?.name||null, images: images.length, videos: videos.length };
}

async function collectLeaves(client, root, parts=[]) {
  const items = await client.list(root, { recursive:false });
  const dirs = items.filter(i=>i.type==='dir');
  const files = items.filter(i=>i.type==='file');
  const out = [];
  if (!dirs.length) {
    out.push({ path: root, name: parts.at(-1), parts, files });
    return out;
  }
  for (const d of dirs) out.push(...await collectLeaves(client, d.path, [...parts, d.name]));
  const media = files.filter(f=>MEDIA_RE.test(f.name));
  if (media.length >= 2) out.push({ path: root, name: parts.at(-1), parts, files: media, mixed:true });
  return out;
}

async function main() {
  const client = createDiskClient();
  const report = { promos: 0, moves: [], errors: [] };

  log('=== Promo pass on Tattoo-Projects ===');
  const leaves = await collectLeaves(client, diskPath(PORTFOLIO,'Tattoo-Projects'), ['Tattoo-Projects']);
  const seen = new Set();
  for (const leaf of leaves) {
    if (seen.has(leaf.path)) continue;
    seen.add(leaf.path);
    const media = (leaf.files||[]).filter(f=>MEDIA_RE.test(f.name));
    if (!media.length) continue;
    const name = String(leaf.name||'').trim();
    if (CATEGORY.has(name.toLowerCase())) continue;
    leaf.files = media;
    const color = mapColor(leaf.path);
    const body = mapBody(leaf.parts, name);
    try {
      const suggested = pickSuggested(media);
      const promo = buildPromo({
        title: name,
        color,
        body,
        bodyRu: BODY_CATS[body].ru,
        notes: 'Работа тату-мастера Ирины. Эскиз и готовая татуировка из одного проекта - так удобно вести сеансы в 634.'
      });
      const md = renderPromoMarkdown(promo, {
        color, colorRu: COLOR_CATS[color].ru, body, bodyRu: BODY_CATS[body].ru,
        date: new Date().toISOString().slice(0,10)
      }) + [
        '',
        '## Что выкладывать из этой папки',
        '',
        suggested.sketch ? `- Эскиз: \`${suggested.sketch}\`` : '- Эскиз: иллюстрация / PNG, если есть',
        suggested.photo ? `- Фото: \`${suggested.photo}\`` : '- Фото: лучший JPG результата',
        suggested.video ? `- Видео: \`${suggested.video}\`` : '- Видео: процесс или результат, если есть',
        '',
        '## Мастер',
        '',
        '- Ирина',
        `- Папка: \`${leaf.path}\``,
        ''
      ].join('\n');
      await client.uploadText(md, `${leaf.path}/promo.md`);
      await client.uploadText(JSON.stringify({
        title: name, artist: 'Ирина', color, body, suggested,
        tags: promo.tags, links: promo.links, curated_at: new Date().toISOString()
      }, null, 2)+'\n', `${leaf.path}/meta.json`);
      report.promos += 1;
      log(`[${report.promos}] ${COLOR_CATS[color].id}/${BODY_CATS[body].id} ${name}`);
    } catch (e) {
      report.errors.push({ path: leaf.path, error: e.message });
      log(`ERR ${name}: ${e.message}`);
    }
  }

  log('=== Artist / Art / Archive moves ===');
  await client.ensureDir(diskPath(PORTFOLIO,'Artist-Irina'));
  await client.ensureDir(diskPath(PORTFOLIO,'Art'));
  await client.ensureDir(diskPath(PORTFOLIO,'_Archive'));

  const topMoves = [
    [diskPath(PORTFOLIO,'Фотосеты'), diskPath(PORTFOLIO,'Artist-Irina','Фотосеты')],
    [diskPath(PORTFOLIO,'Контент','Ирен на работе (съемка)'), diskPath(PORTFOLIO,'Artist-Irina','На-работе')],
    [diskPath(PORTFOLIO,'Контент','ТАТКИ','Я за работой'), diskPath(PORTFOLIO,'Artist-Irina','Я-за-работой')],
    [diskPath(PORTFOLIO,'Контент','Селфачи разных лет'), diskPath(PORTFOLIO,'Artist-Irina','Селфи')],
    [diskPath(PORTFOLIO,'Контент','селфачи в зеркале'), diskPath(PORTFOLIO,'Artist-Irina','Селфи-зеркало')],
    [diskPath(PORTFOLIO,'Контент','Съемка в зелени и на сеновале'), diskPath(PORTFOLIO,'Artist-Irina','Съемка-зелень')],
    [diskPath(PORTFOLIO,'Контент','Съемка на море'), diskPath(PORTFOLIO,'Artist-Irina','Съемка-море')],
    [diskPath(PORTFOLIO,'Контент','ТАТКИ','история студии'), diskPath(PORTFOLIO,'Artist-Irina','История-студии')],
    [diskPath(PORTFOLIO,'Видео картин'), diskPath(PORTFOLIO,'Art','Видео-картин')],
    [diskPath(PORTFOLIO,'Старые арты'), diskPath(PORTFOLIO,'Art','Старые-арты')],
    [diskPath(PORTFOLIO,'ПРОЦЕССИКИ','Масло '), diskPath(PORTFOLIO,'Art','Масло')],
    [diskPath(PORTFOLIO,'ПРОЦЕССИКИ','Скульптуры '), diskPath(PORTFOLIO,'Art','Скульптуры')],
    [diskPath(PORTFOLIO,'Контент','Картины маслом'), diskPath(PORTFOLIO,'Art','Картины-маслом')],
    [diskPath(PORTFOLIO,'Контент','арты'), diskPath(PORTFOLIO,'Art','Арты')],
    [diskPath(PORTFOLIO,'Контент','Видео с артами'), diskPath(PORTFOLIO,'Art','Видео-с-артами')],
    [diskPath(PORTFOLIO,'Контент','ТАТКИ'), diskPath(PORTFOLIO,'_Archive','ТАТКИ-остаток')],
    [diskPath(PORTFOLIO,'Контент'), diskPath(PORTFOLIO,'_Archive','Контент-прочее')],
    [diskPath(PORTFOLIO,'ПРОЦЕССИКИ'), diskPath(PORTFOLIO,'_Archive','ПРОЦЕССИКИ-остаток')],
  ];

  for (const [from, toBase] of topMoves.sort((a,b)=>b[0].length-a[0].length)) {
    if (!(await exists(client, from))) { report.moves.push({from, ok:false, error:'not-found'}); continue; }
    let to = toBase;
    if (await exists(client, to)) to = `${toBase}-${Date.now()}`;
    log(`MOVE ${from} -> ${to}`);
    try {
      await movePath(client, from, to);
      report.moves.push({ from, to, ok:true });
      log('  ok');
    } catch (e) {
      report.moves.push({ from, to, ok:false, error:e.message });
      log('  fail '+e.message);
    }
  }

  await client.uploadText(`# Портфолио Ирины (Sitrifor / 634)

## Структура

- \`Tattoo-Projects/Color|BW/{Arm,Leg,Back,Chest,Neck,Other}/<проект>/\`
  - исходники проекта (эскизы, фото, видео)
  - \`promo.md\` - TikTok / Instagram / VK / LinkedIn
  - \`meta.json\` - рекомендованные файлы для поста
- \`Artist-Irina/\` - фотосеты, съёмки, мастер за работой
- \`Art/\` - картины, арты, скульптура
- \`_Archive/\` - сырой хвост без потерь

Мастер: Ирина. Продвижение: приложение 634 + https://sitrifor.ru
`, diskPath(PORTFOLIO,'README.md'));

  const reportPath = path.join(WORK, `curate-finish-${Date.now()}.json`);
  fs.mkdirSync(WORK, { recursive:true });
  fs.writeFileSync(reportPath, JSON.stringify({ at: new Date().toISOString(), ...report, moves_ok: report.moves.filter(m=>m.ok).length }, null, 2));
  log(`DONE promos=${report.promos} moves_ok=${report.moves.filter(m=>m.ok).length} errors=${report.errors.length}`);
  log('Report: '+reportPath);
}

main().catch(e=>{ console.error(e); process.exit(1); });
