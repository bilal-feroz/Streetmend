"""Tree canopy for the 3D city: real canopy density, illustrative positions.

Sources
  * City of Charlotte / TreesCharlotte, Charlotte Mecklenburg Tree Canopy
    assessment (2022 imagery): tree canopy percentage per assessment area.
  * OpenStreetMap: individually mapped trees (natural=tree, real positions),
    plus streets, water and the building footprints already prepared for the
    3D city (used only to keep generated crowns off them).

Method
  For each assessment area clipped to the 3D-city box, crowns are added until
  their combined (overlap-discounted) area matches the area's 2022 canopy
  percentage. Mapped OSM trees count first. Generated crown positions come from
  a seeded random draw that rejects points on buildings, streets or water, so
  the *amount* of canopy per area is real while individual generated positions
  are illustrative. Output is deterministic for a given input.

    uv run --project services/api --extra ingest python scripts/ingest/fetch_trees.py
"""

from __future__ import annotations

import json
import math
import random
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
from pyproj import Transformer
from shapely.geometry import LineString, Point, Polygon, box, shape
from shapely.ops import transform
from shapely.prepared import prep
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "data" / "cache"
CITY = ROOT / "data" / "samples" / "charlotte_city"
OUT = CITY / "trees.json"
AOI = (-80.848, 35.200, -80.810, 35.230)  # same box as the 3D buildings
UA = {"User-Agent": "StreetMend/0.2 (hackathon research prototype)"}
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter",
            "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
CANOPY = "https://services.arcgis.com/9Nl857LBlQVyzq54/ArcGIS/rest/services/Charlotte_Mecklenburg_Tree_Canopy/FeatureServer/0/query"
CANOPY_FIELD = "TreeCanopyArea2022Percent"
OVERLAP = 0.72  # crowns overlap: each covers ~72% of its disc in new canopy
ROAD_HALF = {"motorway": 13, "trunk": 11, "primary": 9, "secondary": 8, "tertiary": 7, "residential": 5, "unclassified": 5,
             "service": 3, "living_street": 4, "motorway_link": 6, "trunk_link": 6, "primary_link": 5, "secondary_link": 5,
             "tertiary_link": 5}
SEED = 20261021


def log(*a):
    print("[trees]", *a, file=sys.stderr)


def cached(name: str, fetch):
    path = CACHE / name
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    data = fetch()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")
    return data


