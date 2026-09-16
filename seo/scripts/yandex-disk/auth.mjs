#!/usr/bin/env node
/**
 * Yandex Disk OAuth helper (secure store).
 *
 * Token is saved encrypted under /root/.config/sitrifor/secrets/
 * Never writes plaintext into /var/www or seo/.env.
 *
 *   node seo/scripts/yandex-disk/auth.mjs
 *   node seo/scripts/yandex-disk/auth.mjs --check
 *   node seo/scripts/yandex-disk/auth.mjs --from-stdin   # paste token, Ctrl-D
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createDiskClient, readDiskToken, readOAuthApp } from './client.mjs';
import {
  SECRET_NAMES,
  ensureSecretsDir,
  getSecret,
  hasSecret,
  putSecret
} from './secrets.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEO_ROOT = path.resolve(__dirname, '../..');

const DISK_SCOPES = [
  'cloud_api:disk.info',
  'cloud_api:disk.read',
  'cloud_api:disk.write'
];

function authUrl(clientId) {
  const u = new URL('https://oauth.yandex.ru/authorize');
  u.searchParams.set('response_type', 'token');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('force_confirm', 'yes');
  u.searchParams.set('scope', DISK_SCOPES.join(' '));
  return u.toString();
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(String(answer || '').trim());
    });
  });
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8').trim();
}

function loadApp() {
  // Prefer encrypted; allow one-time bootstrap from legacy path during first harden.
  try {
    return readOAuthApp();
  } catch {
    const legacy = path.join(SEO_ROOT, 'credentials/yandex-oauth-app.json');
    if (fs.existsSync(legacy)) {
      return JSON.parse(fs.readFileSync(legacy, 'utf8'));
    }
    throw new Error('Нет OAuth app config. Восстановите через harden/migrate.');
  }
}

function saveApp(app) {
  ensureSecretsDir();
  const next = {
    ...app,
    scopes: Array.from(new Set([...(app.scopes || []), ...DISK_SCOPES]))
  };
  putSecret(SECRET_NAMES.oauthApp, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

async function check(token) {
  const client = createDiskClient(token);
  const info = await client.info();
  console.log('OK: доступ к Яндекс.Диску есть');
  console.log(
    JSON.stringify(
      {
        store: 'encrypted:/root/.config/sitrifor/secrets/',
        total_gb: info.total_space != null ? +(info.total_space / 1e9).toFixed(2) : null,
        used_gb: info.used_space != null ? +(info.used_space / 1e9).toFixed(2) : null,
        trash_gb: info.trash_size != null ? +(info.trash_size / 1e9).toFixed(2) : null
      },
      null,
      2
    )
  );
}

function normalizeToken(raw) {
  let token = String(raw || '').trim();
  const m = token.match(/access_token=([^&\s]+)/);
  if (m) token = decodeURIComponent(m[1]);
  // Never log token. Basic shape check.
  if (!/^y0[_-]/.test(token) || token.length < 20) {
    throw new Error('Токен не похож на Yandex OAuth token');
  }
  return token;
}

async function main() {
  if (process.getuid && process.getuid() !== 0) {
    console.error('Запускайте от root.');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const onlyCheck = args.includes('--check');
  const fromStdin = args.includes('--from-stdin');

  let app = loadApp();
  app = saveApp(app);

  if (onlyCheck) {
    const token = readDiskToken();
    if (!token) {
      console.error('Токен не найден в encrypted store.');
      process.exit(1);
    }
    try {
      await check(token);
    } catch (e) {
      console.error('Проверка не прошла:', e.message);
      console.error('URL:', authUrl(app.client_id));
      process.exit(1);
    }
    return;
  }

  console.log('=== Яндекс.Диск OAuth (secure) ===');
  console.log('');
  console.log('Права в кабинете приложения:');
  console.log('  https://oauth.yandex.ru/client/' + app.client_id);
  for (const s of DISK_SCOPES) console.log('  -', s);
  console.log('');
  console.log('URL авторизации:');
  console.log(authUrl(app.client_id));
  console.log('');
  console.log('Не вставляйте токен в чат Cursor. Только в этот терминал.');
  console.log('');

  let raw;
  if (fromStdin) {
    console.log('Жду токен на stdin (затем Ctrl-D)...');
    raw = await readStdin();
  } else {
    raw = await ask('Вставьте OAuth token (не попадёт в .env /var/www): ');
  }

  const token = normalizeToken(raw);
  putSecret(SECRET_NAMES.diskToken, token);
  console.log('Токен сохранён в encrypted store (AES-256-GCM).');
  console.log('Путь store: /root/.config/sitrifor/secrets/');

  // Ensure no env leftover
  const envPath = path.join(SEO_ROOT, '.env');
  if (fs.existsSync(envPath)) {
    let text = fs.readFileSync(envPath, 'utf8');
    if (/^YANDEX_DISK_OAUTH_TOKEN=.+$/m.test(text)) {
      text = text.replace(
        /^YANDEX_DISK_OAUTH_TOKEN=.*$/m,
        '# YANDEX_DISK_OAUTH_TOKEN managed by encrypted secrets store'
      );
      fs.writeFileSync(envPath, text, { mode: 0o600 });
      console.log('Убран plaintext YANDEX_DISK_OAUTH_TOKEN из seo/.env');
    }
  }

  await check(token);

  if (hasSecret(SECRET_NAMES.diskToken)) {
    // Touch-read to confirm decrypt path without printing
    getSecret(SECRET_NAMES.diskToken);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
