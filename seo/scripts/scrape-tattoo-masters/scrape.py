#!/usr/bin/env python3
"""
Сбор каталогов тату-мастеров РФ/СНГ с публичных страниц:
  - inkppl.com
  - tattootoday.org
  - justdotattoo.ru
  - tattoo-festival.ru

Итог: Excel (Имя | Город | Контакты | Источник | URL профиля).
"""

from __future__ import annotations

import argparse
import html as html_lib
import json
import re
import sys
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

import requests
from bs4 import BeautifulSoup
from openpyxl import Workbook
from openpyxl.styles import Font

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)
CHECKPOINT_DIR = Path(__file__).resolve().parents[2] / "data" / "tattoo-masters" / "checkpoints"

# CIS + РФ country ids on inkppl
INKPPL_COUNTRIES = {
    1: "Россия",
    2: "Украина",
    3: "Беларусь",
    4: "Казахстан",
    6: "Армения",
    7: "Грузия",
    12: "Латвия",
    13: "Литва",
    14: "Эстония",
    15: "Молдова",
    18: "Узбекистан",
}

SESSION = requests.Session()
SESSION.headers.update({"User-Agent": UA, "Accept-Language": "ru-RU,ru;q=0.9"})


@dataclass
class Master:
    name: str
    city: str = ""
    contacts: list[str] = field(default_factory=list)
    source: str = ""
    profile_url: str = ""

    def contact_str(self) -> str:
        seen = set()
        out = []
        for c in self.contacts:
            c = (c or "").strip()
            if not c:
                continue
            key = c.lower().rstrip("/")
            if key in seen:
                continue
            seen.add(key)
            out.append(c)
        return "; ".join(out)


def sleep_polite(sec: float = 0.15) -> None:
    time.sleep(sec)


def get(
    url: str,
    *,
    headers: dict | None = None,
    params: dict | None = None,
    retries: int = 2,
    timeout: int = 18,
) -> requests.Response:
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            r = SESSION.get(url, headers=headers, params=params, timeout=timeout)
            if r.status_code in (429, 503):
                time.sleep(2.0 * (attempt + 1))
                continue
            r.raise_for_status()
            return r
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(0.6 * (attempt + 1))
    raise RuntimeError(f"GET failed {url}: {last_err}")


def master_to_dict(m: Master) -> dict:
    return {
        "name": m.name,
        "city": m.city,
        "contacts": list(m.contacts),
        "source": m.source,
        "profile_url": m.profile_url,
    }


def master_from_dict(d: dict) -> Master:
    return Master(
        name=d.get("name") or "",
        city=d.get("city") or "",
        contacts=list(d.get("contacts") or []),
        source=d.get("source") or "",
        profile_url=d.get("profile_url") or "",
    )


