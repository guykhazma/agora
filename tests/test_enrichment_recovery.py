import copy
from types import SimpleNamespace

import pytest

from scripts import crawl
from llm import client
from llm.local_nlp import LocalNLPClient

SUMMARY = 'A detailed source summary with enough context to explain this discussion clearly.'


@pytest.fixture
def local(monkeypatch):
    monkeypatch.setattr(LocalNLPClient, 'summarize_thread', lambda self, **kw: {
        'summary': SUMMARY, 'topics': ['indexing'], 'status': 'discussion', 'key_points': [],
    })
    monkeypatch.setenv('LLM_REQUEST_DELAY', '0')
    monkeypatch.setenv('LLM_MAX_ITEMS_PER_PROJECT', '20')


class Cloud:
    provider = 'test'
    model = 'test-model'
    def __init__(self, fail=False):
        self.calls = 0
        self.fail = fail
    def summarize_thread(self, **kwargs):
        self.calls += 1
        if self.fail:
            raise RuntimeError('401 authentication failed')
        return {'summary': SUMMARY + ' Cloud.', 'topics': ['indexing'], 'status': 'proposal'}


def proposal(id='p', date='2026-09-28'):
    return {'id': id, 'source': 'github', 'kind': 'issue', 'title': 'Index proposal',
            'body': 'Detailed proposal. ' * 30, 'updated_at': date}


def test_local_summary_upgrades_without_content_change(local):
    stored = crawl.enrich_with_llm([proposal()], {}, None)[0]
    assert stored['summary_generation']['method'] == 'local'
    cloud = Cloud()
    assert crawl._retry_backlog([stored], [], cloud) == [stored]
    upgraded = crawl.enrich_with_llm([proposal()], {'p': stored}, cloud)[0]
    assert cloud.calls == 1 and upgraded['summary_generation']['method'] == 'llm'
    assert crawl._retry_backlog([upgraded], [], cloud) == []
    crawl.enrich_with_llm([proposal()], {'p': upgraded}, cloud)
    assert cloud.calls == 1  # unchanged cloud summaries are cached


def test_failed_upgrade_preserves_summary_and_retries(local):
    stored = crawl.enrich_with_llm([proposal()], {}, Cloud())[0]
    stored['_enrichment_pending'] = True
    failed = crawl.enrich_with_llm([proposal()], {'p': stored}, Cloud(fail=True))[0]
    assert failed['llm_summary'] == stored['llm_summary']
    assert failed['summary_generation'] == stored['summary_generation']
    assert failed['_enrichment_pending'] is True
    assert crawl._retry_backlog([failed], [], Cloud())
    retry = crawl.enrich_with_llm([copy.deepcopy(failed)], {'p': failed}, Cloud())[0]
    assert '_enrichment_pending' not in retry


def test_item_budget_prioritizes_recent_work_and_defers_rest(local, monkeypatch):
    monkeypatch.setenv('LLM_MAX_ITEMS_PER_PROJECT', '1')
    cloud = Cloud()
    result = crawl.enrich_with_llm([proposal('old', '2026-01-01'), proposal('new')], {}, cloud)
    by_id = {p['id']: p for p in result}
    assert cloud.calls == 1
    assert by_id['new']['summary_generation']['method'] == 'llm'
    assert by_id['old']['summary_generation']['method'] == 'local'
    assert by_id['old']['_enrichment_pending']


def test_local_mode_does_not_retry_unchanged_cloud_output(local):
    cloud = Cloud()
    stored = crawl.enrich_with_llm([proposal()], {}, cloud)[0]
    copied = crawl.enrich_with_llm([proposal()], {'p': stored}, None)[0]
    assert copied['summary_generation'] == stored['summary_generation']
    assert copied['llm_summary'] == stored['llm_summary']


def test_backlog_excludes_fetched_items_and_missing_rich_content(local):
    stored = crawl.enrich_with_llm([proposal()], {}, None)[0]
    assert crawl._retry_backlog([stored], [proposal()], Cloud()) == []
    for source in ('youtube', 'google_doc'):
        assert crawl._retry_backlog([{**stored, 'source': source}], [], Cloud()) == []


