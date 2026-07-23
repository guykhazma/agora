"""
GitHub crawler: fetches issues and PRs matching proposal criteria.
Uses GitHub GraphQL API. Incremental: only fetches items updated since last run.
"""

from __future__ import annotations
import os
import re
import time
import logging
from datetime import datetime, timezone
from typing import Optional

from crawlers._http import get_session
from crawlers.link_extractor import extract_links

logger = logging.getLogger(__name__)

GITHUB_API = "https://api.github.com/graphql"


def _headers() -> dict:
    token = os.environ.get("GITHUB_TOKEN", "")
    if not token:
        raise EnvironmentError("GITHUB_TOKEN environment variable is required")
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _graphql(query: str, variables: dict, _attempt: int = 0) -> dict:
    resp = get_session().post(
        GITHUB_API,
        json={"query": query, "variables": variables},
        headers=_headers(),
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    if "errors" in data:
        errors = data["errors"]
        # GraphQL rate-limit / transient errors return HTTP 200 with an errors block
        # (so the HTTP retry adapter never sees them). Back off and retry a few times.
        types = {e.get("type") for e in errors if isinstance(e, dict)}
        if types & {"RATE_LIMITED", "SERVICE_UNAVAILABLE"} and _attempt < 4:
            wait = 30 * (_attempt + 1)
            logger.warning(f"GraphQL {types} — backing off {wait}s (attempt {_attempt + 1}/4)")
            time.sleep(wait)
            return _graphql(query, variables, _attempt + 1)
        raise RuntimeError(f"GraphQL errors: {errors}")
    return data["data"]


ISSUES_QUERY = """
query($owner: String!, $repo: String!, $after: String, $since: DateTime) {
  repository(owner: $owner, name: $repo) {
    issues(
      first: 100,
      after: $after,
      orderBy: {field: UPDATED_AT, direction: DESC},
      filterBy: {since: $since}
    ) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        title
        url
        body
        state
        createdAt
        updatedAt
        author { login }
        labels(first: 20) { nodes { name } }
        comments(first: 50) {
          nodes { body author { login } createdAt }
        }
      }
    }
  }
}
"""

PRS_QUERY = """
query($owner: String!, $repo: String!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequests(
      first: 100,
      after: $after,
      orderBy: {field: UPDATED_AT, direction: DESC},
      states: [OPEN, MERGED]
    ) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        title
        url
        body
        state
        createdAt
        updatedAt
        author { login }
        labels(first: 20) { nodes { name } }
        comments(first: 20) {
          nodes { body author { login } createdAt }
        }
      }
    }
  }
}
"""


def _matches_config(item: dict, config: dict) -> bool:
    """Return True if the issue/PR looks like a proposal based on project config."""
    proposal_labels = {l.lower() for l in config.get("proposal_labels", [])}
    prefixes = [p.lower() for p in config.get("title_prefixes", [])]

    item_labels = {n["name"].lower() for n in item.get("labels", {}).get("nodes", [])}
    if item_labels & proposal_labels:
        return True

    title_lower = item["title"].lower()
    if any(title_lower.startswith(p.lower()) for p in prefixes):
        return True

    return False


def _parse_item(item: dict, kind: str, project_id: str, repo: str = "") -> dict:
    """Convert raw GraphQL node to Agora proposal dict."""
    comments = item.get("comments", {}).get("nodes", [])
    all_text = (item.get("body") or "") + "\n".join(c.get("body", "") for c in comments)
    self_url = item.get("url", "").rstrip("/")
    links = [
        {"url": l.url, "kind": l.kind}
        for l in extract_links(all_text, repo=repo)
        if l.url.rstrip("/") != self_url  # drop self-references
    ]

    return {
        "id": f"{project_id}-gh-{kind[0]}{item['number']}",
        "source": "github",
        "kind": kind,
        "number": item["number"],
        "title": item["title"],
        "url": item["url"],
        "author": (item.get("author") or {}).get("login", "unknown"),
        "state": item["state"].lower(),
        "created_at": item["createdAt"],
        "updated_at": item["updatedAt"],
        "body": (item.get("body") or "")[:2000],  # truncate for storage
        "labels": [n["name"] for n in item.get("labels", {}).get("nodes", [])],
        "linked_resources": links,
        "llm_summary": None,
        "llm_status": None,
        "comment_count": len(comments),
    }


def crawl(project_config: dict, since: Optional[str] = None) -> list[dict]:
    """
    Fetch proposals from GitHub for the given project config.
    `since` is an ISO datetime string; only items updated after this are fetched.
    Returns list of proposal dicts.
    """
    gh_config = project_config.get("github", {})
    repo = gh_config.get("repo") or project_config.get("repo", "")
    if "/" not in repo:
        raise ValueError(f"Invalid repo format: {repo!r}. Expected 'owner/repo'.")

    owner, repo_name = repo.split("/", 1)
    project_id = project_config["id"]
    results = []

    # --- Issues ---
    cursor = None
    pages = 0
    while pages < 10:  # safety cap
        variables = {"owner": owner, "repo": repo_name, "after": cursor, "since": since}
        data = _graphql(ISSUES_QUERY, variables)
        issues_data = data["repository"]["issues"]
        for node in issues_data["nodes"]:
            if _matches_config(node, gh_config):
                results.append(_parse_item(node, "issue", project_id, repo=repo))
        page_info = issues_data["pageInfo"]
        if not page_info["hasNextPage"]:
            break
        cursor = page_info["endCursor"]
        pages += 1

    logger.info(f"GitHub issues: fetched {len(results)} proposals for {repo}")

    # --- PRs ---
    pr_start = len(results)
    cursor = None
    pages = 0
    while pages < 5:
        variables = {"owner": owner, "repo": repo_name, "after": cursor}
        data = _graphql(PRS_QUERY, variables)
        prs_data = data["repository"]["pullRequests"]
        for node in prs_data["nodes"]:
            # Stop if we've gone past the since date
            if since and node["updatedAt"] < since:
                break
            if _matches_config(node, gh_config):
                results.append(_parse_item(node, "pr", project_id, repo=repo))
        page_info = prs_data["pageInfo"]
        if not page_info["hasNextPage"]:
            break
        cursor = page_info["endCursor"]
        pages += 1

    logger.info(f"GitHub PRs: fetched {len(results) - pr_start} proposals for {repo}")
    return results


MILESTONES_QUERY = """
query($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    milestones(first: 30, states: [OPEN, CLOSED], orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        number
        title
        description
        state
        dueOn
        updatedAt
        createdAt
        url
        issues { totalCount }
        closedIssues: issues(states: CLOSED) { totalCount }
      }
    }
  }
}
"""


def crawl_releases(project_config: dict, since: Optional[str] = None) -> list[dict]:
    """Fetch GitHub releases via REST API."""
    repo = project_config.get("github", {}).get("repo") or project_config.get("repo", "")
    if "/" not in repo:
        return []
    project_id = project_config["id"]

    resp = get_session().get(
        f"https://api.github.com/repos/{repo}/releases",
        params={"per_page": 50},
        headers=_headers(),
        timeout=30,
    )
    resp.raise_for_status()

    results = []
    for r in resp.json():
        published = r.get("published_at") or r.get("created_at", "")
        if since and published and published < since:
            break
        tag = r.get("tag_name", "")
        slug = tag.replace(".", "-").replace("/", "-")
        body = (r.get("body") or "")[:2000]
        links = [{"url": l.url, "kind": l.kind} for l in extract_links(body)]
        results.append({
            "id": f"{project_id}-gh-rel-{slug}",
            "source": "github",
            "kind": "release",
            "title": r.get("name") or tag,
            "url": r.get("html_url", ""),
            "author": (r.get("author") or {}).get("login", "unknown"),
            "state": "closed",
            "tag": tag,
            "created_at": r.get("created_at", ""),
            "updated_at": published,
            "body": body,
            "labels": [],
            "linked_resources": links,
            "llm_summary": None,
            "llm_status": "released",
        })

    logger.info(f"GitHub Releases: fetched {len(results)} for {repo}")
    return results


def crawl_milestones(project_config: dict, since: Optional[str] = None) -> list[dict]:
    """Fetch GitHub milestones via GraphQL."""
    gh_config = project_config.get("github", {})
    repo = gh_config.get("repo") or project_config.get("repo", "")
    if "/" not in repo:
        return []
    owner, repo_name = repo.split("/", 1)
    project_id = project_config["id"]

    data = _graphql(MILESTONES_QUERY, {"owner": owner, "repo": repo_name})
    results = []
    for m in data["repository"]["milestones"]["nodes"]:
        updated = m.get("updatedAt", "")
        if since and updated and updated < since:
            continue
        total = m["issues"]["totalCount"]
        closed = m["closedIssues"]["totalCount"]
        pct = int(closed / total * 100) if total else 0
        results.append({
            "id": f"{project_id}-gh-m{m['number']}",
            "source": "github",
            "kind": "milestone",
            "title": m["title"],
            "url": m["url"],
            "author": "community",
            "state": m["state"].lower(),
            "created_at": m.get("createdAt", ""),
            "updated_at": updated,
            "due_on": m.get("dueOn"),
            "body": (m.get("description") or "")[:2000],
            "labels": [],
            "linked_resources": [],
            "comment_count": 0,
            "milestone_progress": {"total": total, "closed": closed, "pct": pct},
            "llm_summary": None,
            "llm_status": "released" if m["state"] == "CLOSED" else "implementation",
        })

    logger.info(f"GitHub Milestones: fetched {len(results)} for {repo}")
    return results
