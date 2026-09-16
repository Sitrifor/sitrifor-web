#!/usr/bin/env node
/**
 * VK Ads (ads.vk.ru) API auth.
 *
 * 1) In cabinet: Settings → API → copy client_secret (visible ~10 min)
 * 2) On server create file (chmod 600):
 *      /root/.config/sitrifor/secrets/vk-ads.incoming.json
 *    {
 *      "client_id": "bgUF8KkH9RiuVmQC",
 *      "client_secret": "PASTE_SECRET_HERE"
 *    }
 * 3) Run:
 *      node seo/scripts/vk-ads-auth.mjs --from-file
 *      node seo/scripts/vk-ads-auth.mjs --check
 *
 * Do NOT paste client_secret into chat or shell history.
 */
import fs from 'node:fs';
import {
  SECRET_NAMES,
  ensureSecretsDir,
  putSecret,
  getSecret,
  hasSecret,
  shredFile
} from './yandex-disk/secrets.mjs';

const FROM_FILE = process.argv.includes('--from-file');
const CHECK = process.argv.includes('--check');
const INCOMING = '/root/.config/sitrifor/secrets/vk-ads.incoming.json';
const TOKEN_URL = 'https://ads.vk.ru/api/v2/oauth2/token.json';
const API = 'https://ads.vk.ru/api/v2';

export const VK_SECRET = {
  app: 'vk-ads-oauth-app',
  token: 'vk-ads-access-token'
};

async function getToken(clientId, clientSecret) {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Token response not JSON (${res.status}): ${text.slice(0, 300)}`);
  }
  if (!res.ok || json.error || !json.access_token) {
    throw new Error(`Token error: ${JSON.stringify(json)}`);
  }
  return json;
}

async function apiGet(path, accessToken) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function check(accessToken) {
  const user = await apiGet('/user.json', accessToken);
  const campaigns = await apiGet('/ad_plans.json?fields=id,name,status,objective&limit=20', accessToken);
  return {
    user: user.json,
    campaignsStatus: campaigns.status,
    campaigns: campaigns.json?.items || campaigns.json || null
  };
}

async function main() {
  if (CHECK) {
    if (!hasSecret(VK_SECRET.token)) {
      console.log(JSON.stringify({ ok: false, reason: 'no_token', hint: 'run --from-file first' }, null, 2));
      process.exit(1);
    }
    const token = getSecret(VK_SECRET.token).trim();
    const info = await check(token);
    console.log(JSON.stringify({ ok: true, ...info }, null, 2));
    return;
  }

  if (!FROM_FILE) {
    console.log(`Создайте файл ${INCOMING} с client_id и client_secret, затем:
  node seo/scripts/vk-ads-auth.mjs --from-file
  node seo/scripts/vk-ads-auth.mjs --check`);
    return;
  }

  if (!fs.existsSync(INCOMING)) {
    console.error(`Нет файла ${INCOMING}`);
    process.exit(1);
  }
  fs.chmodSync(INCOMING, 0o600);
  const raw = JSON.parse(fs.readFileSync(INCOMING, 'utf8'));
  shredFile(INCOMING);
  const clientId = String(raw.client_id || '').trim();
  const clientSecret = String(raw.client_secret || '').trim();
  if (!clientId || !clientSecret) {
    console.error('Нужны client_id и client_secret в JSON');
    process.exit(1);
  }

  const tok = await getToken(clientId, clientSecret);
  ensureSecretsDir();
  putSecret(
    VK_SECRET.app,
    JSON.stringify(
      {
        client_id: clientId,
        client_secret: clientSecret,
        created_at: new Date().toISOString()
      },
      null,
      2
    ) + '\n'
  );
  putSecret(VK_SECRET.token, tok.access_token + '\n');
  if (tok.refresh_token) {
    putSecret('vk-ads-refresh-token', tok.refresh_token + '\n');
  }

  const info = await check(tok.access_token);
  console.log(
    JSON.stringify(
      {
        ok: true,
        saved: [VK_SECRET.app, VK_SECRET.token],
        token_type: tok.token_type,
        expires_in: tok.expires_in,
        scopes: tok.scope || tok.scopes || null,
        user_id: info.user?.id || info.user?.user?.id || null,
        campaigns_preview: Array.isArray(info.campaigns)
          ? info.campaigns.slice(0, 5).map((c) => ({ id: c.id, name: c.name, status: c.status }))
          : info.campaigns
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
