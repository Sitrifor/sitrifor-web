#!/usr/bin/env python3
"""
Google Search Console helpers for sitrifor.ru.
Requires credentials/gsc-service-account.json + SA invited as Full user.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

try:
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
except ImportError:
    print("Install seo/.venv and google-api-python-client")
    raise SystemExit(1)

# Read+write: sitemaps submit; analytics + inspection work with either.
SCOPES = ["https://www.googleapis.com/auth/webmasters"]

DEFAULT_SITE = os.environ.get("GSC_SITE_URL", "sc-domain:sitrifor.ru")

# Priority URLs for SEO / crawl focus (Request indexing in UI if not indexed).
HUB_URLS = [
    "https://sitrifor.ru/",
    "https://sitrifor.ru/masters",
    "https://sitrifor.ru/634/",
    "https://sitrifor.ru/marketplace",
    "https://sitrifor.ru/news",
    "https://sitrifor.ru/guides/aftercare/",
    "https://sitrifor.ru/guides/pigments/",
    "https://sitrifor.ru/guides/machines/",
    "https://sitrifor.ru/guides/cartridges/",
    "https://sitrifor.ru/tools/price-calculator/",
]

SITEMAPS = [
    "https://sitrifor.ru/sitemap.xml",
    "https://sitrifor.ru/sitemap-news.xml",
    # marketplace paused: ~3505 URLs on a young domain (file still public)
]


def client():
    cred_path = os.environ.get(
        "GOOGLE_APPLICATION_CREDENTIALS",
        str(ROOT / "credentials" / "gsc-service-account.json"),
    )
    if not Path(cred_path).is_file():
        print(f"Missing credentials: {cred_path}")
        print("See docs/google-search-console-setup.md")
        raise SystemExit(2)
    if not Path(cred_path).is_absolute():
        cred_path = str((ROOT / cred_path).resolve())
    creds = service_account.Credentials.from_service_account_file(cred_path, scopes=SCOPES)
    return build("searchconsole", "v1", credentials=creds)


def _inspect_one(svc, site: str, url: str) -> dict:
    res = svc.urlInspection().index().inspect(
        body={"inspectionUrl": url, "siteUrl": site}
    ).execute()
    ir = res.get("inspectionResult", {})
    idx = ir.get("indexStatusResult", {}) or {}
    mobile = ir.get("mobileUsabilityResult", {}) or {}
    rich = ir.get("richResultsResult", {}) or {}
    return {
        "url": url,
        "verdict": idx.get("verdict"),
        "coverageState": idx.get("coverageState"),
        "robotsTxtState": idx.get("robotsTxtState"),
        "indexingState": idx.get("indexingState"),
        "lastCrawlTime": idx.get("lastCrawlTime"),
        "pageFetchState": idx.get("pageFetchState"),
        "crawledAs": idx.get("crawledAs"),
        "sitemap": idx.get("sitemap"),
        "referringUrls": idx.get("referringUrls") or [],
        "mobileUsability": mobile.get("verdict"),
        "richResults": rich.get("verdict"),
    }


def cmd_sites(svc, _args) -> int:
    sites = svc.sites().list().execute()
    for s in sites.get("siteEntry", []):
        print(f"{s.get('permissionLevel')}\t{s.get('siteUrl')}")
    return 0


def cmd_sitemap_list(svc, args) -> int:
    data = svc.sitemaps().list(siteUrl=args.site).execute()
    for sm in data.get("sitemap", []):
        contents = sm.get("contents") or []
        submitted = indexed = 0
        for c in contents:
            submitted += int(c.get("submitted") or 0)
            indexed += int(c.get("indexed") or 0)
        print(
            f"{sm.get('lastSubmitted')}\t{sm.get('path')}\t"
            f"errors={sm.get('errors')}\twarnings={sm.get('warnings')}\t"
            f"submitted={submitted}\tindexed={indexed}"
        )
    return 0


def cmd_sitemap_ensure(svc, args) -> int:
    """Submit all known sitemaps (idempotent)."""
    existing = {
        sm.get("path")
        for sm in svc.sitemaps().list(siteUrl=args.site).execute().get("sitemap", [])
    }
    for feed in SITEMAPS:
        if feed in existing and not args.force:
            print(f"ok\t{feed}")
            continue
        svc.sitemaps().submit(siteUrl=args.site, feedpath=feed).execute()
        print(f"submitted\t{feed}")
    return 0


def cmd_inspect(svc, args) -> int:
    if not args.url:
        print("--url required")
        return 1
    row = _inspect_one(svc, args.site, args.url)
    print(json.dumps(row, ensure_ascii=False, indent=2))
    return 0


def cmd_inspect_hubs(svc, args) -> int:
    rows = []
    for u in HUB_URLS:
        try:
            row = _inspect_one(svc, args.site, u)
            rows.append(row)
            flag = "OK" if row.get("verdict") == "PASS" else "NEED"
            print(
                f"{flag}\t{row.get('coverageState')}\t{u}\t"
                f"crawl={row.get('lastCrawlTime') or '-'}"
            )
        except Exception as e:
            print(f"ERR\t{u}\t{e}")
            rows.append({"url": u, "error": str(e)})
    if args.json_out:
        Path(args.json_out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.json_out).write_text(
            json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    return 0


def _analytics(svc, site: str, start: str, end: str, dimensions: list[str], row_limit: int = 50):
    body = {
        "startDate": start,
        "endDate": end,
        "dimensions": dimensions,
        "rowLimit": row_limit,
    }
    return svc.searchanalytics().query(siteUrl=site, body=body).execute()


def cmd_analytics(svc, args) -> int:
    end = date.today() - timedelta(days=3)
    start = end - timedelta(days=args.days)
    dims = [d.strip() for d in args.dimensions.split(",") if d.strip()]
    data = _analytics(svc, args.site, start.isoformat(), end.isoformat(), dims, args.limit)
    rows = data.get("rows") or []
    if not rows:
        print(f"No rows for {start}..{end} (normal for a new property).")
        return 0
    for r in rows:
        keys = " | ".join(r.get("keys") or [])
        print(
            f"{r.get('clicks', 0)}\t{r.get('impressions', 0)}\t"
            f"{r.get('ctr', 0):.4f}\t{r.get('position', 0):.1f}\t{keys}"
        )
    return 0


def cmd_report(svc, args) -> int:
    """Full GSC snapshot for agents / weekly runbook."""
    day = date.today().isoformat()
    out_dir = Path(args.out or (ROOT / "reports" / "gsc"))
    out_dir.mkdir(parents=True, exist_ok=True)

    end = date.today() - timedelta(days=3)
    start = end - timedelta(days=28)

    sites = svc.sites().list().execute().get("siteEntry", [])
    sitemaps = svc.sitemaps().list(siteUrl=args.site).execute().get("sitemap", [])

    hubs = []
    for u in HUB_URLS:
        try:
            hubs.append(_inspect_one(svc, args.site, u))
        except Exception as e:
            hubs.append({"url": u, "error": str(e)})

    analytics = {}
    for dim_name, dims in (
        ("query", ["query"]),
        ("page", ["page"]),
        ("country", ["country"]),
        ("device", ["device"]),
    ):
        try:
            analytics[dim_name] = _analytics(
                svc, args.site, start.isoformat(), end.isoformat(), dims, 25
            )
        except Exception as e:
            analytics[dim_name] = {"error": str(e)}

    not_indexed = [
        h
        for h in hubs
        if h.get("coverageState")
        and "indexed" not in (h.get("coverageState") or "").lower()
        and "Submitted and indexed" not in (h.get("coverageState") or "")
    ]
    # Also catch "Crawled - currently not indexed"
    need_ui = [
        h
        for h in hubs
        if (h.get("verdict") != "PASS")
        or ("not indexed" in (h.get("coverageState") or "").lower())
        or ("unknown" in (h.get("coverageState") or "").lower())
    ]

    sitemap_rows = []
    for sm in sitemaps:
        submitted = indexed = 0
        for c in sm.get("contents") or []:
            submitted += int(c.get("submitted") or 0)
            indexed += int(c.get("indexed") or 0)
        sitemap_rows.append(
            {
                "path": sm.get("path"),
                "errors": sm.get("errors"),
                "warnings": sm.get("warnings"),
                "submitted": submitted,
                "indexed": indexed,
                "lastSubmitted": sm.get("lastSubmitted"),
                "lastDownloaded": sm.get("lastDownloaded"),
            }
        )

    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "siteUrl": args.site,
        "permission": next(
            (s.get("permissionLevel") for s in sites if s.get("siteUrl") == args.site),
            None,
        ),
        "sitemaps": sitemap_rows,
        "hubs": hubs,
        "needRequestIndexing": [
            {"url": h.get("url"), "coverageState": h.get("coverageState"), "verdict": h.get("verdict")}
            for h in need_ui
        ],
        "analyticsWindow": {"start": start.isoformat(), "end": end.isoformat()},
        "analytics": {
            k: {
                "rowCount": len((v.get("rows") or [])),
                "rows": (v.get("rows") or [])[:15],
                "error": v.get("error"),
            }
            for k, v in analytics.items()
        },
        "uiChecklist": [
            "GSC → URL Inspection → Request indexing for any NEED hubs (esp. /634/)",
            "Settings → users: owner + sitrifor-gsc@… Full",
            "Monitor → Core Web Vitals / Page experience (after traffic)",
            "Keep Domain property sc-domain:sitrifor.ru as primary",
            "Optional: Bing Webmaster ← Import from GSC",
        ],
    }

    json_path = out_dir / f"status-{day}.json"
    latest = out_dir / "status-latest.json"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    latest.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        f"# GSC status {day}",
        "",
        f"- Site: `{args.site}` ({report.get('permission')})",
        f"- Generated: `{report['generatedAt']}`",
        "",
        "## Sitemaps",
        "",
    ]
    for sm in sitemap_rows:
        lines.append(
            f"- `{sm['path']}` errors={sm['errors']} submitted={sm['submitted']} "
            f"indexed={sm['indexed']}"
        )
    lines += ["", "## Hubs (URL Inspection)", ""]
    for h in hubs:
        if h.get("error"):
            lines.append(f"- ERR `{h.get('url')}`: {h['error']}")
            continue
        mark = "OK" if h.get("verdict") == "PASS" else "NEED"
        lines.append(
            f"- **{mark}** `{h.get('url')}` - {h.get('coverageState')} "
            f"(crawl {h.get('lastCrawlTime') or 'n/a'})"
        )
    lines += ["", "## Request indexing (UI only)", ""]
    if need_ui:
        for h in need_ui:
            lines.append(f"- [ ] `{h.get('url')}` - {h.get('coverageState')}")
    else:
        lines.append("- All hubs PASS / indexed.")
    lines += [
        "",
        "## Analytics (28d, lag ~3d)",
        "",
        f"- Queries: {report['analytics']['query']['rowCount']} rows",
        f"- Pages: {report['analytics']['page']['rowCount']} rows",
        "",
        "API cannot click «Request indexing» - do that in GSC UI for NEED URLs.",
        "",
        f"JSON: `{json_path}`",
        "",
    ]
    md_path = out_dir / f"status-{day}.md"
    md_path.write_text("\n".join(lines), encoding="utf-8")
    (out_dir / "status-latest.md").write_text("\n".join(lines), encoding="utf-8")

    print(f"Wrote {json_path}")
    print(f"Wrote {md_path}")
    print(f"NEED request indexing: {len(need_ui)}")
    for h in need_ui:
        print(f"  - {h.get('url')}\t{h.get('coverageState')}")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description="Sitrifor GSC toolkit")
    p.add_argument(
        "command",
        choices=[
            "sites",
            "sitemap-list",
            "sitemap-ensure",
            "inspect",
            "inspect-hubs",
            "analytics",
            "report",
        ],
    )
    p.add_argument("--site", default=DEFAULT_SITE)
    p.add_argument("--url", help="URL for inspect")
    p.add_argument("--days", type=int, default=28)
    p.add_argument("--dimensions", default="query", help="comma: query,page,country,device")
    p.add_argument("--limit", type=int, default=50)
    p.add_argument("--force", action="store_true", help="Resubmit sitemaps even if present")
    p.add_argument("--json-out", help="Write inspect-hubs JSON")
    p.add_argument("--out", help="report output directory")
    args = p.parse_args()
    svc = client()

    handlers = {
        "sites": cmd_sites,
        "sitemap-list": cmd_sitemap_list,
        "sitemap-ensure": cmd_sitemap_ensure,
        "inspect": cmd_inspect,
        "inspect-hubs": cmd_inspect_hubs,
        "analytics": cmd_analytics,
        "report": cmd_report,
    }
    return handlers[args.command](svc, args)


if __name__ == "__main__":
    raise SystemExit(main())
