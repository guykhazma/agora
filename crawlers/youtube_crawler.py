"""
YouTube crawler — no API key required.

Uses the public YouTube channel RSS feed to discover videos, then
youtube-transcript-api (also no key) to fetch transcripts for LLM summarization.
If a transcript isn't available the video still appears in the dashboard as a link.
"""

from __future__ import annotations
import logging
import re
import xml.etree.ElementTree as ET
from typing import Optional
import requests

logger = logging.getLogger(__name__)

RSS_URL = "https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
NS = {
    "atom":  "http://www.w3.org/2005/Atom",
    "yt":    "http://www.youtube.com/xml/schemas/2015",
    "media": "http://search.yahoo.com/mrss/",
}


def _fetch_rss(channel_id: str) -> list[dict]:
    """Fetch video list from public YouTube RSS feed. No API key needed."""
    url = RSS_URL.format(channel_id=channel_id)
    resp = requests.get(url, timeout=20)
    resp.raise_for_status()

    root = ET.fromstring(resp.content)
    videos = []
    for entry in root.findall("atom:entry", NS):
        vid_id_el = entry.find("yt:videoId", NS)
        title_el  = entry.find("atom:title", NS)
        link_el   = entry.find("atom:link", NS)
        pub_el    = entry.find("atom:published", NS)
        desc_el   = entry.find(".//media:description", NS)

        if vid_id_el is None or title_el is None:
            continue

        vid_id = vid_id_el.text or ""
        videos.append({
            "video_id":     vid_id,
            "title":        title_el.text or "",
            "url":          f"https://www.youtube.com/watch?v={vid_id}",
            "published_at": pub_el.text if pub_el is not None else "",
            "description":  (desc_el.text or "")[:400] if desc_el is not None else "",
        })

    return videos


def _fetch_transcript(video_id: str) -> str:
    """
    Fetch auto-generated transcript. No API key needed.
    Returns empty string if captions are unavailable.
    """
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        entries = YouTubeTranscriptApi.get_transcript(video_id, languages=["en", "en-US"])
        return " ".join(e["text"] for e in entries)
    except ImportError:
        logger.warning("youtube-transcript-api not installed — pip install youtube-transcript-api")
        return ""
    except Exception:
        return ""


def _is_relevant(title: str, keywords: list[str]) -> bool:
    if not keywords:
        return True
    lower = title.lower()
    return any(k.lower() in lower for k in keywords)


def crawl(project_config: dict, since: Optional[str] = None) -> list[dict]:
    """
    Fetch community videos for the project via RSS (no API key needed).
    Videos without transcripts still appear in the dashboard as links.
    """
    yt_config = project_config.get("youtube", {})
    channel_id = yt_config.get("channel_id", "")
    if not channel_id:
        return []

    keywords  = yt_config.get("keywords", [])
    max_vids  = yt_config.get("max_videos", 30)
    project_id = project_config["id"]

    try:
        raw = _fetch_rss(channel_id)
    except Exception as e:
        logger.error(f"YouTube RSS fetch failed for {channel_id}: {e}")
        return []

    results = []
    for v in raw[:max_vids]:
        if since and v["published_at"] and v["published_at"] < since:
            continue
        if not _is_relevant(v["title"], keywords):
            continue

        transcript = _fetch_transcript(v["video_id"])

        results.append({
            "id":         f"{project_id}-yt-{v['video_id']}",
            "source":     "youtube",
            "kind":       "video",
            "title":      v["title"],
            "url":        v["url"],
            "author":     "community",
            "state":      "open",
            "created_at": v["published_at"],
            "updated_at": v["published_at"],
            "body":       v["description"],
            "labels":     ["community-sync"],
            "linked_resources": [],
            "llm_summary":  None,
            "llm_status":   "released",
            "comment_count": 0,
            # Internal fields stripped before writing
            "_transcript": transcript[:8000] if transcript else "",
            "_has_transcript": bool(transcript),
        })

    logger.info(
        f"YouTube: {len(results)} videos "
        f"({sum(1 for r in results if r['_has_transcript'])} with transcripts)"
    )
    return results
