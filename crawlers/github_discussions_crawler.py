"""
GitHub Discussions crawler.
Fetches discussions from a GitHub repository using the GraphQL API.
Incremental: skips items older than `since` (no built-in filterBy, uses manual date check).

Config key: `github_discussions.repo` (e.g. "apache/iceberg")
Falls back to `github.repo` if `github_discussions` section is not present.

Output format:
  id:     "{project_id}-gh-d{number}"   (d prefix = discussion, distinct from issues/PRs)
  source: "github"
  kind:   "discussion"
  state:  "open" | "closed"  (closed = has an accepted answer)
"""

from __future__ import annotations
import logging
from datetime import datetime, timezone
from typing import Optional

from crawlers.github_crawler import _graphql
from crawlers.link_extractor import extract_links

logger = logging.getLogger(__name__)

DISCUSSIONS_QUERY = """
query($owner: String!, $repo: String!, $after: String) {
  repository(owner: $owner, name: $repo) {
    discussions(
      first: 100,
      after: $after,
      orderBy: {field: UPDATED_AT, direction: DESC}
    ) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        title
        url
        body
        createdAt
        updatedAt
        author { login }
        category { name }
        answer { id }
        comments(first: 50) {
          nodes { body author { login } createdAt }
        }
      }
    }
  }
}
"""

MAX_PAGES = 5


def crawl(config: dict, since: Optional[str] = None) -> list[dict]:
    """Fetch GitHub discussions for the project."""
    project_id = config.get("id", "unknown")

    # Resolve repo: prefer github_discussions.repo, fall back to github.repo
    gd_cfg = config.get("github_discussions", {})
    repo_str = gd_cfg.get("repo") or config.get("github", {}).get("repo", "")
    if not repo_str:
        logger.warning("github_discussions: no repo configured, skipping")
        return []

    if "/" not in repo_str:
        logger.error(f"github_discussions: invalid repo format '{repo_str}' (expected 'owner/name')")
        return []

    owner, repo = repo_str.split("/", 1)
    since_dt: Optional[datetime] = None
    if since:
        try:
            since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
        except ValueError:
            pass

    results: list[dict] = []
    cursor: Optional[str] = None

    for page in range(MAX_PAGES):
        data = _graphql(DISCUSSIONS_QUERY, {"owner": owner, "repo": repo, "after": cursor})
        discussions = data["repository"]["discussions"]
        nodes = discussions["nodes"]

        for node in nodes:
            updated = node.get("updatedAt", "")
            if since_dt and updated:
                try:
                    node_dt = datetime.fromisoformat(updated.replace("Z", "+00:00"))
                    if node_dt < since_dt:
                        # Items are sorted DESC by updatedAt; can stop early
                        return results
                except ValueError:
                    pass

            results.append(_parse_discussion(node, project_id))

        page_info = discussions["pageInfo"]
        if not page_info["hasNextPage"]:
            break
        cursor = page_info["endCursor"]

    logger.info(f"GitHub Discussions: fetched {len(results)} items from {owner}/{repo}")
    return results


def _parse_discussion(node: dict, project_id: str) -> dict:
    comments = node.get("comments", {}).get("nodes", [])
    all_text = (node.get("body") or "") + "\n".join(c.get("body", "") for c in comments)
    self_url = (node.get("url") or "").rstrip("/")
    links = [
        {"url": l.url, "kind": l.kind}
        for l in extract_links(all_text)
        if l.url.rstrip("/") != self_url
    ]

    has_answer = node.get("answer") is not None
    state = "closed" if has_answer else "open"

    return {
        "id": f"{project_id}-gh-d{node['number']}",
        "source": "github",
        "kind": "discussion",
        "number": node["number"],
        "title": node["title"],
        "url": node["url"],
        "author": (node.get("author") or {}).get("login", "unknown"),
        "state": state,
        "created_at": node.get("createdAt", ""),
        "updated_at": node.get("updatedAt", ""),
        "body": (node.get("body") or "")[:2000],
        "labels": [],
        "category": (node.get("category") or {}).get("name", ""),
        "has_answer": has_answer,
        "comment_count": len(comments),
        "linked_resources": links,
        "llm_summary": None,
        "llm_status": None,
    }
