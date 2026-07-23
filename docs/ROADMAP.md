# Agōra — Upgrade Roadmap

*Status: **✅ all phases delivered in this PR.** Grounded in two read-only code audits
(pipeline reliability + frontend/product) and a scan of the external landscape (CHAOSS,
Apache Beam community metrics, ASF ComDev). Kept as the record of what was done and why.*

## The one-line thesis

Agōra already **works** and is more complete than any comparable tool (nothing else unifies
GitHub + mailing list + video + docs + calendars into AI-clustered initiatives with a daily
autonomous crawl). The next upgrade is **not more features first** — it's making the autonomy
*real* so the system runs for months unattended without silently rotting, then layering on the
coverage and product wins that turn it into a genuine "town square."

Guiding constraints (unchanged): **free / static APIs only**, **per-community independence**,
**signal over noise**, and **fully autonomous** (the owner should never need to babysit it).

---

## Why reliability comes first

The reliability audit found a structural flaw that undermines the whole "set it and forget it"
premise:

> The crawl checkpoint (`state.json → last_crawled_at`) advances to "now" on **every** run that
> doesn't throw at the project level — **even when individual sources failed and returned zero
> items**. With no HTTP retries, a single transient GitHub 502 permanently skips everything
> updated in that ~24h window, and the run still reports green.

That, plus **non-atomic JSON writes** (a cancelled CI job can truncate `proposals.json`), **no
freshness/health signal**, **zero pinned dependencies**, and **zero tests**, means the current
system can degrade for weeks before anyone notices. Fixing these is the highest-leverage work on
the board.

---

## Phase 1 — Make autonomy real  ✅ *(delivered)*

| # | Item | Why | Effort |
|---|------|-----|--------|
| 1 | **Atomic writes everywhere** — `write_json_atomic()` (write `*.tmp`, then `os.replace`) | A killed/OOM'd CI job currently truncates `proposals.json`; the next run reads a half-file and commits an empty list. Touches `update_data.py:166,235`, `build_initiatives.py:799,865`, `generate_digest.py`, `build_site_data.py`, `calendar_crawler.py`. | S |
| 2 | **Shared retrying HTTP session** — one `requests.Session` + `urllib3 Retry` (429/5xx, `Retry-After`), plus explicit handling of GraphQL `RATE_LIMITED` | No crawler retries today; one blip = one lost source for the run. Route `github_crawler._graphql`, releases, discussions, `mailing_list`, youtube, calendar, doc through it. | S |
| 3 | **Don't advance the checkpoint on source failure** — track per-source success; only move `last_crawled_at` for sources that actually succeeded | Closes the silent-data-gap hole (the root cause above). `crawl.py:533-544` + `:622`. | M |
| 4 | **Health / freshness signal** — write `data/health.json` (per-project, per-source: `last_success_at`, item counts, last error) and a small scheduled workflow that **opens a GitHub issue** when a project is stale > N days or a source returns 0 for M runs | This is *the* "never come back to it" change: the system tells the owner when it needs attention instead of failing green. Free (uses `GITHUB_TOKEN`). | M |
| 5 | **Pin dependencies** — exact `==` (or a hashed lock) for `crawlers/requirements.txt`; add Dependabot; pin the NLTK-download CI step | Unpinned deps are the #1 cause of "worked for months then broke." Highest risk: `youtube-transcript-api` (unofficial, frequent breaking changes) and the LLM SDK majors. | S |
| 6 | **LLM whole-run local fallback + typed-exception retries** | Today a provider outage/de-funded key logs per-item warnings but the run reports success — enrichment silently stops. Degrade the whole run to `LocalNLPClient` and surface it in `health.json`. Retry on 5xx/timeout, not just substring "rate". `client.py:126-172`. | M |

**Outcome:** a crawl that either succeeds honestly or tells you exactly what broke — and never corrupts or silently skips data.

---

## Phase 2 — Lock it in  ✅ *(delivered)*

