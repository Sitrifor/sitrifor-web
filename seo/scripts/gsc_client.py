#!/usr/bin/env python3
"""
Optional Google Search Console helpers.
Requires credentials/gsc-service-account.json and site verified in GSC.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

try:
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
except ImportError:
    print("Install seo/.venv and google-api-python-client")
    raise SystemExit(1)

SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly"]


def client():
    cred_path = os.environ.get(
        "GOOGLE_APPLICATION_CREDENTIALS",
        str(ROOT / "credentials" / "gsc-service-account.json"),
    )
    if not Path(cred_path).is_file():
        print(f"Missing credentials: {cred_path}")
        print("See credentials/README.md")
        raise SystemExit(2)
    creds = service_account.Credentials.from_service_account_file(cred_path, scopes=SCOPES)
    return build("searchconsole", "v1", credentials=creds)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("command", choices=["sites", "sitemap-list", "inspect"])
    p.add_argument("--site", default=os.environ.get("GSC_SITE_URL", "https://sitrifor.ru/"))
    p.add_argument("--url", help="URL for URL Inspection")
    args = p.parse_args()
    svc = client()

    if args.command == "sites":
        sites = svc.sites().list().execute()
        for s in sites.get("siteEntry", []):
            print(f"{s.get('permissionLevel')}\t{s.get('siteUrl')}")
        return 0

    if args.command == "sitemap-list":
        data = svc.sitemaps().list(siteUrl=args.site).execute()
        for sm in data.get("sitemap", []):
            print(f"{sm.get('lastSubmitted')}\t{sm.get('path')}\terrors={sm.get('errors')}")
        return 0

    if args.command == "inspect":
        if not args.url:
            print("--url required")
            return 1
        # URL Inspection is under searchconsole API v1 urlInspection.index.inspect
        body = {"inspectionUrl": args.url, "siteUrl": args.site}
        res = svc.urlInspection().index().inspect(body=body).execute()
        print(res)
        return 0

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
