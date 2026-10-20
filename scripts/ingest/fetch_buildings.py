"""Fetch OpenStreetMap building footprints for the 3D city area of interest.

The area of interest (AOI) covers the Elizabeth study area plus the eastern
edge of Uptown, so the 3D view has real skyline context. Output is a compact
GeoJSON with footprint rings (WGS84, 6 decimals ~ 0.1 m), and a height in metres
with its provenance:

  height_source = "height"  : OSM height / building:height tag
                  "levels"  : OSM building:levels x 3.2 m (+ roof levels)
                  "estimate": no tag; a type-based visualization assumption

    uv run --project services/api python scripts/ingest/fetch_buildings.py
"""

from __future__ import annotations

import json
import math
import re
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "data" / "cache"
OUT = ROOT / "data" / "samples" / "charlotte_city" / "buildings.geojson"
AOI = (-80.848, 35.200, -80.810, 35.230)  # west, south, east, north
UA = {"User-Agent": "StreetMend/0.2 (hackathon research prototype)"}
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter"]

# Visualization defaults when OSM has neither height nor levels (metres).
DEFAULT_HEIGHT = {"house": 7.0, "detached": 7.0, "semidetached_house": 7.0, "bungalow": 5.0, "garage": 3.0, "garages": 3.0,
                  "shed": 2.5, "carport": 3.0, "roof": 4.0, "apartments": 12.0, "residential": 9.0, "terrace": 8.0,
                  "dormitory": 15.0, "commercial": 9.0, "retail": 6.0, "office": 14.0, "hospital": 22.0, "school": 9.0,
                  "college": 14.0, "university": 14.0, "church": 12.0, "parking": 12.0, "industrial": 8.0,
                  "warehouse": 8.0, "hotel": 20.0, "civic": 10.0, "public": 10.0, "yes": 7.0}


def log(*a):
    print("[buildings]", *a, file=sys.stderr)


def parse_len(v: str | None) -> float | None:
    if not v:
        return None
    m = re.match(r"\s*([\d.]+)\s*(m|ft|')?", v)
    if not m:
        return None
    x = float(m.group(1))
    return x * 0.3048 if m.group(2) in ("ft", "'") else x


def height_of(tags: dict) -> tuple[float, float, str]:
    h = parse_len(tags.get("height") or tags.get("building:height"))
    mh = parse_len(tags.get("min_height") or tags.get("building:min_height")) or 0.0
    if h:
        return h, mh, "height"
    try:
        lv = float(tags.get("building:levels", "").split(";")[0])
        rl = float(tags.get("roof:levels", "0").split(";")[0] or 0)
        if lv > 0:
            return (lv + rl) * 3.2, mh, "levels"
    except ValueError:
        pass
    return DEFAULT_HEIGHT.get(tags.get("building", "yes"), 7.0), mh, "estimate"