def overpass(q: str) -> dict:
    last = None
    for attempt in range(8):
        url = OVERPASS[attempt % len(OVERPASS)]
        try:
            log("overpass", url)
            r = httpx.post(url, data={"data": q}, timeout=240, headers=UA)
            r.raise_for_status()
            return r.json()
        except Exception as exc:  # noqa: BLE001 - mirrors fail in many ways
            last = exc
            log(f"failed: {type(exc).__name__} {str(exc)[:90]}")
            time.sleep(3 * (1 + attempt // len(OVERPASS)))
    raise RuntimeError(f"overpass unavailable: {last}")


def fetch_osm() -> dict:
    w, s, e, n = AOI
    bb = f"{s},{w},{n},{e}"
    q = (f"[out:json][timeout:200];("
         f'node["natural"="tree"]({bb});'
         f'way["highway"]({bb});'
         f'way["natural"="water"]({bb});way["waterway"="riverbank"]({bb});'
         f");out tags geom;")
    return overpass(q)


def fetch_canopy() -> dict:
    w, s, e, n = AOI
    params = {"where": "1=1", "geometry": f"{w},{s},{e},{n}", "geometryType": "esriGeometryEnvelope", "inSR": 4326,
              "spatialRel": "esriSpatialRelIntersects", "outFields": f"OBJECTID,{CANOPY_FIELD},TotalAreaAcres", "outSR": 4326, "f": "geojson"}
    r = httpx.get(CANOPY, params=params, timeout=120, headers=UA)
    r.raise_for_status()
    return r.json()


def main() -> None:
    to_m = Transformer.from_crs(4326, 32617, always_xy=True).transform
    to_ll = Transformer.from_crs(32617, 4326, always_xy=True).transform
    aoi = transform(to_m, box(*AOI))

    canopy = cached("charlotte_tree_canopy.json", fetch_canopy)
    osm = cached("overpass_trees_roads_water.json", fetch_osm)
    buildings = json.loads((CITY / "buildings.geojson").read_text(encoding="utf-8"))
    log(f"canopy areas {len(canopy['features'])}, osm elements {len(osm['elements'])}, buildings {len(buildings['features'])}")

    # obstacles (metres)
    blocks = []
    for f in buildings["features"]:
        try:
            g = transform(to_m, shape(f["geometry"])).buffer(1.5)
            if not g.is_empty:
                blocks.append(g)
        except Exception:  # noqa: BLE001 - skip broken rings
            continue
    roads, water, osm_trees = [], [], []
    for el in osm["elements"]:
        tags = el.get("tags", {})
        if el["type"] == "node" and tags.get("natural") == "tree":
            osm_trees.append(transform(to_m, Point(el["lon"], el["lat"])))
            continue
        geom = el.get("geometry")
        if not geom or len(geom) < 2:
            continue
        coords = [(p["lon"], p["lat"]) for p in geom]
        hw = tags.get("highway")
        if hw in ROAD_HALF:
            roads.append(transform(to_m, LineString(coords)).buffer(ROAD_HALF[hw] + 1.0))
        elif tags.get("natural") == "water" or tags.get("waterway") == "riverbank":
            if len(coords) >= 4:
                water.append(transform(to_m, Polygon(coords)).buffer(0))
    obstacles = blocks + roads + water
    tree_idx = STRtree(obstacles)
    prepared_obstacles = [prep(o) for o in obstacles]
    log(f"obstacles: {len(blocks)} buildings, {len(roads)} street segments, {len(water)} water")

    rng = random.Random(SEED)
    out: list[list[float]] = []
    counts = {"osm": 0, "generated": 0}

    def free(p: Point, r: float = 0.0) -> bool:
        # crown-aware: most of the crown stays off roofs, streets and water
        probe = p.buffer(r * 0.55, quad_segs=4) if r else p
        return not any(prepared_obstacles[i].intersects(probe) for i in tree_idx.query(probe))

    def add(p: Point, r: float, src: int):
        lng, lat = to_ll(p.x, p.y)
        h = round(min(22.0, 3.5 + r * 1.7 + rng.uniform(-1.0, 2.0)), 1)
        out.append([round(lng, 6), round(lat, 6), round(r, 1), h, src])

    mapped = []  # (point, crown radius) of OSM trees inside the box
    for p in osm_trees:
        if aoi.contains(p):
            r = rng.uniform(3.0, 5.5)
            add(p, r, 1)
            mapped.append((p, r))
            counts["osm"] += 1
    mapped_idx = STRtree([p for p, _ in mapped]) if mapped else None
    # The assessment layer stacks several geographies (city, districts, neighborhoods, block
    # groups). Each spot takes the percentage of the finest area covering it: carve smallest-first.
    areas = []
    for f in canopy["features"]:
        pct = f["properties"].get(CANOPY_FIELD)
        if pct is None:
            continue
        g = transform(to_m, shape(f["geometry"])).simplify(2.0).buffer(0).intersection(aoi)
        if not g.is_empty:
            areas.append((g.area, g, float(pct), f["properties"]["OBJECTID"]))
    areas.sort(key=lambda a: a[0])
    covered = None
    pieces = []
    for _, g, pct, oid in areas:
        piece = g if covered is None else g.difference(covered)
        covered = g if covered is None else covered.union(g)
        if piece.area >= 500:
            pieces.append((piece, pct, oid))

    for area, pct, oid in pieces:
        target = area.area * pct / 100.0
        prepared = prep(area)
        have = 0.0
        if mapped_idx is not None:
            for i in mapped_idx.query(area):
                p, r = mapped[i]
                if prepared.contains(p):
                    have += math.pi * r * r * OVERLAP
        minx, miny, maxx, maxy = area.bounds
        tries = 0
        while have < target and tries < 400000:
            tries += 1
            p = Point(rng.uniform(minx, maxx), rng.uniform(miny, maxy))
            if not prepared.contains(p):
                continue
            # crowns: mostly mature street and yard trees, some very large oaks
            r = min(9.0, 3.0 + rng.expovariate(1 / 2.0))
            if not free(p, r):
                continue
            add(p, r, 0)
            counts["generated"] += 1
            have += math.pi * r * r * OVERLAP
        log(f"area {oid}: {area.area / 1e4:.1f} ha, canopy {pct:.1f}% -> {have / 1e4:.1f} ha")

    meta = {
        "sources": {
            "canopy": f"City of Charlotte / TreesCharlotte, Charlotte Mecklenburg Tree Canopy (2022 imagery), field {CANOPY_FIELD}",
            "osm_trees": "OpenStreetMap natural=tree (ODbL 1.0)",
            "obstacles": "OpenStreetMap buildings, streets (buffered by class) and water",
        },
        "method": "Canopy amount per assessment area matches the 2022 canopy percentage; mapped OSM trees are placed at their real positions; generated crown positions are a seeded random draw avoiding buildings, streets and water (illustrative).",
        "aoi": list(AOI),
        "retrieved_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "count": len(out),
        "counts": counts,
        "fields": ["lng", "lat", "crown_radius_m", "height_m", "source (1 = OSM mapped tree, 0 = generated position)"],
    }
    OUT.write_text(json.dumps({"metadata": meta, "trees": out}, separators=(",", ":")), encoding="utf-8")
    log(f"wrote {OUT} ({len(out)} trees: {counts}; {OUT.stat().st_size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
