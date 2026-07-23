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

from crawlers._http import get_session
from crawlers.link_extractor import extract_links

logger = logging.getLogger(__name__)

PONY_MAIL_BASE = "https://lists.apache.org/api"

# Reply snippets passed into enrichment (full thread is used for vote extraction only).
_ENRICH_REPLY_CHUNKS = 35
_ENRICH_REPLY_CHARS = 500


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


def _fetch_month(domain: str, list_name: str, year: int, month: int) -> list[dict]:
    """Fetch thread index for a single month using d=YYYY-MM format."""
    month_str = f"{year}-{month:02d}"
    url = f"{PONY_MAIL_BASE}/stats.lua?list={list_name}&domain={domain}&d={month_str}"
    resp = get_session().get(url, timeout=30)
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
    resp = get_session().get(url, timeout=30)
    if resp.status_code in (404, 400):
        return {}
    resp.raise_for_status()
    data = resp.json()
    emails = data.get("emails", [])
    return emails[0] if emails else {}


def _fetch_thread(thread_id: str) -> list[dict]:
    """Fetch all emails in a thread (root + every reply we can resolve from the tree)."""
    url = f"{PONY_MAIL_BASE}/thread.lua?id={thread_id}"
    resp = get_session().get(url, timeout=30)
    if resp.status_code in (404, 400):
        return []
    resp.raise_for_status()
    data = resp.json()

    root_emails = data.get("emails", [])
    if not root_emails:
        return []

    root = root_emails[0]
    all_emails = [root]

    seen = {root.get("mid") or root.get("id") or thread_id}
    child_mids = _collect_child_mids(root, seen)

    for mid in child_mids:
        try:
            child_email = _fetch_email(mid)
            if child_email:
                all_emails.append(child_email)
        except Exception:
            pass  # individual reply fetch failure is non-fatal

    return all_emails


def _reply_head(text: str) -> str:
    """
    The author's new text usually appears above 'On … wrote:' quoted history.
    Vote signals in the quoted part are stale; prefer the head when detecting votes.
    """
    if not text:
        return ""
    m = re.search(r"^On .+ wrote:\s*$", text, re.MULTILINE | re.IGNORECASE)
    if m:
        return text[: m.start()].strip()
    if "\n---\n" in text:
        return text.split("\n---\n", 1)[0].strip()
    return text.strip()


def _latest_vote_signal_in_body(body: str) -> str | None:
    """
    Pick a single vote token from one message: -1, +1, +1b (binding +1), or 0 (+0 / -0).
    Prefer the reply head (above 'On … wrote:') so quoted history does not override.
    """
    if not body or not body.strip():
        return None

    def _scan_fragment(fragment: str) -> str | None:
        if not fragment:
            return None
        lower = fragment.lower()
        found: list[tuple[int, str]] = []

        for m in re.finditer(
            r"(?:changing|change|switch(?:ed|ing)?)\s+(?:my\s+)?vote\s+to\s*"
            r"(\+1|\-1|\+0|\-0)(?:\s*\(([^)]*)\))?",
            lower,
        ):
            t, paren = m.group(1), (m.group(2) or "").lower()
            if t == "-1":
                found.append((m.end(), "-1"))
            elif "0" in t:
                found.append((m.end(), "0"))
            elif "binding" in paren and "non" not in paren:
                found.append((m.end(), "+1b"))
            else:
                found.append((m.end(), "+1"))

        for m in re.finditer(
            r"my\s+vote\s+is\s+now\s*(\+1|\-1|\+0|\-0)(?:\s*\(([^)]*)\))?",
            lower,
        ):
            t, paren = m.group(1), (m.group(2) or "").lower()
            if t == "-1":
                found.append((m.end(), "-1"))
            elif "0" in t:
                found.append((m.end(), "0"))
            elif t == "+1" and "binding" in paren and "non" not in paren:
                found.append((m.end(), "+1b"))
            elif t == "+1":
                found.append((m.end(), "+1"))

        # `\b` must sit right after "+1" — if placed after the optional (binding)
        # group it backtracks and drops the annotation, miscounting binding as
        # non-binding (which decides whether a vote "passed").
        for m in re.finditer(r"(?m)^\+1\b(?:\s*\(([^)]*)\))?", lower):
            label = (m.group(1) or "").lower()
            is_binding = "binding" in label and "non" not in label
            found.append((m.end(), "+1b" if is_binding else "+1"))

        for m in re.finditer(r"(?m)^\-1\b", lower):
            found.append((m.end(), "-1"))

        for m in re.finditer(r"(?m)^(?:\+0|\-0)\b", lower):
            found.append((m.end(), "0"))

        if not found:
            return None
        found.sort(key=lambda x: x[0])
        return found[-1][1]

    head = _reply_head(body)
    sig = _scan_fragment(head)
    if sig is not None:
        return sig
    return _scan_fragment(body)


def _reply_snippets_for_enrichment(emails: list[dict]) -> list[str]:
    """Recent reply bodies only (truncated). Not persisted — enrichment input."""
    if len(emails) <= 1:
        return []
    rest = emails[1:]
    rest_sorted = sorted(rest, key=lambda e: e.get("date", "") or "")
    tail = rest_sorted[-_ENRICH_REPLY_CHUNKS:]
    return [(e.get("body") or "")[:_ENRICH_REPLY_CHARS] for e in tail]


