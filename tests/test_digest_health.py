"""Cloud failures must not suppress digests or mask required source failures."""
import json
from datetime import datetime, timezone

import pytest

from scripts import check_health, generate_digest
from llm.local_nlp import LocalNLPClient


@pytest.mark.parametrize('response', [None, 'not json', '[]', '{}', '{"summary": 3}',
                                      '{"summary": "ok", "highlights": [3]}'])
def test_digest_cloud_failure_falls_back(tmp_path, monkeypatch, response):
    monkeypatch.setattr(generate_digest, 'DATA_DIR', tmp_path)
    monkeypatch.setattr('llm.local_nlp._sumy_summarize', lambda *a, **kw: '')
    folder = tmp_path / 'parquet'
    folder.mkdir()
    (folder / 'proposals.json').write_text(json.dumps({'proposals': [{
        'title': 'Page index discussion', 'llm_summary': 'Readers can use page indexes.',
        'updated_at': datetime.now(timezone.utc).isoformat(), 'source': 'mailing_list',
    }]}))

    class Cloud:
        def complete(self, *args, **kwargs):
            if response is None:
                raise RuntimeError('quota exhausted')
            return response

    assert generate_digest.generate('parquet', Cloud())
    digest = json.loads((folder / 'digest.json').read_text())
    assert digest['summary'] == 'Readers can use page indexes.'
    assert digest['highlights'] == ['Readers can use page indexes.']
    assert digest['coverage']['thread_count'] == 1
    assert generate_digest.generate('parquet', LocalNLPClient())


@pytest.mark.parametrize('strict,source_failure,stale,expected', [
    (False, False, False, 0), (True, False, False, 1),
    (False, True, False, 1), (False, False, True, 1),
])
def test_health_optional_cloud(tmp_path, monkeypatch, capsys, strict, source_failure, stale, expected):
    path = tmp_path / 'health.json'
    monkeypatch.setattr(check_health, 'HEALTH', path)
    monkeypatch.setenv('AGORA_REQUIRE_CLOUD_LLM', '1' if strict else '0')
    monkeypatch.delenv('GITHUB_STEP_SUMMARY', raising=False)
    path.write_text(json.dumps({'projects': {'parquet': {
        'last_crawled_at': '2020-01-01T00:00:00+00:00' if stale else datetime.now(timezone.utc).isoformat(),
        'status': 'degraded', 'sources': {
            'LLM enrichment': {'ok': False, 'error': 'stage-2 provider failed; fell back to local baseline'},
            'Mailing list': {'ok': not source_failure},
        },
    }}}))
    assert check_health.main() == expected
    if not strict:
        assert 'using local summaries' in capsys.readouterr().out
