#!/usr/bin/env node
/**
 * Save a fresh Direct OAuth token after API app approval.
 *
 * 1) Open AUTH URL under php-grishan, click Allow
 * 2) Copy access_token from redirect URL
 * 3) Paste:
 *      node seo/scripts/direct-auth.mjs --from-stdin
 *    then Ctrl-D
 * Or:
 *      echo 'TOKEN' | node seo/scripts/direct-auth.mjs --from-stdin
 */
import { SECRET_NAMES, ensureSecretsDir, putSecret, getSecret, hasSecret } from './yandex-disk/secrets.mjs';

const FROM_STDIN = process.argv.includes('--from-stdin');
const CHECK = process.argv.includes('--check');

function app() {
  return JSON.parse(getSecret(SECRET_NAMES.oauthApp));
}

function authUrl() {
  const u = new URL('https://oauth.yandex.ru/authorize');
  u.searchParams.set('response_type', 'token');
  u.searchParams.set('client_id', app().client_id);
  u.searchParams.set('force_confirm', 'yes');
  return u.toString();
}

async function testToken(token) {
  const info = await fetch('https://login.yandex.ru/info?format=json', {
    headers: { Authorization: 'OAuth ' + token }
  }).then((r) => r.json());
  const camps = await fetch('https://api.direct.yandex.com/json/v501/campaigns', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Accept-Language': 'ru',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      method: 'get',
      params: {
        SelectionCriteria: {},
        FieldNames: ['Id', 'Name', 'State', 'Type'],
        UnifiedCampaignFieldNames: ['CounterIds', 'Settings']
      }
    })
  }).then((r) => r.json());
  return {
    login: info.login,
    error: camps.error || null,
    campaigns: (camps.result?.Campaigns || []).map((c) => ({
      id: String(c.Id),
      name: c.Name,
      state: c.State,
      type: c.Type
    }))
  };
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function main() {
  if (CHECK) {
    const token = hasSecret('yandex-direct-token')
      ? getSecret('yandex-direct-token').trim()
      : getSecret(SECRET_NAMES.webmasterToken).trim();
    const source = hasSecret('yandex-direct-token') ? 'yandex-direct-token' : 'webmasterToken';
    console.log(JSON.stringify({ source, ...(await testToken(token)) }, null, 2));
    return;
  }

  console.log('Откройте под php-grishan:\n' + authUrl() + '\n');
  if (!FROM_STDIN) {
    console.log('Затем: echo TOKEN | node seo/scripts/direct-auth.mjs --from-stdin');
    return;
  }
  let raw = await readStdin();
  const m = raw.match(/access_token=([^&\s]+)/);
  if (m) raw = decodeURIComponent(m[1]);
  raw = raw.replace(/^Bearer\s+/i, '').trim();
  if (!raw || raw.length < 20) {
    console.error('Нет токена во stdin');
    process.exit(1);
  }
  const test = await testToken(raw);
  console.log(JSON.stringify(test, null, 2));
  if (test.error) {
    console.error('Токен не принят API Директа');
    process.exit(2);
  }
  ensureSecretsDir();
  putSecret('yandex-direct-token', raw + '\n');
  console.log('Saved encrypted secret: yandex-direct-token');
  if (!test.campaigns.length) {
    console.log(
      'WARNING: кампаний по-прежнему 0. Проверьте, что разрешили доступ именно php-grishan и приложение Sitrifor SEO Agent.'
    );
    process.exit(3);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
