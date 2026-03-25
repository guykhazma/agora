"""
Local NLP fallback — no API key required.

Used automatically when no LLM API key is present.
Provides extractive summarization (sumy) and keyword extraction (yake).
Quality is lower than LLM-based summaries but requires zero cost and no network.

Install: pip install sumy yake
"""

from __future__ import annotations
import logging
import re
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Lazy imports — these are optional; fail gracefully if not installed
# ---------------------------------------------------------------------------

def _sumy_summarize(text: str, sentence_count: int = 3) -> str:
    """Extract the N most important sentences using LSA."""
    try:
        from sumy.parsers.plaintext import PlaintextParser
        from sumy.nlp.tokenizers import Tokenizer
        from sumy.summarizers.lsa import LsaSummarizer
        from sumy.nlp.stemmers import Stemmer
        from sumy.utils import get_stop_words

        parser = PlaintextParser.from_string(text, Tokenizer("english"))
        stemmer = Stemmer("english")
        summarizer = LsaSummarizer(stemmer)
        summarizer.stop_words = get_stop_words("english")
        sentences = summarizer(parser.document, sentence_count)
        return " ".join(str(s) for s in sentences)
    except ImportError:
        # sumy not installed — fall back to first N sentences
        sentences = re.split(r'(?<=[.!?])\s+', text.strip())
        return " ".join(sentences[:sentence_count])
    except Exception as e:
        logger.debug(f"sumy failed: {e}")
        sentences = re.split(r'(?<=[.!?])\s+', text.strip())
        return " ".join(sentences[:sentence_count])


def _extract_keywords(text: str, max_ngram: int = 2, top_n: int = 5) -> list[str]:
    """Extract keywords using YAKE (Yet Another Keyword Extractor)."""
    try:
        import yake
        kw = yake.KeywordExtractor(lan="en", n=max_ngram, top=top_n, dedupLim=0.7)
        results = kw.extract_keywords(text)
        # YAKE returns (keyword, score) — lower score = more relevant
        return [kw for kw, _ in results]
    except ImportError:
        # yake not installed — use simple word frequency
        return _freq_keywords(text, top_n)
    except Exception as e:
        logger.debug(f"yake failed: {e}")
        return _freq_keywords(text, top_n)


def _freq_keywords(text: str, top_n: int) -> list[str]:
    """Fallback: top N words by frequency, excluding stop words."""
    STOP = {
        "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
        "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
        "have", "has", "had", "do", "does", "did", "will", "would", "could",
        "should", "may", "might", "this", "that", "these", "those", "it", "its",
        "we", "you", "he", "she", "they", "not", "as", "if", "so", "than",
        "into", "about", "up", "can", "also", "which", "when", "there",
    }
    words = re.findall(r'\b[a-z][a-z0-9\-]{2,}\b', text.lower())
    freq: dict[str, int] = {}
    for w in words:
        if w not in STOP:
            freq[w] = freq.get(w, 0) + 1
    return [w for w, _ in sorted(freq.items(), key=lambda x: -x[1])[:top_n]]


def _classify_status_rules(title: str, body: str) -> str:
    """Rule-based status classification — works without LLM."""
    text = (title + " " + body[:500]).lower()
    title_l = title.lower()

    # Closed / released signals
    if any(w in title_l for w in ["[result]", "[announce]", "released", "merged", "closed"]):
        if any(w in text for w in ["released", "shipped", "available", "merged"]):
            return "released"
        return "abandoned"

    # Vote in progress
    if any(w in title_l for w in ["[vote]", "[graduation vote]"]):
        return "proposal"

    # Active implementation
    if any(w in text for w in ["pull request", "pr #", "draft pr", "implementation pr",
                                 "opened pr", "submitted pr"]):
        return "implementation"

    # Formal proposal / RFC
    if any(w in title_l for w in ["[proposal]", "[rfc]", "[spec]", "[pip-", "spip-", "iep-"]):
        return "proposal"

    # Discussion
    if any(w in title_l for w in ["[discuss]", "[question]", "[help]"]):
        return "discussion"

    # Default: discussion
    return "discussion"


# ---------------------------------------------------------------------------
# Main client class
# ---------------------------------------------------------------------------

