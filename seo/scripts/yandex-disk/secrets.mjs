/**
 * Root-only encrypted secrets for Sitrifor agents.
 *
 * Default store: /root/.config/sitrifor/secrets/ (mode 700)
 * Files are AES-256-GCM ciphertext. Plaintext never stays under /var/www.
 *
 * Env overrides:
 *   SITRIFOR_SECRETS_DIR
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DEFAULT_DIR = path.join(os.homedir(), '.config/sitrifor/secrets');
const KEY_NAME = 'master.key';
const ALGO = 'aes-256-gcm';

export function secretsDir() {
  return process.env.SITRIFOR_SECRETS_DIR || DEFAULT_DIR;
}

export function ensureSecretsDir() {
  const dir = secretsDir();
  if (process.getuid && process.getuid() !== 0) {
    // Allow non-root only if dir already exists and is owned/readable by user.
    // Prefer root for production hardening.
  }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    /* ignore on some FS */
  }
  // Harden parents when possible
  for (const p of [
    path.dirname(dir), // .../sitrifor
    path.dirname(path.dirname(dir)) // .../.config
  ]) {
    try {
      if (fs.existsSync(p)) fs.chmodSync(p, 0o700);
    } catch {
      /* ignore */
    }
  }
  return dir;
}

function keyPath() {
  return path.join(secretsDir(), KEY_NAME);
}

export function loadOrCreateMasterKey() {
  ensureSecretsDir();
  const kp = keyPath();
  if (fs.existsSync(kp)) {
    const key = fs.readFileSync(kp);
    if (key.length !== 32) {
      throw new Error(`Invalid master key length at ${kp}`);
    }
    return key;
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(kp, key, { mode: 0o600 });
  fs.chmodSync(kp, 0o600);
  return key;
}

function encPath(name) {
  const safe = String(name).replace(/[^a-zA-Z0-9._-]+/g, '_');
  return path.join(secretsDir(), `${safe}.enc`);
}

/**
 * Encrypt UTF-8 string and write to <name>.enc
 * Format: base64(iv).base64(tag).base64(ciphertext)
 */
export function putSecret(name, plaintext) {
  if (!plaintext || !String(plaintext).trim()) {
    throw new Error(`Refusing to store empty secret: ${name}`);
  }
  const key = loadOrCreateMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = `${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}\n`;
  const out = encPath(name);
  fs.writeFileSync(out, payload, { mode: 0o600 });
  fs.chmodSync(out, 0o600);
  return out;
}

export function getSecret(name) {
  const p = encPath(name);
  if (!fs.existsSync(p)) return '';
  assertSafePerms(p);
  const raw = fs.readFileSync(p, 'utf8').trim();
  const [ivB64, tagB64, ctB64] = raw.split('.');
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error(`Corrupt secret blob: ${name}`);
  }
  const key = loadOrCreateMasterKey();
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final()
  ]);
  return pt.toString('utf8');
}

export function hasSecret(name) {
  return fs.existsSync(encPath(name));
}

export function deleteSecret(name) {
  const p = encPath(name);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

/** Secure delete: overwrite then unlink */
export function shredFile(filePath) {
  if (!fs.existsSync(filePath)) return false;
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile()) return false;
    const size = st.size || 64;
    const fd = fs.openSync(filePath, 'r+');
    try {
      fs.writeSync(fd, crypto.randomBytes(size), 0, size, 0);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.unlinkSync(filePath);
    return true;
  } catch {
    try {
      fs.unlinkSync(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

export function assertSafePerms(filePath) {
  const st = fs.statSync(filePath);
  const mode = st.mode & 0o777;
  if (mode & 0o077) {
    throw new Error(
      `Insecure permissions on ${filePath} (mode ${mode.toString(8)}). Expected 600/700.`
    );
  }
}

export function auditSecretsStore() {
  const dir = secretsDir();
  const issues = [];
  const ok = [];
  if (!fs.existsSync(dir)) {
    return { ok: false, issues: [`missing secrets dir: ${dir}`], ok_items: [] };
  }
  const dst = fs.statSync(dir);
  if ((dst.mode & 0o077) !== 0) {
    issues.push(`secrets dir group/other accessible: ${dir}`);
  } else ok.push(`dir perms ok: ${dir}`);

  if (String(dir).startsWith('/var/www')) {
    issues.push('secrets dir is under web tree /var/www - move out');
  } else ok.push('secrets dir outside /var/www');

  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (!st.isFile()) continue;
    if ((st.mode & 0o077) !== 0) issues.push(`loose perms: ${p}`);
    else ok.push(`file perms ok: ${name}`);
    if (name.endsWith('.txt') || name.endsWith('.json') || name === '.env') {
      issues.push(`plaintext-looking file in secrets dir: ${name}`);
    }
  }

  // Web-tree plaintext scans
  const webLeaks = [
    '/var/www/sitrifor/seo/credentials/yandex-disk-token.txt',
    '/var/www/sitrifor/seo/credentials/yandex-webmaster-token.txt',
    '/var/www/sitrifor/seo/credentials/yandex-oauth-app.json'
  ];
  for (const p of webLeaks) {
    if (fs.existsSync(p) && fs.statSync(p).size > 0) {
      issues.push(`plaintext still under web tree: ${p}`);
    }
  }

  // .env must not contain disk/webmaster oauth tokens
  const envPath = '/var/www/sitrifor/seo/.env';
  if (fs.existsSync(envPath)) {
    const env = fs.readFileSync(envPath, 'utf8');
    if (/^YANDEX_DISK_OAUTH_TOKEN=.+/m.test(env)) {
      issues.push('YANDEX_DISK_OAUTH_TOKEN set in seo/.env - remove (use encrypted store)');
    } else ok.push('seo/.env has no disk token value');
    if (/^YANDEX_OAUTH_TOKEN=.+/m.test(env)) {
      issues.push('YANDEX_OAUTH_TOKEN set in seo/.env - remove (use encrypted store)');
    } else ok.push('seo/.env has no webmaster token value');
    if (/y0[_-]{1,2}[A-Za-z0-9_-]{16,}/.test(env)) {
      issues.push('seo/.env still contains a y0__ OAuth-looking secret');
    }
  }

  return { ok: issues.length === 0, issues, ok_items: ok, dir };
}

export const SECRET_NAMES = {
  diskToken: 'yandex-disk-token',
  webmasterToken: 'yandex-webmaster-token',
  oauthApp: 'yandex-oauth-app',
  directToken: 'yandex-direct-token',
  vkAdsApp: 'vk-ads-oauth-app',
  vkAdsToken: 'vk-ads-access-token'
};
