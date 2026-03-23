"""
Google Doc content fetcher.
Fetches the text content of publicly accessible Google Docs for LLM summarization.
No authentication needed for docs shared with "anyone with link can view".
"""

from __future__ import annotations
import logging
import re
from typing import Optional
import requests

logger = logging.getLogger(__name__)

# Google Docs export URL for plain text
EXPORT_URL = "https://docs.google.com/document/d/{doc_id}/export?format=txt"


def extract_doc_id(url: str) -> Optional[str]:
    """Extract doc ID from a Google Docs URL."""
    m = re.search(r"/document/d/([A-Za-z0-9_\-]+)", url)
    return m.group(1) if m else None


def fetch_doc_text(url: str, max_chars: int = 6000) -> str:
    """
    Fetch plain text content of a public Google Doc.
    Returns empty string if the doc is not publicly accessible.
    """
    doc_id = extract_doc_id(url)
    if not doc_id:
        return ""

    export_url = EXPORT_URL.format(doc_id=doc_id)
    try:
        resp = requests.get(export_url, timeout=20, allow_redirects=True)
        # 200 = success, 302 with login redirect = private
        if resp.status_code == 200 and "accounts.google.com" not in resp.url:
            return resp.text[:max_chars]
        logger.debug(f"Doc not publicly accessible: {url}")
        return ""
    except Exception as e:
        logger.debug(f"Failed to fetch doc {url}: {e}")
        return ""


def extract_doc_title(text: str) -> str:
    """Extract the document title from the first non-empty line of plain-text export."""
    for line in text.splitlines():
        stripped = line.strip()
        if stripped:
            return stripped[:120]
    return ""


def enrich_proposal_with_docs(proposal: dict, max_docs: int = 3) -> dict:
    """
    For each Google Doc in proposal's linked_resources, fetch its content
    and append to proposal's _doc_content field for LLM summarization.
    Modifies proposal in-place.
    """
    doc_links = [
        l for l in proposal.get("linked_resources", [])
        if l.get("kind") == "google_doc"
    ][:max_docs]

    if not doc_links:
        return proposal

    doc_texts = []
    for link in doc_links:
        text = fetch_doc_text(link["url"])
        if text:
            doc_texts.append(f"--- Google Doc ---\n{text}")
            link["fetched"] = True
            if not link.get("title"):
                link["title"] = extract_doc_title(text)
            logger.debug(f"Fetched doc: {link['url'][:60]}...")
        else:
            link["fetched"] = False

    if doc_texts:
        proposal["_doc_content"] = "\n\n".join(doc_texts)

    return proposal
