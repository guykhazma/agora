"""
Apache Pony Mail crawler.
Fetches mailing list threads from the Apache Pony Mail REST API.

Incremental runs: `since` is last crawl time — only months from that timestamp’s
calendar month through “now” are scanned (fast follow-ups).

Full / backfill: when `since` is None (empty state or `crawl.py --reset`), the
start month is `mailing_list.history_start` (YYYY-MM) if set, otherwise 36 months
ago. Set `history_start` in the project YAML for complete list history.
"""

from __future__ import annotations
import logging
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Optional
import requests

from crawlers.link_extractor import extract_links

logger = logging.getLogger(__name__)

PONY_MAIL_BASE = "https://lists.apache.org/api"

PROPOSAL_SUBJECTS = ["[discuss]", "[proposal]", "[rfc]", "[vote]", "[spec]", "[announce]", "[result]"]


def _epoch_to_iso(val) -> str:
    """Convert epoch int, RFC 2822, or ISO string to ISO 8601."""
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
    return s


def _is_proposal(subject: str) -> bool:
    lower = subject.lower()
    return any(tag in lower for tag in PROPOSAL_SUBJECTS)


def _fetch_month(domain: str, list_name: str, year: int, month: int) -> list[dict]:
    """Fetch thread index for a single month using d=YYYY-MM format."""
    month_str = f"{year}-{month:02d}"
    url = f"{PONY_MAIL_BASE}/stats.lua?list={list_name}&domain={domain}&d={month_str}"
    resp = requests.get(url, timeout=30)
    if resp.status_code in (404, 400):
        logger.debug(f"No data for {month_str} ({resp.status_code})")
        return []
    resp.raise_for_status()
    data = resp.json()
    # Pony Mail returns threads in "thread_struct" or flat "emails"
    return data.get("thread_struct", []) or data.get("emails", [])


def _collect_child_mids(node, seen: set) -> list[str]:
    """Recursively collect all child email IDs from a thread tree node."""
    mids = []
    children = node.get("children", [])
    for child in children:
        mid = child.get("mid") or child.get("tid") or child.get("id")
        if mid and mid not in seen:
            seen.add(mid)
            mids.append(mid)
            mids.extend(_collect_child_mids(child, seen))
    return mids


def _fetch_email(mid: str) -> dict:
    """Fetch a single email by its message ID."""
    url = f"{PONY_MAIL_BASE}/thread.lua?id={mid}"
    resp = requests.get(url, timeout=30)
    if resp.status_code in (404, 400):
        return {}
    resp.raise_for_status()
    data = resp.json()
    emails = data.get("emails", [])
    return emails[0] if emails else {}


def _fetch_thread(thread_id: str) -> list[dict]:
    """Fetch all emails in a thread (root + replies)."""
    url = f"{PONY_MAIL_BASE}/thread.lua?id={thread_id}"
    resp = requests.get(url, timeout=30)
    if resp.status_code in (404, 400):
        return []
    resp.raise_for_status()
    data = resp.json()

    root_emails = data.get("emails", [])
    if not root_emails:
        return []

    root = root_emails[0]
    all_emails = [root]

    # Collect child message IDs from the tree (limit to 8 replies to keep API calls manageable)
    seen = {root.get("mid") or root.get("id") or thread_id}
    child_mids = _collect_child_mids(root, seen)[:8]

    for mid in child_mids:
        try:
            child_email = _fetch_email(mid)
            if child_email:
                all_emails.append(child_email)
        except Exception:
            pass  # individual reply fetch failure is non-fatal

    return all_emails


def _parse_vote(emails: list[dict]) -> dict:
    """
    Extract structured vote data from email bodies.
    Returns: {binding: int, nonbinding: int, vetoes: int, result: 'passed'|'failed'|'open', voters: list}
    """
    import re

    binding_count = 0
    nonbinding_count = 0
    veto_count = 0
    voters = []

    for email in emails:
        body = (email.get("body") or "").lower()
        sender = email.get("from", "")

        # Check for -1 (veto) first
        if re.search(r"^\s*-1\b", body, re.MULTILINE) or re.search(r"\bveto\b", body):
            veto_count += 1
            voters.append({"voter": sender, "vote": "-1"})
        elif re.search(r"^\s*\+1\s*(binding)?", body, re.MULTILINE):
            is_binding = bool(re.search(r"\+1\s*\(?\s*binding", body))
            if is_binding:
                binding_count += 1
                voters.append({"voter": sender, "vote": "+1 (binding)"})
            else:
                nonbinding_count += 1
                voters.append({"voter": sender, "vote": "+1"})
        elif re.search(r"^\s*0\b", body, re.MULTILINE):
            voters.append({"voter": sender, "vote": "0"})

    # Check if vote was cancelled or withdrawn
    cancellation_patterns = re.compile(
        r"\b(cancel(l(ed|ing))?|withdraw(n|ing)?|retract(ed|ing)?|postpone[d]?)\s+(this\s+)?(vote|proposal|rfc)\b",
        re.IGNORECASE
    )
    is_cancelled = any(
        cancellation_patterns.search(email.get("body") or "")
        for email in emails
    )

    # Apache requires 3 binding +1 and no -1 to pass
    if is_cancelled:
        result = "cancelled"
    elif binding_count >= 3 and veto_count == 0:
        result = "passed"
    elif veto_count > 0:
        result = "vetoed"
    elif binding_count > 0 or nonbinding_count > 0:
        result = "open"
    else:
        result = "open"

    return {
        "binding_plus1": binding_count,
        "nonbinding_plus1": nonbinding_count,
        "vetoes": veto_count,
        "result": result,
        "voters": voters[:20],
    }


