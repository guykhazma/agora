#!/usr/bin/env python3
"""
Build lightweight, derived site data from the canonical data/<id>/proposals.json.

This runs at DEPLOY time (see .github/workflows/deploy.yml) — it does NOT touch the
crawl/merge path, so the autonomous crawler stays simple and proven. Nothing here is
committed to git; it is regenerated on every deploy from whatever proposals.json the
crawler produced.

Outputs per project:
  data/<id>/index.json   Slim rows for the dashboard's list/feed/home views. Same
                         shape as proposals.json rows minus the heavy `body` and
                         internal `_*` fields, plus a short `body_preview` for search.
                         The frontend loads this instead of the full proposals.json;
                         the full `body` is lazy-loaded only when an item is opened.
  data/<id>/feed.xml     RSS 2.0 feed of recent activity — a stable, subscribable URL
                         that refreshes every deploy. Free, static, no server.

Usage:
  python scripts/build_site_data.py                 # all projects with a proposals.json
  python scripts/build_site_data.py --project spark # one project
"""

from __future__ import annotations
import argparse
import json
import logging
from datetime import datetime, timezone
from email.utils import format_datetime, parsedate_to_datetime
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).parent.parent
DATA_DIR = ROOT / "data"

logger = logging.getLogger(__name__)

# Fields dropped from index.json rows (heavy content or crawler-internal bookkeeping).
# `body` is the single biggest field (~40% of proposals.json) and is only needed when a
# single item is opened, so it is lazy-loaded from proposals.json on demand instead.
_INDEX_DROP_FIELDS = {
    "body",
    "_content_hash",
    "_gdoc_snap2048",
    "_gdoc_len_at_summary",
    "_doc_content",
    "_emails",
}
_BODY_PREVIEW_CHARS = 280
_FEED_MAX_ITEMS = 40


def _to_iso(val) -> str:
    """Normalize ISO / epoch / RFC 2822 to ISO 8601 (empty string if unparseable)."""
    if not val:
        return ""
    s = str(val).strip()
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).isoformat()
    except ValueError:
        pass
    try:
        return datetime.fromtimestamp(int(s), tz=timezone.utc).isoformat()
    except (ValueError, TypeError, OSError):
        pass
    try:
        return parsedate_to_datetime(s).isoformat()
    except Exception:
        return ""


def _slim_row(p: dict) -> dict:
    """Drop heavy/internal fields; keep a short body preview so search still works."""
    row = {k: v for k, v in p.items() if k not in _INDEX_DROP_FIELDS}
    body = p.get("body") or ""
    if body:
        preview = body[:_BODY_PREVIEW_CHARS]
        row["body_preview"] = preview + "…" if len(body) > _BODY_PREVIEW_CHARS else preview
    return row


def build_index(project_id: str) -> bool:
    """Write data/<id>/index.json from proposals.json. Returns True on success."""
    proposals_path = DATA_DIR / project_id / "proposals.json"
    if not proposals_path.exists():
        logger.info(f"[{project_id}] no proposals.json — skipping index")
        return False

    data = json.loads(proposals_path.read_text())
    proposals = data.get("proposals", [])
    slim = [_slim_row(p) for p in proposals]

    out = DATA_DIR / project_id / "index.json"
    payload = {
        "project_id": project_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total": len(slim),
        "proposals": slim,
    }
    out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))

    full_kb = proposals_path.stat().st_size / 1024
    slim_kb = out.stat().st_size / 1024
    saved = (1 - slim_kb / full_kb) * 100 if full_kb else 0
    logger.info(
        f"[{project_id}] index.json: {len(slim)} rows, "
        f"{slim_kb:.0f}KB (from {full_kb:.0f}KB, -{saved:.0f}%)"
    )
    return True


def _rfc822(iso: str) -> str:
    """ISO 8601 → RFC 822 for RSS pubDate. Empty string if unparseable."""
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return format_datetime(dt)
    except (ValueError, AttributeError):
        return ""


def _project_meta(project_id: str) -> dict:
    """Pull name/website/description from data/projects.json (no YAML dep at deploy time)."""
    projects_json = DATA_DIR / "projects.json"
    if projects_json.exists():
        try:
            for pr in json.loads(projects_json.read_text()).get("projects", []):
                if pr.get("id") == project_id:
                    return pr
        except Exception:
            pass
    return {"id": project_id, "name": project_id}


def build_feed(project_id: str) -> bool:
    """Write data/<id>/feed.xml — RSS 2.0 of the most recent activity."""
    proposals_path = DATA_DIR / project_id / "proposals.json"
    if not proposals_path.exists():
        return False

    proposals = json.loads(proposals_path.read_text()).get("proposals", [])
    recent = sorted(
        (p for p in proposals if p.get("url") and p.get("title")),
        key=lambda p: _to_iso(p.get("updated_at") or ""),
        reverse=True,
    )[:_FEED_MAX_ITEMS]
    if not recent:
        return False

    meta = _project_meta(project_id)
    name = meta.get("name") or project_id
    site = meta.get("website") or f"https://github.com/{meta.get('repo', '')}"

    # Use the digest summary as the channel description when available.
    desc = f"Recent activity across {name} — proposals, votes, releases, and discussions."
    digest_path = DATA_DIR / project_id / "digest.json"
    if digest_path.exists():
        try:
            summary = json.loads(digest_path.read_text()).get("summary")
            if summary:
                desc = summary
        except Exception:
            pass

    now822 = format_datetime(datetime.now(timezone.utc))
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<rss version="2.0"><channel>',
        f"<title>{escape(name)} — Agōra</title>",
        f"<link>{escape(site)}</link>",
        f"<description>{escape(desc)}</description>",
        f"<lastBuildDate>{now822}</lastBuildDate>",
    ]
    for p in recent:
        summary = (p.get("llm_summary") or p.get("body") or "")[:500]
        pub = _rfc822(_to_iso(p.get("updated_at") or ""))
        lines.append("<item>")
        lines.append(f"<title>{escape(p['title'])}</title>")
        lines.append(f"<link>{escape(p['url'])}</link>")
        lines.append(f'<guid isPermaLink="false">{escape(str(p.get("id") or p["url"]))}</guid>')
        if pub:
            lines.append(f"<pubDate>{pub}</pubDate>")
        if p.get("source"):
            lines.append(f"<category>{escape(str(p['source']))}</category>")
        if summary:
            lines.append(f"<description>{escape(summary)}</description>")
        lines.append("</item>")
    lines.append("</channel></rss>")

    out = DATA_DIR / project_id / "feed.xml"
    out.write_text("\n".join(lines), encoding="utf-8")
    logger.info(f"[{project_id}] feed.xml: {len(recent)} items")
    return True


def build(project_id: str) -> None:
    build_index(project_id)
    build_feed(project_id)


def _all_project_ids() -> list[str]:
    """Every project that has a proposals.json (avoids a YAML dependency at deploy time)."""
    if not DATA_DIR.exists():
        return []
    return sorted(
        d.name for d in DATA_DIR.iterdir()
        if d.is_dir() and (d / "proposals.json").exists()
    )


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    ap = argparse.ArgumentParser(description="Build derived site data (index.json + feed.xml)")
    ap.add_argument("--project", help="Project id (default: all with a proposals.json)")
    args = ap.parse_args()

    ids = [args.project] if args.project else _all_project_ids()
    if not ids:
        logger.warning("No projects with proposals.json found under data/")
        return
    for pid in ids:
        build(pid)


if __name__ == "__main__":
    main()
