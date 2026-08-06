#!/usr/bin/env python3
"""Build a compact daily SEO summary JSON from the latest toolkit reports."""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

REPORTS = Path(__file__).resolve().parent.parent / "reports"


def load_json(path: Path):
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def lighthouse_scores(data: dict | None) -> dict:
    if not data:
        return {}
    cats = data.get("categories") or {}
    return {k: round((v.get("score") or 0) * 100) for k, v in cats.items()}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--day", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    audit = load_json(REPORTS / "seo-audit-latest.json") or {}
    deep = load_json(REPORTS / "deep-audit-latest.json") or []
    lh = load_json(REPORTS / "lighthouse-latest.json")

    pages = audit.get("pages") or []
    html_pages = [p for p in pages if p.get("issues") is not None or p.get("title")]
    issue_count = sum(len(p.get("issues") or []) for p in html_pages)
    thin = [p["path"] for p in html_pages if "thin_content" in (p.get("issues") or [])]
    broken_tech = [
        p
        for p in pages
        if isinstance(p.get("status"), int) and p["status"] >= 400 and p.get("path") not in ("/favicon.ico",)
    ]

    crawl_broken = 0
    crawl_file = REPORTS / f"crawl-{args.day}.txt"
    if crawl_file.exists():
        m = re.search(r"broken (\d+)", crawl_file.read_text(encoding="utf-8"))
        if m:
            crawl_broken = int(m.group(1))

    summary = {
        "day": args.day,
        "base": audit.get("base"),
        "generatedAt": audit.get("generatedAt"),
        "pagesAudited": len(html_pages),
        "issueCount": issue_count,
        "thinContent": thin,
        "techFailures": broken_tech,
        "www": (audit.get("tech") or {}).get("www"),
        "robots": {
            "status": ((audit.get("tech") or {}).get("robots") or {}).get("status"),
            "allowsRoot": ((audit.get("tech") or {}).get("robots") or {}).get("allowsRoot"),
        },
        "sitemap": (audit.get("tech") or {}).get("sitemap"),
        "crawlBroken": crawl_broken,
        "lighthouse": lighthouse_scores(lh),
        "deepIssues": [
            {"path": r.get("path"), "issues": r.get("issues"), "words": r.get("words")}
            for r in deep
            if r.get("issues")
        ],
        "health": "ok" if issue_count <= 3 and crawl_broken == 0 and not broken_tech else "needs_attention",
    }

    out = Path(args.out)
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    latest = REPORTS / "daily-summary-latest.json"
    latest.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
