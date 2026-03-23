"""
Helpers for reading/writing Agora data files.

Data layout:
  data/
    projects.json              - index of all projects
    {project_id}/
      proposals.json           - all proposals (merged, deduplicated)
      state.json               - crawler state (last_crawled_at, etc.)
"""

from __future__ import annotations
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent.parent
DATA_DIR = ROOT / "data"

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# State helpers (incremental crawling)
# ---------------------------------------------------------------------------

def load_state(project_id: str) -> dict:
    path = DATA_DIR / project_id / "state.json"
    if path.exists():
        return json.loads(path.read_text())
    return {}


def save_state(project_id: str, state: dict):
    path = DATA_DIR / project_id / "state.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2))


def clear_project_outputs(project_id: str) -> None:
    """
    Remove crawl-generated JSON for a project so the next write is a clean slate.
    Used with crawl.py --reset (full re-ingest, no merge with old proposal ids).
    Keeps state.json — caller overwrites that separately.
    """
    d = DATA_DIR / project_id
    if not d.is_dir():
        return
    for name in ("proposals.json", "initiatives.json", "digest.json", "events.json"):
        p = d / name
        if p.exists():
            p.unlink()
            logger.info(f"Cleared {p.name} for fresh crawl")


# ---------------------------------------------------------------------------
# Proposals helpers
# ---------------------------------------------------------------------------

def load_proposals(project_id: str) -> list[dict]:
    path = DATA_DIR / project_id / "proposals.json"
    if path.exists():
        return json.loads(path.read_text()).get("proposals", [])
    return []


def _normalize_subject(title: str) -> str:
    """Strip Re:/Fwd: prefixes and brackets for deduplication."""
    import re
    t = title.strip()
    # Remove leading "Re: ", "Fwd: ", "Re[2]: " etc.
    t = re.sub(r'^(Re|Fwd|Fw)(\[\d+\])?:\s*', '', t, flags=re.IGNORECASE)
    return t.lower().strip()


def _dedup_mailing_list(items: list[dict]) -> list[dict]:
    """
    Mailing list threads on the same subject can appear multiple times across months
    (Pony Mail creates new thread entries each month for long-running discussions).
    Keep only the most recently active instance of each subject line.
    """
    import re
    ml_items = [i for i in items if i.get("source") == "mailing_list"]
    other_items = [i for i in items if i.get("source") != "mailing_list"]

    by_subject: dict[str, dict] = {}
    for item in ml_items:
        key = _normalize_subject(item.get("title", ""))
        if not key:
            other_items.append(item)
            continue
        existing = by_subject.get(key)
        if existing is None:
            by_subject[key] = item
        else:
            # Keep whichever has more content/recent activity
            # Merge comment counts (sum of all threads on this subject)
            existing_count = int(existing.get("comment_count") or 0)
            new_count = int(item.get("comment_count") or 0)
            # Use the most recently updated as the canonical record
            existing_updated = existing.get("updated_at", "")
            new_updated = item.get("updated_at", "")
            if new_updated > existing_updated:
                # New is more recent — use it but accumulate comment count
                item["comment_count"] = existing_count + new_count
                by_subject[key] = item
            else:
                existing["comment_count"] = existing_count + new_count

    deduped = list(by_subject.values())
    total = len(ml_items)
    kept = len(deduped)
    if total != kept:
        logger.info(f"Mailing list dedup: {total} → {kept} items ({total - kept} duplicate threads removed)")
    return other_items + deduped


