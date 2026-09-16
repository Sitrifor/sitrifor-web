#!/usr/bin/env node
/**
 * Migrate Yandex secrets out of /var/www into encrypted root-only store.
 * Also shreds plaintext leftovers and redacts known terminal leaks.
 *
 *   node seo/scripts/yandex-disk/harden.mjs
 *   node seo/scripts/yandex-disk/harden.mjs --audit
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SECRET_NAMES,
  auditSecretsStore,
  ensureSecretsDir,
  getSecret,
  hasSecret,
  putSecret,
  shredFile,
  secretsDir
} from './secrets.mjs';
import { createDiskClient } from './client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEO_ROOT = path.resolve(__dirname, '../..');
const CRED = path.join(SEO_ROOT, 'credentials');
const ENV_PATH = path.join(SEO_ROOT, '.env');

function readIfExists(p) {
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8').trim();
}

function stripEnvToken() {
  if (!fs.existsSync(ENV_PATH)) return false;
  let text = fs.readFileSync(ENV_PATH, 'utf8');
  const before = text;
  text = text.replace(
    /^YANDEX_DISK_OAUTH_TOKEN=.*$/m,
    '# YANDEX_DISK_OAUTH_TOKEN is stored encrypted outside web root (see harden.mjs)'
  );
  text = text.replace(
    /^YANDEX_OAUTH_TOKEN=.*$/m,
    '# YANDEX_OAUTH_TOKEN stored encrypted: yandex-webmaster-token.enc'
  );
  if (text !== before) {
    fs.writeFileSync(ENV_PATH, text, { mode: 0o600 });
    fs.chmodSync(ENV_PATH, 0o600);
    return true;
  }
  return false;
}

function redactTerminalLeaks() {
  const roots = [
    '/root/.cursor/projects/var-www-sitrifor/terminals',
    '/root/.cursor/projects/var-www-sitrifor/agent-tools'
  ];
  let n = 0;
  const re = /y0[_-]{1,2}[A-Za-z0-9_-]{20,}/g;
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const name of fs.readdirSync(root)) {
      const p = path.join(root, name);
      if (!fs.statSync(p).isFile()) continue;
      let text = fs.readFileSync(p, 'utf8');
      if (!re.test(text)) continue;
      re.lastIndex = 0;
      const next = text.replace(re, 'y0__[REDACTED_YANDEX_TOKEN]');
      if (next !== text) {
        fs.writeFileSync(p, next);
        n += 1;
      }
    }
  }
  return n;
}

function writeCredentialStub() {
  const stub = `# Secrets moved

Yandex OAuth tokens and client secrets are NOT stored in this directory.

Encrypted store (root only):
  ${secretsDir()}/

Manage:
  node seo/scripts/yandex-disk/harden.mjs --audit
  node seo/scripts/yandex-disk/auth.mjs

Do not paste tokens into chat or shell command lines.
`;
  fs.mkdirSync(CRED, { recursive: true, mode: 0o700 });
  fs.chmodSync(CRED, 0o700);
  fs.writeFileSync(path.join(CRED, 'SECRETS_MOVED.txt'), stub, { mode: 0o644 });
}

async function migrate() {
  ensureSecretsDir();
  const report = { migrated: [], shredded: [], notes: [] };

  // Disk token
  const diskPlain =
    readIfExists(path.join(CRED, 'yandex-disk-token.txt')) ||
    (process.env.YANDEX_DISK_OAUTH_TOKEN || '').trim();
  if (diskPlain) {
    putSecret(SECRET_NAMES.diskToken, diskPlain);
    report.migrated.push(SECRET_NAMES.diskToken);
  } else if (!hasSecret(SECRET_NAMES.diskToken)) {
    report.notes.push('no disk token found to migrate');
  }

  // Webmaster token
  const wm = readIfExists(path.join(CRED, 'yandex-webmaster-token.txt'));
  if (wm) {
    putSecret(SECRET_NAMES.webmasterToken, wm);
    report.migrated.push(SECRET_NAMES.webmasterToken);
  }

  // OAuth app json
  const appPath = path.join(CRED, 'yandex-oauth-app.json');
  if (fs.existsSync(appPath)) {
    putSecret(SECRET_NAMES.oauthApp, fs.readFileSync(appPath, 'utf8'));
    report.migrated.push(SECRET_NAMES.oauthApp);
  }

  // Strip .env
  if (stripEnvToken()) report.notes.push('stripped YANDEX_DISK_OAUTH_TOKEN from seo/.env');

  // Shred plaintext under web tree
  for (const name of [
    'yandex-disk-token.txt',
    'yandex-webmaster-token.txt',
    'yandex-oauth-app.json'
  ]) {
    const p = path.join(CRED, name);
    if (shredFile(p)) report.shredded.push(p);
  }

  writeCredentialStub();
  fs.chmodSync(CRED, 0o700);

  const redacted = redactTerminalLeaks();
  report.notes.push(`redacted terminal/tool files: ${redacted}`);

  // Verify disk token still works (decrypt in memory)
  try {
    const token = getSecret(SECRET_NAMES.diskToken);
    if (token) {
      const client = createDiskClient(token);
      const info = await client.info();
      report.notes.push(
        `disk API ok after migrate (used_gb=${(info.used_space / 1e9).toFixed(2)})`
      );
    }
  } catch (e) {
    report.notes.push(`disk API check failed: ${e.message}`);
  }

  return report;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--audit')) {
    const a = auditSecretsStore();
    console.log(JSON.stringify(a, null, 2));
    process.exit(a.ok ? 0 : 2);
  }

  if (process.getuid && process.getuid() !== 0) {
    console.error('Запускайте от root (секреты в /root/.config/...).');
    process.exit(1);
  }

  const report = await migrate();
  console.log(JSON.stringify(report, null, 2));
  const a = auditSecretsStore();
  console.log('--- audit ---');
  console.log(JSON.stringify(a, null, 2));
  if (!a.ok) process.exit(2);
  console.log('OK: Yandex secrets hardened.');
  console.log('');
  console.log('Важно: токен светился в чате. Отзовите его на https://oauth.yandex.ru/ и выдайте новый через:');
  console.log('  node seo/scripts/yandex-disk/auth.mjs');
  console.log('(без вставки токена в чат)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
