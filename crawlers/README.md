# Crawlers

This directory contains data source crawlers for Agora. Each crawler fetches items from one
source type and returns a list of normalized proposal dicts.

## Architecture

```
scripts/crawl.py          ← orchestrator: calls each crawler, runs LLM enrichment, writes data/
crawlers/
  github_crawler.py       ← GitHub issues + pull requests
  mailing_list_crawler.py ← Apache Pony Mail mailing list threads
  youtube_crawler.py      ← YouTube videos via RSS + Data API
  doc_crawler.py          ← Google Docs / Drive (fetches text for LLM summarization)
  link_extractor.py       ← shared utility: extracts typed links from text
llm/
  client.py               ← LLM provider abstraction (OpenAI / Anthropic / Google / Groq / local)
  local_nlp.py            ← Zero-cost local fallback using sumy + yake
  prompts.py              ← LLM prompt templates
```

---

## Proposal schema

Every crawler must return a list of dicts with these fields:

```python
{
    # --- Required ---
    "id":           str,   # globally unique: "{project_id}-{source}-{upstream_id}"
    "source":       str,   # "github" | "mailing_list" | "youtube" | "google_doc"
    "kind":         str,   # "issue" | "pr" | "thread" | "video" | "document"
    "title":        str,
    "url":          str,
    "author":       str,
    "state":        str,   # "open" | "closed" | "merged"
    "created_at":   str,   # ISO 8601
    "updated_at":   str,   # ISO 8601

    # --- Content ---
    "body":         str,   # first email / issue body / description (max 2000 chars)
    "labels":       list[str],
    "comment_count": int,
    "linked_resources": list[{"url": str, "kind": str}],

    # --- LLM enrichment (set to None; filled by crawl.py) ---
    "llm_summary":    None,
    "llm_status":     None,   # idea|discussion|proposal|implementation|released|abandoned
    "llm_key_points": None,
    "llm_topics":     None,

    # --- Pipeline-only fields (stripped before writing to disk) ---
    "_emails":      list[str],   # reply snippets for LLM context (mailing list)
    "_doc_content": str,         # full doc text for LLM summarization
    "_transcript":  str,         # video transcript for LLM summarization
}
```

Optional source-specific fields:
- `"vote_data"`: dict — for `[VOTE]` mailing list threads (see below)
- `"participant_count"`: int — unique senders in a thread
- `"has_transcript"`: bool — for YouTube videos

---

## Crawlers in detail

### `github_crawler.py`

Fetches issues and pull requests from a GitHub repository.

**Config** (`projects/{id}.yaml`):
```yaml
github:
  org: apache
  repo: iceberg
  labels: []          # optional: only fetch issues with these labels
  extra_repos: []     # optional: additional repos to crawl
```

**Incremental**: uses `since` param (ISO date) to only fetch updated items.

**Rate limits**: requires `GITHUB_TOKEN` env var. Free tier: 5000 requests/hour.

---

### `mailing_list_crawler.py`

Fetches mailing list threads from the Apache Pony Mail REST API.

**Config** (`projects/{id}.yaml`):
```yaml
mailing_list:
  pony_mail_domain: iceberg.apache.org
  pony_mail_list: dev
  address: dev@iceberg.apache.org   # for display URL
```

**API endpoints used**:
- `GET https://lists.apache.org/api/stats.lua?list={list}&domain={domain}&d={YYYY-MM}`
  Returns thread index for a month. Each entry has: `tid`, `subject`, `epoch`, `children`.
- `GET https://lists.apache.org/api/thread.lua?id={mid}`
  Returns one email with full body + nested `children` tree (child MIDs only, no bodies).
  Must be called per-reply to get reply bodies.

**Filtering**: only threads whose subject starts with a proposal tag are fetched:
`[discuss]`, `[proposal]`, `[rfc]`, `[vote]`, `[spec]`, `[announce]`, `[result]`

**Vote analysis** (zero API cost):
For `[VOTE]` threads, `_parse_vote(emails)` counts `+1 (binding)` / `+1` / `-1` / veto patterns
and sets `vote_data` with `{binding_plus1, nonbinding_plus1, vetoes, result, voters}`.
Apache convention: 3 binding +1 and no -1 = passed.

**Deduplication**: Pony Mail creates a new thread ID each month for long-running discussions.
`update_data._dedup_mailing_list()` normalizes subjects (strips Re:/Fwd:) and keeps the most
recently active thread, summing comment counts.

