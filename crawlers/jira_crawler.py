"""
Apache JIRA crawler.

Apache projects like Spark track real proposals (SPIPs) as JIRA issues, not GitHub
issues — so GitHub crawling misses them entirely. The public Apache JIRA REST API is
free and needs no auth for public projects.

Config (in projects/<id>.yaml):

  jira:
    base_url: https://issues.apache.org/jira    # ASF JIRA
    project_key: SPARK
    # Extra JQL to focus on proposals (default: whole project). For SPIPs:
    jql: "labels = SPIP"
    max_issues: 300                              # safety cap (optional)

Incremental: `since` becomes a JQL `updated >= "..."` clause, so only changed issues
are fetched.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from crawlers._http import get_session
from crawlers.link_extractor import extract_links

logger = logging.getLogger(__name__)

_FIELDS = "summary,description,status,issuetype,created,updated,reporter,labels,comment"
_PAGE = 100


def _parse_jira_dt(val: str | None) -> str:
    """JIRA dates look like 2026-03-01T12:00:00.000+0000 → ISO 8601."""
    if not val:
        return ""
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M:%S%z"):
        try:
            return datetime.strptime(val, fmt).isoformat()
        except ValueError:
            continue
    return ""


def _since_clause(since: Optional[str]) -> str:
    if not since:
        return ""
    try:
        dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
    except ValueError:
        return ""
    # JQL wants "yyyy-MM-dd HH:mm" in the instance's timezone; minute precision is plenty.
    return f' AND updated >= "{dt.strftime("%Y-%m-%d %H:%M")}"'


def _state_from_status(status: dict) -> str:
    cat = ((status or {}).get("statusCategory") or {}).get("key", "")
    return "closed" if cat == "done" else "open"


def crawl(project_config: dict, since: Optional[str] = None) -> list[dict]:
    jira = project_config.get("jira") or {}
    base = (jira.get("base_url") or "").rstrip("/")
    project_key = jira.get("project_key")
    if not base or not project_key:
        logger.info("No jira config (base_url/project_key) — skipping JIRA crawl.")
        return []

    project_id = project_config["id"]
    extra = jira.get("jql", "").strip()
    max_issues = int(jira.get("max_issues", 300))

    jql = f"project = {project_key}"
    if extra:
        jql += f" AND ({extra})"
    jql += _since_clause(since)
    jql += " ORDER BY updated DESC"

    session = get_session()
    results: list[dict] = []
    start_at = 0

    while start_at < max_issues:
        resp = session.get(
            f"{base}/rest/api/2/search",
            params={"jql": jql, "startAt": start_at, "maxResults": _PAGE, "fields": _FIELDS},
            headers={"Accept": "application/json"},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        issues = data.get("issues", [])
        if not issues:
            break

        for it in issues:
            key = it.get("key", "")
            f = it.get("fields", {})
            desc = (f.get("description") or "")[:2000]
            links = [{"url": l.url, "kind": l.kind} for l in extract_links(desc)]
            results.append({
                "id": f"{project_id}-jira-{key}",
                "source": "jira",
                "kind": "issue",
                "title": f.get("summary") or key,
                "url": f"{base}/browse/{key}",
                "author": ((f.get("reporter") or {}).get("displayName")
                           or (f.get("reporter") or {}).get("name") or "unknown"),
                "state": _state_from_status(f.get("status")),
                "created_at": _parse_jira_dt(f.get("created")),
                "updated_at": _parse_jira_dt(f.get("updated")),
                "body": desc,
                "labels": f.get("labels") or [],
                "linked_resources": links,
                "comment_count": ((f.get("comment") or {}).get("total")) or 0,
                "llm_summary": None,
                "llm_status": None,
            })

        total = data.get("total", 0)
        start_at += _PAGE
        if start_at >= total:
            break

    logger.info(f"JIRA: fetched {len(results)} issues for {project_key} ({project_id})")
    return results
