#!/usr/bin/env python3
"""
Draft a LinkedIn post for Founder @ Sitrifor via local Ollama.

Does NOT publish to LinkedIn and does NOT send connection invites.
Output: ops/linkedin/drafts/YYYYMMDD-HHMMSS.md

  python3 ops/linkedin/draft_post.py
  python3 ops/linkedin/draft_post.py --topic "склад краски перед плотной неделей"
"""
from __future__ import annotations

import argparse
import json
import os
import random
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CFG = Path(__file__).with_name("config.json")
DRAFTS = Path(__file__).with_name("drafts")
STYLE = """
Ты копирайтер Founder Sitrifor (экосистема для тату-мастеров).
Пиши пост для LinkedIn на русском.
Правила:
- короткий дефис '-', без длинных тире;
- без канцелярита и AI-клише («в современном мире», «погрузитесь»);
- конкретика: эскиз, пигмент, сеанс, склад, мастер;
- не обещай CRM-запись и кассу от 634;
- 1 мысль, 4-8 коротких абзацев или список;
- в конце 1-2 ссылки из списка (сайт / App Store / masters);
- без эмодзи-спама (максимум 1-2, можно без);
- не выдумывай метрики и кейсы с цифрами.
""".strip()


def load_cfg() -> dict:
    return json.loads(CFG.read_text(encoding="utf-8"))


def ollama(cfg: dict, system: str, user: str) -> str:
    host = (cfg.get("ollama_host") or "http://127.0.0.1:11434").rstrip("/")
    model = cfg.get("ollama_model") or "qwen2.5:1.5b"
    payload = {
        "model": model,
        "stream": False,
        "keep_alive": "0",
        "options": {
            "num_thread": int(os.environ.get("OLLAMA_NUM_THREAD", "1")),
            "num_ctx": int(os.environ.get("OLLAMA_NUM_CTX", "2048")),
            "temperature": 0.55,
        },
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    req = urllib.request.Request(
        f"{host}/api/chat",
        data=json.dumps(payload).encode(),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        data = json.load(resp)
    return ((data.get("message") or {}).get("content") or "").strip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--topic", default="", help="Тема поста")
    args = ap.parse_args()
    cfg = load_cfg()
    topic = args.topic.strip() or random.choice(cfg.get("topics") or ["Sitrifor и 634"])
    links = (
        f"Сайт: {cfg['site']}\n"
        f"Мастерам: {cfg['masters']}\n"
        f"App Store 634: {cfg['app_store']}\n"
        f"Профиль: {cfg['profile_url']}\n"
    )
    tags = " ".join(cfg.get("hashtags") or [])
    user = (
        f"Тема поста: {topic}\n\n"
        f"Контекст продукта: 634 - проекты, пигменты, склад для тату-мастера. "
        f"Sitrifor.ru - гайды, калькулятор, уход. Founder пишет от первого лица.\n\n"
        f"Ссылки для вставки (выбери 1-2):\n{links}\n"
        f"Хэштеги (опционально, в конце, не больше 4): {tags}\n"
        f"Лимит примерно {cfg.get('max_chars', 2800)} символов.\n"
        f"Верни только текст поста, без преамбулы."
    )
    try:
        text = ollama(cfg, STYLE, user)
    except Exception as e:
        text = (
            f"[Ollama недоступна: {e}]\n\n"
            f"Черновик-заглушка по теме «{topic}».\n\n"
            f"Строим Sitrifor для тату-мастеров: эскиз в проекте, пигмент со склада, "
            f"без путаницы с CRM-записью.\n\n"
            f"{cfg['masters']}\n{cfg['app_store']}\n"
        )

    DRAFTS.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    path = DRAFTS / f"{stamp}.md"
    body = (
        f"# LinkedIn draft\n\n"
        f"- created: {stamp} UTC\n"
        f"- topic: {topic}\n"
        f"- status: draft (не опубликовано)\n"
        f"- publish: вручную в LinkedIn или позже через API после MDP\n\n"
        f"---\n\n"
        f"{text}\n"
    )
    path.write_text(body, encoding="utf-8")
    print(str(path))
    print("---")
    print(text[:1200])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