def test_request_budget_is_shared_between_clients(monkeypatch):
    monkeypatch.setenv('LLM_MAX_REQUESTS_PER_RUN', '1')
    monkeypatch.setattr(client, '_requests_used', 0)
    calls = []
    def create(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='done'))])
    first = client.LLMClient('groq')
    second = client.LLMClient('groq')
    first._client = second._client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    assert first.complete('system', 'user') == 'done'
    with pytest.raises(client.LLMBudgetExceeded):
        second.complete('system', 'user')
    assert len(calls) == 1


def test_budget_exhaustion_is_not_reported_as_provider_failure(local):
    class Exhausted(Cloud):
        def summarize_thread(self, **kwargs):
            raise client.LLMBudgetExceeded('budget reached')
    status = {}
    result = crawl.enrich_with_llm([proposal()], {}, Exhausted(), status)[0]
    assert status['budget_exhausted'] and not status['stage2_degraded']
    assert result['summary_generation']['method'] == 'local'
    assert result['_enrichment_pending']


def test_initiative_budget_prefers_recent_clusters(tmp_path, monkeypatch):
    import json
    from scripts import build_initiatives as initiatives
    monkeypatch.setattr(initiatives, 'DATA_DIR', tmp_path)
    monkeypatch.setenv('LLM_MAX_INITIATIVES_PER_PROJECT', '1')
    folder = tmp_path / 'p'
    folder.mkdir()
    rows = [{**proposal(id, date), 'llm_summary': SUMMARY} for id, date in [
        ('a', '2026-01-01'), ('b', '2026-01-02'), ('c', '2026-09-01'), ('d', '2026-09-02'),
    ]]
    (folder / 'proposals.json').write_text(json.dumps({'proposals': rows}))
    monkeypatch.setattr(initiatives, 'build_clusters', lambda ps: {'a': ['a', 'b'], 'c': ['c', 'd']})
    seen = []
    def summarize(members, llm_client):
        seen.append([p['id'] for p in members])
        return {'title': 'Indexing work', 'summary': SUMMARY}
    monkeypatch.setattr(initiatives, '_generate_initiative_summary', summarize)
    assert initiatives.build('p', Cloud()) == 2
    assert seen == [['c', 'd']]
    seen.clear()
    assert initiatives.build('p', LocalNLPClient()) == 2
    assert not seen


def test_deferred_work_keeps_prior_summaries_and_pending_flag(local, monkeypatch):
    rows = [proposal('a'), proposal('b')]
    stored = crawl.enrich_with_llm(copy.deepcopy(rows), {}, Cloud())
    existing = {p['id']: copy.deepcopy(p) for p in stored}
    monkeypatch.setenv('LLM_MAX_ITEMS_PER_PROJECT', '0')
    for p in rows:
        p['body'] += ' A change.'
    deferred = crawl.enrich_with_llm(rows, existing, Cloud())
    for p in deferred:
        assert p['llm_summary'] == existing[p['id']]['llm_summary']
        assert p['summary_generation'] == existing[p['id']]['summary_generation']
        assert p['_content_hash'] == existing[p['id']]['_content_hash']
        assert p['_enrichment_pending']


def test_circuit_breaker_keeps_prior_output_for_remaining_items(local):
    rows = [proposal('a'), proposal('b')]
    existing = {p['id']: copy.deepcopy(p) for p in crawl.enrich_with_llm(copy.deepcopy(rows), {}, Cloud())}
    for p in rows:
        p['_force_summarize'] = True
    failing = Cloud(fail=True)
    results = crawl.enrich_with_llm(rows, existing, failing)
    assert failing.calls == 1
    assert all(p['llm_summary'] == existing[p['id']]['llm_summary'] for p in results)
    assert all(p['_enrichment_pending'] for p in results)
