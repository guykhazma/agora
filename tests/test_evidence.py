"""Regression tests for citations, observed changes, and multi-repository ingest."""
import copy
import json
from datetime import datetime, timezone

import pytest

from crawlers import github_crawler as github
from scripts import generate_digest as digest, update_data
from scripts.history import record_history


@pytest.mark.parametrize('ids', [[], ['invented'], ['known', 'invented'], [None], [['known']]])
def test_digest_rejects_missing_or_unknown_citations(ids):
    with pytest.raises(ValueError):
        digest._validate_digest({'summary': 'A summary', 'highlights': [
            {'text': 'A claim', 'source_ids': ids}]}, [{'id': 'known'}])


def test_digest_resolves_sources_and_provenance(tmp_path, monkeypatch):
    monkeypatch.setattr(digest, 'DATA_DIR', tmp_path)
    project = tmp_path / 'parquet'
    project.mkdir()
    (project / 'proposals.json').write_text(json.dumps({'proposals': [{
        'id': 'known', 'title': 'Column indexes', 'url': 'https://example.org/discussion',
        'updated_at': datetime.now(timezone.utc).isoformat(), 'llm_summary': 'Indexing discussion',
    }]}))

    class Client:
        provider = 'test'
        model = 'test-model'
        def complete(self, system, prompt, **kwargs):
            assert 'ID=known' in prompt
            return json.dumps({'summary': 'Indexing discussion', 'highlights': [{
                'text': 'Column indexes discussed', 'source_ids': ['known', 'known'],
                'url': 'https://invented.example',
            }]})

    assert digest.generate('parquet', Client())
    result = json.loads((project / 'digest.json').read_text())
    assert result['highlights'][0]['sources'] == [{
        'id': 'known', 'title': 'Column indexes', 'url': 'https://example.org/discussion',
    }]
    assert result['generation'] == {'method': 'llm', 'provider': 'test', 'model': 'test-model', 'prompt_version': 2}
    assert result['item_count'] == result['coverage']['thread_count'] == 1


def test_history_does_not_invent_past_or_model_transitions():
    item = {'id': 'p', 'source': 'github', 'state': 'open', 'llm_status': 'discussion'}
    assert record_history(None, item) == []
    assert record_history(item, {**item, 'llm_status': 'released'}) == []
    assert record_history(item, {**item, 'comment_count': 9}) == []


def test_history_survives_merge_and_does_not_repeat():
    old = {'id': 'p', 'source': 'github', 'state': 'open', 'updated_at': '2026-01-01'}
    incoming = {**old, 'state': 'merged', 'updated_at': '2026-01-02'}
    merged = update_data.merge_proposals([old], [copy.deepcopy(incoming)])
    event = merged[0]['observed_history'][0]
    assert (event['field'], event['from'], event['to']) == ('state', 'open', 'merged')
    assert 'observed_at' in event
    again = update_data.merge_proposals(merged, [copy.deepcopy(incoming)])
    assert again[0]['observed_history'] == [event]
    assert record_history(again[0], old) == [event]  # older source snapshots don't create events


def test_vote_history_is_separate_from_official_result():
    before = {'vote_data': {'result': 'vetoed'}}
    after = {'vote_data': {'result': 'passed'}}
    assert record_history(before, after, 'now') == [{
        'field': 'vote_result', 'from': 'vetoed', 'to': 'passed',
        'observed_at': 'now', 'source_updated_at': '',
    }]


def test_additional_repo_filters_and_ids_do_not_collide(monkeypatch):
    config = {'id': 'parquet', 'github': {'repo': 'apache/parquet-java',
        'proposal_labels': ['proposal'], 'additional_repos': [
            {'repo': 'apache/parquet-format', 'proposal_labels': ['format']},
            'apache/parquet-format', 'apache/parquet-java',
        ]}}
    original = copy.deepcopy(config)
    extra = github.additional_repositories(config)
    assert config == original and len(extra) == 1
    node = {'number': 1, 'title': 'Proposal', 'url': 'https://github.com/a/b/issues/1',
            'body': '', 'state': 'OPEN', 'createdAt': '2026-01-01', 'updatedAt': '2026-01-01',
            'labels': {'nodes': [{'name': 'proposal'}, {'name': 'format'}]}}
    def graphql(query, variables):
        key = 'issues' if query == github.ISSUES_QUERY else 'pullRequests'
        return {'repository': {key: {'nodes': [node], 'pageInfo': {'hasNextPage': False}}}}
    monkeypatch.setattr(github, '_graphql', graphql)
    primary = github.crawl(config)
    secondary = github.crawl(extra[0])
    assert primary[0]['id'] == 'parquet-gh-i1'
    assert len({p['id'] for p in primary + secondary}) == 4
    assert secondary[0]['repository'] == 'apache/parquet-format'
    assert extra[0]['github']['proposal_labels'] == ['format']


def test_pr_pagination_stops_at_checkpoint(monkeypatch):
    calls = []
    def graphql(query, variables):
        calls.append(query)
        if query == github.ISSUES_QUERY:
            return {'repository': {'issues': {'nodes': [], 'pageInfo': {'hasNextPage': False}}}}
        return {'repository': {'pullRequests': {'nodes': [{'updatedAt': '2020-01-01'}],
                'pageInfo': {'hasNextPage': True, 'endCursor': 'unused'}}}}
    monkeypatch.setattr(github, '_graphql', graphql)
    assert github.crawl({'id': 'p', 'repo': 'a/b'}, since='2026-01-01') == []
    assert len(calls) == 2


def test_stale_snapshot_cannot_revert_state_or_create_false_future_change():
    old = {'id': 'p', 'source': 'github', 'state': 'merged', 'updated_at': '2026-09-01T10:00:00Z'}
    stale = {**old, 'state': 'open', 'updated_at': '2026-09-01T10:30:00+01:00'}
    merged = update_data.merge_proposals([old], [stale])
    assert merged == [old]
    again = update_data.merge_proposals(merged, [copy.deepcopy(old)])
    assert again[0]['observed_history'] == []
