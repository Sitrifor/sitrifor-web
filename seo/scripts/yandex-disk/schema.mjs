/**
 * Portfolio taxonomy + path helpers for Sitrifor tattoo projects.
 */

export const ROOT_FOLDER = 'Sitrifor-Portfolio';
export const INBOX_FOLDER = 'Входящие';
export const REVIEW_FOLDER = 'На-проверку';
export const PROJECTS_FOLDER = 'Тату-проекты';
export const MANIFEST_NAME = 'manifest.json';

/** Color axis - id = folder name on Disk (Russian) */
export const COLOR_CATS = {
  color: { id: 'Цветные', ru: 'Цветные', aliases: ['цвет', 'цветн', 'color', 'colour', 'colored'] },
  bw: {
    id: 'Черно-белые',
    ru: 'Черно-белые',
    aliases: ['чб', 'ч/б', 'черно', 'чёрно', 'bw', 'b&w', 'black', 'mono', 'график']
  }
};

/** Body-part axis - id = folder name on Disk (Russian) */
export const BODY_CATS = {
  arm: {
    id: 'Рука',
    ru: 'Рука',
    aliases: ['рука', 'предплечье', 'плечо', 'рукав', 'бицепс', 'forearm', 'sleeve', 'arm', 'shoulder']
  },
  hand: { id: 'Кисть', ru: 'Кисть', aliases: ['кисть', 'ладонь', 'палец', 'hand', 'finger', 'wrist'] },
  leg: {
    id: 'Нога',
    ru: 'Нога',
    aliases: ['нога', 'голень', 'бедро', 'икра', 'leg', 'thigh', 'calf', 'shin']
  },
  foot: { id: 'Стопа', ru: 'Стопа', aliases: ['стопа', 'лодыжка', 'foot', 'ankle'] },
  back: { id: 'Спина', ru: 'Спина', aliases: ['спина', 'back', 'scapula', 'лопат'] },
  chest: { id: 'Грудь', ru: 'Грудь', aliases: ['грудь', 'груд', 'chest', 'sternum', 'torso'] },
  neck: { id: 'Шея', ru: 'Шея', aliases: ['шея', 'шейн', 'neck', 'clavicle', 'ключиц'] },
  rib: { id: 'Рёбра', ru: 'Рёбра', aliases: ['ребра', 'рёбра', 'бок', 'rib', 'side'] },
  head: { id: 'Голова', ru: 'Голова', aliases: ['голова', 'лицо', 'висок', 'face', 'head', 'scalp'] },
  other: { id: 'Другое', ru: 'Другое', aliases: ['другое', 'прочее', 'other', 'misc'] }
};

export const ROLE_ALIASES = {
  sketch: ['sketch', 'eskiz', 'эскиз', 'design', 'чертёж', 'чертеж', 'lineart', 'stencil', 'трафарет'],
  photo: ['photo', 'foto', 'фото', 'heal', 'healed', 'fresh', 'готово', 'result', 'итог', 'tattoo'],
  video: ['video', 'видео', 'reel', 'clip', 'mp4', 'mov', 'process', 'процесс', 'timelapse']
};

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.tif', '.tiff', '.gif']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi']);

export function extOf(name) {
  const i = String(name).lastIndexOf('.');
  return i >= 0 ? String(name).slice(i).toLowerCase() : '';
}

export function isImage(name) {
  return IMAGE_EXT.has(extOf(name));
}

export function isVideo(name) {
  return VIDEO_EXT.has(extOf(name));
}

export function normalizeKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-z0-9а-я]+/gi, ' ')
    .trim();
}

export function detectRole(filename) {
  const base = normalizeKey(pathBasename(filename));
  for (const [role, aliases] of Object.entries(ROLE_ALIASES)) {
    for (const a of aliases) {
      if (base.includes(normalizeKey(a))) return role;
    }
  }
  if (isVideo(filename)) return 'video';
  if (isImage(filename)) return 'photo'; // default; sketch often needs pairing/heuristic
  return 'other';
}

export function detectColor(text) {
  const n = normalizeKey(text);
  for (const [key, cat] of Object.entries(COLOR_CATS)) {
    for (const a of cat.aliases) {
      if (n.includes(normalizeKey(a))) return key;
    }
  }
  return null;
}

export function detectBody(text) {
  const n = normalizeKey(text);
  for (const [key, cat] of Object.entries(BODY_CATS)) {
    if (key === 'other') continue;
    for (const a of cat.aliases) {
      if (n.includes(normalizeKey(a))) return key;
    }
  }
  return null;
}

export function pathBasename(p) {
  const s = String(p).replace(/\\/g, '/');
  const parts = s.split('/');
  return parts[parts.length - 1] || s;
}

export function slugify(s, { max = 48 } = {}) {
  const map = {
    а: 'a',
    б: 'b',
    в: 'v',
    г: 'g',
    д: 'd',
    е: 'e',
    ё: 'e',
    ж: 'zh',
    з: 'z',
    и: 'i',
    й: 'y',
    к: 'k',
    л: 'l',
    м: 'm',
    н: 'n',
    о: 'o',
    п: 'p',
    р: 'r',
    с: 's',
    т: 't',
    у: 'u',
    ф: 'f',
    х: 'h',
    ц: 'ts',
    ч: 'ch',
    ш: 'sh',
    щ: 'sch',
    ъ: '',
    ы: 'y',
    ь: '',
    э: 'e',
    ю: 'yu',
    я: 'ya'
  };
  const raw = String(s || '')
    .toLowerCase()
    .split('')
    .map((ch) => map[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return raw || 'project';
}

export function projectFolderName({ date, title, color, body }) {
  const d = date || new Date().toISOString().slice(0, 10);
  const t = slugify(title || 'tattoo');
  return `${d}_${t}`;
}

export function projectDiskPath({ color, body, folderName }) {
  const c = COLOR_CATS[color]?.id || COLOR_CATS.color.id;
  const b = BODY_CATS[body]?.id || BODY_CATS.other.id;
  return `disk:/${ROOT_FOLDER}/${PROJECTS_FOLDER}/${c}/${b}/${folderName}`;
}

/**
 * Group files that share a common stem prefix before role markers.
 * e.g. floral_arm_sketch.jpg + floral_arm_photo.jpg → floral_arm
 */
export function stemKey(filename) {
  let base = pathBasename(filename).replace(/\.[^.]+$/, '');
  const drop = [...ROLE_ALIASES.sketch, ...ROLE_ALIASES.photo, ...ROLE_ALIASES.video];
  for (const a of drop) {
    base = base.replace(new RegExp(`(^|[_\\-\\s])${escapeRe(a)}([_\\-\\s]|$)`, 'ig'), '$1$2');
  }
  return normalizeKey(base).replace(/\s+/g, '_');
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function roleFileName(role, sourceName, index = 1) {
  const ext = extOf(sourceName) || (role === 'video' ? '.mp4' : '.jpg');
  const n = String(index).padStart(2, '0');
  if (role === 'sketch') return `${n}-sketch${ext}`;
  if (role === 'photo') return `${n}-photo${ext}`;
  if (role === 'video') return `${n}-video${ext}`;
  return `${n}-file${ext}`;
}
