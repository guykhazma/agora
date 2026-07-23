"""
Atomic file writes.

An unattended CI job can be cancelled, time out, or OOM mid-write. A plain
open("w")/write_text truncates the target in place, so an interruption leaves a
half-written proposals.json that the *next* run reads back as corrupt or empty — and
then commits. Writing to a temp file in the same directory and os.replace()-ing it in
is atomic on POSIX, so readers only ever see a complete old or complete new file.

Pure stdlib (safe to import at deploy time without the crawler dependencies installed).
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path


def write_text_atomic(path, text: str, *, encoding: str = "utf-8") -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding=encoding) as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def write_json_atomic(path, obj, **json_kwargs) -> None:
    """Atomically write `obj` as JSON. Accepts any json.dumps kwargs (indent, default, ...)."""
    write_text_atomic(path, json.dumps(obj, **json_kwargs))
