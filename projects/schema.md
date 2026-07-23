# Project Configuration Schema

Each file in `projects/` defines one tracked open-source project.
To add a new project, open a PR adding a `projects/<id>.yaml` file.

## Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Unique slug, used as directory name under `data/` |
| `name` | yes | Display name |
| `description` | yes | One-line description |
| `website` | no | Project homepage |
| `repo` | yes | GitHub repo in `owner/repo` format |
| `logo` | no | Public image URL (SVG/PNG) shown in the app |
| `mailing_list.address` | no | Full email address of the dev list |
| `mailing_list.pony_mail_list` | no | List name in Apache Pony Mail |
| `mailing_list.pony_mail_domain` | no | Domain in Apache Pony Mail |
| `mailing_list.history_start` | no | `YYYY-MM` — first month to backfill on empty state / `--reset` |
| `mailing_list.thread_prefixes` | no | Subject prefixes to keep, e.g. `["[VOTE]", "[SPIP]"]`. Ignores `Re:`/`Fwd:`. **Omit to ingest every thread** (default). Use it for high-volume lists so only governance threads are crawled |
| `github.repo` | no | GitHub repo for issues/PRs/releases/milestones (defaults to top-level `repo`) |
| `github.proposal_labels` | no | Labels that mark proposals/discussions |
| `github.title_prefixes` | no | Issue/PR title prefixes to treat as proposals |
| `github_discussions.repo` | no | Repo for GitHub Discussions (defaults to `github.repo`) |
| `youtube.channel_id` | no | YouTube channel for community-sync videos (public RSS, no API key) |
| `calendars` | no | List of public Google Calendar `.ics` URLs for events |
| `known_docs` | no | Google Docs to always crawl as first-class items (community-sync notes) |
| `components` | no | Logical sub-areas for filtering |

## Status Values

Proposals move through the following lifecycle stages:

- `idea` — Early concept, no formal proposal yet
- `discussion` — Active mailing list or GitHub discussion
- `proposal` — Formal doc/RFC written
- `implementation` — Work has started (open PR)
- `released` — Merged and shipped
- `abandoned` — No activity, marked closed
