"""Charlotte municipal scenario loader (prepared by scripts/ingest)."""

from __future__ import annotations

import os
from pathlib import Path

DATA_DIR = Path(os.environ.get("STREETMEND_DATA", Path(__file__).resolve().parents[4] / "data"))
AREA_DIR = DATA_DIR / "samples" / "charlotte_elizabeth"


def _require(name: str) -> Path:
    p = AREA_DIR / name
    if not p.exists():
        raise FileNotFoundError(str(p))
    return p


def load_records():
    import json

    return json.loads(_require("records.json").read_text(encoding="utf-8"))


def load_municipal_scenario():
    _require("network.json")
    raise FileNotFoundError("municipal network builder not yet available")