class LocalNLPClient:
    """
    Drop-in replacement for LLMClient that uses only local NLP libraries.
    All methods return the same dict shape as LLMClient.
    """

    provider = "local"
    model = "local-nlp"

    def complete(self, system: str, user: str, max_tokens: int = 512, temperature=None) -> str:
        raise NotImplementedError(
            "LocalNLPClient does not support free-form completion. "
            "Use the structured summarize_* methods instead."
        )

    def summarize_vote(self, title: str, body: str, vote_data: dict) -> dict:
        """Generate a structured summary for a vote thread using parsed vote data."""
        result = vote_data.get("result", "open")
        binding = vote_data.get("binding_plus1", 0)
        nonbinding = vote_data.get("nonbinding_plus1", 0)
        vetoes = vote_data.get("vetoes", 0)

        if result == "passed":
            outcome = f"Vote PASSED with {binding} binding +1 vote{'s' if binding != 1 else ''}"
            if nonbinding:
                outcome += f" and {nonbinding} non-binding +1"
            if vetoes:
                outcome += f" (note: {vetoes} veto present)"
            status = "released"
        elif result == "vetoed":
            outcome = f"Vote VETOED — {vetoes} veto(es) recorded"
            status = "abandoned"
        else:
            outcome = f"Vote in progress: {binding} binding +1"
            if nonbinding:
                outcome += f", {nonbinding} non-binding +1"
            if vetoes:
                outcome += f", {vetoes} -1"
            status = "proposal"

        # Key points: first sentence of body + voter list
        key_points = []
        first_sentence = re.split(r'(?<=[.!?])\s+', body.strip())[0] if body else ""
        if len(first_sentence) > 20:
            key_points.append(first_sentence[:150])

        voters = vote_data.get("voters", [])[:5]
        if voters:
            voter_names = ", ".join(v["voter"].split("<")[0].strip() for v in voters[:3])
            key_points.append(f"Voters include: {voter_names}...")

        keywords = _extract_keywords(f"{title} {body[:1000]}", top_n=4)
        return {
            "summary": outcome,
            "status": status,
            "key_points": key_points,
            "topics": [re.sub(r"[^a-z0-9]+", "-", kw.lower()).strip("-") for kw in keywords],
        }

    def summarize_thread(self, title: str, body: str, replies: list[str],
                         doc_content: str = "", vote_data: dict | None = None) -> dict:
        """Extractive summary of a mailing list thread or GitHub issue."""
        # Use structured vote analysis if available
        if vote_data:
            return self.summarize_vote(title, body, vote_data)

        # Combine body and recent replies into one block (replies already truncated upstream)
        all_text = body[:3000]
        for r in replies[:25]:
            all_text += "\n\n" + r[:500]
        if doc_content:
            all_text += "\n\n" + doc_content[:1000]

        summary = _sumy_summarize(all_text, sentence_count=3)
        keywords = _extract_keywords(f"{title} {all_text[:2000]}", top_n=4)
        status = _classify_status_rules(title, body)

        # Build key points from top replies (first sentence of each)
        key_points = []
        for r in replies[:8]:
            first_sentence = re.split(r'(?<=[.!?])\s+', r.strip())[0]
            if len(first_sentence) > 20:
                key_points.append(first_sentence[:120])
        key_points = key_points[:3]

        return {
            "summary": summary or title,
            "status": status,
            "key_points": key_points,
            "topics": [re.sub(r"[^a-z0-9]+", "-", kw.lower()).strip("-") for kw in keywords],
        }

    def summarize_video(self, title: str, description: str, transcript: str) -> dict:
        """Extractive summary of a community sync video."""
        text = (description or "") + "\n\n" + (transcript or "")
        summary = _sumy_summarize(text[:4000], sentence_count=3)
        keywords = _extract_keywords(f"{title} {text[:2000]}", top_n=4)

        return {
            "summary": summary or title,
            "key_points": [],
            "topics": [re.sub(r"[^a-z0-9]+", "-", kw.lower()).strip("-") for kw in keywords],
        }

    def summarize_doc(self, title: str, content: str) -> dict:
        """Extractive summary of a design document."""
        summary = _sumy_summarize(content[:5000], sentence_count=3)
        keywords = _extract_keywords(f"{title} {content[:3000]}", top_n=4)
        status = _classify_status_rules(title, content[:500])

        # First few sentences as key points
        sentences = re.split(r'(?<=[.!?])\s+', content.strip())
        key_points = [s for s in sentences[1:6] if len(s) > 30][:3]

        topics = [re.sub(r"[^a-z0-9]+", "-", kw.lower()).strip("-") for kw in _extract_keywords(f"{title} {content[:3000]}", top_n=4)]

        return {
            "summary": summary or title,
            "status": status,
            "key_points": key_points,
            "topics": topics,
        }

    def classify_status(self, title: str, body: str) -> str:
        return _classify_status_rules(title, body)

    def _parse_json(self, raw: str, fallback: dict) -> dict:
        # Not called for local client, but here for interface compatibility
        return fallback
