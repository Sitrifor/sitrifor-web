#!/usr/bin/env node
/**
 * Apply Metrika-based query pruning to Yandex Direct.
 *
 *   node seo/scripts/direct-optimize.mjs --dry-run
 *   node seo/scripts/direct-optimize.mjs --apply
 *
 * Env:
 *   DIRECT_CLIENT_LOGIN  - optional Client-Login (another advertiser under same OAuth)
 *   DIRECT_CAMPAIGN_ID   - optional force campaign id (default: from Metrika)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECRET_NAMES, getSecret } from './yandex-disk/secrets.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = path.resolve(__dirname, '../reports/direct');
const APPLY = process.argv.includes('--apply');
const DRY = !APPLY;
const METRIKA_ID = '111332527';
const DATE1 = '2026-08-11';
const GOALS = {
  appstore: 593149640,
  carePdf: 593149713,
  calcPdf: 593149710
};

const KEEP_KEYWORDS = fs
  .readFileSync(path.join(REPORT_DIR, 'keep-keywords.txt'), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

const MINUS = fs
  .readFileSync(path.join(REPORT_DIR, 'minus-phrases.txt'), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean);

function token() {
  try {
    const t = getSecret('yandex-direct-token').trim();
    if (t) return t;
  } catch {
    /* fallback */
  }
  return getSecret(SECRET_NAMES.webmasterToken).trim();
}

function clientLogin() {
  return (process.env.DIRECT_CLIENT_LOGIN || '').trim();
}

async function ym(qs) {
  const u = new URL('https://api-metrika.yandex.net/stat/v1/data');
  Object.entries(qs).forEach(([k, v]) => u.searchParams.set(k, String(v)));
  const res = await fetch(u, { headers: { Authorization: 'OAuth ' + token() } });
  return res.json();
}

