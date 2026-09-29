"""Record observed source changes, never model-generated status changes."""
from datetime import datetime, timezone


def is_older_snapshot(old: dict, item: dict) -> bool:
    try:
        before = datetime.fromisoformat((old.get("updated_at") or "").replace("Z", "+00:00"))
        after = datetime.fromisoformat((item.get("updated_at") or "").replace("Z", "+00:00"))
    except ValueError:
        return False
    before = before.replace(tzinfo=timezone.utc) if before.tzinfo is None else before
    after = after.replace(tzinfo=timezone.utc) if after.tzinfo is None else after
    return after < before


def record_history(old: dict | None, item: dict, observed_at: str | None = None) -> list[dict]:
    if not old:
        return []  # A backfill is not a newly observed transition.
    history = list(old.get("observed_history") or [])
    after_date = item.get("updated_at") or ""
    if is_older_snapshot(old, item):
        return history
    changes = []
    if item.get("source") in ("github", "jira"):
        changes.append(("state", old.get("state"), item.get("state")))
    changes.append(("vote_result", (old.get("vote_data") or {}).get("result"),
                    (item.get("vote_data") or {}).get("result")))
    now = observed_at or datetime.now(timezone.utc).isoformat()
    for field, before, after in changes:
        if before is not None and after is not None and before != after:
            history.append({"field": field, "from": before, "to": after,
                            "observed_at": now, "source_updated_at": after_date})
    return history[-20:]
