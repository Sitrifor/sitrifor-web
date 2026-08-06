#!/usr/bin/env python3
"""
Polish Russian editorial text for Sitrifor news LLM pipeline.
Uses razdel + pymorphy3, plus optional gates:
  krrkt (info-style score), mawo-grammar, pyaspeller, Natasha NER,
  optional LanguageTool (NEWS_LANGUAGETOOL=1), structure_metrics, AI-cliché strip.
Typograf (Art Lebedev) is intentionally NOT used.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
from pathlib import Path

import razdel
import pymorphy3

MORPH = pymorphy3.MorphAnalyzer()

BAD_PATTERNS = [
    re.compile(r"типы пайки|пайки,\s*ножниц|кружевн|стрелочк|как языковая модель|as an ai|lorem ipsum", re.I),
    re.compile(r"\w\*\*:"),  # markdown bold artifacts like слово**:
    re.compile(r"(.)\1{6,}"),
]

AI_CLICHE = re.compile(
    r"в\s+сегодняшнем\s+(быстроменяющемся|динамичном)\s+мире|"
    r"важно\s+отметить[, ]|"
    r"нельзя\s+недооценивать|"
    r"давайте\s+разбер[её]мся|"
    r"в\s+этой\s+статье\s+мы\s+рассмотрим|"
    r"является\s+ключевым\s+фактором|"
    r"играет\s+важную\s+роль|"
    r"комплексный\s+подход|"
    r"синерги[яи]|"
    r"на\s+сегодняшний\s+день|"
    r"подводя\s+итог|"
    r"безусловно,|"
    r"стоит\s+отметить[, ]|"
    r"в\s+заключение\s+хочется|"
    r"не\s+секрет,\s+что|"
    r"как\s+известно,|"
    r"в\s+наше\s+время|"
    r"каждый\s+мастер\s+знает|"
    r"секреты?\s+успеха|"
    r"взрывной\s+рост\s+охватов|"
    r"контент[, ]+который\s+взрывает|"
    r"алгоритм[ыа]?\s+(Instagram|инстаграм)",
    re.I,
)

# Soft auto-strip before gate – keeps facts, drops bureau openers
AI_CLICHE_STRIP = [
    (re.compile(r"^важно\s+отметить[,:]?\s*", re.I | re.M), ""),
    (re.compile(r"^стоит\s+отметить[,:]?\s*", re.I | re.M), ""),
    (re.compile(r"^безусловно,\s*", re.I | re.M), ""),
    (re.compile(r"^как\s+известно,\s*", re.I | re.M), ""),
    (re.compile(r"^не\s+секрет,\s+что\s*", re.I | re.M), ""),
    (re.compile(r"в\s+сегодняшнем\s+(быстроменяющемся|динамичном)\s+мире[, ]*", re.I), ""),
    (re.compile(r"давайте\s+разбер[её]мся[.:!]?\s*", re.I), ""),
    (re.compile(r"в\s+этой\s+статье\s+мы\s+рассмотрим[^.?!]*[.?!]\s*", re.I), ""),
    (re.compile(r"подводя\s+итог[,:]?\s*", re.I), ""),
    (re.compile(r"на\s+сегодняшний\s+день\s*", re.I), "сейчас "),
    (re.compile(r"играет\s+важную\s+роль", re.I), "влияет на результат"),
    (re.compile(r"является\s+ключевым\s+фактором", re.I), "сильно влияет"),
    (re.compile(r"комплексный\s+подход", re.I), "системная работа"),
    (re.compile(r"синерги[яи]\s+контент[аеу]?,?\s+который\s+взрывает\s+(ленту|охват[ы]?)", re.I), "контент, который лучше удерживает внимание"),
    (re.compile(r"контент[аеу]?,?\s+который\s+взрывает\s+(ленту|охват[ы]?)", re.I), "материал, который лучше удерживает внимание"),
    (re.compile(r"который\s+взрывает\s+(ленту|охват[ы]?)", re.I), "который лучше удерживает внимание"),
    (re.compile(r"синерги[яи]", re.I), "согласованность"),
    (re.compile(r"взрывной\s+рост\s+охватов", re.I), "рост охватов"),
    (re.compile(r"каждый\s+мастер\s+знает[,:]?\s*", re.I), ""),
    (re.compile(r"секреты?\s+успеха", re.I), "рабочие приёмы"),
    (re.compile(r"нельзя\s+недооценивать\s*", re.I), ""),
    (re.compile(r"в\s+наше\s+время\s*", re.I), "сейчас "),
]

CLAIM_PATTERNS = re.compile(
    r"\b\d{1,3}\s*%|"
    r"исследовани[еяй].{0,40}(показал|выявил|доказал)|"
    r"по\s+данным\s+.{0,30}(опрос|статистик|исследован)|"
    r"медицинск(ая|ие|ую)\s+гарант|"
    r"доказано\s+наукой",
    re.I,
)

TYPO_MAP = {
    "щас": "сейчас",
    "короч": "короче",
    "норм ": "нормально ",
    "вообщем": "в общем",
    "подчеркнутый": "подчёркнутый",
}

# Lazy heavy deps
_SPELLER = None
_GRAMMAR = None
_NER = None
_LANGUAGETOOL = None


def strip_ai_cliches(text: str) -> str:
    """Remove / soften AI and SMM fluff so more drafts pass the editorial gate."""
    t = text or ""
    for pat, repl in AI_CLICHE_STRIP:
        t = pat.sub(repl, t)
    t = re.sub(r"[ \t]{2,}", " ", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def structure_metrics(text: str) -> dict:
    """Magazine-like markdown structure score (headings, lists, images)."""
    headings = len(re.findall(r"(?m)^#{1,3}\s+\S", text or ""))
    lists = len(re.findall(r"(?m)^(?:[-•*]|\d+\.)\s+\S", text or ""))
    images = len(re.findall(r"!\[[^\]]*\]\([^)]+\)", text or ""))
    paras = [
        p
        for p in re.split(r"\n\s*\n", text or "")
        if p.strip() and not p.strip().startswith("#")
    ]
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


def _content_lemma(word: str) -> str | None:
    w = (word or "").strip("«»\"'()[].,;:!?…").lower()
    if len(w) < 3 or not re.search(r"[а-яё]", w):
        return None
    try:
        parsed = MORPH.parse(w)
        if not parsed:
            return None
        return parsed[0].normal_form
    except Exception:
        return None


def morph_coherence_hints(text: str) -> list[str]:
    """
    pymorphy3: detect monotonous lemma starts and near-duplicate sentence openers.
    Previously MorphAnalyzer was imported but unused.
    """
    hints: list[str] = []
    lemmas: list[str] = []
    for s in razdel.sentenize(text or ""):
        toks = [t.text for t in razdel.tokenize(s.text) if re.search(r"[А-Яа-яЁё]", t.text)]
        if not toks:
            continue
        lem = _content_lemma(toks[0])
        if lem:
            lemmas.append(lem)
    if len(lemmas) >= 4:
        from collections import Counter

        top, n = Counter(lemmas).most_common(1)[0]
        if n >= 3:
            hints.append("monotonous_lemmas")
    # Near-duplicate consecutive openers (same first 3 lemmas)
    opens = []
    for s in razdel.sentenize(text or ""):
        toks = [t.text for t in razdel.tokenize(s.text) if re.search(r"[А-Яа-яЁё]", t.text)][:3]
        key = tuple(_content_lemma(t) or t.lower() for t in toks)
        if key and any(key):
            opens.append(key)
    for a, b in zip(opens, opens[1:]):
        if a == b:
            hints.append("duplicate_sentence_open")
            break
    return hints


_URL_TOKEN_RE = re.compile(r"https?://[^\s)\]]+|@@URL\d+@@|⟦URL\d+⟧")


def _mask_urls(text: str) -> tuple[str, list[str]]:
    urls: list[str] = []

    def repl(m: re.Match) -> str:
        urls.append(m.group(0))
        return f"@@URL{len(urls) - 1}@@"

    return _URL_TOKEN_RE.sub(repl, text), urls


def _unmask_urls(text: str, urls: list[str]) -> str:
    return re.sub(r"@@URL(\d+)@@", lambda m: urls[int(m.group(1))] if int(m.group(1)) < len(urls) else m.group(0), text)


def heal_broken_http_urls(text: str) -> str:
    """Collapse spaces inside http(s) URLs and lowercase the host."""

    def fix(m: re.Match) -> str:
        raw = m.group(0)
        compact = raw.replace(" ", "")
        # hostname is between :// and next / ? # or end
        hm = re.match(r"(https?://)([^/?#]+)(.*)$", compact, re.I)
        if not hm:
            return compact
        return hm.group(1) + hm.group(2).lower() + hm.group(3)

    return re.sub(
        r"https?://(?:[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%\-]| (?=[A-Za-z0-9%._~+\-?=&#/]))+",
        fix,
        text or "",
    )


def strip_junk(text: str, keep_md: bool = True) -> str:
    text = heal_broken_http_urls(text or "")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\u00a0", " ")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    masked, urls = _mask_urls(text)
    # Ensure space after sentence end before a letter (never inside URLs)
    masked = re.sub(r"\.([A-Za-zА-Яа-яЁё])", r". \1", masked)
    masked = re.sub(r"\?([A-Za-zА-Яа-яЁё])", r"? \1", masked)
    masked = re.sub(r"!([A-Za-zА-Яа-яЁё])", r"! \1", masked)
    # Fix broken markdown bold leftovers like слово**:
    masked = re.sub(r"(\w)\*\*:", r"\1:", masked)
    if not keep_md:
        masked = re.sub(r"\*\*([^*]+)\*\*", r"\1", masked)
        masked = re.sub(r"`+", "", masked)
    return heal_broken_http_urls(_unmask_urls(masked, urls).strip())


def typography(text: str) -> str:
    # Straight quotes → Russian guillemets for quoted phrases
    def repl_quotes(s: str) -> str:
        if s.count('"') >= 2:
            out = []
            open_q = True
            for ch in s:
                if ch == '"':
                    out.append("«" if open_q else "»")
                    open_q = not open_q
                else:
                    out.append(ch)
            return "".join(out)
        return s

    lines = []
    for line in text.split("\n"):
        if line.startswith("#"):
            lines.append(line.strip())
            continue
        line = repl_quotes(line)
        line = re.sub(r"\u2014", "–", line)  # em → en (no Lebedev typograf)
        line = re.sub(r"(?<=\S)\s+–\s+", " – ", line)
        line = re.sub(r"(?<=\S)\s+-\s+", " – ", line)  # keep markdown "- " lists
        line = re.sub(r"\( ", "(", line)
        line = re.sub(r" \)", ")", line)
        line = re.sub(r"\s+,", ",", line)
        line = re.sub(r"\s+\.", ".", line)
        line = re.sub(r"\s+!", "!", line)
        line = re.sub(r"\s+\?", "?", line)
        line = re.sub(r",{2,}", ",", line)
        for bad, good in TYPO_MAP.items():
            line = re.sub(re.escape(bad), good, line, flags=re.I)
        lines.append(line.rstrip())
    return "\n".join(lines)


def capitalize_sentences(text: str) -> str:
    masked, urls = _mask_urls(text or "")
    # Direct pass: capitalize after .?! when next letter is lowercase
    masked = re.sub(r"([.?!…]\s+)([a-zа-яё])", lambda m: m.group(1) + m.group(2).upper(), masked)
    parts = []
    for block in masked.split("\n"):
        lead_s = block.lstrip()
        if (
            not block.strip()
            or lead_s.startswith("#")
            or lead_s.startswith("•")
            or lead_s.startswith("- ")
            or lead_s.startswith("* ")
            or re.match(r"^\d+\.", lead_s)
        ):
            parts.append(block)
            continue
        sentences = list(razdel.sentenize(block))
        if not sentences:
            # capitalize first letter of plain block
            m = re.match(r"^(\s*)(.*)$", block, re.S)
            lead, body = m.group(1), m.group(2)
            if body and body[0].islower():
                body = body[0].upper() + body[1:]
            parts.append(lead + body)
            continue
        out = []
        cursor = 0
        for s in sentences:
            gap = block[cursor:s.start]
            chunk = block[s.start:s.stop]
            m = re.match(r"^(\s*)(.*)$", chunk, re.S)
            lead, body = m.group(1), m.group(2)
            if body and body[0].islower() and not body.startswith(("http", "www")):
                body = body[0].upper() + body[1:]
            out.append(gap + lead + body)
            cursor = s.stop
        out.append(block[cursor:])
        parts.append("".join(out))
    return heal_broken_http_urls(_unmask_urls("\n".join(parts), urls))


def readability_metrics(text: str) -> dict:
    sents = [s.text.strip() for s in razdel.sentenize(text) if s.text.strip()]
    words = [w.text for w in razdel.tokenize(text) if re.search(r"[А-Яа-яA-Za-z0-9]", w.text)]
    avg_sent = (sum(len(s.split()) for s in sents) / len(sents)) if sents else 0
    long_sents = sum(1 for s in sents if len(s.split()) > 28)
    very_short = sum(1 for s in sents if len(s.split()) < 3)
    return {
        "sentences": len(sents),
        "words": len(words),
        "avg_sentence_words": round(avg_sent, 2),
        "long_sentences": long_sents,
        "tiny_sentences": very_short,
        "paragraphs": len([p for p in text.split("\n\n") if p.strip()]),
    }


def coherence_hints(text: str) -> list[str]:
    hints = []
    metrics = readability_metrics(text)
    if metrics["avg_sentence_words"] > 24:
        hints.append("sentences_too_long")
    if metrics["long_sentences"] >= 3:
        hints.append("many_long_sentences")
    if metrics["words"] < 40:
        hints.append("too_short")
    if re.search(r"(как сделать|что делать).{0,40}\1", text, re.I):
        hints.append("repetition")
    for pat in BAD_PATTERNS:
        if pat.search(text):
            hints.append("bad_pattern")
            break
    if AI_CLICHE.search(text):
        hints.append("ai_cliche")
    if "\u2014" in text:
        hints.append("em_dash")
    # Repeated sentence starts
    starts = []
    for s in razdel.sentenize(text):
        tok = s.text.strip().split(" ", 1)[0].lower()
        starts.append(tok)
    if len(starts) >= 4:
        from collections import Counter

        c = Counter(starts)
        if c.most_common(1)[0][1] >= 3:
            hints.append("monotonous_starts")
    hints.extend(morph_coherence_hints(text))
    structure = structure_metrics(text)
    if structure["headings"] == 0 and metrics["words"] >= 220:
        hints.append("no_headings")
    if structure["lists"] == 0 and metrics["words"] >= 280:
        hints.append("no_lists")
    return hints


def split_long_sentences(text: str) -> str:
    """Break very long sentences on commas near midpoints for readability."""
    out_blocks = []
    for block in text.split("\n"):
        if block.lstrip().startswith("#") or not block.strip():
            out_blocks.append(block)
            continue
        new_sents = []
        for s in razdel.sentenize(block):
            words = s.text.split()
            if len(words) <= 30 or "," not in s.text:
                new_sents.append(s.text.strip())
                continue
            # split on a comma closest to middle
            mid = len(s.text) // 2
            commas = [m.start() for m in re.finditer(r",\s+", s.text)]
            if not commas:
                new_sents.append(s.text.strip())
                continue
            cut = min(commas, key=lambda i: abs(i - mid))
            left = s.text[:cut].strip().rstrip(",")
            right = s.text[cut + 1 :].strip()
            if right and right[0].islower():
                right = right[0].upper() + right[1:]
            if left and left[-1] not in ".!?…":
                left += "."
            new_sents.append(left)
            new_sents.append(right)
        out_blocks.append(" ".join(new_sents))
    return "\n".join(out_blocks)


DOMAIN_SPELL_IGNORE = {
    "слот",
    "слота",
    "слоты",
    "слотов",
    "whatsapp",
    "instagram",
    "reels",
    "stories",
    "tiktok",
    "procreate",
    "canva",
    "booksy",
    "yclients",
    "sitrifor",
    "tattoomarket",
    "cheyenne",
    "bishop",
    "kwadron",
    "картридж",
    "картриджа",
    "картриджи",
    "машинка",
    "флэш",
    "флеш",
    "guest",
    "spot",
    "aftercare",
    "stencil",
    "linework",
    "soft",
    "bold",
    "cta",
    "crm",
    "seo",
    "reels",
}

# mawo rules that are too noisy for auto-reject
MAWO_NOISE_RULES = {
    "PREP_V_ACCUSATIVE_MOTION",
    "PREP_V_PREPOSITIONAL_LOCATION",
    "VERB_ASPECT_USAGE",
    "PARTICLE_USAGE",
}


def _get_speller():
    global _SPELLER
    if _SPELLER is False:
        return None
    if _SPELLER is None:
        try:
            from pyaspeller import YandexSpeller

            _SPELLER = YandexSpeller(lang="ru", ignore_urls=True, ignore_digits=True)
        except Exception:
            _SPELLER = False
            return None
    return _SPELLER


def spell_fix(text: str) -> tuple[str, list[dict]]:
    """
    Check spelling via Yandex Speller.
    Does NOT auto-rewrite (Yandex often breaks industry terms like «слот»).
    Returns (unchanged_text, issues) for the gate.
    """
    if os.environ.get("NEWS_SPELLER", "1") == "0":
        return text, []
    speller = _get_speller()
    if not speller:
        return text, []
    try:
        issues = []
        for item in speller.spell(text) or []:
            if isinstance(item, dict):
                word = item.get("word") or ""
                suggestions = item.get("s") or []
                code = item.get("code")
            else:
                word = getattr(item, "word", "") or ""
                suggestions = getattr(item, "s", None) or getattr(item, "suggestions", None) or []
                code = getattr(item, "code", None)
            if not word:
                continue
            if word.lower() in DOMAIN_SPELL_IGNORE:
                continue
            if word.startswith("@@URL") or word.startswith("⟦URL"):
                continue
            issues.append(
                {
                    "word": word,
                    "suggestions": list(suggestions)[:3] if suggestions else [],
                    "code": code,
                }
            )
        return text, issues[:30]
    except Exception:
        return text, []


def _get_grammar():
    global _GRAMMAR
    if _GRAMMAR is False:
        return None
    if _GRAMMAR is None:
        try:
            from mawo_grammar import RussianGrammarChecker

            _GRAMMAR = RussianGrammarChecker()
        except Exception:
            _GRAMMAR = False
            return None
    return _GRAMMAR


def grammar_check(text: str) -> list[dict]:
    if os.environ.get("NEWS_MAWO", "1") == "0":
        return []
    checker = _get_grammar()
    if not checker:
        return []
    try:
        errs = checker.check(text) or []
    except Exception:
        return []
    out = []
    for e in errs[:40]:
        rule_id = str(getattr(e, "rule_id", None) or getattr(e, "rule", None) or "")
        if rule_id in MAWO_NOISE_RULES:
            continue
        sev = getattr(e, "severity", None)
        sev_s = getattr(sev, "value", None) or str(sev or "minor")
        out.append(
            {
                "rule_id": rule_id or None,
                "severity": sev_s,
                "description": getattr(e, "description", None) or getattr(e, "message", None),
                "engine": "mawo",
            }
        )
    return out


def _get_languagetool():
    """Optional LanguageTool (opt-in: NEWS_LANGUAGETOOL=1). Heavy; off by default."""
    global _LANGUAGETOOL
    if os.environ.get("NEWS_LANGUAGETOOL", "0") != "1":
        return None
    if _LANGUAGETOOL is False:
        return None
    if _LANGUAGETOOL is None:
        try:
            import language_tool_python

            _LANGUAGETOOL = language_tool_python.LanguageTool("ru-RU")
        except Exception:
            _LANGUAGETOOL = False
            return None
    return _LANGUAGETOOL


def languagetool_check(text: str) -> list[dict]:
    """Soft LT report – never hard-rejects alone; complements mawo."""
    tool = _get_languagetool()
    if not tool:
        return []
    try:
        sample = (text or "")[:3500]
        matches = tool.check(sample) or []
    except Exception:
        return []
    out = []
    for m in matches[:25]:
        rule_id = getattr(m, "ruleId", None) or getattr(m, "rule_id", None) or ""
        # Skip typography / dash noise we enforce ourselves
        if any(x in str(rule_id).upper() for x in ("DASH", "WHITESPACE", "TYPOGRAPHIC")):
            continue
        out.append(
            {
                "rule_id": str(rule_id) or None,
                "severity": "minor",
                "description": getattr(m, "message", None),
                "engine": "languagetool",
            }
        )
    return out


def krrkt_score(text: str) -> dict:
    """Glavred-like info-style score 0–10 via krrkt fast layer (no LLM)."""
    if os.environ.get("NEWS_KRRKT", "1") == "0":
        return {"score": None, "stopwords": 0, "findings": []}
    try:
        from krrkt.engine.pipeline import proofread

        result = asyncio.run(proofread(text, skip_llm=True))
        findings = []
        for f in (result.findings or [])[:25]:
            findings.append(
                {
                    "word": getattr(f, "word", None),
                    "rule": getattr(f, "rule", None),
                    "weight": getattr(f, "weight", None),
                }
            )
        return {
            "score": float(result.score) if result.score is not None else None,
            "stopwords": int(getattr(result, "stopwords", 0) or 0),
            "words": int(getattr(result, "words", 0) or 0),
            "findings": findings,
        }
    except Exception as exc:
        return {"score": None, "stopwords": 0, "findings": [], "error": str(exc)[:120]}


def _get_ner():
    global _NER
    if _NER is False:
        return None
    if _NER is None:
        try:
            from natasha import Doc, Segmenter, NewsEmbedding, NewsNERTagger, NewsMorphTagger

            seg = Segmenter()
            emb = NewsEmbedding()
            ner = NewsNERTagger(emb)
            morph = NewsMorphTagger(emb)
            _NER = (Doc, seg, morph, ner)
        except Exception:
            _NER = False
            return None
    return _NER


def ner_entities(text: str) -> list[dict]:
    if os.environ.get("NEWS_NER", "1") == "0":
        return []
    pack = _get_ner()
    if not pack:
        return []
    Doc, seg, morph, ner = pack
    try:
        # Cap for speed/RAM
        sample = text[:4000]
        doc = Doc(sample)
        doc.segment(seg)
        doc.tag_morph(morph)
        doc.tag_ner(ner)
        seen = set()
        out = []
        for span in doc.spans or []:
            key = (span.text, span.type)
            if key in seen:
                continue
            seen.add(key)
            out.append({"text": span.text, "type": span.type})
            if len(out) >= 30:
                break
        return out
    except Exception:
        return []


def fact_gate(text: str, entities: list[dict]) -> list[str]:
    """Soft fact-check hints: named claims without sources."""
    hints = []
    has_source = bool(
        re.search(
            r"https?://|@@URL\d+@@|⟦URL\d+⟧|по\s+ссылке|источник:|tattoo\s*market|tattoomarket",
            text,
            re.I,
        )
    )
    if CLAIM_PATTERNS.search(text):
        if not has_source:
            hints.append("unverified_claim")
    orgs = [e["text"] for e in entities if e.get("type") == "ORG"]
    # Unknown brand-like ORG + percentage → soft warn
    if orgs and CLAIM_PATTERNS.search(text) and not has_source:
        hints.append("named_claim_no_url")
    return hints


def editorial_gate(
    text: str,
    *,
    krrkt: dict | None = None,
    grammar: list[dict] | None = None,
    spell_issues: list[dict] | None = None,
    hints: list[str] | None = None,
    fact_hints: list[str] | None = None,
) -> dict:
    """
    Publish gate aligned with ru-score rubric (0–10).
    Reject below NEWS_KRRKT_MIN (default 7.0) for bodies with enough words.
    """
    min_score = float(os.environ.get("NEWS_KRRKT_MIN", "7.0"))
    words = readability_metrics(text)["words"]
    krrkt = krrkt or {}
    grammar = grammar or []
    spell_issues = spell_issues or []
    hints = list(hints or [])
    fact_hints = list(fact_hints or [])

    info_score = krrkt.get("score")
    reasons: list[str] = []
    ok = True

    majors = [
        g
        for g in grammar
        if str(g.get("severity", "")).lower() in ("major", "critical", "error")
    ]
    # mawo comma/prep majors are too noisy on real copy – do not hard-reject on them.
    # Hard grammar signal: bureaucratese + krrkt score (+ AI clichés / claims).
    bureau = [g for g in grammar if "BUREAUCRATESE" in str(g.get("rule_id") or "").upper()]
    if len(bureau) >= 2:
        reasons.append("bureaucratese")
        ok = False
    elif len(bureau) >= 1 and (info_score is None or info_score < 8):
        reasons.append("bureaucratese")
        ok = False
    # Keep majors in report only
    if majors and not any(r.startswith("grammar") for r in reasons):
        pass
    if "bad_pattern" in hints:
        reasons.append("bad_pattern")
        ok = False
    if "em_dash" in hints or "\u2014" in text:
        reasons.append("em_dash")
        ok = False
    cliche_hits = len(AI_CLICHE.findall(text))
    if "ai_cliche" in hints or cliche_hits:
        reasons.append("ai_cliche")
        if cliche_hits >= 2 or (cliche_hits >= 1 and words < 120):
            ok = False
    if len(spell_issues) >= 6:
        reasons.append("spell_many")
        ok = False
    if "unverified_claim" in fact_hints and words >= 120:
        reasons.append("unverified_claim")
        if info_score is not None and info_score < min_score:
            ok = False

    skip_krrkt = words < 40 or os.environ.get("NEWS_KRRKT_GATE", "1") == "0"
    if not skip_krrkt and info_score is not None:
        if info_score < min_score:
            reasons.append(f"krrkt_below_{min_score}")
            ok = False
    elif not skip_krrkt and info_score is None and krrkt.get("error"):
        reasons.append("krrkt_error")

    # Map to 0–10 editorial score for callers
    if info_score is not None:
        editorial_score = float(info_score)
    else:
        editorial_score = 7.0 if ok else 5.0
    if cliche_hits:
        editorial_score = max(0.0, editorial_score - 0.5 * min(3, cliche_hits))
    if bureau:
        editorial_score = max(0.0, editorial_score - min(1.5, 0.3 * len(bureau)))

    return {
        "ok": ok,
        "editorial_score": round(editorial_score, 1),
        "info_score": info_score,
        "min_score": min_score,
        "reasons": reasons,
        "skipped_krrkt": skip_krrkt,
        "grammar_majors": len(majors),
        "bureaucratese": len(bureau),
    }


def polish(text: str, *, aggressive: bool = True, keep_md: bool = True, gate: bool = True) -> dict:
    original = text or ""
    t = strip_junk(original, keep_md=keep_md)
    t = typography(t)
    t = strip_ai_cliches(t)
    if aggressive:
        t = split_long_sentences(t)
    t = capitalize_sentences(t)
    t = typography(t)
    t = re.sub(r"\n{3,}", "\n\n", t).strip()
    t = heal_broken_http_urls(t)

    spell_issues: list[dict] = []
    if gate and os.environ.get("NEWS_SPELLER", "1") != "0":
        t, spell_issues = spell_fix(t)
        t = typography(t)
        t = heal_broken_http_urls(t)

    metrics = readability_metrics(t)
    structure = structure_metrics(t)
    metrics = {**metrics, "structure": structure}
    hints = coherence_hints(t)
    score = 100
    score -= min(30, metrics["long_sentences"] * 8)
    score -= 25 if "bad_pattern" in hints else 0
    score -= 10 if "monotonous_starts" in hints else 0
    score -= 8 if "monotonous_lemmas" in hints else 0
    score -= 15 if "too_short" in hints else 0
    score -= 8 if "repetition" in hints else 0
    score -= 8 if "ai_cliche" in hints else 0
    score -= 6 if "no_headings" in hints else 0
    # Structure bonus for magazine-shaped drafts
    if structure.get("ok"):
        score = min(100, score + 5)
    score = max(0, min(100, score))

    grammar: list[dict] = []
    krrkt: dict = {"score": None, "stopwords": 0, "findings": []}
    entities: list[dict] = []
    fact_hints: list[str] = []
    gate_result: dict | None = None

    if gate:
        grammar = grammar_check(t)
        grammar.extend(languagetool_check(t))
        if metrics["words"] >= 40:
            krrkt = krrkt_score(t)
        entities = ner_entities(t)
        fact_hints = fact_gate(t, entities)
        if fact_hints:
            hints.extend(fact_hints)
        # Re-check clichés after strip – leftover still flags soft hint
        if AI_CLICHE.search(t) and "ai_cliche" not in hints:
            hints.append("ai_cliche")
        gate_result = editorial_gate(
            t,
            krrkt=krrkt,
            grammar=grammar,
            spell_issues=spell_issues,
            hints=hints,
            fact_hints=fact_hints,
        )

    ok_basic = score >= 60 and "bad_pattern" not in hints
    # When krrkt/mawo gate ran: trust it for publish; soft readability score is advisory.
    if gate_result is not None:
        ok = bool(gate_result.get("ok")) and "bad_pattern" not in hints
    else:
        ok = ok_basic

    return {
        "text": t,
        "changed": t != original.strip(),
        "score": score,
        "metrics": metrics,
        "structure": structure,
        "hints": hints,
        "ok": ok,
        "spell_issues": spell_issues,
        "grammar": grammar,
        "krrkt": krrkt,
        "entities": entities,
        "gate": gate_result,
        "editorial_score": (gate_result or {}).get("editorial_score"),
        "info_score": (krrkt or {}).get("score"),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--text", default="")
    ap.add_argument("--file", default="")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--soft", action="store_true", help="skip long-sentence splitting")
    ap.add_argument("--keep-md", dest="keep_md", action="store_true", default=True)
    ap.add_argument("--strip-md", dest="keep_md", action="store_false")
    ap.add_argument("--no-gate", action="store_true", help="skip krrkt/mawo/speller/ner gate")
    args = ap.parse_args()
    if args.file:
        raw = Path(args.file).read_text(encoding="utf-8")
    elif args.text:
        raw = args.text
    else:
        raw = sys.stdin.read()
    result = polish(raw, aggressive=not args.soft, keep_md=args.keep_md, gate=not args.no_gate)
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(result["text"])
    return 0 if result.get("ok", True) else 2


if __name__ == "__main__":
    raise SystemExit(main())
