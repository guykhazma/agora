# Evidence, history, and bounded enrichment

Agōra stores public source records and derived summaries separately. These features
work with static JSON and GitHub Pages; no additional service or account is required.

## Digests

New digests use `schema_version: 2`. Each highlight has `text` and `sources`
(`id`, `title`, `url`). The model returns item IDs; the generator resolves them to
actual crawled records. Missing or unknown IDs, malformed JSON, and provider errors
fall back to local extraction. This validates references, not whether every model
claim is semantically supported: readers can follow the links to verify it.

`generation` records `method` (`llm` or `local`), `prompt_version`, and, for model
output, `provider` and `model`. The dashboard and Markdown export display this
provenance. Local extraction selects from existing item summaries, which themselves
may have been generated locally or by an LLM. It is not a fresh source crawl.

Existing digests with string highlights still render. Their generation method is
unknown and is not guessed. New source links appear when the digest is regenerated.
Only the up-to-20 supplied records count toward `item_count` and coverage.

## Source history and changes since your visit

`observed_history` retains at most 20 transitions per item:

- GitHub/JIRA source `state` changes, such as a PR moving from open to merged.
- Parsed `vote_data.result` changes. These are inferred tallies, not official results.

Each transition stores `from`, `to`, `field`, `observed_at`, and `source_updated_at`.
Older source snapshots are ignored when their timestamps can be compared.
No transition is created for initial imports, comment-count changes, or LLM status
changes. Repeating a crawl with the same values does not append duplicate events.
History starts when this version observes changes; it does not reconstruct past
transitions or claim their observation time is the exact event time.

The Overview shows up to eight transitions observed since the previous visit,
with links to the item. It stays hidden when there are none, including the first
visit. An initiative shows up to 12 source events: dated thread/PR openings,
release publications, result-thread postings, and observed transitions. A posted
result thread is not interpreted as an approval or rejection by this timeline.

## Enrichment limits and recovery

Environment variables (GitHub Actions exposes these as repository **variables**):

| Variable | Default | Scope |
|---|---:|---|
| `LLM_MAX_ITEMS_PER_PROJECT` | 20 | Maximum item-level LLM attempts per project per invocation; newest updates first |
| `LLM_MAX_INITIATIVES_PER_PROJECT` | 5 | Maximum multi-item initiative summary attempts per project, newest activity first |
| `LLM_MAX_REQUESTS_PER_RUN` | 100 | Shared limit on calls attempted through the LLM client, including its retries, initiative summaries and digests, for this Python process |

Zero disables the corresponding work; negative values are invalid. These are
request limits, not token limits or a guarantee against a provider's daily quota.
Starting another process resets the request count. OpenAI-compatible and Anthropic
SDK retries are disabled so the client controls retries; other SDK internals may
have their own retry behavior. Cloud failures still retain the local baseline.
Budget exhaustion is expected deferral, not a failed source.

New item summaries record `summary_generation`. Unchanged model summaries are
cached. Eligible local summaries, explicitly pending attempts, and known summaries
with an older prompt version can be upgraded. Up to the item limit of stored text
items (GitHub, mailing list, JIRA) are considered even when sources return no new
items. Votes, announcements and short items remain local. Docs and videos need a
fresh content fetch; they are not upgraded from incomplete stored text alone.
Legacy summaries without provenance are not assumed to be local; normal content
changes or an explicit `--re-enrich` refresh them. Stored text retries have only
the retained body, not the original full reply history.

Digests run before initiative clustering within each project. All model work
shares the process limit; if it is exhausted, later digests use local extraction.
The limits also apply to `--re-enrich`; raise them deliberately for larger passes.

## Additional GitHub repositories

```yaml
github:
  repo: apache/parquet-java
  proposal_labels: [proposal, enhancement]
  title_prefixes: ["[PROPOSAL]", "[DISCUSS]"]
  additional_repos:
    - repo: apache/parquet-format
      # Optional per-repo proposal_labels/title_prefixes override inherited filters.
```

Additional repositories contribute issues and PRs. Releases, milestones and
GitHub Discussions continue to use the primary repository. Existing primary IDs
are unchanged; additional IDs include an owner/repository namespace. Each additional
repo has a checkpoint in `state.json.github_repositories`; its first run backfills
matching items automatically, without resetting the project. Pagination runs to
completion (or raises on a non-advancing cursor); PR scans stop at the checkpoint.

Successful checkpoints use the **crawl start time**, with a five-minute overlap on
the next read. ID-based merging deduplicates overlap. A failed critical source
holds the project checkpoint; each additional repository advances only on success.

## Metric interpretation

“Discussion span” measures creation to latest update for commented tracked items,
not response speed. Contributor mix counts tracked item authors, not all community
contributions. The trend groups items by their latest update date, not every event
that occurred that week. These signals describe the filtered dataset and should
not be used to compare overall project health as if coverage were complete.

## Verification

```bash
python -m pytest tests/ -q
npm --prefix frontend test
npm --prefix frontend run lint
npm --prefix frontend run build
```

Regression tests cover source-ID validation, provider fallback/recovery, request
limits, repository ID collisions/pagination, checkpoint failures, repeated-history
merges, old digest rendering, Markdown links, and inferred-vote labels. These tests
use mocked source/provider responses and do not spend API quota.
