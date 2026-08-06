#!/usr/bin/env python3
"""
Seed keyword / content opportunity map for sitrifor.ru (RU tattoo niche).
No paid APIs required — editorial priority list for continuous organic growth.
Writes reports/keyword-seeds-latest.json
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

REPORTS = Path(__file__).resolve().parent.parent / "reports"

# Priority clusters for tattoo-master SaaS / tools niche in RU
CLUSTERS = [
    {
        "cluster": "приложение для тату-мастера",
        "intent": "commercial",
        "priority": 1,
        "targetUrl": "https://sitrifor.ru/masters#app",
        "seeds": [
            "приложение для тату мастера",
            "программа для тату мастера",
            "учёт краски тату",
            "подбор пигментов тату",
            "приложение 634 тату",
            "цифровой склад пигментов",
        ],
        "contentFormat": "landing + how-to article",
    },
    {
        "cluster": "калькулятор стоимости тату",
        "intent": "transactional",
        "priority": 1,
        "targetUrl": "https://sitrifor.ru/masters#calculator",
        "seeds": [
            "калькулятор стоимости тату",
            "сколько стоит тату сеанс",
            "расчёт цены тату",
            "прайс тату мастера",
            "стоимость тату по зоне",
        ],
        "contentFormat": "tool page + guide",
    },
    {
        "cluster": "уход за тату",
        "intent": "informational",
        "priority": 1,
        "targetUrl": "https://sitrifor.ru/masters#care",
        "seeds": [
            "уход за тату после сеанса",
            "как заживает тату",
            "памятка клиенту после тату",
            "чем мазать тату",
            "этапы заживления татуировки",
        ],
        "contentFormat": "evergreen guides (high organic)",
    },
    {
        "cluster": "партнёрам / B2B",
        "intent": "commercial",
        "priority": 2,
        "targetUrl": "https://sitrifor.ru/partners",
        "seeds": [
            "реклама для тату мастеров",
            "дистрибуция приложения тату",
            "партнёрство тату бренд",
            "лидогенерация тату студии",
        ],
        "contentFormat": "case study / partner page",
    },
    {
        "cluster": "бренд / trust",
        "intent": "navigational",
        "priority": 2,
        "targetUrl": "https://sitrifor.ru/about",
        "seeds": [
            "sitrifor",
            "sitrifor тату",
            "что такое 634 приложение",
            "фаундеры sitrifor",
        ],
        "contentFormat": "about + FAQ (done)",
    },
]

# 14-day publishing cadence — organic growth requires new indexable URLs
CALENDAR = [
    {"dayOffset": 0, "title": "Как подобрать пигменты под эскиз: метод 634", "cluster": "приложение для тату-мастера", "type": "guide"},
    {"dayOffset": 2, "title": "Калькулятор стоимости тату: зона, сложность, время", "cluster": "калькулятор стоимости тату", "type": "guide"},
    {"dayOffset": 4, "title": "Памятка клиенту: первые 14 дней после сеанса", "cluster": "уход за тату", "type": "guide"},
    {"dayOffset": 6, "title": "Склад краски в телефоне: зачем оцифровывать пигменты", "cluster": "приложение для тату-мастера", "type": "guide"},
    {"dayOffset": 8, "title": "Прайс тату-мастера: как считать час и доплаты", "cluster": "калькулятор стоимости тату", "type": "guide"},
    {"dayOffset": 10, "title": "Чем мазать тату: чеклист без брендового спама", "cluster": "уход за тату", "type": "guide"},
    {"dayOffset": 12, "title": "Как бренду пигментов выйти к мастерам через 634", "cluster": "партнёрам / B2B", "type": "case"},
]


def main() -> None:
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "site": "https://sitrifor.ru",
        "note": "Seeds are editorial priorities. Connect Yandex Wordstat / GSC for real volumes.",
        "clusters": CLUSTERS,
        "publishCadence": "3 articles / week recommended for measurable organic growth",
        "calendar14d": CALENDAR,
        "blockersForMeasurement": [
            "Yandex Metrika counter ID",
            "Google Search Console property + service account",
            "Yandex Webmaster verification",
        ],
        "techReady": [
            "robots.txt",
            "sitemap.xml",
            "canonical + OG + JSON-LD",
            "IndexNow key",
            "daily cron audit",
        ],
    }
    REPORTS.mkdir(parents=True, exist_ok=True)
    out = REPORTS / "keyword-seeds-latest.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {out}")
    print(f"Clusters: {len(CLUSTERS)}, calendar items: {len(CALENDAR)}")


if __name__ == "__main__":
    main()