---

### `youtube_crawler.py`

Fetches community sync videos from a YouTube channel.

**Config** (`projects/{id}.yaml`):
```yaml
youtube:
  channel_id: UCZdOFUrTX9CfumMBgkVH8fQ
  playlist_id: PLW...   # optional
```

**Data sources** (in order of preference):
1. YouTube Data API (`YOUTUBE_API_KEY`) — full metadata
2. RSS feed (`https://www.youtube.com/feeds/videos.xml?channel_id=...`) — no key needed

**Transcripts**: fetched via `youtube-transcript-api` (no key needed). Stored in `_transcript`
for LLM summarization. `has_transcript: true` is persisted to the proposal for frontend display.

---

### `doc_crawler.py`

Fetches text from Google Docs linked in proposals or configured as `known_docs`.

**Config** (`projects/{id}.yaml`):
```yaml
known_docs:
  - url: https://docs.google.com/document/d/1abc.../
    title: "Community Sync Notes"
```

**How it works**: converts a Google Doc URL to export format
(`/export?format=txt`) and fetches plain text. Stored in `_doc_content` for LLM context.

Also called on-the-fly for any `linked_resources` with `kind: google_doc` found in
GitHub issues or mailing list threads.

---

## Adding a new crawler

1. **Create `crawlers/your_crawler.py`** with a `crawl(config, since=None) -> list[dict]` function:

```python
def crawl(project_config: dict, since: str | None = None) -> list[dict]:
    """
    Crawl your source and return a list of proposal dicts.

    Args:
        project_config: full project YAML as dict
        since: ISO 8601 datetime string for incremental crawling (may be None for first run)

    Returns:
        List of proposal dicts matching the schema above.
    """
    your_config = project_config.get("your_source", {})
    if not your_config:
        return []

    project_id = project_config["id"]
    proposals = []

    # ... fetch data ...

    proposals.append({
        "id": f"{project_id}-yoursource-{item_id}",
        "source": "your_source",
        "kind": "your_kind",
        "title": ...,
        "url": ...,
        "author": ...,
        "state": "open",
        "created_at": ...,
        "updated_at": ...,
        "body": ...,
        "labels": [],
        "linked_resources": [],
        "llm_summary": None,
        "llm_status": None,
        "comment_count": 0,
    })

    return proposals
```

2. **Register it in `scripts/crawl.py`** inside `crawl_project()`:

```python
# Your source
try:
    from crawlers import your_crawler
    your_results = your_crawler.crawl(config, since=since)
    new_proposals.extend(your_results)
    logger.info(f"Your source: {len(your_results)} items")
except Exception as e:
    logger.error(f"Your source crawl failed: {e}")
```

3. **Add to `frontend/src/lib/data.js`** — add an entry in `SOURCE_META`:

```js
export const SOURCE_META = {
  // ...
  your_source: { label: "Your Label", color: "bg-violet-50 text-violet-700 ..." },
};
```

4. **Add YAML config** to your project file (`projects/{id}.yaml`):

```yaml
your_source:
  some_config: value
```

5. **Add dependencies** to `crawlers/requirements.txt` if needed.

---

## Local NLP (zero-cost enrichment)

When no LLM API key is set, `llm/local_nlp.py` provides:

| Feature | Library | Quality |
|---------|---------|---------|
| Extractive summarization | `sumy` (LSA) | Good for long content |
| Keyword extraction | `yake` | Good for topics |
| Status classification | Rule-based (title patterns) | Good for tagged subjects |
| Vote analysis | Regex (`+1`, `-1`, `binding`) | Exact (no LLM needed) |

Install: `pip install sumy yake nltk`

The `LocalNLPClient` class has the same interface as `LLMClient` and is used automatically
as fallback. Vote threads always use local analysis even when an LLM is available — no tokens
needed since votes are structured and parseable.

---

## Rate limits & delays

| Source | Limit | Default delay |
|--------|-------|---------------|
| GitHub | 5000 req/hr (with token) | None |
| Pony Mail | No enforced limit | None |
| YouTube RSS | None | None |
| YouTube Data API | 10,000 units/day | None |
| Groq | 6K TPM, 500K TPD | 10s between calls |
| Google Gemini | 15 RPM, 1500 RPD (free) | 4s between calls |
| OpenAI | Varies by tier | 0.5s between calls |

Override delay: `LLM_REQUEST_DELAY=<seconds>` env var.
