"""
Data-integrity units: thread_prefixes filter, mailing-list dedup, merge preservation,
content hashing, index slimming, atomic writes, and health.json merge.
"""
import json

from crawlers.mailing_list_crawler import _subject_matches_prefixes
from crawlers._io import write_json_atomic, write_text_atomic
from scripts.update_data import merge_proposals, _dedup_mailing_list, update_health
import scripts.update_data as update_data
from scripts.build_site_data import _slim_row
from scripts.crawl import _compute_content_hash


# ── thread_prefixes ────────────────────────────────────────────────────────
def test_thread_prefixes_keeps_governance_drops_support():
    pfx = ["[VOTE]", "[DISCUSS]", "[SPIP]"]
    assert _subject_matches_prefixes("[VOTE] Release 1.5.0", pfx)
    assert _subject_matches_prefixes("Re: [SPIP] geospatial types", pfx)
    assert _subject_matches_prefixes("[discuss] lowercase ok", pfx)  # case-insensitive
    assert not _subject_matches_prefixes("How do I read parquet?", pfx)


def test_empty_prefixes_keeps_everything():
    assert _subject_matches_prefixes("anything at all", [])
    assert _subject_matches_prefixes("x", None or [])


# ── mailing-list dedup ─────────────────────────────────────────────────────
def test_dedup_accumulates_comment_counts_keeps_recent():
    items = [
        {"id": "p-ml-1", "source": "mailing_list", "title": "[DISCUSS] X", "comment_count": 3, "updated_at": "2026-01-01"},
        {"id": "p-ml-2", "source": "mailing_list", "title": "Re: [DISCUSS] X", "comment_count": 5, "updated_at": "2026-02-01"},
    ]
    out = _dedup_mailing_list(items)
    assert len(out) == 1
    assert out[0]["comment_count"] == 8          # summed
    assert out[0]["updated_at"] == "2026-02-01"  # most recent kept


# ── merge preserves enrichment ─────────────────────────────────────────────
def test_merge_preserves_llm_and_hash_when_new_lacks_them():
    existing = [{"id": "a", "updated_at": "2026-01-01", "llm_summary": "old summary",
                 "llm_status": "proposal", "_content_hash": "abc123"}]
    new = [{"id": "a", "updated_at": "2026-02-01", "llm_summary": None}]
    merged = merge_proposals(existing, new)
    row = {p["id"]: p for p in merged}["a"]
    assert row["llm_summary"] == "old summary"   # preserved
    assert row["_content_hash"] == "abc123"       # preserved
    assert row["updated_at"] == "2026-02-01"      # new wins on non-llm fields


# ── content hash ───────────────────────────────────────────────────────────
def test_content_hash_changes_with_body_and_votes():
    base = {"id": "x", "body": "hello", "comment_count": 1}
    h1 = _compute_content_hash(base)
    h2 = _compute_content_hash({**base, "body": "hello world"})
    h3 = _compute_content_hash({**base, "comment_count": 2})
    assert h1 != h2 and h1 != h3
    assert _compute_content_hash(base) == h1  # stable


# ── index slimming ─────────────────────────────────────────────────────────
def test_slim_row_drops_body_keeps_preview_and_fields():
    row = _slim_row({
        "id": "x", "title": "T", "llm_summary": "s", "vote_data": {"result": "open"},
        "linked_resources": [{"url": "u"}], "body": "y" * 500,
        "_content_hash": "h", "_gdoc_snap2048": "z",
    })
    assert "body" not in row
    assert "_content_hash" not in row and "_gdoc_snap2048" not in row
    assert row["body_preview"].endswith("…") and len(row["body_preview"]) <= 281
    assert row["vote_data"] == {"result": "open"}      # kept for cards
    assert row["linked_resources"] == [{"url": "u"}]   # kept for the doc graph


# ── atomic writes ──────────────────────────────────────────────────────────
def test_atomic_write_roundtrip(tmp_path):
    p = tmp_path / "sub" / "x.json"
    write_json_atomic(p, {"a": [1, 2, 3]}, indent=2)
    assert json.loads(p.read_text()) == {"a": [1, 2, 3]}
    # no leftover temp files
    assert [f.name for f in p.parent.iterdir()] == ["x.json"]


def test_atomic_text_write(tmp_path):
    p = tmp_path / "feed.xml"
    write_text_atomic(p, "<rss/>")
    assert p.read_text() == "<rss/>"


# ── health merge ───────────────────────────────────────────────────────────
def test_update_health_preserves_last_success_on_failure(tmp_path, monkeypatch):
    monkeypatch.setattr(update_data, "DATA_DIR", tmp_path)
    update_health("spark", {"last_run_at": "t1", "last_crawled_at": "c1", "status": "ok",
                            "sources": {"GitHub": {"ok": True, "item_count": 5}}})
    update_health("spark", {"last_run_at": "t2", "last_crawled_at": "c1", "status": "error",
                            "sources": {"GitHub": {"ok": False, "item_count": 0, "error": "502"}}})
    health = json.loads((tmp_path / "health.json").read_text())
    gh = health["projects"]["spark"]["sources"]["GitHub"]
    assert gh["ok"] is False
    assert gh["last_success_at"] is not None  # preserved from the first successful run
    assert health["projects"]["spark"]["status"] == "error"


# ── LLM client selection (GitHub Models retired) ───────────────────────────
def test_get_client_uses_local_when_only_github_token(monkeypatch):
    """GITHUB_TOKEN alone must not select the retired github_models provider."""
    from llm.local_nlp import LocalNLPClient
    from llm import client as llm_client

    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.setenv("GITHUB_TOKEN", "ghs_test_only")

    c = llm_client.get_client()
    assert isinstance(c, LocalNLPClient)


def test_get_client_github_models_env_falls_back_to_local(monkeypatch):
    from llm.local_nlp import LocalNLPClient
    from llm import client as llm_client

    monkeypatch.setenv("LLM_PROVIDER", "github_models")
    monkeypatch.setenv("GITHUB_TOKEN", "ghs_test_only")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)

    c = llm_client.get_client()
    assert isinstance(c, LocalNLPClient)


def test_github_models_llmclient_raises_clear_error():
    from llm.client import LLMClient
    import pytest
    with pytest.raises(ValueError, match="retired"):
        LLMClient(provider="github_models")._ensure_client()
