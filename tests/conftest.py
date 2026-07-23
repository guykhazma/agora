"""Put the repo root on sys.path so `crawlers.*` / `scripts.*` import under pytest."""
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