def save_checkpoint(name: str, masters: list[Master]) -> Path:
    CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)
    path = CHECKPOINT_DIR / f"{name}.json"
    path.write_text(
        json.dumps([master_to_dict(m) for m in masters], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"  checkpoint: {path} ({len(masters)})", flush=True)
    return path


def load_checkpoint(name: str) -> list[Master] | None:
    path = CHECKPOINT_DIR / f"{name}.json"
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    return [master_from_dict(d) for d in data]


def clean_text(s: str | None) -> str:
    if not s:
        return ""
    s = html_lib.unescape(s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def normalize_contact(raw: str) -> str:
    raw = clean_text(raw)
    if not raw:
        return ""
    # inkppl away.php redirect
    if "away.php" in raw and "url=" in raw:
        q = urllib.parse.urlparse(raw).query
        parsed = urllib.parse.parse_qs(q)
        if "url" in parsed:
            raw = urllib.parse.unquote(parsed["url"][0])
    raw = raw.strip()
    if raw.startswith("//"):
        raw = "https:" + raw
    # bare handles / domains
    low = raw.lower()
    if low.startswith(("vk.com/", "vk.ru/", "instagram.com/", "t.me/", "telegram.me/")):
        raw = "https://" + raw
    if "instagram.com" in low or "t.me/" in low or "telegram.me" in low or "vk.com" in low or "vk.ru" in low:
        return raw.split("?")[0].rstrip("/")
    if raw.startswith("http"):
        return raw.split("?")[0].rstrip("/")
    if re.match(r"^@[\w.]+$", raw):
        return f"https://t.me/{raw[1:]}"
    if re.match(r"^[\w.+-]+@[\w.-]+\.\w+$", raw):
        return raw
    if re.match(r"^\+?\d[\d\s()-]{8,}$", raw):
        return re.sub(r"\s+", " ", raw)
    return raw


def extract_city_country(loc: str) -> str:
    loc = clean_text(loc)
    if not loc:
        return ""
    # "Москва, Россия" / "Москва, Россия / Германия"
    part = loc.split("/")[0].strip()
    if "," in part:
        city = part.split(",")[0].strip()
    else:
        city = part
    countries = {
        "россия",
        "украина",
        "беларусь",
        "казахстан",
        "армения",
        "грузия",
        "молдова",
        "узбекистан",
        "латвия",
        "литва",
        "эстония",
    }
    if city.lower() in countries:
        return ""
    return city


def map_pool(fn, items: list, workers: int = 8, desc: str = "", checkpoint_name: str | None = None) -> list:
    if not items:
        return []
    # Preserve identity/order via index so partial checkpoints never shrink the set.
    results: list = [None] * len(items)
    total = len(items)
    done = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(fn, item): i for i, item in enumerate(items)}
        for fut in as_completed(futs):
            i = futs[fut]
            done += 1
            if done % 50 == 0 or done == total:
                print(f"  [{desc}] {done}/{total}", flush=True)
            try:
                results[i] = fut.result()
            except Exception as e:  # noqa: BLE001
                print(f"  warn {desc}: {e}", flush=True)
                results[i] = items[i]
            if checkpoint_name and (done % 200 == 0 or done == total):
                snapshot = [results[j] if results[j] is not None else items[j] for j in range(total)]
                save_checkpoint(checkpoint_name, snapshot)
    return [r for r in results if r]


# ───────────────────────── inkppl ─────────────────────────


def parse_inkppl_cards(html: str, country_name: str) -> list[Master]:
    soup = BeautifulSoup(html, "lxml")
    out: list[Master] = []
    for art in soup.select("article.master-card"):
        href = art.get("data-href") or ""
        if href.startswith("/"):
            href = "https://inkppl.com" + href
        link = art.select_one("a.master-slider-link")
        name = clean_text(link.get("aria-label") if link else "")
        if not name:
            name = clean_text(art.get_text(" ", strip=True))[:80]
        # drop nickname after " / " for display? keep full as on site
        loc_el = art.select_one(".master-location")
        loc = clean_text(loc_el.get_text(" ", strip=True) if loc_el else "")
        city = extract_city_country(loc) or country_name
        out.append(
            Master(
                name=name,
                city=city,
                contacts=[href] if href else [],
                source="inkppl",
                profile_url=href,
            )
        )
    return out


def scrape_inkppl(workers: int = 8, enrich: bool = True) -> list[Master]:
    print("=== inkppl ===", flush=True)
    masters: list[Master] = []
    for cid, cname in INKPPL_COUNTRIES.items():
        offset = 0
        limit = 15
        total = None
        while True:
            sleep_polite(0.12)
            r = get(
                "https://inkppl.com/assets/php/masters-filter.php",
                headers={
                    "X-Requested-With": "XMLHttpRequest",
                    "Referer": "https://inkppl.com/tattoo-mastera",
                    "Accept": "application/json, text/javascript, */*; q=0.01",
                },
                params={"limit": limit, "offset": offset, "country": cid},
            )
            data = r.json()
            if total is None:
                total = int(data.get("total") or 0)
                print(f"  {cname}: {total}", flush=True)
            html = data.get("html") or ""
            if not html.strip():
                break
            batch = parse_inkppl_cards(html, cname)
            if not batch:
                break
            masters.extend(batch)
            offset += limit
            if not data.get("hasMore") or offset >= total:
                break
        print(f"  {cname}: собрано {offset if total else 0}+ карточек", flush=True)

    # dedupe by profile url within source
    by_url: dict[str, Master] = {}
    for m in masters:
        key = m.profile_url or m.name
        if key not in by_url:
            by_url[key] = m
    masters = list(by_url.values())
    print(f"  уникальных: {len(masters)}", flush=True)

    if enrich:
        print("  обогащение контактов с профилей...", flush=True)

        def enrich_one(m: Master) -> Master:
            if not m.profile_url:
                return m
            sleep_polite(0.05)
            try:
                r = get(m.profile_url, timeout=16)
            except Exception:
                return m
            html = r.text
            # JSON-LD sameAs
            for block in re.findall(
                r'<script type="application/ld\+json">(.*?)</script>', html, re.S
            ):
                try:
                    data = json.loads(block)
                except json.JSONDecodeError:
                    continue
                nodes = data if isinstance(data, list) else [data]
                for node in nodes:
                    if not isinstance(node, dict):
                        continue
                    same = node.get("sameAs") or []
                    if isinstance(same, str):
                        same = [same]
                    for s in same:
                        c = normalize_contact(s)
                        if c and c not in m.contacts:
                            m.contacts.append(c)
            # social links
            soup = BeautifulSoup(html, "lxml")
            for a in soup.select("a.mp-social-link[href]"):
                c = normalize_contact(a.get("href") or "")
                if c and ("instagram" in c or "t.me" in c or "vk.com" in c or "vk.ru" in c):
                    if c not in m.contacts:
                        m.contacts.append(c)
            # location refine
            loc = soup.select_one("[data-loc-query]")
            if loc and loc.get("data-loc-query"):
                q = loc["data-loc-query"]
                # "... Москва, Россия"
                parts = [p.strip() for p in q.split(",") if p.strip()]
                if parts:
                    # city often second-to-last before country
                    if len(parts) >= 2:
                        m.city = parts[-2] if any(
                            x in parts[-1].lower()
                            for x in ("росс", "белар", "украин", "казах", "армен", "грузи", "молдов", "узбек", "латви", "литв", "эстон")
                        ) else parts[0]
                    else:
                        m.city = parts[0]
            return m

        masters = map_pool(
            enrich_one,
            masters,
            workers=workers,
            desc="inkppl profiles",
            checkpoint_name="inkppl",
        )
    save_checkpoint("inkppl", masters)
    return masters


# ───────────────────────── tattootoday ─────────────────────────


def scrape_tattootoday(workers: int = 8, enrich: bool = True) -> list[Master]:
    print("=== tattootoday ===", flush=True)
    # discover last page
    r = get("https://tattootoday.org/top-tattoo-masters/catalog")
    pages = [int(x) for x in re.findall(r"catalog/page/(\d+)", r.text)]
    last = max(pages) if pages else 1
    print(f"  страниц каталога: {last}", flush=True)

    urls: list[tuple[str, str]] = []  # url, name
    for page in range(1, last + 1):
        sleep_polite(0.1)
        url = (
            "https://tattootoday.org/top-tattoo-masters/catalog"
            if page == 1
            else f"https://tattootoday.org/top-tattoo-masters/catalog/page/{page}"
        )
        html = get(url).text
        for m in re.finditer(
            r'<script type="application/ld\+json">(.*?)</script>', html, re.S
        ):
            try:
                data = json.loads(m.group(1))
            except json.JSONDecodeError:
                continue
            graph = data.get("@graph") if isinstance(data, dict) else None
            nodes = graph if isinstance(graph, list) else [data]
            for node in nodes:
                if not isinstance(node, dict) or node.get("@type") != "ItemList":
                    continue
                for item in node.get("itemListElement") or []:
                    if not isinstance(item, dict):
                        continue
                    u = item.get("url") or ""
                    n = clean_text(item.get("name") or "")
                    if u and n:
                        urls.append((u, n))
        if page % 10 == 0:
            print(f"  catalog pages {page}/{last}, urls={len(urls)}", flush=True)

    # dedupe urls
    seen = set()
    uniq: list[tuple[str, str]] = []
    for u, n in urls:
        if u in seen:
            continue
        seen.add(u)
        uniq.append((u, n))
    print(f"  уникальных профилей: {len(uniq)}", flush=True)

    def fetch_profile(pair: tuple[str, str]) -> Master:
        url, name = pair
        sleep_polite(0.05)
        city = ""
        contacts = [url]
        if not enrich:
            return Master(name=name, city=city, contacts=contacts, source="tattootoday", profile_url=url)
        try:
            html = get(url, timeout=16).text
        except Exception:
            return Master(name=name, city=city, contacts=contacts, source="tattootoday", profile_url=url)
        # city
        m = re.search(r"Город</span>\s*<strong>([^<]+)</strong>", html)
        if m:
            city = clean_text(m.group(1))
        else:
            meta = re.search(
                r'<meta[^>]+(?:property="og:description"|name="description")[^>]+content="([^"]+)"',
                html,
                re.I,
            )
            if meta:
                # "тату мастер · ... · Москва · ..."
                parts = [clean_text(p) for p in html_lib.unescape(meta.group(1)).split("·")]
                for p in parts:
                    if p and p.lower() not in ("тату мастер", "tattoo artist") and len(p) < 40:
                        if not any(x in p.lower() for x in ("black", "realism", "стил", "grey", "gray")):
                            city = p
                            break
        # social hints (often without https)
        for hint in re.findall(r'users-social-link__hint[^>]*>(.*?)</', html, re.S):
            c = normalize_contact(clean_text(re.sub(r"<[^>]+>", "", hint)))
            if c and c not in contacts:
                contacts.append(c)
        for a in re.findall(r'href="(https?://(?:www\.)?(?:instagram\.com|t\.me|vk\.com|vk\.ru|telegram\.me)/[^"]+)"', html, re.I):
            if "tattootoday" in a:
                continue
            c = normalize_contact(a)
            if c and c not in contacts:
                contacts.append(c)
        return Master(name=name, city=city, contacts=contacts, source="tattootoday", profile_url=url)

    return map_pool(
        fetch_profile,
        uniq,
        workers=workers,
        desc="tattootoday profiles",
        checkpoint_name="tattootoday",
    )


# ───────────────────────── justdotattoo ─────────────────────────


def scrape_justdo(workers: int = 6, enrich: bool = True) -> list[Master]:
    print("=== justdotattoo ===", flush=True)
    masters: list[Master] = []
    page = 1
    while page <= 30:
        sleep_polite(0.15)
        url = (
            "https://justdotattoo.ru/masters/"
            if page == 1
            else f"https://justdotattoo.ru/masters/?PAGEN_1={page}"
        )
        html = get(url).text
        soup = BeautifulSoup(html, "lxml")
        items = soup.select(".master_item")
        if not items:
            break
        batch = []
        for item in items:
            a = item.select_one("a.info") or item.select_one("a.logo")
            href = a.get("href") if a else ""
            if href and href.startswith("/"):
                href = "https://justdotattoo.ru" + href
            name = clean_text((item.select_one(".name") or item).get_text(" ", strip=True))
            # name node only
            name_el = item.select_one(".name")
            if name_el:
                name = clean_text(name_el.get_text(" ", strip=True))
            loc_el = item.select_one(".location")
            city = clean_text(loc_el.get_text(" ", strip=True) if loc_el else "")
            batch.append(
                Master(
                    name=name,
                    city=city,
                    contacts=[href] if href else [],
                    source="justdotattoo",
                    profile_url=href,
                )
            )
        # stop if wrap-around (page repeats page 1)
        if page > 1 and batch and masters and batch[0].profile_url == masters[0].profile_url:
            break
        masters.extend(batch)
        print(f"  page {page}: +{len(batch)} (total {len(masters)})", flush=True)
        # pagination end
        pagens = [int(x) for x in re.findall(r"PAGEN_1=(\d+)", html)]
        if pagens and page >= max(pagens) and page != 1:
            # keep going one more to detect wrap; if next wraps we break above
            pass
        if not pagens and page > 1:
            break
        page += 1

    # dedupe
    by_url = {m.profile_url or m.name: m for m in masters}
    masters = list(by_url.values())
    print(f"  уникальных: {len(masters)}", flush=True)

    if enrich:

        def enrich_one(m: Master) -> Master:
            if not m.profile_url:
                return m
            sleep_polite(0.08)
            try:
                html = get(m.profile_url, timeout=16).text
            except Exception:
                return m
            for a in re.findall(
                r'href="(https?://(?:www\.)?(?:instagram\.com|t\.me|vk\.com|vk\.ru|telegram\.me|wa\.me)/[^"]+)"',
                html,
                re.I,
            ):
                if "justdotattoo" in a or "tattooideas" in a:
                    continue
                c = normalize_contact(a)
                if c and c not in m.contacts:
                    m.contacts.append(c)
            # phones / @handles in text blocks
            for tel in re.findall(r'href="tel:([^"]+)"', html):
                c = normalize_contact(urllib.parse.unquote(tel))
                if c and c not in m.contacts:
                    m.contacts.append(c)
            return m

        masters = map_pool(enrich_one, masters, workers=workers, desc="justdo profiles")
    return masters


# ───────────────────────── tattoo-festival ─────────────────────────


def scrape_festival(workers: int = 8, enrich: bool = True) -> list[Master]:
    print("=== tattoo-festival ===", flush=True)
    html = get("https://tattoo-festival.ru/eksponenty/").text
    soup = BeautifulSoup(html, "lxml")
    masters: list[Master] = []
    for card in soup.select("div.member__card"):
        name_el = card.select_one(".member__name")
        if not name_el:
            continue
        name = clean_text(name_el.get_text(" ", strip=True))
        link = card.select_one("a[href*='/eksponenty/']")
        href = link.get("href") if link else ""
        if href and href.startswith("/"):
            href = "https://tattoo-festival.ru" + href
        contacts = []
        for a in card.select("a.person-block__social-link[href]"):
            c = normalize_contact(a.get("href") or "")
            if c and "tattoofestival" not in c:
                contacts.append(c)
        if href:
            contacts.append(href)
        masters.append(
            Master(
                name=name,
                city="",
                contacts=contacts,
                source="tattoo-festival",
                profile_url=href,
            )
        )
    # dedupe
    by_key = {}
    for m in masters:
        by_key[m.profile_url or m.name] = m
    masters = list(by_key.values())
    print(f"  карточек: {len(masters)}", flush=True)

    if enrich:

        def enrich_one(m: Master) -> Master:
            if not m.profile_url:
                return m
            sleep_polite(0.05)
            try:
                html = get(m.profile_url, timeout=16).text
            except Exception:
                return m
            cm = re.search(
                r"Город:</span>\s*<span class=\"person-link\">([^<]+)</span>",
                html,
            )
            if cm:
                m.city = clean_text(cm.group(1))
            for a in re.findall(
                r'href="(https?://(?:vk\.com|vk\.ru|t\.me|instagram\.com|telegram\.me)/[^"]+)"',
                html,
                re.I,
            ):
                if "tattoofestival" in a:
                    continue
                c = normalize_contact(a)
                if c and c not in m.contacts:
                    m.contacts.append(c)
            return m

        masters = map_pool(
            enrich_one,
            masters,
            workers=workers,
            desc="festival details",
            checkpoint_name="festival",
        )
    save_checkpoint("festival", masters)
    return masters


# ───────────────────────── merge / excel ─────────────────────────


def norm_name(s: str) -> str:
    s = s.lower().strip()
    s = re.sub(r"\s*/\s*.*$", "", s)  # drop nickname after /
    s = re.sub(r"[^\wа-яё]+", " ", s, flags=re.I)
    return re.sub(r"\s+", " ", s).strip()


def merge_masters(groups: Iterable[list[Master]]) -> list[Master]:
    """Merge by profile URL first, then by name+city."""
    by_url: dict[str, Master] = {}
    no_url: list[Master] = []
    for group in groups:
        for m in group:
            if m.profile_url:
                key = m.profile_url.rstrip("/").lower()
                if key in by_url:
                    existing = by_url[key]
                    if not existing.city and m.city:
                        existing.city = m.city
                    for c in m.contacts:
                        if c not in existing.contacts:
                            existing.contacts.append(c)
                    if m.source not in existing.source:
                        existing.source = f"{existing.source}; {m.source}"
                else:
                    by_url[key] = m
            else:
                no_url.append(m)

    # second pass: name+city
    by_nc: dict[tuple[str, str], Master] = {}
    out: list[Master] = []
    for m in list(by_url.values()) + no_url:
        nk = (norm_name(m.name), clean_text(m.city).lower())
        if nk[0] and nk in by_nc:
            existing = by_nc[nk]
            for c in m.contacts:
                if c not in existing.contacts:
                    existing.contacts.append(c)
            if m.source not in existing.source:
                existing.source = f"{existing.source}; {m.source}"
            if not existing.city and m.city:
                existing.city = m.city
        else:
            by_nc[nk] = m
            out.append(m)
    out.sort(key=lambda x: (x.city.lower(), x.name.lower()))
    return out


def write_xlsx(masters: list[Master], path: Path) -> None:
    wb = Workbook()
    ws = wb.active
    ws.title = "Мастера"
    headers = ["Имя", "Город", "Контакты", "Источник", "URL профиля"]
    ws.append(headers)
    for cell in ws[1]:
        cell.font = Font(bold=True)
    for m in masters:
        ws.append([m.name, m.city, m.contact_str(), m.source, m.profile_url])
    ws.column_dimensions["A"].width = 32
    ws.column_dimensions["B"].width = 22
    ws.column_dimensions["C"].width = 70
    ws.column_dimensions["D"].width = 22
    ws.column_dimensions["E"].width = 45

    meta = wb.create_sheet("Мета")
    meta.append(["Поле", "Значение"])
    meta.append(["Всего строк", len(masters)])
    meta.append(["Дата сбора (UTC)", time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())])
    meta.append(
        [
            "Источники",
            "inkppl.com; tattootoday.org; justdotattoo.ru; tattoo-festival.ru",
        ]
    )
    meta.append(
        [
            "Примечание",
            "Срез публичных каталогов РФ/СНГ, не полный реестр всех мастеров. Контакты - то, что открыто на страницах (соцсети, ссылка профиля).",
        ]
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(path)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--out",
        default=str(
            Path(__file__).resolve().parents[2]
            / "data"
            / "tattoo-masters"
            / "tattoo-masters-rf-sng.xlsx"
        ),
    )
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--no-enrich", action="store_true", help="Только листинги, без профилей")
    ap.add_argument("--resume", action="store_true", help="Брать готовые checkpoint JSON")
    ap.add_argument(
        "--only",
        choices=["inkppl", "tattootoday", "justdo", "festival", "all"],
        default="all",
    )
    args = ap.parse_args()
    enrich = not args.no_enrich
    workers = max(2, args.workers)

    def run_source(key: str, fn):
        if args.resume:
            cached = load_checkpoint(key)
            if cached is not None:
                print(f"=== {key}: resume {len(cached)} из checkpoint ===", flush=True)
                return cached
        try:
            masters = fn()
        except Exception as e:  # noqa: BLE001
            print(f"ERROR {key}: {e}", flush=True)
            cached = load_checkpoint(key)
            if cached is not None:
                print(f"  fallback checkpoint {len(cached)}", flush=True)
                return cached
            return []
        save_checkpoint(key, masters)
        return masters

    groups: list[list[Master]] = []
    if args.only in ("all", "inkppl"):
        groups.append(
            run_source("inkppl", lambda: scrape_inkppl(workers=workers, enrich=enrich))
        )
    if args.only in ("all", "tattootoday"):
        groups.append(
            run_source(
                "tattootoday",
                lambda: scrape_tattootoday(workers=max(2, workers // 2), enrich=enrich),
            )
        )
    if args.only in ("all", "justdo"):
        groups.append(
            run_source("justdo", lambda: scrape_justdo(workers=workers, enrich=enrich))
        )
    if args.only in ("all", "festival"):
        groups.append(
            run_source("festival", lambda: scrape_festival(workers=workers, enrich=enrich))
        )

    # also merge any leftover checkpoints when running a subset rebuild
    merged = merge_masters(groups)
    out = Path(args.out)
    write_xlsx(merged, out)
    print(f"\nГотово: {out} ({len(merged)} строк)", flush=True)
    side = out.with_suffix(".json")
    side.write_text(
        json.dumps(
            [
                {
                    "name": m.name,
                    "city": m.city,
                    "contacts": m.contact_str(),
                    "source": m.source,
                    "url": m.profile_url,
                }
                for m in merged
            ],
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"JSON: {side}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
