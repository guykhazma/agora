# Agōra — Architecture

## How the pipeline works

```
GitHub Issues/PRs/Discussions ──┐
GitHub Releases & Milestones ───┤
Apache Mailing List ────────────┼──► extract linked Google Docs & cross-references
YouTube RSS ────────────────────┤         │
Google Docs (from threads) ─────┤         │
Google Calendar (ICS) ──────────┘         │
Known docs from YAML (`known_docs`) — merged after fetch (first-class `google_doc` rows)
                                          │
                    (parallel source tasks + calendar + known docs)
                                          │
                    local NLP enrichment (vote parsing, announcements, releases)
                    LLM summarization for rich discussions
                    (cached by content hash — only re-runs on changes)
                                          │
                    union-find clustering (see `build_initiatives.py`):
                      1. shared Google Doc URL (strongest)
                      2. GitHub cross-references (issues/PRs)
                      3. matching LLM topic tags (filtered for generic / over-broad terms)
                      4. shared normalized URLs in body, summary, or links
                      5. title+summary token overlap (Jaccard, mid-frequency tokens)
                      6. vote / discuss / proposal title threading (normalized subject)
                      7. optional semantic similarity (fastembed embeddings)
                                          │
              ┌───────────┬───────────────┬───────────────┐
    proposals.json   initiatives.json   events.json
    (all items)      (union-find: each proposal appears once,
                      merged with related items or alone)
                     (upcoming calendar events)
              └───────────┴───────────────┴───────────────┘
                              │
                         digest.json
                    (AI briefing — date-bounded; cloud LLM or local extractive fallback)
                                          │
                        React + Tailwind dashboard
                        (static files, no server)
```

**No server required.** All data is static JSON. The dashboard reads directly from `data/`.

**Secrets:** Put API keys only in `.env` (gitignored) or GitHub Actions **secrets** / **variables**. Scripts read keys from `os.environ` and pass them to official SDKs — they do not echo keys in logs. Error messages from providers are truncated where logged (e.g. initiative LLM failures) to avoid huge HTML bodies in CI output.

---

## Repository layout

```
agora/
├── projects/          # One YAML config per tracked project
│   └── iceberg.yaml
├── crawlers/          # One Python module per data source
│   ├── github_crawler.py          # Issues, PRs, Releases, Milestones
│   ├── github_discussions_crawler.py  # GitHub Discussions (GraphQL)
│   ├── mailing_list_crawler.py    # Apache Pony Mail
│   ├── youtube_crawler.py         # YouTube RSS
│   ├── calendar_crawler.py        # Google Calendar ICS
│   ├── doc_crawler.py             # Google Docs text fetch
│   └── link_extractor.py          # Extract linked resources from bodies
├── llm/
│   ├── client.py      # OpenAI, Anthropic, Google, Groq, GitHub Models (`GITHUB_TOKEN`), Ollama, llama.cpp
│   └── local_nlp.py   # Local enrichment: vote parsing, announcement detection
├── scripts/
│   ├── crawl.py             # Main entry — parallel crawlers + LLM; `--re-enrich` = no fetch, re-summarize disk
│   ├── build_initiatives.py # Union-find: one initiative per proposal (merge related)
│   ├── generate_digest.py   # Weekly digest; run as `python scripts/generate_digest.py --project <id>`
│   └── update_data.py       # Write projects.json; state management
├── data/              # Generated output (committed, served as static assets)
│   └── {project}/
│       ├── proposals.json    # All items with summaries and metadata
│       ├── initiatives.json  # One row per component (singleton or cluster)
│       ├── digest.json       # AI briefing
│       ├── events.json       # Upcoming calendar events
│       └── state.json        # Crawl cursor (timestamps / last-seen IDs)
└── frontend/          # React + Tailwind dashboard (Vite)
    └── src/
        ├── components/
        │   ├── Dashboard.jsx       # Tab routing
        │   ├── HomeView.jsx        # Overview: stage-grouped topics
        │   ├── InitiativesView.jsx # Full topic list
        │   ├── DocsView.jsx        # Design documents hub
        │   └── ...
        └── lib/
            ├── data.js    # Fetch helpers + type/status/source metadata
            └── utils.js   # cleanTitle(), sourceBreakdown(), etc.
```

---

## Adding a new data source

**1. Write a crawler** in `crawlers/your_source.py`:

