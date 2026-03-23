#!/usr/bin/env python3
"""
Main crawler entry point.

Incremental crawling (default):
  data/<project>/state.json stores last_crawled_at. Each run passes this as
  `since` to GitHub, mailing list, YouTube, etc., so only new/updated items
  are fetched. The mailing list scans calendar months from that timestamp
  through the current month.

Full backfill / re-ingest:
  python scripts/crawl.py --project iceberg --reset
  Deletes proposals/initiatives/digest/events for that project, clears
  last_crawled_at, then re-fetches (no merge with old rows). Set
  mailing_list.history_start in the project YAML for list backfill depth.

Usage:
  python scripts/crawl.py                              # crawl all projects
  python scripts/crawl.py --project iceberg            # crawl one project
  python scripts/crawl.py --project iceberg --no-llm  # skip LLM enrichment
  python scripts/crawl.py --project iceberg --reset   # ignore checkpoint; full source pull
  python scripts/crawl.py --project iceberg --re-enrich  # re-run LLM on existing data (no re-crawl)
  python scripts/generate_digest.py --project iceberg  # digest only (needs LLM key for narrative)

Environment variables:
  GITHUB_TOKEN        required for GitHub crawling
  YOUTUBE_API_KEY     required for YouTube crawling (optional)
  LLM_PROVIDER        openai | anthropic | google | groq | github_models | ollama | local
  LLM_MODEL           model override
  LLM_API_KEY         provider API key (or set OPENAI_API_KEY etc.)
"""

from __future__ import annotations
import argparse
import logging
import sys
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import yaml

# Load .env for local development (no-op in CI where vars are set directly)
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env")
except ImportError:
    pass  # dotenv not installed — env vars must be set manually

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from crawlers import github_crawler, mailing_list_crawler
from crawlers.doc_crawler import enrich_proposal_with_docs, fetch_doc_text, extract_doc_id, extract_doc_title
from scripts.update_data import clear_project_outputs, load_state, save_state, write_project_data
from llm.client import LLMClient, content_hash

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# google_doc append-only delta: prefix must match; new bytes are full[cov:]
GDOC_SNAP_PREFIX = 2048
GDOC_DELTA_MAX_CHARS = 6000


def load_project_config(project_id: str) -> dict:
    path = ROOT / "projects" / f"{project_id}.yaml"
    with open(path) as f:
        return yaml.safe_load(f)


def list_project_ids() -> list[str]:
    return [p.stem for p in (ROOT / "projects").glob("*.yaml") if p.stem != "schema"]


def _llm_output_looks_incomplete(proposal: dict, old: dict) -> bool:
    """True if stored LLM fields look truncated or too thin for the content."""
    title_lower = (proposal.get("title") or "").lower()
    is_announcement = title_lower.startswith("[announce")
    body_len = len(proposal.get("body") or "")
    summary = (old.get("llm_summary") or "") if old else ""
    has_topics = bool(old.get("llm_topics")) if old else False
    if not is_announcement and body_len > 200 and len(summary) < 60:
        return True
    if not is_announcement and body_len > 200 and not has_topics:
        return True
    return False


def _needs_summarization(proposal: dict, existing_by_id: dict) -> bool:
    """
    Return True if this proposal needs LLM summarization.
    Uses a content hash to avoid re-summarizing unchanged items.
    Also re-summarizes items whose previous output was incomplete
    (e.g. truncated by a rate-limit retry that returned partial JSON).

    Known docs / community sync rows are re-fetched each crawl with llm_* unset on the
    *new* dict; we compare _content_hash to the prior snapshot so unchanged docs skip LLM.
    """
    old = existing_by_id.get(proposal["id"])

    # Force re-summarize (opt-in per proposal)
    if proposal.get("_force_summarize"):
        return True

    new_hash = _compute_content_hash(proposal)

    # Prior run still valid — even if this crawl's row has no llm_summary yet
    if old and old.get("llm_summary") and old.get("_content_hash") == new_hash:
        if _llm_output_looks_incomplete(proposal, old):
            return True
        return False

    if not old:
        return True

    if not old.get("llm_summary"):
        return True

    if old.get("_content_hash", "") != new_hash:
        return True

    if _llm_output_looks_incomplete(proposal, old):
        return True

    return False


