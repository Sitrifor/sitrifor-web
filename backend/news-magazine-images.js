/**
 * Image utilities for magazine covers/collages (sharp).
 */
import sharp from 'sharp';
import { mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, '../public');
const COVERS = join(PUBLIC, 'img/news/covers');
const BDAY_BANNERS = join(PUBLIC, 'img/news/birthday/banners');

function absPublic(urlPath) {
  const clean = String(urlPath || '')
    .split('?')[0]
    .replace(/^https?:\/\/sitrifor\.ru/i, '')
    .replace(/^\//, '');
  return join(PUBLIC, clean);
}

function publicUrl(absPath) {
  const rel = absPath.replace(PUBLIC, '').replace(/\\/g, '/');
  return rel.startsWith('/') ? rel : `/${rel}`;
}

function escXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build a dark magazine cover collage from phone screenshots.
 * @returns {Promise<string>} public URL path
 */
export async function buildPhoneCollageCover({
  shots = [],
  outName = 'cover.jpg',
  width = 1600,
  height = 1000,
  title = ''
} = {}) {
  mkdirSync(COVERS, { recursive: true });
  const outPath = join(COVERS, outName);
  const usable = shots
    .map((s) => (typeof s === 'string' ? s : s.src))
    .map((s) => absPublic(s))
    .filter((p) => existsSync(p))
    .slice(0, 4);

  const bg = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 17, g: 17, b: 20 }
    }
  })
    .jpeg()
    .toBuffer();

  if (!usable.length) {
    await sharp(bg).toFile(outPath);
    return `/img/news/covers/${outName}`;
  }

  const phoneW = Math.round(width * 0.18);
  const composites = [];
  const gap = Math.round(width * 0.035);
  const totalW = usable.length * phoneW + (usable.length - 1) * gap;
  let x = Math.round((width - totalW) / 2);
  const y = Math.round(height * 0.12);

  for (let i = 0; i < usable.length; i++) {
    const buf = await sharp(usable[i])
      .resize({
        width: phoneW,
        height: Math.round(height * 0.78),
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toBuffer();
    composites.push({ input: buf, left: x, top: y });
    x += phoneW + gap;
  }

  let img = sharp(bg).composite(composites);

  if (title) {
    const svg = Buffer.from(`
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#111114" stop-opacity="0"/>
            <stop offset="55%" stop-color="#111114" stop-opacity="0.55"/>
            <stop offset="100%" stop-color="#111114" stop-opacity="0.92"/>
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#g)"/>
        <text x="64" y="${height - 64}" fill="#FFD60A" font-size="28" font-family="Arial, sans-serif" font-weight="700">${escXml(
          String(title).slice(0, 60)
        )}</text>
      </svg>`);
    img = img.composite([{ input: svg, left: 0, top: 0 }]);
  }

  await img.jpeg({ quality: 86, mozjpeg: true }).toFile(outPath);
  return `/img/news/covers/${outName}`;
}

/**
 * Sitrifor-branded birthday / zodiac banner collage.
 * Dark charcoal + yellow accent, 3–4 tattoo frames from the article gallery.
 *
 * @returns {Promise<{path:string, url:string}|null>}
 */
export async function buildBirthdayBanner({
  images = [],
  outName = null,
  width = 1600,
  height = 900,
  title = '',
  kicker = 'Тату по дате рождения',
  sign = '',
  dateRu = '',
  force = false
} = {}) {
  mkdirSync(BDAY_BANNERS, { recursive: true });

  const usable = images
    .map((s) => (typeof s === 'string' ? s : s?.src))
    .filter(Boolean)
    .map((s) => absPublic(s))
    .filter((p) => existsSync(p))
    .slice(0, 4);

  // No tattoo photos – branded care / prep promo banner for the article hero
  if (!usable.length) {
    return buildBirthdayServiceBanner({
      outName,
      width,
      height,
      title,
      kicker: kicker || 'Уход и подготовка к тату',
      sign,
      dateRu,
      force
    });
  }

  const hash = createHash('sha1')
    .update(usable.join('|') + '|' + title + '|' + sign + '|' + dateRu)
    .digest('hex')
    .slice(0, 12);
  const file = outName || `bday-${hash}.jpg`;
  const outPath = join(BDAY_BANNERS, file);
  if (!force && existsSync(outPath)) {
    return { path: outPath, url: publicUrl(outPath) };
  }

  const bgSvg = Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="glow" cx="72%" cy="28%" r="55%">
          <stop offset="0%" stop-color="#FFD60A" stop-opacity="0.22"/>
          <stop offset="45%" stop-color="#FFD60A" stop-opacity="0.06"/>
          <stop offset="100%" stop-color="#111114" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="wash" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#1A1A1E"/>
          <stop offset="55%" stop-color="#111114"/>
          <stop offset="100%" stop-color="#0C0C0E"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#wash)"/>
      <rect width="100%" height="100%" fill="url(#glow)"/>
      <rect x="0" y="0" width="8" height="100%" fill="#FFD60A"/>
      <circle cx="${width - 120}" cy="120" r="56" fill="none" stroke="#FFD60A" stroke-opacity="0.35" stroke-width="2"/>
      <circle cx="${width - 120}" cy="120" r="28" fill="none" stroke="#FFD60A" stroke-opacity="0.2" stroke-width="1"/>
    </svg>`);

  const canvas = await sharp(bgSvg).jpeg({ quality: 92 }).toBuffer();

  const slots =
    usable.length >= 4
      ? [
          { w: 520, h: 680, x: 90, y: 110, r: -4 },
          { w: 340, h: 420, x: 660, y: 70, r: 3 },
          { w: 340, h: 420, x: 1040, y: 160, r: -2 },
          { w: 260, h: 320, x: 860, y: 520, r: 5 }
        ]
      : usable.length === 3
        ? [
            { w: 560, h: 700, x: 100, y: 100, r: -3 },
            { w: 380, h: 460, x: 720, y: 80, r: 4 },
            { w: 380, h: 460, x: 1120, y: 220, r: -2 }
          ]
        : [
            { w: 620, h: 720, x: 120, y: 90, r: -2 },
            { w: 480, h: 600, x: 820, y: 150, r: 3 }
          ];

  const composites = [];
  const n = Math.min(usable.length, slots.length);

  for (let i = 0; i < n; i++) {
    const slot = slots[i];
    const pad = 14;
    const innerW = slot.w - pad * 2;
    const innerH = slot.h - pad * 2;

    const photo = await sharp(usable[i])
      .resize({ width: innerW, height: innerH, fit: 'cover', position: 'centre' })
      .jpeg({ quality: 88 })
      .toBuffer();

    const cardSvg = Buffer.from(`
      <svg width="${slot.w}" height="${slot.h}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="sh" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#000" flood-opacity="0.55"/>
          </filter>
        </defs>
        <rect x="2" y="2" width="${slot.w - 4}" height="${slot.h - 4}" rx="18" ry="18"
          fill="#1A1A1E" stroke="#FFD60A" stroke-opacity="0.55" stroke-width="2" filter="url(#sh)"/>
      </svg>`);

    const cardBase = await sharp(cardSvg).png().toBuffer();
    const framed = await sharp(cardBase)
      .composite([{ input: photo, left: pad, top: pad }])
      .png()
      .toBuffer();

    const rotated = await sharp(framed)
      .rotate(slot.r, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    const meta = await sharp(rotated).metadata();
    const left = Math.max(0, Math.round(slot.x - ((meta.width || slot.w) - slot.w) / 2));
    const top = Math.max(0, Math.round(slot.y - ((meta.height || slot.h) - slot.h) / 2));
    composites.push({ input: rotated, left, top });
  }

  const label = [dateRu, sign].filter(Boolean).join(' · ');
  const brandSvg = Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="veil" x1="0" y1="0.45" x2="0" y2="1">
          <stop offset="0%" stop-color="#111114" stop-opacity="0"/>
          <stop offset="55%" stop-color="#111114" stop-opacity="0.45"/>
          <stop offset="100%" stop-color="#111114" stop-opacity="0.92"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#veil)"/>
      <text x="48" y="${height - 88}" fill="#FFD60A" font-size="22" font-family="Arial, Helvetica, sans-serif"
        font-weight="800" letter-spacing="4">SITRIFOR</text>
      <text x="48" y="${height - 52}" fill="#FFFFFF" fill-opacity="0.88" font-size="28"
        font-family="Arial, Helvetica, sans-serif" font-weight="700">${escXml(String(kicker).slice(0, 48))}</text>
      ${
        label
          ? `<text x="48" y="${height - 22}" fill="#FFFFFF" fill-opacity="0.55" font-size="18"
        font-family="Arial, Helvetica, sans-serif">${escXml(label.slice(0, 64))}</text>`
          : ''
      }
      ${
        title
          ? `<text x="${width - 48}" y="${height - 28}" fill="#FFD60A" fill-opacity="0.7" font-size="16"
        font-family="Arial, Helvetica, sans-serif" text-anchor="end">${escXml(String(title).slice(0, 42))}</text>`
          : ''
      }
    </svg>`);

  await sharp(canvas)
    .composite([...composites, { input: brandSvg, left: 0, top: 0 }])
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(outPath);

  return { path: outPath, url: publicUrl(outPath) };
}

