"""Vercel entry point: the StreetMend FastAPI engine as one Python function.

The repository layout is kept in the bundle (services/api for the package, data/ for the
prepared Charlotte data), so the engine finds its files exactly as it does locally.
"""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "services" / "api"))
os.environ.setdefault("STREETMEND_DATA", str(ROOT / "data"))
os.environ.setdefault("STREETMEND_LLM", "0")  # no local model on a public host: the rule parser answers

from streetmend.api.main import app  # noqa: E402,F401