def _gdoc_delta_excerpt(full: str, old: dict | None) -> str | None:
    """
    If the fetched doc only grew at the end since last summary (unchanged prefix), return
    the new slice for summarize_doc_delta; otherwise None (use full thread/doc prompt).
    """
    if not full or not old or not old.get("llm_summary"):
        return None
    snap = old.get("_gdoc_snap2048")
    cov = old.get("_gdoc_len_at_summary")
    if snap is None or cov is None:
        return None
    try:
        cov = int(cov)
    except (TypeError, ValueError):
        return None
    if cov <= 0 or len(full) <= cov:
        return None
    if len(full) < len(snap) or full[: len(snap)] != snap:
        return None
    delta = full[cov : cov + GDOC_DELTA_MAX_CHARS]
    return delta if delta.strip() else None


def _set_google_doc_summary_anchor(p: dict, doc_content: str) -> None:
    """Persist prefix + fetched length for append-only delta summarization."""
    if p.get("source") != "google_doc" or not doc_content:
        return
    p["_gdoc_snap2048"] = doc_content[:GDOC_SNAP_PREFIX]
    p["_gdoc_len_at_summary"] = len(doc_content)


def _compute_content_hash(proposal: dict, doc_content: str | None = None) -> str:
    """Hash the content that matters for summarization."""
    if proposal.get("source") == "google_doc":
        blob = doc_content if doc_content is not None else (proposal.get("_doc_content") or "")
        if blob:
            return content_hash(blob)
    text = (
        (proposal.get("body") or "")
        + str(proposal.get("comment_count", 0))
        + (proposal.get("_transcript") or "")
        + (proposal.get("_doc_content") or "")
    )
    return content_hash(text)


def _default_delay(provider: str) -> float:
    """Seconds to sleep between LLM calls. Groq free tier: ~6k TPM → need ~10s gap."""
    env_override = os.environ.get("LLM_REQUEST_DELAY")
    if env_override is not None:
        return float(env_override)
    if provider == "groq":
        return 10.0
    if provider in ("ollama", "llama_cpp"):
        return 0.0   # local — no rate limit
    if provider == "github_models":
        return 1.0   # 150 req/hr → ~24s safe, but incremental runs are small
    return 0.5


def _can_handle_locally(proposal: dict) -> bool:
    """
    Return True if this proposal can be adequately summarized with local NLP,
    saving cloud LLM tokens for items that truly benefit from it.

    Local NLP is sufficient for:
      - Vote threads (structured +1/-1 parsing is exact)
      - Announcements (title says it all; body is usually short)
      - Items with very short bodies (<300 chars) — not enough content for LLM to add value
      - Items with no body and no replies at all
    """
    title_lower = (proposal.get("title") or "").lower()
    body_len    = len(proposal.get("body") or "")
    replies     = proposal.get("_emails") or []

    if proposal.get("vote_data"):
        return True   # vote analysis is handled structurally, no LLM needed
    if title_lower.startswith("[announce"):
        return True   # announcement — title + short body is sufficient
    if title_lower.startswith("[result]"):
        return True   # vote result announcement
    if proposal.get("kind") == "release":
        return True   # release notes are self-describing; title + tag sufficient
    if proposal.get("kind") == "milestone":
        return True   # milestones are structural (title + progress); LLM adds little
    if body_len < 300 and not replies:
        return True   # no substantive content to summarize
    return False


