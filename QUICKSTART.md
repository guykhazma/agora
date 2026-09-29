# Quickstart

**Prerequisites:** Python 3.10+, [Bun](https://bun.sh), a GitHub token

```bash
git clone https://github.com/guykhazma/agora
cd agora

# 1. Python environment
python -m venv .venv && source .venv/bin/activate
pip install -r crawlers/requirements.txt

# 2. API keys
export GITHUB_TOKEN=ghp_...
export GROQ_API_KEY=gsk_...     # free tier — get one at console.groq.com
# Also supported: OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY
# Provider is auto-detected from whichever key is set

# 3. Crawl (two-pass recommended for first run)
python scripts/crawl.py --project iceberg --no-llm   # fast: fetch all data
python scripts/crawl.py --project iceberg             # enrich with LLM summaries

# 4. Frontend
cd frontend
bun install
ln -sf ../../data public/data
bun dev
# → http://localhost:5173
```

## Two-pass crawling

The `--no-llm` flag skips LLM summarization on the first pass so you get data fast. The second pass (with an API key set) only processes items that are new or changed — it won't re-summarize everything.

For incremental updates (after the first run), a single `python scripts/crawl.py --project iceberg` is enough. Sources are crawled in parallel and only fetch items updated since the last run.

## Regenerate the digest only

After you already have `proposals.json` with LLM summaries, you can refresh `digest.json` without re-crawling sources:

```bash
python scripts/generate_digest.py --project iceberg
```

Requires the same LLM API key env vars as a normal crawl.

## Derived site data (index.json + RSS feed)

The dashboard loads a slim `data/<id>/index.json` (the full `proposals.json` minus the
heavy `body` field, ~45% smaller) and a subscribable `data/<id>/feed.xml`. Both are
generated from `proposals.json` — no extra crawl:

```bash
python scripts/build_site_data.py                 # all projects
python scripts/build_site_data.py --project spark  # one project
```

These are **regenerated automatically at deploy time** and are gitignored, so you only
need to run this locally if you want the exact production payloads. Local `bun dev` works
without it — the frontend falls back to `proposals.json` when `index.json` is absent.

## Re-enrich without re-crawling

Strip existing LLM fields from `proposals.json`, re-summarize everything, rebuild initiatives, and regenerate the digest — **no** GitHub / mailing-list / YouTube fetch:

```bash
python scripts/crawl.py --project iceberg --re-enrich
```

Use this for a polished pass after a `--no-llm` crawl, or after changing summarization logic. Needs a vendor LLM API key (`OPENAI_API_KEY`, `GROQ_API_KEY`, etc.); otherwise stage 2 is skipped and local extractive NLP is kept.

## Crawl from scratch

Use `python scripts/crawl.py --project iceberg --reset` to: (1) delete cached `proposals.json`, `initiatives.json`, `digest.json`, and `events.json` for that project, (2) clear the crawl checkpoint, then (3) re-fetch from each source (for GitHub: full history; for the dev list: from `mailing_list.history_start` through today). **No merge** with previous proposal rows.

Deleting only `state.json` without `--reset` does **not** remove old proposals — use `--reset` for a truly fresh dataset.

## Environment variables

| Variable | Required | Notes |
|----------|----------|-------|
| `GITHUB_TOKEN` | Yes | Personal access token, read-only scopes sufficient |
| `GROQ_API_KEY` | Recommended | Free tier at console.groq.com |
| `OPENAI_API_KEY` | Alternative | Instead of Groq |
| `ANTHROPIC_API_KEY` | Alternative | Instead of Groq |
| `GOOGLE_API_KEY` | Alternative | Instead of Groq |

## Deploying to GitHub Pages

The repo uses **GitHub Actions** (`.github/workflows/deploy.yml`): on push to `main` that touches `frontend/**` or `data/**`, it copies `data/` into `frontend/public/data`, runs `bun run build`, and publishes `frontend/dist` to Pages.

- In the repo, set **Settings → Pages** source to **GitHub Actions**.
- If the site is not at the domain root, add a repository variable **`VITE_BASE_PATH`** (e.g. `/agora/`) — same value you’d use locally.
- You do **not** need to commit `frontend/dist/`; CI builds it.

Scheduled / manual crawls (`.github/workflows/crawl.yml`) commit `data/` when it changes; that commit triggers deploy.

## Free summarization and health alerts

No external service is required: `LLM_PROVIDER=local` uses extractive summaries
and generates digests without an API key. Cloud digest failures (including invalid
JSON) also fall back to local extraction.

For cloud summaries, the existing Groq integration defaults to `openai/gpt-oss-20b`.
Set GitHub Actions secrets `LLM_PROVIDER=groq` and `GROQ_API_KEY`; remove an old
`LLM_MODEL` override or set it to `openai/gpt-oss-20b`. Free quotas are limited;
check https://console.groq.com/docs/rate-limits for current account limits.

The health check reports cloud-to-local fallback as a warning, while source
failures and stale crawls still fail. Set `AGORA_REQUIRE_CLOUD_LLM=1` in the health
check environment if cloud enrichment must be mandatory. Existing health records
remain historical; a successful crawl refreshes them.
