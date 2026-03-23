"""Extract external resource links from text (Google Docs, Sheets, Slides, Drive, GitHub)."""

import re
from typing import NamedTuple


GOOGLE_DOC_PATTERN = re.compile(
    r'https://docs\.google\.com/(?:document|spreadsheets|presentation|forms|drawings)/d/[A-Za-z0-9_\-]+[^\s\)\]"\'<>]*'
)
GOOGLE_DRIVE_PATTERN = re.compile(
    r'https://drive\.google\.com/(?:file/d|drive/folders|open\?id=)[^\s\)\]"\'<>]+'
)
GITHUB_PR_PATTERN = re.compile(
    r'https://github\.com/[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+/pull/\d+'
)
GITHUB_ISSUE_PATTERN = re.compile(
    r'https://github\.com/[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+/issues/\d+'
)
# "closes #123", "fixes #456", "resolves #789" — bare references in PR/issue bodies
GITHUB_CLOSES_PATTERN = re.compile(
    r'(?:closes?|fixes?|resolves?)\s+#(\d+)',
    re.IGNORECASE,
)


class ExtractedLink(NamedTuple):
    url: str
    kind: str  # google_doc | google_drive | github_pr | github_issue | other


def extract_links(text: str, repo: str = "") -> list[ExtractedLink]:
    """
    Return all notable external links found in text, deduplicated.

    repo: optional "owner/name" string — when provided, bare "closes #N" / "fixes #N"
          references are resolved to full GitHub issue URLs and included.
    """
    seen = set()
    results = []

    def add(url: str, kind: str):
        clean = url.rstrip(".,;)")
        if clean not in seen:
            seen.add(clean)
            results.append(ExtractedLink(url=clean, kind=kind))

    for m in GOOGLE_DOC_PATTERN.finditer(text):
        add(m.group(), "google_doc")
    for m in GOOGLE_DRIVE_PATTERN.finditer(text):
        add(m.group(), "google_drive")
    for m in GITHUB_PR_PATTERN.finditer(text):
        add(m.group(), "github_pr")
    for m in GITHUB_ISSUE_PATTERN.finditer(text):
        add(m.group(), "github_issue")

    # Bare closes/fixes/resolves references — only meaningful when repo is known
    if repo and "/" in repo:
        for m in GITHUB_CLOSES_PATTERN.finditer(text):
            num = m.group(1)
            add(f"https://github.com/{repo}/issues/{num}", "github_issue")

    return results
