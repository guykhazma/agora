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
| `mailing_list.address` | no | Full email address of the dev list |
| `mailing_list.pony_mail_list` | no | List name in Apache Pony Mail |
| `mailing_list.pony_mail_domain` | no | Domain in Apache Pony Mail |
| `github.proposal_labels` | no | Labels that mark proposals/discussions |
| `github.title_prefixes` | no | Issue/PR title prefixes to treat as proposals |
| `known_doc_folders` | no | Known Google Drive folder URLs to crawl |
| `components` | no | Logical sub-areas for filtering |

## Status Values

Proposals move through the following lifecycle stages:

- `idea` — Early concept, no formal proposal yet
- `discussion` — Active mailing list or GitHub discussion
- `proposal` — Formal doc/RFC written
- `implementation` — Work has started (open PR)
- `released` — Merged and shipped
- `abandoned` — No activity, marked closed
