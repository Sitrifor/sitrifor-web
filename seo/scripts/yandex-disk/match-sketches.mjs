#!/usr/bin/env node
/**
 * Match sketches from Арт/Старые-арты into Тату-проекты by visual similarity (pHash).
 *
 *   node seo/scripts/yandex-disk/match-sketches.mjs --plan
 *   node seo/scripts/yandex-disk/match-sketches.mjs --apply
 *   node seo/scripts/yandex-disk/match-sketches.mjs --apply --min-score 12
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDiskClient, diskPath } from './client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.resolve(__dirname, '../../data/yandex-disk-portfolio/sketch-match');
const PREVIEW_DIR = path.join(WORK, 'previews');
const PLAN = path.join(WORK, 'matches.json');
const PY = '/var/www/sitrifor/seo/.venv/bin/python';

const PORTFOLIO = 'Sitrifor-Portfolio';
const SKETCH_SRC = diskPath(PORTFOLIO, 'Арт', 'Старые-арты');
const PROJECTS = diskPath(PORTFOLIO, 'Тату-проекты');
const DONE_DIR = diskPath(PORTFOLIO, 'Арт', 'Старые-арты', '_уже-в-проектах');
const UNMATCHED_DIR = diskPath(PORTFOLIO, 'На-проверку', 'Эскизы-без-проекта');

const MEDIA_IMG = /\.(jpe?g|png|webp|heic)$/i;

function has(args, n) {
  return args.includes(n);
}
function arg(args, n, def) {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : def;
}
function log(m) {
  process.stdout.write(`${m}\n`);
}

async function exists(client, p) {
  try {
    await client.meta(p);
    return true;
  } catch {
    return false;
  }
}

async function collectProjects(client, root, parts = []) {
  const items = await client.list(root, { recursive: false });
  const dirs = items.filter((i) => i.type === 'dir');
  const files = items.filter((i) => i.type === 'file');
  const out = [];
  if (!dirs.length) {
    out.push({ path: root, name: parts.at(-1), parts, files });
    return out;
  }
  for (const d of dirs) {
    // skip service
    if (d.name.startsWith('_')) continue;
    out.push(...(await collectProjects(client, d.path, [...parts, d.name])));
  }
  return out;
}

function pickPhoto(files) {
  const imgs = files.filter((f) => MEDIA_IMG.test(f.name) && !/promo|meta|эскиз|sketch|иллюстрац/i.test(f.name));
  // Prefer camera JPGs mid-size
  const scored = imgs
    .map((f) => {
      let s = 0;
      if (/\.jpe?g$/i.test(f.name)) s += 20;
      if (/^p[a-z0-9]/i.test(f.name)) s += 10;
      if (/копия|\(\d+\)/i.test(f.name)) s -= 15;
      if (f.size > 1.5e6 && f.size < 12e6) s += 10;
      if (/\.png$/i.test(f.name)) s -= 5; // often sketch
      return { f, s };
    })
    .sort((a, b) => b.s - a.s);
  return scored[0]?.f || null;
}

function hasSketchAlready(files) {
  return files.some(
    (f) =>
      /^(01-)?эскиз|^(01-)?sketch|иллюстрац/i.test(f.name) ||
      (/\.png$/i.test(f.name) && f.size < 25e6 && /эскиз|sketch|design|arm_/i.test(f.name))
  );
}

async function downloadPreview(client, resourcePath, destFile) {
  // Prefer Disk preview URL from meta
  const meta = await client.meta(resourcePath, { previewSize: 'XL' });
  const url = meta.preview;
  if (!url) {
    // fallback: full download (heavier)
    await client.downloadTo(resourcePath, destFile);
    return destFile;
  }
  const res = await fetch(url, { headers: { Authorization: `OAuth ${client.token}` } });
  if (!res.ok) {
    // preview may not need auth / may expire - try without
    const res2 = await fetch(url);
    if (!res2.ok) throw new Error(`preview ${res.status}/${res2.status}`);
    const buf = Buffer.from(await res2.arrayBuffer());
    fs.mkdirSync(path.dirname(destFile), { recursive: true });
    fs.writeFileSync(destFile, buf);
    return destFile;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  fs.writeFileSync(destFile, buf);
  return destFile;
}

function runHashMatch(sketchesCsv, photosCsv, outJson, maxDist) {
  const script = `
import csv, json, sys
from pathlib import Path
import imagehash
from PIL import Image

max_dist = int(sys.argv[1])
sk_path = Path(sys.argv[2])
ph_path = Path(sys.argv[3])
out_path = Path(sys.argv[4])

def load_rows(p):
    rows = []
    with p.open(newline='', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            rows.append(r)
    return rows

def phash(path):
    im = Image.open(path).convert('RGB')
    return imagehash.phash(im, hash_size=16)

sk = load_rows(sk_path)
ph = load_rows(ph_path)
sk_h = []
for r in sk:
    try:
        sk_h.append((r, phash(r['local'])))
    except Exception as e:
        print('skip sketch', r.get('name'), e, file=sys.stderr)
ph_h = []
for r in ph:
    try:
        ph_h.append((r, phash(r['local'])))
    except Exception as e:
        print('skip photo', r.get('name'), e, file=sys.stderr)

# each sketch -> best project; each project gets at most 1 best sketch (greedy by distance)
pairs = []
for s, sh in sk_h:
    best = None
    for p, phv in ph_h:
        d = sh - phv
        if best is None or d < best[0]:
            best = (d, p, s)
    if best and best[0] <= max_dist:
        pairs.append({'dist': int(best[0]), 'sketch': best[2], 'project': best[1]})

pairs.sort(key=lambda x: x['dist'])
used_sk = set(); used_pr = set(); chosen = []
for p in pairs:
    sid = p['sketch']['path']; pid = p['project']['path']
    if sid in used_sk or pid in used_pr: continue
    used_sk.add(sid); used_pr.add(pid); chosen.append(p)

out_path.write_text(json.dumps({'matches': chosen, 'sketches': len(sk_h), 'photos': len(ph_h), 'max_dist': max_dist}, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'matches={len(chosen)} from sketches={len(sk_h)} photos={len(ph_h)} max_dist={max_dist}')
`;
  const pyFile = path.join(WORK, 'match_phash.py');
  fs.writeFileSync(pyFile, script);
  const r = spawnSync(PY, [pyFile, String(maxDist), sketchesCsv, photosCsv, outJson], {
    encoding: 'utf8'
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) throw new Error(`python match failed: ${r.status}`);
}

async function movePath(client, from, to) {
  const parent = to.replace(/\/[^/]+\/?$/, '');
  if (parent.startsWith('disk:')) await client.ensureDir(parent);
  const op = await client.move(from, to, { overwrite: false, forceAsync: true });
  if (op?.href) await client.waitOperation(op.href, { timeoutMs: 600000 });
}

async function copyPath(client, from, to) {
  const op = await client.copy(from, to, { overwrite: true });
  if (op?.href) await client.waitOperation(op.href, { timeoutMs: 600000 });
}

async function buildPlan(client, maxDist) {
  fs.mkdirSync(PREVIEW_DIR, { recursive: true });
  const sketchItems = (await client.list(SKETCH_SRC, { recursive: false })).filter(
    (f) => f.type === 'file' && MEDIA_IMG.test(f.name) && !f.name.startsWith('_')
  );
  log(`Sketches: ${sketchItems.length}`);

  const projects = [];
  for (const color of ['Цветные', 'Черно-белые']) {
    const colorPath = diskPath(PORTFOLIO, 'Тату-проекты', color);
    if (!(await exists(client, colorPath))) continue;
    const bodies = await client.list(colorPath, { recursive: false });
    for (const body of bodies.filter((d) => d.type === 'dir')) {
      const leaves = await collectProjects(client, body.path, [color, body.name]);
      for (const leaf of leaves) {
        const media = leaf.files.filter((f) => MEDIA_IMG.test(f.name) || /\.(mp4|mov)$/i.test(f.name));
        if (!media.length) continue;
        if (hasSketchAlready(leaf.files)) continue;
        const photo = pickPhoto(leaf.files);
        if (!photo) continue;
        projects.push({
          path: leaf.path,
          name: leaf.name,
          color,
          body: body.name,
          photo
        });
      }
    }
  }
  log(`Projects needing sketch: ${projects.length}`);

  const skRows = [];
  let i = 0;
  for (const s of sketchItems) {
    i += 1;
    const local = path.join(PREVIEW_DIR, 'sk', `${i}-${s.name}`.replace(/[^\w.\-а-яА-ЯёЁ]+/g, '_'));
    try {
      await downloadPreview(client, s.path, local);
      skRows.push({ path: s.path, name: s.name, local, size: s.size });
      log(`[sk ${i}/${sketchItems.length}] ${s.name}`);
    } catch (e) {
      log(`[sk fail] ${s.name}: ${e.message}`);
    }
  }

  const phRows = [];
  i = 0;
  for (const p of projects) {
    i += 1;
    const local = path.join(
      PREVIEW_DIR,
      'ph',
      `${i}-${p.name}-${p.photo.name}`.replace(/[^\w.\-а-яА-ЯёЁ]+/g, '_')
    );
    try {
      await downloadPreview(client, p.photo.path, local);
      phRows.push({
        path: p.path,
        name: p.name,
        color: p.color,
        body: p.body,
        photo_path: p.photo.path,
        photo_name: p.photo.name,
        local
      });
      if (i % 10 === 0 || i === projects.length) log(`[ph ${i}/${projects.length}]`);
    } catch (e) {
      log(`[ph fail] ${p.name}: ${e.message}`);
    }
  }

  const skCsv = path.join(WORK, 'sketches.csv');
  const phCsv = path.join(WORK, 'photos.csv');
  const writeCsv = (file, rows) => {
    if (!rows.length) {
      fs.writeFileSync(file, 'path,name,local\n');
      return;
    }
    const keys = Object.keys(rows[0]);
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    fs.writeFileSync(
      file,
      keys.join(',') + '\n' + rows.map((r) => keys.map((k) => esc(r[k])).join(',')).join('\n') + '\n'
    );
  };
  writeCsv(skCsv, skRows);
  writeCsv(phCsv, phRows);

  const rawOut = path.join(WORK, 'phash-raw.json');
  runHashMatch(skCsv, phCsv, rawOut, maxDist);
  const raw = JSON.parse(fs.readFileSync(rawOut, 'utf8'));

  const plan = {
    created_at: new Date().toISOString(),
    max_dist: maxDist,
    stats: {
      sketches: skRows.length,
      projects: phRows.length,
      matches: raw.matches.length
    },
    matches: raw.matches.map((m) => ({
      dist: m.dist,
      sketch_path: m.sketch.path,
      sketch_name: m.sketch.name,
      project_path: m.project.path,
      project_name: m.project.name,
      color: m.project.color,
      body: m.project.body,
      photo_name: m.project.photo_name,
      dest_name: `01-эскиз${path.extname(m.sketch.name).toLowerCase() || '.jpg'}`
    })),
    unmatched_sketches: skRows
      .filter((s) => !raw.matches.some((m) => m.sketch.path === s.path))
      .map((s) => ({ path: s.path, name: s.name }))
  };
  fs.writeFileSync(PLAN, JSON.stringify(plan, null, 2));
  log(`Plan: ${PLAN}`);
  log(`Matches: ${plan.matches.length}, unmatched sketches: ${plan.unmatched_sketches.length}`);
  for (const m of plan.matches.slice(0, 20)) {
    log(`  d=${m.dist}  ${m.sketch_name}  →  [${m.color}/${m.body}] ${m.project_name}`);
  }
  if (plan.matches.length > 20) log(`  ... +${plan.matches.length - 20}`);
  return plan;
}

async function applyPlan(client, plan) {
  await client.ensureDir(DONE_DIR);
  await client.ensureDir(UNMATCHED_DIR);
  const results = [];
  let n = 0;
  for (const m of plan.matches) {
    n += 1;
    const dest = `${m.project_path}/${m.dest_name}`;
    try {
      await copyPath(client, m.sketch_path, dest);
      // move original sketch into done bucket
      let doneTo = `${DONE_DIR}/${m.sketch_name}`;
      if (await exists(client, doneTo)) doneTo = `${DONE_DIR}/${Date.now()}-${m.sketch_name}`;
      try {
        await movePath(client, m.sketch_path, doneTo);
      } catch (e) {
        log(`  warn move original: ${e.message}`);
      }
      // update meta.json if present
      try {
        const metaPath = `${m.project_path}/meta.json`;
        const tmp = path.join(WORK, `meta-${n}.json`);
        await client.downloadTo(metaPath, tmp);
        const meta = JSON.parse(fs.readFileSync(tmp, 'utf8'));
        meta.suggested = meta.suggested || {};
        meta.suggested.sketch = m.dest_name;
        meta.sketch_match = {
          from: m.sketch_path,
          dist: m.dist,
          matched_at: new Date().toISOString()
        };
        await client.uploadText(`${JSON.stringify(meta, null, 2)}\n`, metaPath);
      } catch {
        /* meta optional */
      }
      results.push({ ok: true, ...m, dest });
      log(`[${n}/${plan.matches.length}] ${m.project_name} ← ${m.sketch_name} (d=${m.dist})`);
    } catch (e) {
      results.push({ ok: false, error: e.message, ...m });
      log(`[${n}] FAIL ${m.project_name}: ${e.message}`);
    }
  }

  // move unmatched sketches to review (optional - only if --move-unmatched)
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const client = createDiskClient();
  const maxDist = Number(arg(args, '--min-score', arg(args, '--max-dist', '18')));
  // note: lower dist = more similar. Default 18 for hash_size=16

  if (has(args, '--plan') || (!has(args, '--apply') && args.length === 0)) {
    await buildPlan(client, maxDist);
    return;
  }
  if (has(args, '--apply')) {
    if (!fs.existsSync(PLAN) || has(args, '--rebuild')) {
      await buildPlan(client, maxDist);
    }
    const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
    const results = await applyPlan(client, plan);
    const ok = results.filter((r) => r.ok).length;
    log(`DONE applied=${ok}/${results.length}`);
    fs.writeFileSync(path.join(WORK, `apply-${Date.now()}.json`), JSON.stringify(results, null, 2));
    return;
  }
  log('Use --plan or --apply [--max-dist 18]');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
