/**
 * Minimal Yandex Disk REST API client.
 * Docs: https://yandex.com/dev/disk/rest/
 *
 * Token source (priority):
 * 1) encrypted store /root/.config/sitrifor/secrets/ (preferred)
 * 2) process.env.YANDEX_DISK_OAUTH_TOKEN only if SITRIFOR_ALLOW_ENV_DISK_TOKEN=1
 *
 * Never fall back to Webmaster token. Never read plaintext under /var/www.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECRET_NAMES, getSecret, hasSecret } from './secrets.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEO_ROOT = path.resolve(__dirname, '../..');
const API = 'https://cloud-api.yandex.net/v1/disk';

export function loadEnv() {
  const envPath = path.join(SEO_ROOT, '.env');
  const out = { ...process.env };
  if (!fs.existsSync(envPath)) return out;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && out[m[1]] === undefined) out[m[1]] = m[2].trim();
  }
  return out;
}

export function readDiskToken(env = loadEnv()) {
  if (hasSecret(SECRET_NAMES.diskToken)) {
    const t = getSecret(SECRET_NAMES.diskToken).trim();
    if (t) return t;
  }
  if (env.SITRIFOR_ALLOW_ENV_DISK_TOKEN === '1' && env.YANDEX_DISK_OAUTH_TOKEN) {
    return env.YANDEX_DISK_OAUTH_TOKEN.trim();
  }
  return '';
}

export function readOAuthApp() {
  if (hasSecret(SECRET_NAMES.oauthApp)) {
    return JSON.parse(getSecret(SECRET_NAMES.oauthApp));
  }
  throw new Error(
    'OAuth app secret missing. Run: node seo/scripts/yandex-disk/harden.mjs'
  );
}

export function diskPath(...parts) {
  const joined = parts
    .filter(Boolean)
    .map((p) => String(p).replace(/^disk:/, '').replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
  return `disk:/${joined}`;
}

async function api(token, method, urlPath, { query, body, raw } = {}) {
  const u = new URL(urlPath.startsWith('http') ? urlPath : `${API}${urlPath}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      u.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(u, {
    method,
    headers: {
      Authorization: `OAuth ${token}`,
      ...(body && !(body instanceof Buffer) && !(body instanceof Uint8Array)
        ? { 'Content-Type': 'application/json' }
        : {})
    },
    body: body
      ? body instanceof Buffer || body instanceof Uint8Array
        ? body
        : typeof body === 'string'
          ? body
          : JSON.stringify(body)
      : undefined
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = raw ? text : { raw: text.slice(0, 500) };
  }
  if (!res.ok) {
    const err = new Error(
      `Yandex Disk ${method} ${u.pathname} → ${res.status}: ${json?.message || json?.description || text.slice(0, 200)}`
    );
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return json;
}

export function createDiskClient(token = readDiskToken()) {
  if (!token) {
    throw new Error(
      'Нет токена Яндекс.Диска. Запустите: node seo/scripts/yandex-disk/auth.mjs'
    );
  }

  return {
    token,

    info() {
      return api(token, 'GET', '/');
    },

    meta(pathOnDisk, options = {}) {
      return api(token, 'GET', '/resources', {
        query: {
          path: pathOnDisk,
          limit: options.limit ?? 1000,
          offset: options.offset ?? 0,
          fields: options.fields,
          preview_size: options.previewSize || 'XL',
          preview_crop: options.previewCrop ? 'true' : undefined
        }
      });
    },

    async list(pathOnDisk, { recursive = false, limit = 1000 } = {}) {
      const items = [];
      let offset = 0;
      for (;;) {
        const meta = await this.meta(pathOnDisk, { limit, offset });
        const chunk = meta?._embedded?.items || [];
        items.push(...chunk);
        if (chunk.length < limit) break;
        offset += limit;
      }
      if (!recursive) return items;
      const out = [...items];
      for (const it of items) {
        if (it.type === 'dir') {
          const nested = await this.list(it.path, { recursive: true, limit });
          out.push(...nested);
        }
      }
      return out;
    },

    async ensureDir(pathOnDisk) {
      const parts = pathOnDisk.replace(/^disk:\//, '').split('/').filter(Boolean);
      let cur = 'disk:/';
      for (const part of parts) {
        cur = diskPath(cur.replace(/^disk:\//, ''), part);
        try {
          await api(token, 'PUT', '/resources', { query: { path: cur } });
        } catch (e) {
          if (e.status !== 409) throw e;
        }
      }
      return cur;
    },

    move(from, to, { overwrite = false, forceAsync = false } = {}) {
      return api(token, 'POST', '/resources/move', {
        query: {
          from,
          path: to,
          overwrite: overwrite ? 'true' : 'false',
          force_async: forceAsync ? 'true' : 'false'
        }
      });
    },

    copy(from, to, { overwrite = false } = {}) {
      return api(token, 'POST', '/resources/copy', {
        query: {
          from,
          path: to,
          overwrite: overwrite ? 'true' : 'false'
        }
      });
    },

    remove(pathOnDisk, { permanently = false } = {}) {
      return api(token, 'DELETE', '/resources', {
        query: {
          path: pathOnDisk,
          permanently: permanently ? 'true' : 'false'
        }
      });
    },

    async downloadUrl(pathOnDisk) {
      const j = await api(token, 'GET', '/resources/download', {
        query: { path: pathOnDisk }
      });
      return j.href;
    },

    async uploadUrl(pathOnDisk, { overwrite = true } = {}) {
      const j = await api(token, 'GET', '/resources/upload', {
        query: {
          path: pathOnDisk,
          overwrite: overwrite ? 'true' : 'false'
        }
      });
      return j.href;
    },

    async uploadFile(localPath, pathOnDisk, { overwrite = true } = {}) {
      const href = await this.uploadUrl(pathOnDisk, { overwrite });
      const buf = fs.readFileSync(localPath);
      const res = await fetch(href, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: buf
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`Upload failed ${res.status}: ${t.slice(0, 200)}`);
      }
      return { ok: true, path: pathOnDisk, bytes: buf.length };
    },

    async uploadText(text, pathOnDisk, { overwrite = true } = {}) {
      const href = await this.uploadUrl(pathOnDisk, { overwrite });
      const body = Buffer.from(text, 'utf8');
      const res = await fetch(href, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`Upload text failed ${res.status}: ${t.slice(0, 200)}`);
      }
      return { ok: true, path: pathOnDisk, bytes: body.length };
    },

    async downloadTo(pathOnDisk, localPath) {
      const href = await this.downloadUrl(pathOnDisk);
      const res = await fetch(href);
      if (!res.ok) throw new Error(`Download failed ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(localPath, buf);
      return { ok: true, path: localPath, bytes: buf.length };
    },

    async waitOperation(href, { timeoutMs = 120000, intervalMs = 1000 } = {}) {
      const started = Date.now();
      for (;;) {
        const res = await fetch(href, {
          headers: { Authorization: `OAuth ${token}` }
        });
        const json = await res.json();
        if (json.status === 'success') return json;
        if (json.status === 'failed') {
          throw new Error(`Async op failed: ${JSON.stringify(json)}`);
        }
        if (Date.now() - started > timeoutMs) {
          throw new Error(`Async op timeout: ${href}`);
        }
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }
  };
}