const CARE_ASSET = join(PUBLIC, 'img/marketing/card-care.jpg');
const CARE_ASSET_PNG = join(PUBLIC, 'img/marketing/card-care.png');

/**
 * Fallback hero when Yandex/Bing returned no usable tattoo photos:
 * advertise Sitrifor care & prep (app / masters care block).
 */
export async function buildBirthdayServiceBanner({
  outName = null,
  width = 1600,
  height = 900,
  title = '',
  kicker = 'Уход и подготовка к тату',
  sign = '',
  dateRu = '',
  force = false
} = {}) {
  mkdirSync(BDAY_BANNERS, { recursive: true });
  const file = outName || `service-care-${createHash('sha1').update(String(title || dateRu)).digest('hex').slice(0, 10)}.jpg`;
  const outPath = join(BDAY_BANNERS, file);
  if (!force && existsSync(outPath)) {
    return { path: outPath, url: publicUrl(outPath), kind: 'service' };
  }

  const carePath = existsSync(CARE_ASSET) ? CARE_ASSET : existsSync(CARE_ASSET_PNG) ? CARE_ASSET_PNG : null;

  const bgSvg = Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="glow" cx="78%" cy="32%" r="58%">
          <stop offset="0%" stop-color="#FFD60A" stop-opacity="0.28"/>
          <stop offset="50%" stop-color="#FFD60A" stop-opacity="0.07"/>
          <stop offset="100%" stop-color="#111114" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="wash" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#1A1A1E"/>
          <stop offset="55%" stop-color="#111114"/>
          <stop offset="100%" stop-color="#0C0C0E"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#wash)"/>
      <rect width="100%" height="100%" fill="url(#glow)"/>
      <rect x="0" y="0" width="8" height="100%" fill="#FFD60A"/>
    </svg>`);

  const composites = [];
  if (carePath) {
    const panelW = Math.round(width * 0.42);
    const panelH = Math.round(height * 0.78);
    const photo = await sharp(carePath)
      .resize({ width: panelW - 28, height: panelH - 28, fit: 'cover', position: 'centre' })
      .jpeg({ quality: 90 })
      .toBuffer();
    const frameSvg = Buffer.from(`
      <svg width="${panelW}" height="${panelH}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="sh" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="16" stdDeviation="16" flood-color="#000" flood-opacity="0.5"/>
          </filter>
        </defs>
        <rect x="2" y="2" width="${panelW - 4}" height="${panelH - 4}" rx="20" ry="20"
          fill="#1A1A1E" stroke="#FFD60A" stroke-opacity="0.55" stroke-width="2" filter="url(#sh)"/>
      </svg>`);
    const framed = await sharp(await sharp(frameSvg).png().toBuffer())
      .composite([{ input: photo, left: 14, top: 14 }])
      .png()
      .toBuffer();
    composites.push({
      input: framed,
      left: Math.round(width * 0.52),
      top: Math.round((height - panelH) / 2)
    });
  }

  const sub = [dateRu, sign].filter(Boolean).join(' · ');
  const copySvg = Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <text x="56" y="120" fill="#FFD60A" font-size="22" font-family="Arial, Helvetica, sans-serif"
        font-weight="800" letter-spacing="4">SITRIFOR</text>
      <text x="56" y="190" fill="#FFFFFF" font-size="44" font-family="Arial, Helvetica, sans-serif"
        font-weight="700">${escXml(String(kicker).slice(0, 42))}</text>
      <text x="56" y="250" fill="#FFFFFF" fill-opacity="0.78" font-size="24"
        font-family="Arial, Helvetica, sans-serif">Чек-листы до сеанса и уход после –</text>
      <text x="56" y="286" fill="#FFFFFF" fill-opacity="0.78" font-size="24"
        font-family="Arial, Helvetica, sans-serif">в приложении и на сайте Sitrifor</text>
      ${
        sub
          ? `<text x="56" y="${height - 56}" fill="#FFFFFF" fill-opacity="0.5" font-size="18"
        font-family="Arial, Helvetica, sans-serif">${escXml(sub.slice(0, 64))}</text>`
          : ''
      }
      ${
        title
          ? `<text x="56" y="${height - 28}" fill="#FFD60A" fill-opacity="0.65" font-size="15"
        font-family="Arial, Helvetica, sans-serif">${escXml(String(title).slice(0, 52))}</text>`
          : ''
      }
    </svg>`);

  await sharp(bgSvg)
    .composite([...composites, { input: copySvg, left: 0, top: 0 }])
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(outPath);

  return { path: outPath, url: publicUrl(outPath), kind: 'service' };
}

export function birthdayBannerDir() {
  return BDAY_BANNERS;
}
