# Quickstart

**Prerequisites:** Python 3.10+, Node 18+ or [Bun](https://bun.sh), a GitHub token

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
bun install          # or: npm install
ln -sf ../../data public/data
bun dev              # or: npm run dev
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

## Re-enrich without re-crawling

Strip existing LLM fields from `proposals.json`, re-summarize everything, rebuild initiatives, and regenerate the digest — **no** GitHub / mailing-list / YouTube fetch:

```bash
python scripts/crawl.py --project iceberg --re-enrich
```

Use this for a polished pass after a `--no-llm` crawl, or after changing summarization logic. Needs an LLM API key (or GitHub Models in Actions with `GITHUB_TOKEN`).

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

The repo uses **GitHub Actions** (`.github/workflows/deploy.yml`): on push to `main` that touches `frontend/**` or `data/**`, it copies `data/` into `frontend/public/data`, runs `npm run build`, and publishes `frontend/dist` to Pages.

- In the repo, set **Settings → Pages** source to **GitHub Actions**.
- If the site is not at the domain root, add a repository variable **`VITE_BASE_PATH`** (e.g. `/agora/`) — same value you’d use locally.
- You do **not** need to commit `frontend/dist/`; CI builds it.

Scheduled / manual crawls (`.github/workflows/crawl.yml`) commit `data/` when it changes; that commit triggers deploy.