def enrich_with_llm(proposals: list[dict], existing_by_id: dict, llm_client) -> list[dict]:
    """
    Add LLM summary/status to proposals that need it.

    Strategy (local-first):
      1. Items that don't need re-summarization → carry over existing summary
      2. Items handled well by local NLP (votes, announcements, thin content) → local NLP
      3. Only rich discussion threads + docs + videos → cloud LLM

    This minimises cloud LLM calls to stay within free-tier quotas.
    """
    from llm.local_nlp import LocalNLPClient
    local_client = LocalNLPClient()

    total = len(proposals)
    skipped = enriched = local_enriched = failed = 0
    llm_needed = sum(
        1 for p in proposals
        if _needs_summarization(p, existing_by_id) and not _can_handle_locally(p)
    )
    if llm_needed:
        delay = _default_delay(llm_client.provider)
        est_s = int(llm_needed * max(delay, 0.5))
        est_str = f"~{est_s//60}m{est_s%60:02d}s" if est_s >= 60 else f"~{est_s}s"
        logger.info(f"LLM enrichment: {llm_needed} items via {llm_client.provider} ({est_str} estimated)")

    for idx, p in enumerate(proposals):
        if not _needs_summarization(p, existing_by_id):
            # Carry over existing summary from old record
            old = existing_by_id[p["id"]]
            p["llm_summary"]    = old.get("llm_summary")
            p["llm_status"]     = old.get("llm_status")
            p["llm_key_points"] = old.get("llm_key_points", [])
            p["llm_topics"]     = old.get("llm_topics", [])
            p["llm_title"]      = old.get("llm_title", "")
            p["_content_hash"]  = old.get("_content_hash", "")
            if old.get("_gdoc_len_at_summary") is not None:
                p["_gdoc_snap2048"] = old.get("_gdoc_snap2048")
                p["_gdoc_len_at_summary"] = old.get("_gdoc_len_at_summary")
            p.pop("_has_transcript", None)
            p.pop("_force_summarize", None)
            skipped += 1
            continue

        try:
            source       = p.get("source")
            replies      = p.pop("_emails", [])
            doc_content  = p.pop("_doc_content", "")
            transcript   = p.pop("_transcript", "")
            has_transcript = p.pop("_has_transcript", bool(transcript))
            p.pop("_force_summarize", None)

            # ── Local NLP path (free, no API call) ──
            if source != "youtube" and _can_handle_locally(p):
                result = local_client.summarize_thread(
                    title=p["title"],
                    body=p.get("body", ""),
                    replies=replies,
                    doc_content=doc_content,
                    vote_data=p.get("vote_data"),
                )
                p["llm_summary"]    = result.get("summary", "")
                p["llm_status"]     = result.get("status") or "discussion"
                p["llm_key_points"] = result.get("key_points", [])
                p["llm_topics"]     = result.get("topics", [])
                p["_content_hash"]  = _compute_content_hash(p, doc_content)
                _set_google_doc_summary_anchor(p, doc_content)
                local_enriched += 1
                continue

            # ── Cloud / local-LLM path ──
            enriched += 1
            title_hint = (p.get("title") or "")[:60]
            used_delta = False

            if source == "youtube":
                p["has_transcript"] = has_transcript
                result = llm_client.summarize_video(
                    title=p["title"],
                    description=p.get("body", ""),
                    transcript=transcript,
                )
                p["llm_summary"]    = result.get("summary", "")
                p["llm_key_points"] = result.get("key_points", [])
                p["llm_topics"]     = result.get("topics", [])
                p["llm_status"]     = "released"
            else:
                old_rec = existing_by_id.get(p["id"])
                delta_excerpt = None
                if (
                    source == "google_doc"
                    and doc_content
                    and isinstance(llm_client, LLMClient)
                ):
                    delta_excerpt = _gdoc_delta_excerpt(doc_content, old_rec)
                if delta_excerpt:
                    used_delta = True
                    result = llm_client.summarize_doc_delta(
                        title=p["title"],
                        previous_summary=old_rec.get("llm_summary") or "",
                        previous_key_points=old_rec.get("llm_key_points") or [],
                        delta_excerpt=delta_excerpt,
                    )
                else:
                    result = llm_client.summarize_thread(
                        title=p["title"],
                        body=p.get("body", ""),
                        replies=replies,
                        doc_content=doc_content,
                        vote_data=p.get("vote_data"),
                    )
                p["llm_summary"]    = result.get("summary", "")
                p["llm_status"]     = result.get("status") or "discussion"
                p["llm_key_points"] = result.get("key_points", [])
                p["llm_topics"]     = result.get("topics", [])

            if result.get("clean_title"):
                p["llm_title"] = result["clean_title"]

            suffix = " (delta)" if used_delta else ""
            logger.info(f"  LLM [{enriched}/{llm_needed}] {title_hint}{suffix}")

            p["_content_hash"] = _compute_content_hash(p, doc_content)
            _set_google_doc_summary_anchor(p, doc_content)

            delay = _default_delay(llm_client.provider)
            if delay > 0:
                time.sleep(delay)

        except Exception as e:
            logger.warning(f"LLM enrichment failed for {p['id']}: {e}")
            p.pop("_emails", None)
            p.pop("_doc_content", None)
            p.pop("_transcript", None)
            failed += 1

    logger.info(
        f"LLM enrichment: {enriched} cloud, {local_enriched} local, "
        f"{skipped} skipped (unchanged), {failed} failed / {total} total"
    )
    return proposals


def _strip_internal_fields(proposals: list[dict]) -> list[dict]:
    """Remove fields that are only used during crawl pipeline."""
    for p in proposals:
        p.pop("_emails", None)
        p.pop("_doc_content", None)
        p.pop("_transcript", None)
        p.pop("_force_summarize", None)
    return proposals


