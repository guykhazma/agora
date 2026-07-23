#!/usr/bin/env python3
"""
Read data/health.json (written by scripts/crawl.py) and decide whether the
unattended pipeline needs a human. Prints a Markdown report and exits:

  0  everything healthy
  1  at least one project/source is stale or failing

The health-check workflow runs this and opens/updates a GitHub issue on exit 1, so
the owner is told when something needs attention instead of the system rotting green.

Thresholds (override via env):
  AGORA_STALE_DAYS         project not crawled in N days           (default 3)
  AGORA_SOURCE_STALE_DAYS  a source hasn't succeeded in N days     (default 7)
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent.parent
HEALTH = ROOT / "data" / "health.json"

STALE_DAYS = float(os.environ.get("AGORA_STALE_DAYS", "3"))
SOURCE_STALE_DAYS = float(os.environ.get("AGORA_SOURCE_STALE_DAYS", "7"))


def _age_days(iso: str | None) -> float | None:
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - dt).total_seconds() / 86400


def main() -> int:
    if not HEALTH.exists():
        print("⚠️ No data/health.json yet — the crawler hasn't recorded a run.")
        return 0  # nothing to alert on before the first crawl

    health = json.loads(HEALTH.read_text())
    projects = health.get("projects", {})
    problems: list[str] = []
    lines = ["# Agōra crawl health", ""]

    for pid in sorted(projects):
        p = projects[pid]
        proj_issues: list[str] = []

        age = _age_days(p.get("last_crawled_at"))
        if age is None:
            proj_issues.append("never completed a successful crawl (no checkpoint)")
        elif age > STALE_DAYS:
            proj_issues.append(f"not crawled in {age:.1f} days (checkpoint stale)")

        if p.get("status") == "error":
            proj_issues.append("last run reported **error** (a critical source failed)")

        bad_sources = []
        for label, s in (p.get("sources") or {}).items():
            src_age = _age_days(s.get("last_success_at"))
            if not s.get("ok"):
                detail = (s.get("error") or "").strip()
                bad_sources.append(f"{label} failing" + (f" — {detail[:120]}" if detail else ""))
            elif src_age is not None and src_age > SOURCE_STALE_DAYS:
                bad_sources.append(f"{label} last succeeded {src_age:.1f}d ago")
        proj_issues.extend(bad_sources)

        icon = "🔴" if proj_issues else "🟢"
        lines.append(f"## {icon} {pid}")
        lines.append(f"- last crawled: {p.get('last_crawled_at') or '—'} · status: {p.get('status')}")
        if proj_issues:
            for it in proj_issues:
                lines.append(f"- ⚠️ {it}")
                problems.append(f"**{pid}**: {it}")
        else:
            lines.append("- all sources healthy")
        lines.append("")

    report = "\n".join(lines)
    print(report)

    # Surface in the GitHub Actions run summary when available.
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        try:
            with open(summary, "a", encoding="utf-8") as f:
                f.write(report + "\n")
        except OSError:
            pass

    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