| # | Item | Why | Effort |
|---|------|-----|--------|
| 7 | **Python test suite + `pytest` CI gate** | Zero tests exist. Cover the subtle, business-critical pure functions: **vote parsing incl. an issue #1 regression test** (`mailing_list_crawler._parse_vote`), `thread_prefixes` filter, `merge_proposals`/dedup, `_compute_content_hash`, index generation, calendar RRULE/DST. | M |
| 8 | **Frontend reproducibility + lint + smoke tests** | Commit a lockfile and switch deploy to `npm ci` (or `bun install --frozen-lockfile`) — today `deploy.yml` runs bare `npm install` against floating `^` ranges, so the built site can drift. Add ESLint + a Vitest smoke test for `data.js` helpers. | S |
| 9 | **Delete dead code** — `ActivityHeatmap.jsx`, `StatsBar.jsx`, `ProposalList.jsx` (~191 lines, zero importers) | Reduces surface area. Note: `ActivityHeatmap` is the only trend-viz in the tree — *revive* the concept in Phase 4 (#14) rather than lose it. | S |

---

## Phase 3 — Coverage  ✅ *(delivered)*

| # | Item | Why | Effort |
|---|------|-----|--------|
| 10 | **JIRA crawler** (Apache JIRA REST, free / no-auth) | The real completeness gap: Spark's actual proposals live in JIRA as SPIP-labelled tickets (`project=SPARK AND labels=SPIP`), not GitHub. Reusable for Flink/Kafka/etc. New `crawlers/jira_crawler.py`, register in `crawl.py`, add `jira:` config block. | M |
| 11 | **Vote deadline → "closing soon"** | `vote_data` has no close date, so no countdown/alert is possible today. Parse the 72h/close language from `[VOTE]` threads into a `closes_at` field; unlock "closing soon" badges + a health-panel alert. | M |

---

## Phase 4 — Product  ✅ *(delivered)*

| # | Item | Why | Effort |
|---|------|-----|--------|
| 12 | **Hash router / deep-linking** — `#/project/:id/:tab?item=:id` | **Highest product leverage.** Today everything is `useState`, so you can't share a link to a proposal/initiative/tab, refresh resets to the first project's Overview, and Back does nothing — for a dashboard meant to be *shared*, this is the top miss. State already exists (`App.jsx`, three `selected` owners), so it's mostly plumbing. | M |
| 13 | **Slide-over accessibility** — `role="dialog"` + `aria-modal` + focus trap + focus-restore | Both detail panels are visually modal but invisible to assistive tech; focus stays behind the overlay and Tab escapes it. Small diff, real correctness win. `ProposalDetail.jsx`, `InitiativeDetail.jsx`. | S |
| 14 | **CHAOSS-style community health panel** | The differentiator. Agōra already holds the raw data to compute lightweight [CHAOSS](https://chaoss.community/kb/metrics-model-starter-project-health/) signals per project — PR/issue **responsiveness**, **bus factor** (contributor concentration), **activity trend** — with no new APIs. Revive the dead heatmap as the trend view. | L |
| 15 | **Surface RSS + a real watchlist** | The RSS feed is generated but never linked — add a "Subscribe" affordance. Extend the watchlist to **initiatives** and add a dedicated cross-project **"Following"** view (today ★ is item-only and buried in the Activity tab). | M |
| 16 | **Per-source health in the UI** | Consume `health.json` (from #4) to show last-crawled + per-source freshness, so viewers can trust the data's recency. | S |
| 17 | **Perf/UX cleanups** — cache the 3×/2× refetches of `initiatives.json`/`events.json`/`index.json`; debounce global search; unify loading/empty states | Opening a project fires ~5-6 requests for 3 files; search re-filters the whole corpus per keystroke. Low-risk polish. | S |

---

## Suggested sequencing

- **Sprint 1 — Foundation:** Phase 1 (#1–#5), the "never come back" core. One or two focused PRs.
- **Sprint 2 — Safety + reach:** tests (#7, #8), JIRA (#10), a11y (#13), deep-link router (#12).
- **Sprint 3 — Differentiation:** health panel (#14), watchlist/Following + RSS (#15), closing-soon (#11), LLM fallback (#6), per-source health UI (#16).

## What we deliberately are *not* doing

- **No paid services / servers** — rules out email/Slack push, hosted search, etc. RSS + static stay the delivery model.
- **No Spark calendar / Parquet sync-doc ingest** — Spark has no public community calendar (grass-roots meetups only); Parquet's sync notes are explicitly marked "don't share." Both are correctly list + GitHub, and Parquet's meeting summaries already flow through the dev list.
- **No cross-project merged view** — per-community independence is intentional; cross-project themes surface within each project.

---

*Prioritization is impact-first within each phase. Every item is scoped to the free/static/autonomous
constraints. Pick any subset; Phase 1 is the recommended starting point.*
