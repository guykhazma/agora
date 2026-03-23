"""
LLM provider abstraction.
Supports: openai, anthropic, google, ollama, llama_cpp, groq, github_models
Set via LLM_PROVIDER env var (default: openai)
llama_cpp: points to llama-server OpenAI-compatible API (default: http://localhost:8080/v1)
github_models: free inference via GitHub Models API using GITHUB_TOKEN (great for CI)
"""

from __future__ import annotations
import hashlib
import json
import logging
import os
import re
import time
from typing import Optional

logger = logging.getLogger(__name__)


def get_client():
    """
    Return an LLMClient (cloud) or LocalNLPClient (local extractive NLP).

    Priority: explicit LLM_PROVIDER env > anthropic > groq > openai > google > github_models > local
    When no API key is available, falls back to local NLP (sumy + yake) at zero cost.
    github_models uses GITHUB_TOKEN (always present in GitHub Actions) — free for public repos.
    """
    provider = os.environ.get("LLM_PROVIDER", "").lower()
    if not provider:
        if os.environ.get("ANTHROPIC_API_KEY"):
            provider = "anthropic"
        elif os.environ.get("GROQ_API_KEY"):
            provider = "groq"
        elif os.environ.get("OPENAI_API_KEY"):
            provider = "openai"
        elif os.environ.get("GOOGLE_API_KEY"):
            provider = "google"
        elif os.environ.get("GITHUB_TOKEN"):
            provider = "github_models"
        else:
            provider = "local"

    if provider == "local":
        from llm.local_nlp import LocalNLPClient
        logger.info("No LLM API key found — using local extractive NLP (sumy + yake)")
        return LocalNLPClient()

    model = os.environ.get("LLM_MODEL", "")
    api_key = os.environ.get("LLM_API_KEY", "")
    return LLMClient(provider=provider, model=model or None, api_key=api_key or None)


def content_hash(text: str) -> str:
    """Short hash of content used to detect changes since last summarization."""
    return hashlib.sha1(text.encode()).hexdigest()[:12]


