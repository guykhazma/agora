"""
Generate a digest for a project from existing proposals (no source re-crawl).
Called at the end of each crawl run, or run standalone:

  python scripts/generate_digest.py --project iceberg

Writes data/{project_id}/digest.json.
"""

from __future__ import annotations
import json
import logging
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).parent.parent
DATA_DIR = ROOT / "data"

logger = logging.getLogger(__name__)

# Types that shouldn't appear in the narrative digest
_NON_NARRATIVE_PREFIXES = ("[vote]", "[result]", "[announce]", "[announcement]")


def _to_iso(val) -> str:
    """Normalize various date formats (ISO, epoch int, RFC 2822) to ISO 8601."""
    if not val:
        return ""
    s = str(val).strip()
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).isoformat()
    except ValueError:
        pass
    try:
        epoch = int(s)
        return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()
    except (ValueError, TypeError, OSError):
        pass
    try:
        return parsedate_to_datetime(s).isoformat()
    except Exception:
        pass
    return ""

DIGEST_SYSTEM = """\
You write a short digest for an open-source community dashboard.

Rules (critical):
- Use ONLY facts that appear in the provided Items list (titles and summaries). Do not invent
  release numbers, product versions, dates, vendors, or events that are not explicitly there.
- If a detail is not in the items, omit it — never guess (e.g. do not mention "Spark 3.x" unless
  those words appear in an item).
- Highlights must paraphrase themes that are clearly supported by specific items; prefer naming
  the actual thread topics (REST spec, branch merge, TLS, etc.) over vague hype.

Output a JSON object with:
  - "summary": 2-3 sentences grounded strictly in the items
  - "highlights": up to 4 short strings tied to those items

Return ONLY valid JSON. No markdown.
"""


def _diversify(items: list[dict], per_source_cap: int = 8) -> list[dict]:
    """
    Cap the number of items per source so GitHub doesn't crowd out mailing list,
    community sync notes, YouTube, etc. Preserves recency order within each source.
    Result is re-sorted by updated_at so the final list stays chronological.
    """
    from collections import defaultdict
    buckets: dict = defaultdict(list)
    for p in items:
        buckets[p.get("source", "other")].append(p)
    capped = []
    for src_items in buckets.values():
        capped.extend(src_items[:per_source_cap])
    capped.sort(key=lambda p: _to_iso(p.get("updated_at") or ""), reverse=True)
    return capped


def _digest_candidates(proposals: list[dict], days: int) -> list[dict]:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    out = [
        p for p in proposals
        if _to_iso(p.get("updated_at")) >= cutoff
        and p.get("llm_summary")
        and not (p.get("title") or "").lower().startswith(_NON_NARRATIVE_PREFIXES)
    ]
    out.sort(key=lambda p: _to_iso(p.get("updated_at") or ""), reverse=True)
    return _diversify(out)


def _fallback_digest_pool(proposals: list[dict], limit: int = 25) -> list[dict]:
    """When nothing is 'recent', still summarize the latest activity with LLM summaries."""
    pool = [
        p for p in proposals
        if p.get("llm_summary")
        and not (p.get("title") or "").lower().startswith(_NON_NARRATIVE_PREFIXES)
    ]
    pool.sort(key=lambda p: _to_iso(p.get("updated_at") or ""), reverse=True)
    return pool[:limit]


def _extractive_digest_local(recent: list[dict], items_text: str) -> dict:
    """
    Build digest.json without cloud LLM (LocalNLPClient cannot run complete()).
    Uses sumy over the same item list text when available, else stitches summaries.
    """
    try:
        from llm.local_nlp import _sumy_summarize

        summary = _sumy_summarize(items_text[:8000], sentence_count=4)
    except Exception:
        summary = ""
    if not summary or len(summary.strip()) < 30:
        parts = [p.get("llm_summary", "").strip() for p in recent[:4] if p.get("llm_summary")]
        summary = " ".join(parts[:3]) if parts else "Recent activity across project sources."
    highlights: list[str] = []
    for p in recent[:4]:
        s = (p.get("llm_summary") or "").strip()
        if s:
            highlights.append((s[:100] + "…") if len(s) > 100 else s)
    if not highlights:
        highlights = [(p.get("title") or "Item")[:90] for p in recent[:4] if p.get("title")]
    return {"summary": summary[:900].strip(), "highlights": highlights[:4]}


