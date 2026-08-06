#!/usr/bin/env python3
"""Validate sitemap.xml and report URL statuses."""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from urllib.request import Request, urlopen

NS = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}


def main() -> int:
    origin = (sys.argv[1] if len(sys.argv) > 1 else "https://sitrifor.ru").rstrip("/")
    sitemap_url = f"{origin}/sitemap.xml"
    req = Request(sitemap_url, headers={"User-Agent": "SitriforSeoToolkit/1.0"})
    try:
        with urlopen(req, timeout=20) as resp:
            data = resp.read()
            status = resp.status
    except Exception as e:
        print(f"FAIL fetch {sitemap_url}: {e}")
        return 1

    print(f"sitemap status={status} bytes={len(data)}")
    try:
        root = ET.fromstring(data)
    except ET.ParseError as e:
        print(f"FAIL parse XML: {e}")
        return 1

    locs = [el.text.strip() for el in root.findall("sm:url/sm:loc", NS) if el.text]
    if not locs:
        locs = [el.text.strip() for el in root.findall("url/loc") if el.text]
    print(f"urls: {len(locs)}")
    bad = 0
    for loc in locs:
        try:
            r = Request(loc, method="HEAD", headers={"User-Agent": "SitriforSeoToolkit/1.0"})
            with urlopen(r, timeout=15) as resp:
                code = resp.status
        except Exception as e:
            # some servers disallow HEAD
            try:
                r = Request(loc, headers={"User-Agent": "SitriforSeoToolkit/1.0"})
                with urlopen(r, timeout=15) as resp:
                    code = resp.status
            except Exception as e2:
                print(f"  ERR {loc} {e2}")
                bad += 1
                continue
        mark = "OK" if code < 400 else "BAD"
        if code >= 400:
            bad += 1
        print(f"  {mark} {code} {loc}")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