def overpass() -> dict:
    w, s, e, n = AOI
    q = f"[out:json][timeout:180];(way[\"building\"]({s},{w},{n},{e});relation[\"building\"][\"type\"=\"multipolygon\"]({s},{w},{n},{e}););out tags geom;"
    cache = CACHE / "overpass_buildings.json"
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    last = None
    for attempt in range(6):
        url = OVERPASS[attempt % len(OVERPASS)]
        try:
            log("overpass", url)
            r = httpx.post(url, data={"data": q}, timeout=200, headers=UA)
            r.raise_for_status()
            data = r.json()
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(json.dumps(data), encoding="utf-8")
            return data
        except Exception as exc:
            last = exc
            log(f"failed: {type(exc).__name__} {str(exc)[:100]}; backoff {5 * 2 ** (attempt // 3)}s")
            time.sleep(5 * 2 ** (attempt // 3))
    raise RuntimeError(f"overpass unavailable: {last}")


def osm_api_tiles() -> dict:
    """Fallback: OSM API 0.6 map calls on a 3x3 tiling of the AOI."""

    w, s, e, n = AOI
    elements = []
    for i in range(3):
        for j in range(3):
            bw, be = w + (e - w) * i / 3, w + (e - w) * (i + 1) / 3
            bs, bn = s + (n - s) * j / 3, s + (n - s) * (j + 1) / 3
            cache = CACHE / f"osm_api_buildings_{i}_{j}.osm"
            if not cache.exists():
                url = f"https://api.openstreetmap.org/api/0.6/map?bbox={bw},{bs},{be},{bn}"
                log("OSM API", url)
                r = httpx.get(url, timeout=180, headers=UA)
                r.raise_for_status()
                cache.parent.mkdir(parents=True, exist_ok=True)
                cache.write_bytes(r.content)
                time.sleep(1.0)
            root = ET.fromstring(cache.read_bytes())
            nodes = {nd.get("id"): (float(nd.get("lon")), float(nd.get("lat"))) for nd in root.iter("node")}
            for way in root.iter("way"):
                tags = {t.get("k"): t.get("v") for t in way.iter("tag")}
                if "building" not in tags:
                    continue
                geom = [{"lon": nodes[r.get("ref")][0], "lat": nodes[r.get("ref")][1]} for r in way.iter("nd") if r.get("ref") in nodes]
                elements.append({"type": "way", "id": int(way.get("id")), "tags": tags, "geometry": geom})
    return {"elements": elements}


def ring_area_m2(ring) -> float:
    lat0 = math.radians(ring[0][1])
    k = 111320.0
    pts = [((x * math.cos(lat0)) * k, y * 110574.0) for x, y in ring]
    return abs(sum(pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1] for i in range(len(pts) - 1))) / 2


def main():
    try:
        data, source = overpass(), "overpass"
    except RuntimeError as exc:
        log(exc, "-> OSM API fallback")
        data, source = osm_api_tiles(), "osm-api-0.6-map"
    feats, seen = [], set()
    counts = {"height": 0, "levels": 0, "estimate": 0}
    for el in data.get("elements", []):
        key = (el["type"], el["id"])
        if key in seen:
            continue
        seen.add(key)
        tags = el.get("tags", {})
        rings = []
        if el["type"] == "way":
            g = el.get("geometry") or []
            rings = [[[round(p["lon"], 6), round(p["lat"], 6)] for p in g]]
        else:  # multipolygon relation: outer + inner members
            for m in el.get("members", []):
                if m.get("type") == "way" and m.get("geometry"):
                    ring = [[round(p["lon"], 6), round(p["lat"], 6)] for p in m["geometry"]]
                    rings.append(ring if m.get("role") == "outer" else ["inner", ring])
        polys = []
        outer = [r for r in rings if r and r[0] != "inner"]
        inner = [r[1] for r in rings if r and r[0] == "inner"]
        for o in outer:
            if len(o) < 4 or o[0] != o[-1]:
                continue
            if ring_area_m2(o) < 6:
                continue
            polys.append([o] + [h for h in inner if len(h) >= 4 and h[0] == h[-1]])
        if not polys:
            continue
        h, mh, src = height_of(tags)
        counts[src] += 1
        geom = {"type": "Polygon", "coordinates": polys[0]} if len(polys) == 1 else {"type": "MultiPolygon", "coordinates": polys}
        feats.append({"type": "Feature", "id": f"{el['type'][0]}{el['id']}", "geometry": geom,
                      "properties": {"b": tags.get("building", "yes"), "name": tags.get("name"), "h": round(h, 1),
                                     "mh": round(mh, 1), "hs": src, "lv": tags.get("building:levels"),
                                     "amenity": tags.get("amenity")}})
    OUT.parent.mkdir(parents=True, exist_ok=True)
    meta = {"source": f"OpenStreetMap ({source})", "license": "ODbL 1.0, (c) OpenStreetMap contributors",
            "retrieved_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "aoi": AOI,
            "count": len(feats), "height_sources": counts,
            "note": "Heights from OSM tags where present; otherwise a type-based visualization assumption."}
    OUT.write_text(json.dumps({"type": "FeatureCollection", "metadata": meta, "features": feats}, separators=(",", ":")), encoding="utf-8")
    log(f"wrote {len(feats)} buildings ({OUT.stat().st_size / 1e6:.1f} MB); heights: {counts}")


if __name__ == "__main__":
    main()
