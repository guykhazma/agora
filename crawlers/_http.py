"""
Shared HTTP session with automatic retry/backoff for all crawlers.

Unattended crawls must survive transient failures (429 rate limits, 5xx, dropped
connections) instead of losing a whole source for the run. Every crawler routes its
requests through get_session() so retries are configured in exactly one place.
"""
from __future__ import annotations

import logging

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

logger = logging.getLogger(__name__)

_session: requests.Session | None = None

# GET is retried freely; POST is included because our only POST is the GitHub GraphQL
# read endpoint (idempotent queries), which we very much want retried on 5xx/429.
_RETRY = Retry(
    total=4,
    connect=4,
    read=4,
    status=4,
    backoff_factor=1.5,  # 0s, 1.5s, 3s, 6s (plus jitter from urllib3)
    status_forcelist=(429, 500, 502, 503, 504),
    allowed_methods=frozenset(["GET", "POST"]),
    respect_retry_after_header=True,
    raise_on_status=False,
)


def get_session() -> requests.Session:
    """Process-wide singleton session with retry/backoff mounted."""
    global _session
    if _session is None:
        s = requests.Session()
        adapter = HTTPAdapter(max_retries=_RETRY)
        s.mount("https://", adapter)
        s.mount("http://", adapter)
        _session = s
    return _session