def generate(project_id: str, llm_client) -> bool:
    proposals_path = DATA_DIR / project_id / "proposals.json"
    if not proposals_path.exists():
        return False

    data = json.loads(proposals_path.read_text())
    proposals = data.get("proposals", [])

    recent = _digest_candidates(proposals, 7)
    period = "last_7_days"
    if not recent:
        recent = _digest_candidates(proposals, 14)
        period = "last_14_days"
    if not recent:
        recent = _fallback_digest_pool(proposals, 25)
        period = "latest_activity"

    if not recent:
        logger.info(f"No proposals with summaries for digest ({project_id})")
        return False

    def _day(iso: str) -> str:
        if not iso:
            return ""
        try:
            return datetime.fromisoformat(iso.replace("Z", "+00:00")).date().isoformat()
        except ValueError:
            return ""

    dates = [_day(_to_iso(p.get("updated_at"))) for p in recent[:20]]
    dates = [d for d in dates if d]
    window_start = min(dates) if dates else ""
    window_end = max(dates) if dates else ""

    as_of = datetime.now(timezone.utc).date().isoformat()

    # Build a compact list for the LLM (newest first; each line dated for grounding)
    items_text = "\n".join(
        f"- ({_day(_to_iso(p.get('updated_at'))) or '?'}) [{p.get('llm_status', '?')}] "
        f"{p['title']}: {p.get('llm_summary', '')[:180]}"
        for p in recent[:20]
    )

    scope_hint = {
        "last_7_days": f"Calendar window: items were updated in the last ~7 days (today UTC: {as_of}).",
        "last_14_days": f"Calendar window: items were updated in the last ~14 days (today UTC: {as_of}).",
        "latest_activity": (
            "These are the most recently updated threads in the dataset; some may be older than "
            f"two weeks. Today UTC: {as_of}. Do NOT call them all 'this week' — say 'recent activity' "
            "or similar."
        ),
    }.get(period, f"Recent activity (today UTC: {as_of}).")
    user_msg = (
        f"Project: {project_id}\n"
        f"{scope_hint}\n"
        f"Item date range in this list: {window_start or '?'} to {window_end or '?'} (UTC dates).\n"
        f"Items:\n{items_text}"
    )

    digest: dict | None = None
    try:
        from llm.local_nlp import LocalNLPClient

        if isinstance(llm_client, LocalNLPClient):
            logger.info(
                "Digest: extractive fallback (LocalNLPClient has no complete()). "
                "For a narrative digest, use a cloud LLM key and run: "
                f"python scripts/generate_digest.py --project {project_id}"
            )
            digest = _extractive_digest_local(recent, items_text)
        else:
            raw = llm_client.complete(DIGEST_SYSTEM, user_msg, max_tokens=400, temperature=0)
            cleaned = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
            digest = json.loads(cleaned)
    except Exception as e:
        logger.warning(f"Digest generation failed for {project_id}: {e}")
        return False

    if not digest or not digest.get("summary"):
        logger.warning(f"Digest missing summary for {project_id}")
        return False

    digest["generated_at"] = datetime.now(timezone.utc).isoformat()
    digest["item_count"] = len(recent)
    digest["period"] = period
    if window_start and window_end:
        digest["coverage"] = {
            "from": window_start,
            "to": window_end,
            "thread_count": len(recent[:20]),
        }

    out = DATA_DIR / project_id / "digest.json"
    out.write_text(json.dumps(digest, indent=2))
    logger.info(f"Digest written: {out}")
    return True


if __name__ == "__main__":
    import argparse
    import sys

    try:
        from dotenv import load_dotenv
        load_dotenv(ROOT / ".env")
    except ImportError:
        pass

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    p = argparse.ArgumentParser(description="Regenerate digest.json from existing proposals (no source crawl)")
    p.add_argument("--project", default="iceberg", help="Project id (default: iceberg)")
    args = p.parse_args()

    sys.path.insert(0, str(ROOT))
    from llm.client import get_client  # noqa: E402
    ok = generate(args.project, get_client())
    sys.exit(0 if ok else 1)
