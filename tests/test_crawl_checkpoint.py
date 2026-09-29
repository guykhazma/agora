import copy
from datetime import datetime, timezone

import pytest

from scripts import crawl, update_data, build_initiatives
from crawlers import github_crawler, github_discussions_crawler, mailing_list_crawler


@pytest.mark.parametrize('fail_extra', [False, True])
def test_crawl_uses_start_watermark_and_backfills_new_repo(monkeypatch, fail_extra):
    start = datetime(2026, 9, 29, 6, tzinfo=timezone.utc)
    end = datetime(2026, 9, 29, 7, tzinfo=timezone.utc)
    times = iter([start, end])
    class Clock:
        @staticmethod
        def now(tz):
            return next(times)
        fromisoformat = datetime.fromisoformat
    monkeypatch.setattr(crawl, 'datetime', Clock)
    config = {'id': 'parquet', 'github': {'repo': 'apache/parquet-java',
              'additional_repos': ['apache/parquet-format']}}
    state = {'last_crawled_at': '2026-09-28T06:00:00+00:00'}
    monkeypatch.setattr(crawl, 'load_project_config', lambda pid: config)
    monkeypatch.setattr(crawl, 'load_state', lambda pid: copy.deepcopy(state))
    monkeypatch.setattr(update_data, 'load_proposals', lambda pid: [])
    seen = {}
    def fetch(cfg, since=None):
        repo = cfg['github']['repo']
        seen[repo] = since
        if fail_extra and repo.endswith('format'):
            raise RuntimeError('source unavailable')
        return []
    monkeypatch.setattr(github_crawler, 'crawl', fetch)
    for module, fn in [(github_crawler, 'crawl_releases'), (github_crawler, 'crawl_milestones'),
                       (github_discussions_crawler, 'crawl'), (mailing_list_crawler, 'crawl')]:
        monkeypatch.setattr(module, fn, lambda *a, **kw: [])
    monkeypatch.setattr(crawl, 'write_project_data', lambda *a: None)
    monkeypatch.setattr(build_initiatives, 'build', lambda *a: 0)
    saved = {}
    health = {}
    monkeypatch.setattr(crawl, 'save_state', lambda pid, value: saved.update(value))
    monkeypatch.setattr(crawl, 'update_health', lambda pid, value: health.update(value))
    crawl.crawl_project('parquet', use_llm=False)
    assert seen == {'apache/parquet-java': '2026-09-28T05:55:00+00:00', 'apache/parquet-format': None}
    assert health['last_run_at'] == end.isoformat()
    if fail_extra:
        assert saved['last_crawled_at'] == state['last_crawled_at']
        assert 'github_repositories' not in saved
        assert health['status'] == 'error'
    else:
        assert saved['last_crawled_at'] == start.isoformat()
        assert saved['github_repositories']['apache/parquet-format'] == start.isoformat()