def _parse_vote(emails: list[dict]) -> dict:
    """
    Extract structured vote data from email bodies, handling vote updates.
    Each sender's latest explicit vote (line or prose, in chronological order) wins.
    """
    binding_count = 0
    nonbinding_count = 0
    veto_count = 0
    voter_latest_votes: dict[str, dict] = {}

    emails_sorted = sorted(emails, key=lambda e: e.get("date", "") or "")

    for email in emails_sorted:
        sender = email.get("from", "")
        if not sender:
            continue
        body = email.get("body") or ""
        sig = _latest_vote_signal_in_body(body)
        if sig is None:
            continue
        if sig == "-1":
            vote = "-1"
        elif sig == "+1b":
            vote = "+1 (binding)"
        elif sig == "+1":
            vote = "+1"
        else:
            vote = "0"
        voter_latest_votes[sender] = {"voter": sender, "vote": vote}

    for vote in voter_latest_votes.values():
        if vote["vote"] == "-1":
            veto_count += 1
        elif vote["vote"] == "+1 (binding)":
            binding_count += 1
        elif vote["vote"] == "+1":
            nonbinding_count += 1

    if veto_count > 0:
        result = "vetoed"
    elif binding_count >= 3:
        result = "passed"
    elif binding_count > 0 or nonbinding_count > 0:
        result = "open"
    else:
        result = "open"

    voters_sorted = sorted(voter_latest_votes.values(), key=lambda v: v["voter"])

    return {
        "binding_plus1": binding_count,
        "nonbinding_plus1": nonbinding_count,
        "vetoes": veto_count,
        "result": result,
        "voters": voters_sorted,
    }


def _extract_vote_deadline(body: str, created_iso: str) -> str | None:
    """
    Best-effort close time for an ASF [VOTE] thread. ASF votes state a window in the
    opening email ("open for at least 72 hours" / "3 days"); we add that to the thread
    start. Returns ISO 8601 or None. Advisory only — used for a "closing soon" badge.
    """
    if not body or not created_iso:
        return None
    from datetime import timedelta

    low = body.lower()
    hours = None
    m = re.search(r"(?:at least\s+|for\s+|open\s+for\s+)?(\d{1,3})\s*(?:hours?|hrs?|h)\b", low)
    if m:
        hours = int(m.group(1))
    else:
        m = re.search(r"(?:at least\s+|for\s+|open\s+for\s+)?(\d{1,2})\s*(?:business\s+)?days?\b", low)
        if m:
            hours = int(m.group(1)) * 24
    if not hours or hours > 24 * 30:  # ignore absurd matches
        return None
    try:
        dt = datetime.fromisoformat(created_iso.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None
    return (dt + timedelta(hours=hours)).isoformat()


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
        if vote_data:
            deadline = _extract_vote_deadline(first.get("body") or "", created)
            if deadline:
                vote_data["closes_at"] = deadline

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
        "_emails": _reply_snippets_for_enrichment(emails),
    }

    if vote_data:
        result["vote_data"] = vote_data

    return result


def _normalize_subject(subject: str) -> str:
    """Lowercase and strip leading Re:/Fwd:/Fw: reply markers for prefix matching."""
    s = (subject or "").strip()
    while True:
        m = re.match(r"^(re|fwd|fw)\s*(\[\d+\])?\s*:\s*", s, re.IGNORECASE)
        if not m:
            break
        s = s[m.end():].lstrip()
    return s.lower()


def _subject_matches_prefixes(subject: str, prefixes: list[str]) -> bool:
    """
    True if `subject` (ignoring Re:/Fwd:) starts with one of `prefixes`.
    Empty `prefixes` means "no filter" — every thread matches (default behavior).
    """
    if not prefixes:
        return True
    norm = _normalize_subject(subject)
    return any(norm.startswith(p.strip().lower()) for p in prefixes if p and p.strip())


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

    # Optional governance filter: only ingest threads whose subject (ignoring
    # Re:/Fwd:) starts with one of these prefixes, e.g. ["[VOTE]", "[DISCUSS]",
    # "[SPIP]"]. Essential for high-volume lists (Spark) where full ingest would
    # pull tens of thousands of support threads. Absent/empty = ingest everything
    # (unchanged behavior for existing projects like Iceberg).
    thread_prefixes = ml_config.get("thread_prefixes") or []

    results = []
    seen_thread_ids: set[str] = set()
    skipped = 0
    year, month = _mailing_list_start_month(ml_config, since, now)

    while (year, month) <= (now.year, now.month):
        logger.info(f"Fetching {list_name}@{domain} for {year}-{month:02d}")
        try:
            threads = _fetch_month(domain, list_name, year, month)
        except Exception as e:
            logger.warning(f"Failed to fetch {year}-{month:02d}: {e}")
            threads = []

        for thread_meta in threads:
            tid = str(thread_meta.get("tid") or thread_meta.get("id", ""))
            if not tid or tid in seen_thread_ids:
                continue
            seen_thread_ids.add(tid)

            # Cheap subject-level filter before the (expensive) full-thread fetch.
            subject = thread_meta.get("subject", "")
            if not _subject_matches_prefixes(subject, thread_prefixes):
                skipped += 1
                continue

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

    if thread_prefixes:
        logger.info(
            f"Mailing list: fetched {len(results)} threads for {project_id} "
            f"({skipped} skipped by thread_prefixes filter)"
        )
    else:
        logger.info(f"Mailing list: fetched {len(results)} threads for {project_id}")
    return results
