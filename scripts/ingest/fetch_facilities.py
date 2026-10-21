"""Fetch essential-service facilities around the Elizabeth study area from OpenStreetMap.

Six service categories (the set REACH uses for service access, adapted to OSM
tags in Charlotte). The fetch box extends well past the street-graph bounds so
that a home near the edge of the study area can be checked against facilities
just outside it: those are used for straight-line screening only, because the
modeled pedestrian network stops at the study-area boundary.

Output: data/samples/charlotte_elizabeth/facilities.geojson (points; parks keep
their polygon). Every feature keeps its OSM id; the retrieval time is recorded.
Usage: uv run --project services/api python scripts/ingest/fetch_facilities.py
"""

from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from shapely.geometry import Polygon, mapping

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "data" / "cache" / "overpass_facilities.json"
OUT = ROOT / "data" / "samples" / "charlotte_elizabeth" / "facilities.geojson"
BOX = (-80.850, 35.192, -80.801, 35.232)  # west, south, east, north: graph bounds plus about 1.2 km
UA = {"User-Agent": "StreetMend/0.3 (hackathon research prototype)"}
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter"]

# OSM tag -> (category, kind). Order matters: the first match wins.
RULES: list[tuple[str, set[str] | None, str]] = [
    ("amenity", {"hospital", "clinic", "doctors", "dentist", "pharmacy"}, "healthcare"),
    ("healthcare", {"hospital", "clinic", "doctor", "pharmacy", "centre", "nurse", "rehabilitation", "dentist"}, "healthcare"),
    ("amenity", {"school", "kindergarten", "college", "university"}, "education"),
    ("shop", {"supermarket", "grocery", "greengrocer"}, "grocery"),
    ("highway", {"bus_stop"}, "transit"),
    ("railway", {"tram_stop", "station", "halt"}, "transit"),
    ("leisure", {"park", "playground", "nature_reserve"}, "parks"),
    ("leisure", {"garden"}, "parks"),  # public or community gardens only, see classify()
    ("amenity", {"post_office", "bank", "library", "community_centre", "social_facility", "police", "fire_station", "townhall"}, "services"),
]


def log(*a):
    print("[facilities]", *a, file=sys.stderr)


def query() -> str:
    w, s, e, n = BOX
    b = f"({s},{w},{n},{e})"
    parts = [
        f'nwr["amenity"~"^(hospital|clinic|doctors|dentist|pharmacy|school|kindergarten|college|university|post_office|bank|library|community_centre|social_facility|police|fire_station|townhall)$"]{b};',
        f'nwr["healthcare"]{b};',
        f'nwr["shop"~"^(supermarket|grocery|greengrocer)$"]{b};',
        f'node["highway"="bus_stop"]{b};',
        f'node["railway"~"^(tram_stop|station|halt)$"]{b};',
        f'nwr["leisure"~"^(park|playground|garden|nature_reserve)$"]{b};',
    ]
    return "[out:json][timeout:120];(" + "".join(parts) + ");out tags geom;"


def fetch() -> dict:
    if CACHE.exists():
        return json.loads(CACHE.read_text(encoding="utf-8"))
    data = urllib.parse.urlencode({"data": query()}).encode()
    last = None
    for attempt in range(6):
        url = OVERPASS[attempt % len(OVERPASS)]
        try:
            req = urllib.request.Request(url, data=data, headers=UA)
            with urllib.request.urlopen(req, timeout=150) as r:
                out = json.loads(r.read())
            out["_retrieved"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
            out["_endpoint"] = url
            CACHE.parent.mkdir(parents=True, exist_ok=True)
            CACHE.write_text(json.dumps(out), encoding="utf-8")
            return out
        except Exception as exc:  # network errors: try the next mirror
            last = exc
            log("retry", url, exc)
            time.sleep(3 + attempt * 2)
    raise RuntimeError(f"Overpass failed: {last}")


def classify(tags: dict) -> str | None:
    if tags.get("leisure") == "garden" and not (tags.get("garden:type") == "community" or tags.get("access") in ("yes", "public")):
        return None  # landscaping beds and private gardens are not parks
    for key, values, cat in RULES:
        v = tags.get(key)
        if v and (values is None or v in values):
            return cat
    return None


def kind_of(tags: dict) -> str:
    for key in ("amenity", "healthcare", "shop", "railway", "highway", "public_transport", "leisure"):
        if tags.get(key):
            return f"{key}={tags[key]}"
    return "unknown"


def main() -> None:
    raw = fetch()
    feats = []
    seen: set[str] = set()
    for el in raw["elements"]:
        tags = el.get("tags", {})
        cat = classify(tags)
        if not cat:
            continue
        oid = f"{el['type']}/{el['id']}"
        if oid in seen:
            continue
        seen.add(oid)
        if el["type"] == "node":
            geom = {"type": "Point", "coordinates": [el["lon"], el["lat"]]}
            point = (el["lon"], el["lat"])
        else:
            ring = [(p["lon"], p["lat"]) for p in el.get("geometry", []) if p]
            if el["type"] == "relation":
                ring = [(p["lon"], p["lat"]) for m in el.get("members", []) if m.get("role") == "outer" for p in m.get("geometry", [])]
            if len(ring) < 3:
                continue
            poly = Polygon(ring).buffer(0)
            if poly.is_empty:
                continue
            c = poly.representative_point()
            point = (round(c.x, 7), round(c.y, 7))
            geom = mapping(poly) if cat == "parks" else {"type": "Point", "coordinates": list(point)}
        name = tags.get("name") or tags.get("ref") or ""
        if cat == "transit" and not name:
            name = "Bus stop" if tags.get("highway") == "bus_stop" else "Transit stop"
        feats.append({"type": "Feature", "geometry": geom, "properties": {
            "id": f"osm:{oid}", "category": cat, "kind": kind_of(tags), "name": name or f"Unnamed {kind_of(tags).split('=')[-1].replace('_', ' ')}",
            "point": list(point), "source": "osm",
        }})
    feats.sort(key=lambda f: (f["properties"]["category"], f["properties"]["id"]))
    out = {"type": "FeatureCollection", "features": feats, "properties": {
        "source": "OpenStreetMap contributors (ODbL), via Overpass API", "endpoint": raw.get("_endpoint"),
        "retrieved": raw.get("_retrieved"), "bbox": BOX,
        "categories": {c: sum(1 for f in feats if f["properties"]["category"] == c) for c in sorted({r[2] for r in RULES})},
    }}
    OUT.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    log("wrote", OUT, len(feats), out["properties"]["categories"])


if __name__ == "__main__":
    main()
