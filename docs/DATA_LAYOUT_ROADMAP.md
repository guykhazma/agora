# Data layout roadmap (not implemented)

This document tracks the **planned** split of static project data. The running app today uses a **single** `data/<project>/proposals.json` per project; nothing here is wired in code until we deliberately implement it.

## Goals

1. **Performance** — Avoid loading a huge JSON blob up front; fetch month-sized archives when needed.
2. **Cost** — Extend `state.json` with content hashes and API cursors so crawls skip unchanged work and redundant LLM calls.
3. **Git / reviews** — Smaller monthly files produce readable diffs.

## Target layout (sketch)

| Layer | Path | Purpose |
|--------|------|---------|
| **Index** | `data/<project>/index.json` | Menu for the UI: `id`, display title, status, `updated_at`, `bucket_path` (e.g. `archive/2026-03.json`). |
| **Archive** | `data/<project>/archive/YYYY-MM.json` | Full unified rows (raw + derived) for items whose `created_at` falls in that month. |
| **State** | `data/<project>/state.json` | Crawler-only: `last_crawled_*`, per-item or per-source hashes, Pony/GitHub cursors. |

## Merge rules (for the future crawler)

- Bucket by item **`created_at`** month.
- Compare stored hash vs incoming; **new** → insert; **changed** → update raw + re-derive (LLM only when needed); **unchanged** → keep derived fields.
- Regenerate **`index.json`** after writes.

## Frontend (future)

- Load **`index.json`** first for lists.
- On row select, fetch **`archive/<month>.json`** once and cache (keyed by month path).

## Implementation checklist (when we start)

- [ ] `scripts/update_data.py` (or crawl): write `archive/*.json` + `index.json`.
- [ ] One-off **`scripts/shard_proposals.py`** (or equivalent) to migrate existing `proposals.json`.
- [ ] `scripts/build_initiatives.py` / digest: read from new layout or a compatibility loader.
- [ ] `frontend/src/lib/data.js`: `fetchProjectIndex`, lazy `fetchArchiveMonth`, update views.
- [ ] **ARCHITECTURE.md** — document final paths and drop this file or mark it “done”.

## Notes

- **`data/projects.json`** (multi-project menu) stays separate; it already summarizes counts from each project’s main store.
- Vote / enrichment improvements (e.g. `_vote_data_fingerprint` in crawl) are independent of this layout.
