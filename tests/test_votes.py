"""
Vote parsing — governance-critical and regex-heavy. A regression here silently
corrupts every vote tally, so these lock the behavior down.

Includes the regression test for issue #1 (a voter changing -1 → +1 must not stay VETOED).
"""
from crawlers.mailing_list_crawler import (
    _latest_vote_signal_in_body,
    _parse_vote,
    _extract_vote_deadline,
)


def _email(sender, body, date="2026-01-01T00:00:00+00:00"):
    return {"from": sender, "body": body, "date": date}


def test_binding_vs_nonbinding_plus_one():
    assert _latest_vote_signal_in_body("+1 (binding)") == "+1b"
    assert _latest_vote_signal_in_body("+1 (non-binding)") == "+1"
    assert _latest_vote_signal_in_body("+1") == "+1"


def test_veto_and_zero():
    assert _latest_vote_signal_in_body("-1") == "-1"
    assert _latest_vote_signal_in_body("+0") == "0"
    assert _latest_vote_signal_in_body("-0") == "0"


def test_reply_head_beats_quoted_history():
    # The new text is a +1; the quoted history below "On ... wrote:" contains a -1.
    body = "+1 looks good to me\n\nOn Mon, someone wrote:\n> -1 I disagree"
    assert _latest_vote_signal_in_body(body) == "+1"


def test_prose_vote_change_switches_tally():
    # issue #1: a later prose "changing my vote to +1" must override an earlier -1.
    emails = [
        _email("Daniel Weeks <dw@example.com>", "-1 I have concerns", "2026-01-01T00:00:00+00:00"),
        _email("Daniel Weeks <dw@example.com>", "Changing my vote to +1, concerns addressed", "2026-01-02T00:00:00+00:00"),
    ]
    vote = _parse_vote(emails)
    assert vote["vetoes"] == 0, "the later +1 must clear the earlier veto"
    assert vote["result"] != "vetoed"
    voters = {v["voter"]: v["vote"] for v in vote["voters"]}
    assert voters["Daniel Weeks <dw@example.com>"] == "+1"


def test_each_voter_counted_once_latest_wins():
    emails = [
        _email("A", "+1", "2026-01-01T00:00:00+00:00"),
        _email("A", "actually changing my vote to -1", "2026-01-03T00:00:00+00:00"),
        _email("B", "+1 (binding)", "2026-01-02T00:00:00+00:00"),
    ]
    vote = _parse_vote(emails)
    assert vote["vetoes"] == 1
    assert vote["binding_plus1"] == 1
    assert vote["result"] == "vetoed"


def test_passed_requires_three_binding():
    emails = [_email(f"V{i}", "+1 (binding)", f"2026-01-0{i+1}T00:00:00+00:00") for i in range(3)]
    assert _parse_vote(emails)["result"] == "passed"


def test_vote_deadline_from_72_hours():
    d = _extract_vote_deadline("This vote is open for at least 72 hours.", "2026-01-01T00:00:00+00:00")
    assert d.startswith("2026-01-04T00:00:00")  # +72h


def test_vote_deadline_from_days():
    d = _extract_vote_deadline("Voting is open for 3 days.", "2026-01-01T00:00:00+00:00")
    assert d.startswith("2026-01-04T00:00:00")


def test_vote_deadline_none_when_absent():
    assert _extract_vote_deadline("Please review this release candidate.", "2026-01-01T00:00:00+00:00") is None