class LLMClient:
    DEFAULTS = {
        "openai":         "gpt-4o-mini",
        "anthropic":      "claude-haiku-4-5-20251001",  # fast + cheap; set LLM_MODEL=claude-sonnet-4-6 for best quality
        "google":         "gemini-2.0-flash",
        "ollama":         "llama3",
        "llama_cpp":      "local",   # model is loaded server-side; any string works
        "groq":           "llama-3.3-70b-versatile",    # best free model; 6k TPM → use 10s delay
        "github_models":  "gpt-4o-mini",                # free via GitHub token; 150 req/hr for public repos
    }

    def __init__(self, provider: str, model: Optional[str] = None, api_key: Optional[str] = None):
        self.provider = provider
        self.model = model or self.DEFAULTS.get(provider, "")
        self.api_key = api_key
        self._client = None

    def _ensure_client(self):
        if self._client is not None:
            return
        p = self.provider
        if p == "openai":
            import openai
            self._client = openai.OpenAI(api_key=self.api_key or os.environ.get("OPENAI_API_KEY"))
        elif p == "anthropic":
            import anthropic
            self._client = anthropic.Anthropic(api_key=self.api_key or os.environ.get("ANTHROPIC_API_KEY"))
        elif p == "google":
            import google.generativeai as genai
            genai.configure(api_key=self.api_key or os.environ.get("GOOGLE_API_KEY"))
            self._client = genai.GenerativeModel(self.model)
        elif p == "ollama":
            import openai
            self._client = openai.OpenAI(
                api_key="ollama",
                base_url=os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434/v1"),
            )
        elif p == "llama_cpp":
            import openai
            self._client = openai.OpenAI(
                api_key="llama_cpp",
                base_url=os.environ.get("LLAMA_CPP_BASE_URL", "http://localhost:8080/v1"),
            )
        elif p == "groq":
            import openai
            self._client = openai.OpenAI(
                api_key=self.api_key or os.environ.get("GROQ_API_KEY"),
                base_url="https://api.groq.com/openai/v1",
            )
        elif p == "github_models":
            import openai
            self._client = openai.OpenAI(
                api_key=self.api_key or os.environ.get("GITHUB_TOKEN"),
                base_url="https://models.inference.ai.azure.com",
            )
        else:
            raise ValueError(
                f"Unknown LLM provider: {self.provider!r}. "
                "Set LLM_PROVIDER to one of: openai, anthropic, google, ollama, groq, github_models"
            )

    def complete(self, system: str, user: str, max_tokens: int = 512,
                 temperature: Optional[float] = None, _retries: int = 4) -> str:
        self._ensure_client()
        p = self.provider
        temp = 0.2 if temperature is None else temperature

        for attempt in range(_retries):
            try:
                if p in ("openai", "ollama", "llama_cpp", "groq", "github_models"):
                    resp = self._client.chat.completions.create(
                        model=self.model,
                        messages=[{"role": "system", "content": system},
                                  {"role": "user", "content": user}],
                        max_tokens=max_tokens,
                        temperature=temp,
                    )
                    return resp.choices[0].message.content.strip()

                elif p == "anthropic":
                    resp = self._client.messages.create(
                        model=self.model,
                        max_tokens=max_tokens,
                        temperature=temp,
                        system=system,
                        messages=[{"role": "user", "content": user}],
                    )
                    return resp.content[0].text.strip()

                elif p == "google":
                    prompt = f"{system}\n\n{user}"
                    resp = self._client.generate_content(prompt)
                    return resp.text.strip()

            except Exception as e:
                err_text = str(e).lower()
                # OpenAI returns HTTP 429 for both RPM limits and zero billing — only the latter is non-retryable.
                if p == "openai" and (
                    "insufficient_quota" in err_text
                    or "exceeded your current quota" in err_text
                ):
                    logger.error(
                        "OpenAI rejected the request for billing/quota (not a spacing issue). "
                        "Check platform.openai.com → Billing and that this API key belongs to the same org/project. "
                        "ChatGPT Plus does not fund the API."
                    )
                    raise
                is_rate_limit = "429" in str(e) or "rate" in err_text or "quota" in err_text
                if is_rate_limit and attempt < _retries - 1:
                    wait = 2 ** (attempt + 1)   # 2, 4, 8, 16 seconds
                    logger.warning(f"Rate limited by {p} — waiting {wait}s (attempt {attempt + 1}/{_retries})")
                    time.sleep(wait)
                else:
                    raise

    def _parse_json(self, raw: str, fallback: dict) -> dict:
        # Strip markdown code fences
        cleaned = raw.strip()
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
        cleaned = cleaned.strip()

        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            pass

        # Fallback: model returned unquoted string values (common with llama).
        # Quote any unquoted values after "key": <unquoted text>
        try:
            fixed = re.sub(
                r'("(?:summary|status)"\s*:\s*)([^"\[{][^,}\n]*?)(\s*[,}])',
                lambda m: m.group(1) + '"' + m.group(2).strip().replace('"', '\\"') + '"' + m.group(3),
                cleaned,
            )
            return json.loads(fixed)
        except Exception:
            pass

        # Last resort: extract fields individually with regex
        result = dict(fallback)
        m = re.search(r'"summary"\s*:\s*"([^"]+)"', cleaned)
        if not m:
            m = re.search(r'"summary"\s*:\s*([^,}\n]+)', cleaned)
        if m:
            result["summary"] = m.group(1).strip().strip('"')

        m = re.search(r'"status"\s*:\s*"?(\w+)"?', cleaned)
        if m:
            result["status"] = m.group(1).strip()

        points = re.findall(r'"([^"]{10,})"', cleaned)
        if points and "key_points" not in result:
            result["key_points"] = points[:4]

        if "summary" not in result:
            result["summary"] = cleaned[:300]

        logger.warning(f"LLM non-JSON recovered partially: {cleaned[:80]}")
        return result

    # ------------------------------------------------------------------
    # Summarization methods
    # ------------------------------------------------------------------

    def summarize_thread(self, title: str, body: str, replies: list[str],
                         doc_content: str = "", vote_data: dict | None = None) -> dict:
        """Summarize a mailing list thread or GitHub issue."""
        # Vote threads: use structured local analysis — no LLM token cost needed
        if vote_data:
            from llm.local_nlp import LocalNLPClient
            return LocalNLPClient().summarize_vote(title, body, vote_data)

        from llm.prompts import THREAD_SUMMARY_SYSTEM, thread_summary_user
        user_msg = thread_summary_user(title=title, body=body, replies=replies,
                                       doc_content=doc_content)
        raw = self.complete(THREAD_SUMMARY_SYSTEM, user_msg, max_tokens=600)
        return self._parse_json(raw, {"status": "discussion", "key_points": []})

    def summarize_video(self, title: str, description: str, transcript: str) -> dict:
        """Summarize a community sync video from its transcript."""
        from llm.prompts import VIDEO_SUMMARY_SYSTEM, video_summary_user
        if not transcript and not description:
            return {"summary": title, "key_points": [], "topics": []}
        user_msg = video_summary_user(title=title, description=description, transcript=transcript)
        raw = self.complete(VIDEO_SUMMARY_SYSTEM, user_msg, max_tokens=600)
        return self._parse_json(raw, {"key_points": [], "topics": []})

    def summarize_doc(self, title: str, content: str) -> dict:
        """Summarize a Google Doc design document."""
        from llm.prompts import DOC_SUMMARY_SYSTEM, doc_summary_user
        if not content:
            return {"summary": "", "status": "proposal", "key_points": []}
        user_msg = doc_summary_user(title=title, content=content)
        raw = self.complete(DOC_SUMMARY_SYSTEM, user_msg, max_tokens=500)
        return self._parse_json(raw, {"status": "proposal", "key_points": []})

    def summarize_doc_delta(
        self,
        title: str,
        previous_summary: str,
        previous_key_points: list[str],
        delta_excerpt: str,
    ) -> dict:
        """Update a doc summary from an append-only text delta (see crawl.py)."""
        from llm.prompts import DOC_DELTA_SYSTEM, doc_delta_user
        if not delta_excerpt.strip():
            return {
                "summary": previous_summary or "",
                "status": "discussion",
                "key_points": list(previous_key_points or []),
                "topics": [],
            }
        user_msg = doc_delta_user(
            title=title,
            previous_summary=previous_summary or "",
            previous_key_points=list(previous_key_points or []),
            delta_excerpt=delta_excerpt,
        )
        raw = self.complete(DOC_DELTA_SYSTEM, user_msg, max_tokens=600)
        return self._parse_json(raw, {"status": "discussion", "key_points": [], "topics": []})

    def classify_status(self, title: str, body: str) -> str:
        from llm.prompts import STATUS_SYSTEM, status_user
        raw = self.complete(STATUS_SYSTEM, status_user(title=title, body=body), max_tokens=20)
        valid = {"idea", "discussion", "proposal", "implementation", "released", "abandoned"}
        result = raw.strip().lower().split()[0] if raw.strip() else "discussion"
        return result if result in valid else "discussion"
