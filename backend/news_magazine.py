#!/usr/bin/env python3
"""
Lightweight magazine helpers: markdown structure score + optional Pillow collage.
Used by SEO scripts / editorial pipeline. Typograf is NOT used.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

try:
    from markdown_it import MarkdownIt
except ImportError:
    MarkdownIt = None

try:
    from PIL import Image
except ImportError:
    Image = None


def structure_score(md: str) -> dict:
    text = md or ""
    headings = len(re.findall(r"(?m)^#{1,3}\s+\S", text))
    lists = len(re.findall(r"(?m)^(?:[-•*]|\d+\.)\s+\S", text))
    images = len(re.findall(r"!\[[^\]]*\]\([^)]+\)", text))
    paras = [p for p in re.split(r"\n\s*\n", text) if p.strip() and not p.strip().startswith("#")]
    avg = (sum(len(p.split()) for p in paras) / len(paras)) if paras else 0
    score = 50
    score += min(20, headings * 4)
    score += min(15, lists * 3)
    score += min(20, images * 5)
    if 40 <= avg <= 120:
        score += 10
    elif avg > 160:
        score -= 10
    score = max(0, min(100, score))
    return {
        "score": score,
        "headings": headings,
        "lists": lists,
        "images": images,
        "avg_para_words": round(avg, 1),
        "ok": score >= 60,
    }


def collage(paths: list[str], out: str, size=(1600, 1000)) -> str:
    if Image is None:
        raise SystemExit("Pillow required")
    imgs = [Image.open(p).convert("RGBA") for p in paths[:4]]
    canvas = Image.new("RGB", size, (17, 17, 20))
    if not imgs:
        canvas.save(out, quality=86)
        return out
    phone_w = int(size[0] * 0.18)
    gap = int(size[0] * 0.035)
    total = len(imgs) * phone_w + (len(imgs) - 1) * gap
    x = (size[0] - total) // 2
    y = int(size[1] * 0.12)
    target_h = int(size[1] * 0.78)
    for im in imgs:
        im.thumbnail((phone_w, target_h), Image.Resampling.LANCZOS)
        canvas.paste(im, (x + (phone_w - im.width) // 2, y + (target_h - im.height) // 2), im)
        x += phone_w + gap
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out, quality=86)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--score-file", default="")
    ap.add_argument("--collage", nargs="*", default=[])
    ap.add_argument("--out", default="")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    if args.score_file or (not args.collage and not sys.stdin.isatty()):
        raw = Path(args.score_file).read_text(encoding="utf-8") if args.score_file else sys.stdin.read()
        result = structure_score(raw)
        print(json.dumps(result, ensure_ascii=False, indent=2) if args.json else result["score"])
        return 0
    if args.collage and args.out:
        collage(args.collage, args.out)
        print(args.out)
        return 0
    ap.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
