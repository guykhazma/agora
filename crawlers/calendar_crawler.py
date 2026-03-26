"""
Google Calendar ICS crawler.
Fetches upcoming community events from one or more public ICS calendar URLs.
No API key required — works with any public ICS feed.

Config key (in projects/<id>.yaml):

  # Single calendar:
  calendar:
    ics_url: "https://calendar.google.com/calendar/ical/.../basic.ics"
    url: "https://calendar.google.com/calendar/..."

  # Multiple calendars:
  calendars:
    - name: "Dev Events"
      ics_url: "https://calendar.google.com/calendar/ical/.../basic.ics"
      url: "https://calendar.google.com/calendar/..."
    - name: "Community"
      ics_url: "..."

Output: writes data/{project_id}/events.json
"""

from __future__ import annotations
import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import requests

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
LOOKAHEAD_DAYS = 30


def crawl_events(config: dict, project_id: str) -> None:
    """Fetch ICS feeds and write events.json for the project."""
    # Support both `calendar` (single) and `calendars` (list)
    cal_configs: list[dict] = []
    if config.get("calendars"):
        cal_configs = config["calendars"]
    elif config.get("calendar", {}).get("ics_url"):
        cal_configs = [config["calendar"]]

    if not cal_configs:
        logger.debug(f"calendar: no calendars configured for {project_id}")
        return

    try:
        from icalendar import Calendar
    except ImportError:
        logger.error("calendar_crawler: 'icalendar' package not installed. Run: pip install icalendar")
        return

    now = datetime.now(tz=timezone.utc)
    cutoff = now + timedelta(days=LOOKAHEAD_DAYS)
    all_events: list[dict] = []
    fetched_any = False

    for cal_cfg in cal_configs:
        ics_url = cal_cfg.get("ics_url")
        cal_name = cal_cfg.get("name", "")
        if not ics_url:
            continue

        try:
            resp = requests.get(ics_url, timeout=15)
            resp.raise_for_status()
        except Exception as e:
            logger.error(f"calendar_crawler: failed to fetch '{cal_name}' ICS feed: {e}")
            continue

        try:
            cal = Calendar.from_ical(resp.content)
        except Exception as e:
            logger.error(f"calendar_crawler: failed to parse '{cal_name}' ICS: {e}")
            continue
        fetched_any = True

        count = 0
        for component in cal.walk():
            if component.name != "VEVENT":
                continue
            events = _parse_event(component, now, cutoff, cal_name) or []
            if events:
                all_events.extend(events)
                count += len(events)

        logger.info(f"calendar: '{cal_name}' — {count} upcoming events")

    # Deduplicate by title+start, sort by start time
    seen = set()
    unique_events = []
    for ev in all_events:
        key = (ev["title"], ev["start"])
        if key not in seen:
            seen.add(key)
            unique_events.append(ev)
    unique_events.sort(key=lambda e: e["_start_ts"])
    for ev in unique_events:
        ev.pop("_start_ts", None)

    # Build calendar_urls list for frontend "View calendar" links
    calendar_urls = [
        {"name": c.get("name", ""), "url": c["url"]}
        for c in cal_configs if c.get("url")
    ]

    out = {
        "project_id": project_id,
        "generated_at": now.isoformat(),
        "calendar_urls": calendar_urls,
        "events": unique_events,
    }

    out_dir = DATA_DIR / project_id
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "events.json"
    if not fetched_any:
        logger.error(f"calendar: no ICS feeds could be fetched; keeping existing {out_path} (if any)")
        return
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)

    logger.info(f"calendar: wrote {len(unique_events)} total upcoming events to {out_path}")


def _to_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _parse_event(component, now: datetime, cutoff: datetime, calendar_name: str = "") -> list[dict]:
    """
    Parse a VEVENT component and return a list of dicts for occurrences within [now, cutoff].
    Expands RRULE recurrences into concrete upcoming instances.
    """
    try:
        dtstart = component.get("DTSTART")
        if dtstart is None:
            return []
        start = dtstart.dt

        # Convert date-only events to datetime
        if not isinstance(start, datetime):
            start = datetime(start.year, start.month, start.day, tzinfo=timezone.utc)
        start = _to_utc(start)

        dtend = component.get("DTEND")
        end = None
        if dtend:
            end = dtend.dt
            if not isinstance(end, datetime):
                end = datetime(end.year, end.month, end.day, tzinfo=timezone.utc)
            end = _to_utc(end)

        title = str(component.get("SUMMARY") or "").strip()
        location = str(component.get("LOCATION") or "").strip()
        description = str(component.get("DESCRIPTION") or "").strip()
        rrule = component.get("RRULE")

        # Duration (for recurring instances)
        duration = None
        if end and isinstance(end, datetime):
            duration = end - start

        base = {
            "title": title,
            "location": location,
            "description": description[:500] if description else "",
            "calendar": calendar_name,
        }

        # Non-recurring
        if not rrule:
            if start < now or start > cutoff:
                return []
            return [{
                **base,
                "start": start.isoformat(),
                "end": end.isoformat() if end else None,
                "recurring": False,
                "_start_ts": start.timestamp(),
            }]

        # Recurring: expand occurrences within window
        try:
            from dateutil.rrule import rrulestr
        except Exception:
            # python-dateutil is in requirements; if missing, fall back to including only DTSTART
            if start < now or start > cutoff:
                return []
            return [{
                **base,
                "start": start.isoformat(),
                "end": end.isoformat() if end else None,
                "recurring": True,
                "_start_ts": start.timestamp(),
            }]

        # rrulestr needs the RRULE line, not just the value
        try:
            rule_text = component.get("RRULE").to_ical().decode("utf-8", errors="ignore").strip()
        except Exception:
            rule_text = ""
        if rule_text and not rule_text.upper().startswith("RRULE:"):
            rule_text = f"RRULE:{rule_text}"

        # Collect EXDATEs if present
        exdates = set()
        try:
            ex = component.get("EXDATE")
            if ex:
                # icalendar may return vDDDLists; iterate defensively
                for exd in getattr(ex, "dts", []) or []:
                    dt = exd.dt
                    if isinstance(dt, datetime):
                        exdates.add(_to_utc(dt))
                    else:
                        exdates.add(datetime(dt.year, dt.month, dt.day, tzinfo=timezone.utc))
        except Exception:
            pass

        occs: list[dict] = []
        if rule_text:
            rule = rrulestr(rule_text, dtstart=start)
            # between() is inclusive; we want events starting in [now, cutoff]
            for occ in rule.between(now, cutoff, inc=True):
                occ_utc = _to_utc(occ)
                if occ_utc in exdates:
                    continue
                occ_end = (occ_utc + duration) if duration else None
                occs.append({
                    **base,
                    "start": occ_utc.isoformat(),
                    "end": occ_end.isoformat() if occ_end else None,
                    "recurring": True,
                    "_start_ts": occ_utc.timestamp(),
                })

        return occs
    except Exception as e:
        logger.debug(f"calendar: skipping event due to parse error: {e}")
        return []