async function direct(service, body, { version = 'v5' } = {}) {
  const headers = {
    Authorization: 'Bearer ' + token(),
    'Accept-Language': 'ru',
    'Content-Type': 'application/json; charset=utf-8'
  };
  const login = clientLogin();
  if (login) headers['Client-Login'] = login;
  const res = await fetch(`https://api.direct.yandex.com/json/${version}/${service}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  return res.json();
}

function apiBlocked(j) {
  const code = j?.error?.error_code;
  return code === 58;
}

async function metrikaCampaignId(date2) {
  const forced = Number(process.env.DIRECT_CAMPAIGN_ID || 0);
  if (forced) return forced;
  const j = await ym({
    ids: METRIKA_ID,
    date1: DATE1,
    date2,
    accuracy: 'full',
    limit: 5,
    metrics: 'ym:s:visits',
    dimensions: 'ym:s:lastDirectClickOrder',
    filters: "ym:s:lastSourceEngine=='ad.Яндекс: Директ'",
    sort: '-ym:s:visits'
  });
  const row = j.data?.[0]?.dimensions?.[0];
  const id = Number(String(row?.direct_id || row?.id || '').replace(/^N-/, ''));
  return Number.isFinite(id) && id > 0 ? id : null;
}

async function loadCampaigns(metrikaId) {
  const versions = ['v501', 'v5'];
  for (const version of versions) {
    const byList = await direct(
      'campaigns',
      {
        method: 'get',
        params: {
          SelectionCriteria: {},
          FieldNames: ['Id', 'Name', 'Status', 'State', 'Type', 'NegativeKeywords'],
          UnifiedCampaignFieldNames: ['CounterIds', 'Settings', 'BiddingStrategy', 'TrackingParams']
        }
      },
      { version }
    );
    if (apiBlocked(byList)) return { blocked: byList };
    const list = byList.result?.Campaigns || [];
    if (list.length) return { version, campaigns: list, source: 'list' };

    if (metrikaId) {
      const byId = await direct(
        'campaigns',
        {
          method: 'get',
          params: {
            SelectionCriteria: { Ids: [metrikaId] },
            FieldNames: ['Id', 'Name', 'Status', 'State', 'Type', 'NegativeKeywords'],
            UnifiedCampaignFieldNames: ['CounterIds', 'Settings', 'BiddingStrategy', 'TrackingParams']
          }
        },
        { version }
      );
      const found = byId.result?.Campaigns || [];
      if (found.length) return { version, campaigns: found, source: 'metrika_id' };
    }
  }
  return { version: 'v501', campaigns: [], source: 'none' };
}

async function main() {
  const date2 = new Date().toISOString().slice(0, 10);
  const metrics = [
    'ym:s:visits',
    `ym:s:goal${GOALS.appstore}reaches`,
    `ym:s:goal${GOALS.carePdf}reaches`,
    `ym:s:goal${GOALS.calcPdf}reaches`
  ].join(',');

  const pages = [];
  for (const offset of [1, 101, 201]) {
    pages.push(
      await ym({
        ids: METRIKA_ID,
        date1: DATE1,
        date2,
        accuracy: 'full',
        limit: 100,
        offset,
        metrics,
        dimensions: 'ym:s:lastDirectSearchPhrase',
        filters: "ym:s:lastSourceEngine=='ad.Яндекс: Директ'",
        sort: '-ym:s:visits'
      })
    );
  }

  const rows = pages.flatMap((p) => p.data || []).map((r) => {
    const q = r.dimensions[0].name;
    const [visits, appstore, carePdf, calcPdf] = r.metrics;
    const pdf = carePdf + calcPdf;
    return { q, visits, appstore, pdf, target: appstore + pdf };
  });
  const converting = rows.filter((r) => r.target > 0);

  const clients = await direct('clients', {
    method: 'get',
    params: { FieldNames: ['Login', 'ClientId', 'ClientInfo'] }
  });
  if (apiBlocked(clients)) {
    console.log(JSON.stringify({ ok: false, reason: 'direct_api_access_pending', detail: clients.error }, null, 2));
    process.exit(2);
  }

  const metrikaId = await metrikaCampaignId(date2);
  const loaded = await loadCampaigns(metrikaId);
  if (loaded.blocked) {
    console.log(JSON.stringify({ ok: false, reason: 'direct_api_access_pending', detail: loaded.blocked.error }, null, 2));
    process.exit(2);
  }

  const campaigns = loaded.campaigns || [];
  const target =
    campaigns.find((c) => c.Id === metrikaId) ||
    campaigns.find((c) => /11\.08\.2026|авто|634|тату/i.test(c.Name || '')) ||
    campaigns.find((c) => c.State === 'ON') ||
    campaigns[0];

  if (!target) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          reason: 'campaign_not_on_this_direct_login',
          apiLogin: clients.result?.Clients?.[0]?.Login || null,
          clientLoginHeader: clientLogin() || null,
          metrikaCampaignId: metrikaId,
          metrikaCampaignName: 'Кампания от 11.08.2026',
          converting,
          keepKeywords: KEEP_KEYWORDS,
          minusPhrases: MINUS,
          hint:
            'API доступен, но у логина php-grishan нет кампании N-' +
            metrikaId +
            '. В интерфейсе Директа откройте кампанию и посмотрите логин (правый верхний угол / переключатель аккаунтов). Выдайте OAuth-токен от того логина или укажите DIRECT_CLIENT_LOGIN=... и повторите --apply.'
        },
        null,
        2
      )
    );
    process.exit(3);
  }

  const existingMinus = target.NegativeKeywords?.Items || [];
  const mergedMinus = Array.from(new Set([...existingMinus, ...MINUS]));

  const groups = await direct(
    'adgroups',
    {
      method: 'get',
      params: {
        SelectionCriteria: { CampaignIds: [target.Id] },
        FieldNames: ['Id', 'Name', 'Status', 'CampaignId']
      }
    },
    { version: loaded.version }
  );
  const adGroupId = groups.result?.AdGroups?.[0]?.Id;

  const plan = {
    dry: DRY,
    apiVersion: loaded.version,
    campaignId: target.Id,
    campaignName: target.Name,
    campaignType: target.Type,
    adGroupId,
    convertingCount: converting.length,
    addKeywords: KEEP_KEYWORDS,
    minusCount: mergedMinus.length,
    disableNetwork: true
  };

  if (DRY) {
    console.log(JSON.stringify({ ok: true, ...plan, converting }, null, 2));
    return;
  }

  const campaignUpdate = {
    Id: target.Id,
    NegativeKeywords: { Items: mergedMinus }
  };

  // Unified: try turn off network placements via Settings if present
  if (target.Type === 'UNIFIED_CAMPAIGN') {
    campaignUpdate.UnifiedCampaign = {
      Settings: [{ Option: 'ENABLE_AREA_OF_INTEREST_TARGETING', Value: 'NO' }]
    };
  }

  const upd = await direct(
    'campaigns',
    { method: 'update', params: { Campaigns: [campaignUpdate] } },
    { version: loaded.version }
  );

  let kw = null;
  if (adGroupId) {
    kw = await direct(
      'keywords',
      {
        method: 'add',
        params: {
          Keywords: KEEP_KEYWORDS.map((Keyword) => ({
            AdGroupId: adGroupId,
            Keyword
          }))
        }
      },
      { version: loaded.version }
    );
  }

  console.log(JSON.stringify({ ok: true, applied: true, update: upd, keywords: kw, plan }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