```python
def crawl(project_config: dict, since: str | None = None) -> list[dict]:
    """
    Fetch items from your source.

    project_config  — parsed YAML from projects/<id>.yaml
    since           — ISO 8601 timestamp of the last successful crawl (None = first run)

    Returns a list of proposal dicts. Required keys:
        id            str   — globally unique, e.g. "{project}-jira-{issue_key}"
        source        str   — your source name, e.g. "jira"
        kind          str   — "issue" | "pr" | "thread" | "doc" | "video"
        title         str
        url           str
        author        str
        state         str   — "open" | "closed"
        created_at    str   — ISO 8601
        updated_at    str   — ISO 8601
        body          str   — first ~2000 chars of content
        labels        list[str]
        linked_resources  list[{"url": str, "kind": str}]
        comment_count int
        llm_summary   None  — filled in later by the enrichment step
        llm_status    None
    """
```

**2. Register it** in `scripts/crawl.py` — add to the `CRAWLERS` list.

**3. Add config** to `projects/<id>.yaml` for any source-specific fields:
```yaml
jira:
  base_url: https://issues.apache.org/jira
  project_key: MYPROJECT
```

**4. Add a display label** in `frontend/src/lib/data.js` under `SOURCE_META`:
```js
jira: { label: "Jira", color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300" },
```

Clustering, LLM enrichment, and dashboard display are automatic after that.

---

## Local vs. LLM enrichment

Agōra tries to do as much as possible locally before making API calls:

| Item type | How it's handled |
|-----------|-----------------|
| `[VOTE]` threads | Vote parsing in Python (binding +1, vetoes, result) |
| `[ANNOUNCE]` / `[RESULT]` | Local NLP — status + summary from title/body |
| Short items (<300 chars, no replies) | Local NLP — title + body sufficient |
| Rich discussions, long bodies, **community sync Google Docs** (`known_docs`), videos | LLM API call (`summarize_thread` / `summarize_video`; doc text passed as `doc_content` where applicable) |

Each item is cached by a content hash (for `google_doc` rows: full fetched doc text; otherwise body, transcript, linked doc text, etc.). Re-runs skip unchanged items — LLM API costs stay low on incremental crawls.

---

## Clustering algorithm

Initiatives are built with [union-find](scripts/build_initiatives.py). **Every proposal is in exactly one initiative:** either alone (singleton) or merged with others when signals link them. Nothing is dropped after clustering.

**Merge signals:**

1. **Shared Google Doc URL** — same normalized doc id in `linked_resources` (docs linked from *too many* proposals are treated as “hub” docs and **do not** merge, so one community notes doc cannot absorb the whole list)
2. **GitHub cross-references** — PR/issue links to another crawled item (uncapped; usually small cliques)
3. **Matching LLM topic tags** — normalized tags in a mid-frequency band (generic tags and weak engine-prefixed tags are filtered)
4. **Shared URLs** — same non-generic URL appears in a small set of proposals (strict fan-out cap)
5. **Token overlap** — Jaccard on title + `llm_summary` (mid-frequency tokens only)
6. **Governance title threading** — same normalized subject across `[VOTE]` / `[DISCUSS]` / etc.
7. **Embeddings** (optional) — cosine similarity via fastembed when installed

**Anti–mega-cluster:** Topic, shared-URL, text, vote-thread, and embedding unions **refuse** to merge if the combined component would exceed a fixed size (~30). That blocks weak transitive chains from gluing unrelated threads. Strong doc cliques (below the hub threshold) and direct GitHub cross-refs are not subject to that cap.

**Display:** Multi-member groups get a synthesized title/summary (LLM when available). Singles reuse each proposal’s `llm_title` / `llm_summary` / `llm_key_points`. `shared_docs` lists docs cited by ≥2 members in a cluster (ranked); single-item initiatives show that proposal’s own design-doc links.

## Go live (operator checklist)

- Crawl or `--re-enrich` with a working LLM key; commit `data/` if the static site should match.
- GitHub **Pages** source = **GitHub Actions**; set **`VITE_BASE_PATH`** repo variable if the site is not at domain root (e.g. `/agora/`).
- **Actions**: enable workflows; optional **`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`** / **`LLM_API_KEY`** secrets for CI — otherwise **`GITHUB_TOKEN`** can drive **GitHub Models** for incremental enrichment.

### Scheduled / incremental crawl in CI

The **Crawl & Enrich** workflow (`.github/workflows/crawl.yml`) runs `python scripts/crawl.py` on a cron and on manual dispatch. It uses **`data/<project>/state.json`** (`last_crawled_at`) so each run is **incremental** (not a full re-ingest) unless you dispatch with **Re-crawl from scratch** (`--reset`). Successful runs commit **`data/`**; that push triggers **Deploy** when `data/**` changes. No extra setup is required beyond secrets and a populated `state.json` on `main` (created by the first crawl).