def crawl_project(project_id: str, use_llm: bool = True):
    config = load_project_config(project_id)
    state = load_state(project_id)
    since = state.get("last_crawled_at")

    mode = "incremental" if since else "full backfill"
    logger.info(f"=== Crawling {project_id} [{mode}] — LLM={'on' if use_llm else 'off'} ===")
    if since:
        logger.info(f"  Checkpoint: fetching items updated since {since[:10]}")

    # Load existing proposals for hash-based dedup
    from scripts.update_data import load_proposals
    existing = load_proposals(project_id)
    existing_by_id = {p["id"]: p for p in existing}

    new_proposals = []

    # ── Parallel source crawling ──────────────────────────────────────────────
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from crawlers import youtube_crawler, github_discussions_crawler, calendar_crawler

    def _crawl_github():
        return ("GitHub issues/PRs", github_crawler.crawl(config, since=since))

    def _crawl_mailing_list():
        return ("Mailing list", mailing_list_crawler.crawl(config, since=since))

    def _crawl_youtube():
        if not config.get("youtube"):
            return ("YouTube", [])
        return ("YouTube", youtube_crawler.crawl(config, since=since))

    def _crawl_discussions():
        if not (config.get("github_discussions") or config.get("github", {}).get("repo")):
            return ("GitHub Discussions", [])
        return ("GitHub Discussions", github_discussions_crawler.crawl(config, since=since))

    def _crawl_releases():
        if not (config.get("github", {}).get("repo") or config.get("repo")):
            return ("GitHub Releases", [])
        return ("GitHub Releases", github_crawler.crawl_releases(config, since=since))

    def _crawl_milestones():
        if not (config.get("github", {}).get("repo") or config.get("repo")):
            return ("GitHub Milestones", [])
        return ("GitHub Milestones", github_crawler.crawl_milestones(config, since=since))

    def _crawl_calendar():
        if config.get("calendars") or config.get("calendar", {}).get("ics_url"):
            calendar_crawler.crawl_events(config, project_id)
        return ("Calendar", [])

    tasks = [
        _crawl_github,
        _crawl_mailing_list,
        _crawl_youtube,
        _crawl_discussions,
        _crawl_releases,
        _crawl_milestones,
        _crawl_calendar,
    ]

    logger.info(f"  Launching {len(tasks)} source crawlers in parallel…")
    with ThreadPoolExecutor(max_workers=len(tasks)) as executor:
        futures = {executor.submit(fn): fn.__name__ for fn in tasks}
        completed = 0
        for future in as_completed(futures):
            completed += 1
            try:
                label, items = future.result()
                new_proposals.extend(items)
                status = f"{len(items)} items" if items else "0 items (skipped or up-to-date)"
                logger.info(f"  [{completed}/{len(tasks)}] {label}: {status}")
            except Exception as e:
                logger.error(f"  [{completed}/{len(tasks)}] {futures[future]} failed: {e}")

    # Known docs — always crawl these as first-class proposals
    for doc_cfg in config.get("known_docs", []):
        doc_url = doc_cfg.get("url", "")
        doc_title = doc_cfg.get("title", "")
        if not doc_url:
            continue
        doc_id = extract_doc_id(doc_url)
        if not doc_id:
            continue
        proposal_id = f"{project_id}-doc-{doc_id[:12]}"
        text = fetch_doc_text(doc_url, max_chars=8000)
        if not text:
            logger.warning(f"Could not fetch known doc: {doc_url}")
            continue
        # Use configured title, fallback to first line of the doc itself
        resolved_title = doc_title or extract_doc_title(text) or f"Doc: {doc_id[:20]}"
        from crawlers.link_extractor import extract_links
        links = [{"url": l.url, "kind": l.kind} for l in extract_links(text)]
        new_proposals.append({
            "id": proposal_id,
            "source": "google_doc",
            "kind": "document",
            "title": resolved_title,
            "url": doc_url,
            "author": "community",
            "state": "open",
            "created_at": "",
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "body": text[:2000],
            "labels": [],
            "linked_resources": links,
            "llm_summary": None,
            "llm_status": None,
            "comment_count": 0,
            "_doc_content": text,
            # Re-summarization is driven by content hash — only runs when the doc text changes
        })
        logger.info(f"Fetched known doc: {doc_title or doc_url}")

    # Fetch Google Doc content for items that have doc links
    for p in new_proposals:
        if p.get("linked_resources") and p.get("source") != "google_doc":
            enrich_proposal_with_docs(p)

    # LLM enrichment
    if use_llm and new_proposals:
        from llm.client import get_client
        client = get_client()
        new_proposals = enrich_with_llm(new_proposals, existing_by_id, client)
    else:
        _strip_internal_fields(new_proposals)

    # Write merged data
    write_project_data(project_id, new_proposals, config)

    # Initiative clustering
    logger.info("  Building initiative clusters…")
    from scripts.build_initiatives import build as build_initiatives
    if use_llm:
        from llm.client import get_client as _get_llm
        n_initiatives = build_initiatives(project_id, _get_llm())
    else:
        n_initiatives = build_initiatives(project_id)
    logger.info(f"  Initiatives: {n_initiatives} clusters written")

    # Digest
    if use_llm:
        logger.info("  Generating digest…")
        from llm.client import get_client as _get_client
        from scripts.generate_digest import generate as generate_digest
        if not generate_digest(project_id, _get_client()):
            logger.warning(
                "  Digest was not written — see logs (cloud LLM error, or use generate_digest with a key; "
                "local NLP now uses an extractive fallback)."
            )

    # Update state
    state["last_crawled_at"] = datetime.now(timezone.utc).isoformat()
    save_state(project_id, state)

    n_total = len(new_proposals)
    logger.info(
        f"=== Done {project_id}: {n_total} proposals, {n_initiatives} initiatives"
        + (f", digest updated" if use_llm else " (no LLM — run again with API key for summaries)")
        + " ==="
    )


