#!/usr/bin/env python3
"""
Sitrifor Delivery orchestrator (minimal).

Polls GitHub Project «Sitrifor Delivery», runs role agents via local Ollama,
posts Issue comments, advances Status. Stops at approve gates until the
issue gets a comment containing `/approve`.

Token: /root/.config/sitrifor/github.token (Classic PAT, repo+project).
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CFG_PATH = Path(__file__).with_name("config.json")
TOKEN_PATH = Path(os.environ.get("SITRIFOR_GH_TOKEN_FILE", "/root/.config/sitrifor/github.token"))
STATE_MARKER = "<!-- orch:stage:{role}:done -->"
AWAIT_MARKER = "<!-- orch:awaiting-approve:{status} -->"


def load_cfg() -> dict:
    return json.loads(CFG_PATH.read_text(encoding="utf-8"))


def token() -> str:
    if not TOKEN_PATH.exists():
        raise SystemExit(f"Missing GitHub token file: {TOKEN_PATH}")
    t = TOKEN_PATH.read_text(encoding="utf-8").strip()
    if not t:
        raise SystemExit("Empty GitHub token")
    return t


def gql(tok: str, query: str, variables: dict | None = None) -> dict:
    body = json.dumps({"query": query, "variables": variables or {}}).encode()
    req = urllib.request.Request(
        "https://api.github.com/graphql",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {tok}",
            "Content-Type": "application/json",
            "Accept": "application/vnd.github+json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.load(resp)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"GraphQL HTTP {e.code}: {e.read().decode()[:500]}") from e
    if data.get("errors"):
        raise RuntimeError(json.dumps(data["errors"], ensure_ascii=False)[:2000])
    return data["data"]


def rest(tok: str, method: str, path: str, payload: dict | None = None):
    body = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(
        f"https://api.github.com{path}",
        data=body,
        method=method,
        headers={
            "Authorization": f"Bearer {tok}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
            "User-Agent": "sitrifor-orchestrator",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read()
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:800]


def ollama_chat(cfg: dict, system: str, user: str) -> str:
    host = cfg["ollama_host"].rstrip("/")
    model = cfg.get("ollama_model") or "qwen2.5:1.5b"
    payload = {
        "model": model,
        "stream": False,
        "keep_alive": "0",
        "options": {
            "num_thread": int(os.environ.get("OLLAMA_NUM_THREAD", "1")),
            "num_ctx": int(os.environ.get("OLLAMA_NUM_CTX", "2048")),
            "temperature": 0.3,
        },
        "messages": [
            {"role": "system", "content": system[:4000]},
            {"role": "user", "content": user[:6000]},
        ],
    }
    req = urllib.request.Request(
        f"{host}/api/chat",
        data=json.dumps(payload).encode(),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = json.load(resp)
    except Exception as e:
        return (
            f"(Ollama недоступен: {e}. Ниже каркас этапа без LLM.)\n\n"
            f"## Черновик\nНужна ручная оценка роли. Модель: {model}."
        )
    return (data.get("message") or {}).get("content") or "(пустой ответ модели)"


def read_text(rel: str, limit: int = 8000) -> str:
    p = ROOT / rel
    if not p.exists():
        return f"(нет файла {rel})"
    return p.read_text(encoding="utf-8")[:limit]


def stage_index(cfg: dict, status_name: str) -> int:
    for i, s in enumerate(cfg["stages"]):
        if s["status"] == status_name:
            return i
    return -1


def next_status(cfg: dict, status_name: str) -> str | None:
    i = stage_index(cfg, status_name)
    if i < 0 or i + 1 >= len(cfg["stages"]):
        return None
    return cfg["stages"][i + 1]["status"]


def load_project(tok: str, cfg: dict) -> dict:
    data = gql(
        tok,
        """
        query($login:String!, $n:Int!) {
          user(login:$login) {
            projectV2(number:$n) {
              id
              title
              fields(first:40) {
                nodes {
                  __typename
                  ... on ProjectV2FieldCommon { id name }
                  ... on ProjectV2SingleSelectField {
                    id name
                    options { id name }
                  }
                }
              }
              items(first:50) {
                nodes {
                  id
                  fieldValues(first:30) {
                    nodes {
                      ... on ProjectV2ItemFieldSingleSelectValue {
                        name
                        field { ... on ProjectV2SingleSelectField { name } }
                      }
                    }
                  }
                  content {
                    __typename
                    ... on Issue {
                      id
                      number
                      title
                      body
                      url
                      state
                      labels(first:20) { nodes { name } }
                      comments(last:40) { nodes { body author { login } } }
                    }
                  }
                }
              }
            }
          }
        }
        """,
        {"login": cfg["project_owner"], "n": cfg["project_number"]},
    )
    return data["user"]["projectV2"]


def status_maps(project: dict, cfg: dict):
    field = None
    for f in project["fields"]["nodes"]:
        if f and f.get("name") == cfg["status_field_name"] and f.get("options") is not None:
            field = f
            break
    if not field:
        raise RuntimeError("Status field not found on project")
    opt = {o["name"]: o["id"] for o in field["options"]}
    return field["id"], opt


def item_status(item: dict) -> str | None:
    for fv in item.get("fieldValues", {}).get("nodes") or []:
        field = (fv or {}).get("field") or {}
        if field.get("name") == "Status":
            return fv.get("name")
    return None


def has_product_label(issue: dict, cfg: dict) -> bool:
    names = {n["name"] for n in (issue.get("labels") or {}).get("nodes") or []}
    return any(l in names for l in cfg["product_labels"])


def comments_text(issue: dict) -> str:
    return "\n".join(c.get("body") or "" for c in (issue.get("comments") or {}).get("nodes") or [])


def stage_done(issue: dict, role: str) -> bool:
    return STATE_MARKER.format(role=role) in comments_text(issue)


def awaiting_approve(issue: dict, status: str) -> bool:
    return AWAIT_MARKER.format(status=status) in comments_text(issue)


def has_approve(issue: dict, cfg: dict) -> bool:
    cmd = cfg.get("approve_command") or "/approve"
    # approve after the last await marker
    bodies = [c.get("body") or "" for c in (issue.get("comments") or {}).get("nodes") or []]
    last_await = -1
    for i, b in enumerate(bodies):
        if "<!-- orch:awaiting-approve:" in b:
            last_await = i
    for b in bodies[last_await + 1 :]:
        if cmd in b and "orch:awaiting-approve" not in b:
            return True
    return False


def set_status(tok: str, project_id: str, item_id: str, field_id: str, option_id: str):
    gql(
        tok,
        """
        mutation($projectId:ID!, $itemId:ID!, $fieldId:ID!, $optionId:String!) {
          updateProjectV2ItemFieldValue(input:{
            projectId:$projectId
            itemId:$itemId
            fieldId:$fieldId
            value:{ singleSelectOptionId:$optionId }
          }) { projectV2Item { id } }
        }
        """,
        {
            "projectId": project_id,
            "itemId": item_id,
            "fieldId": field_id,
            "optionId": option_id,
        },
    )


def add_issue_to_project(tok: str, project_id: str, issue_node_id: str) -> str:
    data = gql(
        tok,
        """
        mutation($projectId:ID!, $contentId:ID!) {
          addProjectV2ItemById(input:{projectId:$projectId, contentId:$contentId}) {
            item { id }
          }
        }
        """,
        {"projectId": project_id, "contentId": issue_node_id},
    )
    return data["addProjectV2ItemById"]["item"]["id"]


def comment_issue(tok: str, cfg: dict, number: int, body: str):
    code, resp = rest(
        tok,
        "POST",
        f"/repos/{cfg['repo_owner']}/{cfg['repo_name']}/issues/{number}/comments",
        {"body": body},
    )
    if code not in (200, 201):
        raise RuntimeError(f"comment failed {code}: {resp}")


def ensure_task_dir(number: int) -> Path:
    d = ROOT / "docs" / "tasks" / f"ISSUE-{number}"
    d.mkdir(parents=True, exist_ok=True)
    return d


def write_artifact(number: int, name: str, content: str):
    d = ensure_task_dir(number)
    p = d / name
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    prev = p.read_text(encoding="utf-8") if p.exists() else ""
    block = f"\n\n## {stamp}\n\n{content.strip()}\n"
    p.write_text((prev + block).lstrip() + "\n", encoding="utf-8")


def build_prompt(role: str, issue: dict, action: str) -> tuple[str, str]:
    role_md = read_text(f"agents/{role}/ROLE.md")
    rules = read_text(f"agents/{role}/RULES.md", 3000)
    kb = "\n\n".join(
        [
            read_text("docs/kb/metrics.md", 2500),
            read_text("docs/kb/pipeline.md", 2000),
            read_text("docs/kb/sitrifor-web.md", 2500),
            read_text("docs/kb/app-634.md", 1500),
        ]
    )
    labels = ", ".join(n["name"] for n in (issue.get("labels") or {}).get("nodes") or [])
    system = (
        "Ты агент роли в delivery-пайплайне Sitrifor. Пиши по-русски, коротко, конкретно. "
        "Только короткий дефис '-', без длинных тире. Не выдумывай секреты и доступы. "
        "Верни markdown: вывод этапа, критерии приёмки этапа, риски, next step."
    )
    if action == "plan_only":
        system += " Код не пиши - только план реализации для Cursor/разработчика."
    user = (
        f"# Роль\n{role_md}\n\n# Правила\n{rules}\n\n# KB\n{kb}\n\n"
        f"# Issue #{issue['number']}: {issue['title']}\n"
        f"Labels: {labels}\n\n"
        f"{(issue.get('body') or '')[:3500]}\n"
    )
    return system, user


def format_agent_comment(role: str, status: str, text: str, extra: str = "") -> str:
    return (
        f"### Агент `{role}` ({status})\n\n"
        f"{text.strip()}\n\n"
        f"{extra}"
        f"{STATE_MARKER.format(role=role)}\n"
    )


def pickup_inbox(tok: str, cfg: dict, project: dict, field_id: str, opt: dict, item: dict, issue: dict) -> bool:
    """Move Inbox -> BizDev so the BizDev agent can run on next tick or same run."""
    nxt = "1 BizDev"
    if nxt not in opt:
        return False
    set_status(tok, project["id"], item["id"], field_id, opt[nxt])
    comment_issue(
        tok,
        cfg,
        issue["number"],
        "Оркестратор: задача принята из **0 Inbox**, передана роли **BizDev**.\n\n"
        "<!-- orch:picked-up -->\n",
    )
    print(f"#{issue['number']}: Inbox -> BizDev")
    return True


def run_role(
    tok: str,
    cfg: dict,
    project: dict,
    field_id: str,
    opt: dict,
    item: dict,
    issue: dict,
    stage: dict,
) -> bool:
    role = stage["role"]
    status = stage["status"]
    action = stage.get("action") or "run"
    if not role:
        return False
    if stage_done(issue, role):
        # already done - advance if not waiting
        if stage.get("approve_after") and awaiting_approve(issue, status) and not has_approve(issue, cfg):
            print(f"#{issue['number']}: waiting /approve at {status}")
            return False
        nxt = next_status(cfg, status)
        if nxt and nxt in opt:
            if stage.get("approve_after") and not has_approve(issue, cfg):
                return False
            set_status(tok, project["id"], item["id"], field_id, opt[nxt])
            print(f"#{issue['number']}: advance {status} -> {nxt} (already done)")
            return True
        return False

    if action == "human":
        return False

    system, user = build_prompt(role, issue, action)
    print(f"#{issue['number']}: running {role} via Ollama…")
    answer = ollama_chat(cfg, system, user)

    # artifacts
    write_artifact(issue["number"], "brief.md", issue.get("body") or issue["title"])
    write_artifact(issue["number"], f"{role}.md", answer)
    if role in ("bizdev", "strategist", "product"):
        write_artifact(issue["number"], "score.md", answer)
    write_artifact(
        issue["number"],
        "acceptance.md",
        f"### {role}\n\n(из ответа агента - проверить критерии в комментарии Issue)\n",
    )
    write_artifact(
        issue["number"],
        "pipeline.md",
        f"status: {status}\nrole: {role}\naction: {action}\n",
    )

    extra = ""
    if stage.get("approve_after"):
        extra = (
            f"\n---\n**Нужен апрув заказчика:** напишите в Issue комментарий "
            f"`{cfg.get('approve_command', '/approve')}` чтобы сдвинуть дальше.\n\n"
            f"{AWAIT_MARKER.format(status=status)}\n"
        )

    comment_issue(tok, cfg, issue["number"], format_agent_comment(role, status, answer, extra))

    if stage.get("approve_after"):
        print(f"#{issue['number']}: {role} done, awaiting /approve")
        return True

    nxt = next_status(cfg, status)
    if nxt and nxt in opt:
        set_status(tok, project["id"], item["id"], field_id, opt[nxt])
        print(f"#{issue['number']}: {role} done, {status} -> {nxt}")
    return True


def sync_open_issues(tok: str, cfg: dict, project_id: str, opt: dict, field_id: str, existing_numbers: set[int]):
    """Add open labeled issues that are not on the board yet."""
    code, data = rest(
        tok,
        "GET",
        f"/repos/{cfg['repo_owner']}/{cfg['repo_name']}/issues?state=open&per_page=30",
    )
    if code != 200 or not isinstance(data, list):
        print("sync issues failed", code)
        return
    for issue in data:
        if "pull_request" in issue:
            continue
        labels = {l["name"] for l in issue.get("labels") or []}
        if not any(l in labels for l in cfg["product_labels"]):
            continue
        n = issue["number"]
        if n in existing_numbers:
            continue
        # get node id
        q = gql(
            tok,
            "query($o:String!,$r:String!,$n:Int!){ repository(owner:$o,name:$r){ issue(number:$n){ id } } }",
            {"o": cfg["repo_owner"], "r": cfg["repo_name"], "n": n},
        )
        node_id = q["repository"]["issue"]["id"]
        try:
            item_id = add_issue_to_project(tok, project_id, node_id)
            if "0 Inbox" in opt:
                set_status(tok, project_id, item_id, field_id, opt["0 Inbox"])
            comment_issue(
                tok,
                cfg,
                n,
                "Оркестратор: Issue добавлена на доску **Sitrifor Delivery** → **0 Inbox**.\n\n"
                "<!-- orch:boarded -->\n",
            )
            print(f"#{n}: added to board (Inbox)")
        except Exception as e:
            print(f"#{n}: board add failed: {e}")


def process_once() -> int:
    cfg = load_cfg()
    tok = token()
    project = load_project(tok, cfg)
    field_id, opt = status_maps(project, cfg)
    items = project["items"]["nodes"]
    existing = set()
    for it in items:
        content = it.get("content") or {}
        if content.get("__typename") == "Issue" and content.get("number"):
            existing.add(content["number"])

    sync_open_issues(tok, cfg, project["id"], opt, field_id, existing)

    # reload after sync
    project = load_project(tok, cfg)
    field_id, opt = status_maps(project, cfg)

    handled = 0
    max_n = int(cfg.get("max_items_per_run") or 2)

    # Prefer Inbox pickup, then role columns in order
    ordered_statuses = [s["status"] for s in cfg["stages"]]

    for status_name in ordered_statuses:
        if handled >= max_n:
            break
        stage = next(s for s in cfg["stages"] if s["status"] == status_name)
        for item in project["items"]["nodes"]:
            if handled >= max_n:
                break
            issue = item.get("content") or {}
            if issue.get("__typename") != "Issue" or issue.get("state") != "OPEN":
                continue
            if not has_product_label(issue, cfg):
                continue
            cur = item_status(item)
            if cur != status_name:
                continue

            if stage.get("action") == "pickup":
                if pickup_inbox(tok, cfg, project, field_id, opt, item, issue):
                    handled += 1
                continue

            # If awaiting approve and got it - advance without re-run
            if stage.get("approve_after") and stage_done(issue, stage["role"] or ""):
                if has_approve(issue, cfg):
                    nxt = next_status(cfg, status_name)
                    if nxt and nxt in opt:
                        set_status(tok, project["id"], item["id"], field_id, opt[nxt])
                        comment_issue(
                            tok,
                            cfg,
                            issue["number"],
                            f"Оркестратор: получен `{cfg.get('approve_command')}`, "
                            f"сдвиг **{status_name}** → **{nxt}**.\n\n<!-- orch:approved -->\n",
                        )
                        print(f"#{issue['number']}: approved -> {nxt}")
                        handled += 1
                else:
                    print(f"#{issue['number']}: still awaiting /approve")
                continue

            if run_role(tok, cfg, project, field_id, opt, item, issue, stage):
                handled += 1

    print(f"done, handled={handled}")
    return 0


def main():
    if len(sys.argv) > 1 and sys.argv[1] in ("-h", "--help"):
        print("Usage: run.py  # one orchestration tick")
        return 0
    try:
        return process_once()
    except Exception as e:
        print("ERROR", e, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
