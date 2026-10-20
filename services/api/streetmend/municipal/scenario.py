"""Charlotte municipal scenario loader (data prepared by scripts/ingest)."""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

from .build import POLICIES, build_municipal, classify_ramp, survey_iso

DATA_DIR = Path(os.environ.get("STREETMEND_DATA", Path(__file__).resolve().parents[4] / "data"))
AREA_DIR = DATA_DIR / "samples" / "charlotte_elizabeth"
REQUIRED = ["ramps.geojson", "sidewalks.geojson", "bus_stops.geojson", "osm_streets.geojson", "osm_nodes.geojson",
            "osm_pois.geojson", "osm_buildings.geojson", "osm_residential.geojson", "provenance.json", "quality.json"]


def _require() -> None:
    missing = [n for n in REQUIRED if not (AREA_DIR / n).exists()]
    if missing:
        raise FileNotFoundError(f"{AREA_DIR}: missing {', '.join(missing)}")


@lru_cache(maxsize=4)
def load_municipal_scenario(policy: str = "moderate"):
    _require()
    sc, report = build_municipal(AREA_DIR, policy)
    prov = json.loads((AREA_DIR / "provenance.json").read_text(encoding="utf-8"))
    sc.provenance = prov + [{"id": "streetmend-build", "name": "StreetMend candidate graph construction", "kind": "inferred",
                             "description": "Corners, curb landings, crossings and access connectors inferred by streetmend.municipal.build."}]
    sc.context = {"build_report": report, "policy": policy, "policies": POLICIES}
    return sc


@lru_cache(maxsize=1)
def load_records() -> dict[str, Any]:
    """Source records for the explorer view, with per-policy classification."""

    _require()
    ramps = json.loads((AREA_DIR / "ramps.geojson").read_text(encoding="utf-8"))
    for f in ramps["features"]:
        p = f["properties"]
        p["survey_date"] = survey_iso(p.get("RP_SurveyDate"))
        p["classification"] = {pol: classify_ramp(p, pol).category for pol in POLICIES}
        p["state"] = {pol: classify_ramp(p, pol).state.value for pol in POLICIES}
    return {
        "area": {"id": "charlotte-elizabeth", "name": "Elizabeth, Charlotte NC", "bbox": json.loads((AREA_DIR / "quality.json").read_text(encoding="utf-8"))["area"]["bbox"]},
        "provenance": json.loads((AREA_DIR / "provenance.json").read_text(encoding="utf-8")),
        "quality": json.loads((AREA_DIR / "quality.json").read_text(encoding="utf-8")),
        "ramps": ramps["features"],
        "sidewalks": json.loads((AREA_DIR / "sidewalks.geojson").read_text(encoding="utf-8"))["features"],
        "bus_stops": json.loads((AREA_DIR / "bus_stops.geojson").read_text(encoding="utf-8"))["features"],
        "policies": POLICIES,
    }