def re_enrich_project(project_id: str):
    """Re-run LLM enrichment on existing proposals without re-crawling any sources."""
    from scripts.update_data import load_proposals, write_project_data
    config = load_project_config(project_id)

    proposals = load_proposals(project_id)
    if not proposals:
        logger.error(f"No proposals found for {project_id} — run a crawl first")
        return

    logger.info(f"=== Re-enriching {project_id}: {len(proposals)} existing proposals ===")

    # Strip all existing LLM fields + content hashes so every item is re-processed
    for p in proposals:
        p.pop("llm_summary", None)
        p.pop("llm_status", None)
        p.pop("llm_key_points", None)
        p.pop("llm_topics", None)
        p.pop("llm_title", None)
        p.pop("_content_hash", None)
        p.pop("_gdoc_snap2048", None)
        p.pop("_gdoc_len_at_summary", None)

    from llm.client import get_client as _get_llm
    llm_client = _get_llm()
    proposals = enrich_with_llm(proposals, {}, llm_client)
    _strip_internal_fields(proposals)
    write_project_data(project_id, proposals, config)

    logger.info("  Building initiative clusters…")
    from scripts.build_initiatives import build as build_initiatives
    n_initiatives = build_initiatives(project_id, llm_client)
    logger.info(f"  Initiatives: {n_initiatives} clusters written")

    logger.info("  Generating digest…")
    from scripts.generate_digest import generate as generate_digest
    if not generate_digest(project_id, llm_client):
        logger.warning(
            "  Digest was not written — check logs (e.g. cloud LLM JSON parse failure, or no items with llm_summary)."
        )

    logger.info(f"=== Re-enrichment done: {len(proposals)} proposals, {n_initiatives} initiatives ===")


def main():
    parser = argparse.ArgumentParser(description="Agora crawler")
    parser.add_argument("--project", help="Project ID to crawl (default: all)")
    parser.add_argument("--no-llm", action="store_true", help="Skip LLM enrichment")
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Fresh crawl: delete proposals/initiatives/digest/events, clear state, re-fetch all sources",
    )
    parser.add_argument(
        "--re-enrich",
        action="store_true",
        help="Re-run LLM enrichment on existing proposals without re-crawling sources (useful to upgrade quality or switch models)",
    )
    args = parser.parse_args()

    project_ids = [args.project] if args.project else list_project_ids()
    if not project_ids:
        logger.error("No projects found in projects/")
        sys.exit(1)

    for pid in project_ids:
        if args.re_enrich:
            re_enrich_project(pid)
        else:
            if args.reset:
                clear_project_outputs(pid)
                save_state(pid, {"last_crawled_at": None})
                logger.info(f"Fresh crawl for {pid}: cleared cached data and reset state")
            crawl_project(pid, use_llm=not args.no_llm)


if __name__ == "__main__":
    main()