def _parse_thread(thread_meta: dict, emails: list[dict], project_id: str) -> dict:
    subject = thread_meta.get("subject", "") or (emails[0].get("subject", "") if emails else "")
    first = emails[0] if emails else {}
    all_text = " ".join(e.get("body", "") or "" for e in emails)
    links = [{"url": l.url, "kind": l.kind} for l in extract_links(all_text)]

    dates = [_epoch_to_iso(e.get("date") or e.get("epoch")) for e in emails if e.get("date") or e.get("epoch")]
    last_activity = sorted(d for d in dates if d)[-1] if dates else ""
    thread_id = str(thread_meta.get("tid") or thread_meta.get("id", ""))

    # Fall back to thread-level epoch if individual email dates are missing
    meta_date = _epoch_to_iso(thread_meta.get("epoch"))
    created = _epoch_to_iso(first.get("date") or first.get("epoch")) or meta_date
    updated = last_activity or meta_date

    # Count unique participants
    participants = list({e.get("from", "") for e in emails if e.get("from")})

    # Vote analysis for [VOTE] threads
    vote_data = None
    title_lower = subject.lower()
    if "[vote]" in title_lower:
        vote_data = _parse_vote(emails)

    result = {
        "id": f"{project_id}-ml-{thread_id}",
        "source": "mailing_list",
        "kind": "thread",
        "title": subject,
        "url": f"https://lists.apache.org/thread/{thread_id}",
        "author": first.get("from", "unknown"),
        "state": "open",
        "created_at": created,
        "updated_at": updated,
        "body": (first.get("body") or "")[:2000],
        "labels": [],
        "linked_resources": links,
        "llm_summary": None,
        "llm_status": None,
        "comment_count": max(0, len(emails) - 1),
        "participant_count": len(participants),
        "_emails": [e.get("body", "")[:500] for e in emails[1:9]],
    }

    if vote_data:
        result["vote_data"] = vote_data

    return result


def _mailing_list_start_month(ml_config: dict, since: Optional[str], now: datetime) -> tuple[int, int]:
    """
    First (year, month) to scan, inclusive.
    Incremental: month of `since`. Full: `history_start` or default lookback.
    """
    if since:
        since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
        return since_dt.year, since_dt.month

    raw = (ml_config.get("history_start") or "").strip()
    m = re.match(r"^(\d{4})-(\d{2})$", raw)
    if m:
        return int(m.group(1)), int(m.group(2))

    from dateutil.relativedelta import relativedelta

    months = ml_config.get("history_months")
    try:
        n = int(months) if months is not None else 36
    except (TypeError, ValueError):
        n = 36
    n = max(6, min(n, 240))  # 6 months .. 20 years
    back = now - relativedelta(months=n)
    return back.year, back.month


def crawl(project_config: dict, since: Optional[str] = None) -> list[dict]:
    ml_config = project_config.get("mailing_list", {})
    domain = ml_config.get("pony_mail_domain", "")
    list_name = ml_config.get("pony_mail_list", "dev")

    if not domain:
        logger.info(f"No mailing list config for {project_config['id']}, skipping.")
        return []

    project_id = project_config["id"]
    now = datetime.now(timezone.utc)

    results = []
    seen_thread_ids: set[str] = set()
    year, month = _mailing_list_start_month(ml_config, since, now)

    while (year, month) <= (now.year, now.month):
        logger.info(f"Fetching {list_name}@{domain} for {year}-{month:02d}")
        try:
            threads = _fetch_month(domain, list_name, year, month)
        except Exception as e:
            logger.warning(f"Failed to fetch {year}-{month:02d}: {e}")
            threads = []

        for thread_meta in threads:
            subject = thread_meta.get("subject", "")
            if not _is_proposal(subject):
                continue

            tid = str(thread_meta.get("tid") or thread_meta.get("id", ""))
            if not tid or tid in seen_thread_ids:
                continue
            seen_thread_ids.add(tid)

            try:
                emails = _fetch_thread(tid)
            except Exception as e:
                logger.warning(f"Failed to fetch thread {tid}: {e}")
                emails = []

            results.append(_parse_thread(thread_meta, emails, project_id))

        month += 1
        if month > 12:
            month = 1
            year += 1

    logger.info(f"Mailing list: fetched {len(results)} threads for {project_id}")
    return results
