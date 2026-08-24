<p align="center">
  <img src="frontend/public/favicon.svg" width="72" alt="Agōra" />
</p>

<h1 align="center">Agōra</h1>

<p align="center">
  One place for everything happening in an open-source project.
</p>

<p align="center">
  <a href="https://guykhazma.github.io/agora">See it in action</a> &nbsp;•&nbsp;
  <a href="ARCHITECTURE.md">Architecture</a>
</p>

---

## Why Agōra?

The *agora* (ἀγορά) was the central public square of ancient Greek cities — where citizens gathered to trade, debate, vote, and govern. Every major decision passed through the agora.

Open-source communities have the same problem as a city without a town square: debates happen simultaneously in GitHub issues, mailing list threads, design docs, and video calls, with no single place to see what is actually being decided.

**Agōra is that town square.** It crawls GitHub, mailing lists, YouTube, and linked Google Docs, then surfaces a unified dashboard showing what's being proposed, what's gaining traction, what needs a vote, and which discussions across different channels are about the same thing.

---

## What you get

**Overview** — the pulse of the project at a glance:
- AI-generated digest of what's been active
- Last community sync notes with summary
- Upcoming community events with Join links
- Recent votes with pass/veto status
- Recent activity feed

**Initiatives** — cross-source topic clusters ranked by how many channels are engaged, grouped by stage: *Vote · In Design · Cross-Source · Active*

**Feed** — filterable stream of every item: votes, RFCs, PRs, discussions, announcements, videos, releases, milestones

**Docs** — design documents and Google Docs extracted from discussions, grouped by topic and sorted by date

**Follow along** — ★ star anything to build a personal watchlist, see *what changed since your last visit*, subscribe to a per-project **RSS feed**, deep-link/share any item or initiative, and copy the digest as Markdown. All client-side / static — no account, no server.

**Community health** — a per-project [CHAOSS](https://chaoss.community)-style panel (responsiveness, contributor concentration / bus factor, 12-week activity) plus a live source-freshness strip.

**Runs itself** — a daily GitHub Actions crawl refreshes every project, isolates per-project failures, retries transient errors, never advances its checkpoint past a failed source, and writes a `health.json` that a second workflow turns into a **GitHub issue** when anything goes stale. No paid APIs required — enrichment falls back to local NLP when no vendor key is set.

---

## Currently tracking

| Project | Sources |
|---------|---------|
| [Apache Iceberg](https://iceberg.apache.org) | GitHub issues, PRs & discussions · dev@ mailing list · YouTube community syncs · Releases & milestones · Community calendars |
| [Apache Spark](https://spark.apache.org) | dev@ mailing list (SPIP votes & discussions) · Apache JIRA (SPIP proposals) · GitHub releases & milestones |
| [Apache Parquet](https://parquet.apache.org) | dev@ mailing list (governance) · GitHub issues, PRs, releases & milestones (`parquet-java`) |

Governance-heavy lists (like Spark's) use a `mailing_list.thread_prefixes` filter so only `[VOTE]` / `[DISCUSS]` / `[SPIP]`-style threads are ingested — signal, not support noise.

**Want to add a project?** It's [one YAML file](#adding-a-project) — the daily crawl picks it up automatically.

---

## Adding a project

1. Copy [`projects/iceberg.yaml`](projects/iceberg.yaml) as `projects/<your-project>.yaml`
2. Fill in the fields — at minimum `id`, `name`, `repo`, and one source
3. Open a PR — the next crawl will populate it automatically

Minimal config:
```yaml
id: my-project
name: My Project
repo: apache/my-project
mailing_list:
  address: dev@my-project.apache.org
  pony_mail_list: dev
  pony_mail_domain: my-project.apache.org
  history_start: "2024-01"   # full backfill from this month when state is empty / --reset
  # For a high-volume list, keep only governance threads (omit to ingest everything):
  thread_prefixes: ["[VOTE]", "[DISCUSS]", "[PROPOSAL]", "[RESULT]", "[ANNOUNCE"]
```

See [`projects/spark.yaml`](projects/spark.yaml) and [`projects/parquet.yaml`](projects/parquet.yaml) for real-world examples, and [ARCHITECTURE.md](ARCHITECTURE.md) for all available fields and how the pipeline works.

---

## License

Apache 2.0