def merge_proposals(existing: list[dict], new_items: list[dict]) -> list[dict]:
    """
    Merge new items into existing list.
    Deduplicates by id. New items win on all fields except llm_* if existing has them.
    Also deduplicates mailing list threads with the same subject line across months.
    """
    # Deduplicate mailing list threads by subject before merging
    new_items = _dedup_mailing_list(new_items)

    by_id: dict[str, dict] = {p["id"]: p for p in existing}

    for item in new_items:
        eid = item["id"]
        if eid in by_id:
            old = by_id[eid]
            # Preserve LLM enrichment + content hash from old if new doesn't have it
            if not item.get("llm_summary") and old.get("llm_summary"):
                item["llm_summary"] = old["llm_summary"]
                item["llm_status"] = old.get("llm_status")
                item["llm_key_points"] = old.get("llm_key_points", [])
                item["llm_topics"] = old.get("llm_topics", [])
            # Always preserve content hash so incremental runs don't re-summarize unchanged items
            if not item.get("_content_hash") and old.get("_content_hash"):
                item["_content_hash"] = old["_content_hash"]
            # Preserve google_doc append-delta anchors when the incoming row did not set them
            if old.get("_gdoc_len_at_summary") is not None and "_gdoc_len_at_summary" not in item:
                item["_gdoc_snap2048"] = old.get("_gdoc_snap2048")
                item["_gdoc_len_at_summary"] = old.get("_gdoc_len_at_summary")
        by_id[eid] = item

    # Sort: most recently updated first
    merged = sorted(by_id.values(), key=lambda x: x.get("updated_at", ""), reverse=True)
    return merged


def write_project_data(project_id: str, new_proposals: list[dict], config: dict):
    """Merge new proposals with existing and write to disk."""
    existing = load_proposals(project_id)
    merged = merge_proposals(existing, new_proposals)
    # Dedup mailing list threads by subject in the final merged set
    # (catches duplicates that were already in the existing store)
    merged = _dedup_mailing_list(merged)

    out_dir = DATA_DIR / project_id
    out_dir.mkdir(parents=True, exist_ok=True)

    proposals_path = out_dir / "proposals.json"
    proposals_path.write_text(json.dumps({
        "project_id": project_id,
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "total": len(merged),
        "proposals": merged,
    }, indent=2, default=str))

    logger.info(f"Wrote {len(merged)} proposals to {proposals_path}")

    # Rebuild projects index
    _rebuild_projects_index()


def _rebuild_projects_index():
    """Write data/projects.json with summary stats for all projects."""
    import yaml

    projects_dir = ROOT / "projects"
    index = []

    for yaml_path in sorted(projects_dir.glob("*.yaml")):
        if yaml_path.stem == "schema":
            continue
        with open(yaml_path) as f:
            cfg = yaml.safe_load(f)

        pid = cfg["id"]
        proposals_path = DATA_DIR / pid / "proposals.json"
        stats = {"total": 0, "by_status": {}}

        if proposals_path.exists():
            data = json.loads(proposals_path.read_text())
            proposals = data.get("proposals", [])
            stats["total"] = len(proposals)
            for p in proposals:
                s = p.get("llm_status") or "discussion"
                stats["by_status"][s] = stats["by_status"].get(s, 0) + 1

        state = load_state(pid)

        ml = cfg.get("mailing_list", {})
        ml_address = ml.get("address", "")
        ml_url = f"https://lists.apache.org/list.html?{ml_address}" if ml_address else ""

        yt = cfg.get("youtube", {})
        yt_channel_id = yt.get("channel_id", "")
        yt_url = f"https://www.youtube.com/channel/{yt_channel_id}" if yt_channel_id else ""

        slack = cfg.get("slack", {})

        index.append({
            "id": pid,
            "name": cfg.get("name", pid),
            "description": cfg.get("description", ""),
            # Image URL only; UI links the logo to `website` (or repo on GitHub).
            "logo": (cfg.get("logo") or "").strip(),
            "website": cfg.get("website", ""),
            "repo": cfg.get("repo", ""),
            "mailing_list_url": ml_url,
            "mailing_list_address": ml_address,
            "youtube_url": yt_url,
            "slack_url": slack.get("url", ""),
            "slack_channel": slack.get("channel", ""),
            "last_updated": state.get("last_crawled_at", ""),
            "stats": stats,
        })

    out = DATA_DIR / "projects.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"projects": index}, indent=2))
    logger.info(f"Rebuilt projects index: {len(index)} projects")
