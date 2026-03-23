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

        count = 0
        for component in cal.walk():
            if component.name != "VEVENT":
                continue
            event = _parse_event(component, now, cutoff, cal_name)
            if event:
                all_events.append(event)
                count += 1

        logger.info(f"calendar: '{cal_name}' — {count} upcoming events")

    # Deduplicate by title+start, sort by start time
    seen = set()
    unique_events = []
    for ev in all_events:
        key = (ev["title"], ev["start"])
        if key not in seen:
            seen.add(key)
            unique_events.append(ev)
    unique_events.sort(key=lambda e: e["start"])

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
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)

    logger.info(f"calendar: wrote {len(unique_events)} total upcoming events to {out_path}")


def _parse_event(component, now: datetime, cutoff: datetime, calendar_name: str = "") -> Optional[dict]:
    """Parse a VEVENT component and return a dict if it falls within [now, cutoff]."""
    try:
        dtstart = component.get("DTSTART")
        if dtstart is None:
            return None
        start = dtstart.dt

        # Convert date-only events to datetime
        if not isinstance(start, datetime):
            start = datetime(start.year, start.month, start.day, tzinfo=timezone.utc)
        elif start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)

        if start < now or start > cutoff:
            return None

        dtend = component.get("DTEND")
        end = None
        if dtend:
            end = dtend.dt
            if not isinstance(end, datetime):
                end = datetime(end.year, end.month, end.day, tzinfo=timezone.utc)
            elif end.tzinfo is None:
                end = end.replace(tzinfo=timezone.utc)

        title = str(component.get("SUMMARY") or "").strip()
        location = str(component.get("LOCATION") or "").strip()
        description = str(component.get("DESCRIPTION") or "").strip()
        rrule = component.get("RRULE")

        return {
            "title": title,
            "start": start.isoformat(),
            "end": end.isoformat() if end else None,
            "location": location,
            "description": description[:500] if description else "",
            "recurring": rrule is not None,
            "calendar": calendar_name,
        }
    except Exception as e:
        logger.debug(f"calendar: skipping event due to parse error: {e}")
        return None
