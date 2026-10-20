"""Reproducible ingestion for the Charlotte (Elizabeth) study area.

Fetches official City of Charlotte layers (ArcGIS REST, paginated, native
NC State Plane coordinates reprojected locally with pyproj and cross-checked
against server-side reprojection) and OpenStreetMap data (OSMnx/Overpass),
normalizes them, and writes small GeoJSON files plus provenance and data
quality reports to data/samples/charlotte_elizabeth/.

Raw responses are cached in data/cache/ (gitignored) so reruns do not hit
the services again unless --refresh is passed.

    uv run --project services/api --extra ingest python scripts/ingest/fetch_charlotte.py
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "data" / "cache"
OUT = ROOT / "data" / "samples" / "charlotte_elizabeth"

AREA = {
    "id": "charlotte-elizabeth",
    "name": "Elizabeth, Charlotte NC (around Novant Health Presbyterian Medical Center)",
    "bbox": [-80.832, 35.207, -80.818, 35.217],  # west, south, east, north (WGS84)
}

ORG = "https://services.arcgis.com/9Nl857LBlQVyzq54/ArcGIS/rest/services"
LAYERS = {
    "ramps": {
        "url": f"{ORG}/ADA_Curb_Ramps_/FeatureServer/0",
        "name": "CDOT ADA Curb Ramps (ADA self-evaluation inventory)",
        "official_mapserver": "https://gis.charlottenc.gov/arcgis/rest/services/CDOT_ADA/ADA_Curb_Ramps/MapServer/0",
    },
    "sidewalks": {
        "url": f"{ORG}/Sidewalk_Inventory/FeatureServer/0",
        "name": "CDOT Sidewalk Inventory",
    },
    "bus_stops": {
        "url": f"{ORG}/Bus_Stops/FeatureServer/0",
        "name": "CATS Bus Stops (City of Charlotte)",
    },
}

RAMP_FIELDS = [
    "OBJECTID", "ADA_ID", "RP_AssetID", "RP_IntID", "RP_Type", "RP_Street1", "RP_Street2", "RP_LocInInt",
    "RP_SurveyDate", "RP_ComplianceStatus", "RP_InitValidStatus", "RP_Status", "RP_Obs", "RP_ObsType",
    "RP_XWalk1", "RP_XWalk1Dir", "RP_XWalk2", "RP_XWalk2Dir", "RP_Slope", "RP_XSlope", "RP_GutterLipHt",
    "RP_SurfCond", "RP_DWSProvided", "RP_Wid", "Remediated", "RemediatedType", "RemediatedDate",
    "ActualCosts", "TechnicalInfeasibility",
]
KEY_RAMP_FIELDS = ["RP_Type", "RP_SurveyDate", "RP_ComplianceStatus", "RP_XWalk1Dir", "RP_Slope", "Remediated", "RemediatedDate", "ActualCosts"]


def log(*a: Any) -> None:
    print("[ingest]", *a, file=sys.stderr)


def cached_get(client: httpx.Client, url: str, params: dict[str, Any], refresh: bool, retries: int = 4) -> dict:
    key = hashlib.sha1((url + json.dumps(params, sort_keys=True)).encode()).hexdigest()[:20]
    path = CACHE / "arcgis" / f"{key}.json"
    if path.exists() and not refresh:
        return json.loads(path.read_text(encoding="utf-8"))
    last: Exception | None = None
    for attempt in range(retries):
        try:
            r = client.get(url, params=params, timeout=60)
            r.raise_for_status()
            data = r.json()
            if "error" in data:
                raise RuntimeError(f"ArcGIS error: {data['error']}")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(data), encoding="utf-8")
            return data
        except Exception as exc:  # retry with backoff
            last = exc
            wait = 2 ** attempt
            log(f"request failed ({type(exc).__name__}: {exc}); retry in {wait}s")
            time.sleep(wait)
    raise RuntimeError(f"source unavailable after {retries} attempts: {url} ({last})")


def fetch_layer(client: httpx.Client, key: str, refresh: bool) -> tuple[dict, list[dict], dict]:
    url = LAYERS[key]["url"]
    meta = cached_get(client, url, {"f": "json"}, refresh)
    max_rec = int(meta.get("maxRecordCount") or 1000)
    page = min(max_rec, 1000)
    w, s, e, n = AREA["bbox"]
    base = {
        "where": "1=1",
        "geometry": f"{w},{s},{e},{n}",
        "geometryType": "esriGeometryEnvelope",
        "inSR": 4326,
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "*",
        "returnGeometry": "true",
        "orderByFields": meta.get("objectIdField") or "OBJECTID",
        "f": "json",
    }
    count = cached_get(client, f"{url}/query", {**base, "returnCountOnly": "true"}, refresh)["count"]
    feats: list[dict] = []
    offset = 0
    while True:  # pagination
        data = cached_get(client, f"{url}/query", {**base, "resultOffset": offset, "resultRecordCount": page}, refresh)
        batch = data.get("features", [])
        feats.extend(batch)
        if not batch or not data.get("exceededTransferLimit") and len(batch) < page:
            break
        offset += len(batch)
    native_sr = (meta.get("extent") or {}).get("spatialReference") or {}
    log(f"{key}: {len(feats)} features (server count {count}), native SR {native_sr}")
    # Server-side reprojection of a sample, used only to validate our own transform.
    check = cached_get(client, f"{url}/query", {**base, "outSR": 4326, "resultRecordCount": 25}, refresh)
    return meta, feats, {"server_count": count, "native_sr": native_sr, "check": check.get("features", [])}


def to_wgs84(native_sr: dict):
    wkid = native_sr.get("latestWkid") or native_sr.get("wkid")
    if wkid in (4326, None):
        return lambda x, y: (x, y), 4326
    epsg = {102719: 2264, 102100: 3857}.get(wkid, wkid)
    t = Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True)
    return (lambda x, y: t.transform(x, y)), epsg


def hav(a, b) -> float:
    lon1, lat1, lon2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371008.8 * math.asin(math.sqrt(h))


def validate_transform(feats: list[dict], check: list[dict], tf, oid: str) -> dict:
    by_id = {f["attributes"][oid]: f for f in feats}
    errs = []
    for c in check:
        f = by_id.get(c["attributes"].get(oid))
        if not f or "geometry" not in f:
            continue
        g, cg = f["geometry"], c["geometry"]
        if "x" in g:
            errs.append(hav(tf(g["x"], g["y"]), (cg["x"], cg["y"])))
        elif "paths" in g:
            p, cp = g["paths"][0][0], cg["paths"][0][0]
            errs.append(hav(tf(p[0], p[1]), (cp[0], cp[1])))
    return {"samples": len(errs), "max_error_m": round(max(errs), 3) if errs else None,
            "note": "pyproj local transform vs ArcGIS server-side outSR=4326"}


def epoch_ms_to_iso(v):
    if isinstance(v, (int, float)) and v > 0:
        return datetime.fromtimestamp(v / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
    return None


def num(v):
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def clean(v):
    if isinstance(v, str):
        v = v.strip()
        return v if v and v.upper() not in ("N/A", "NULL") else None
    return v


def normalize_ramps(feats, tf, oid) -> tuple[list[dict], dict]:
    seen_oid, seen_loc = set(), {}
    out, dups = [], []
    missing = Counter()
    for f in feats:
        a = f["attributes"]
        if a[oid] in seen_oid:
            dups.append({"reason": "duplicate OBJECTID", "id": a[oid]})
            continue
        seen_oid.add(a[oid])
        g = f.get("geometry")
        if not g or g.get("x") is None:
            missing["geometry"] += 1
            continue
        lon, lat = tf(g["x"], g["y"])
        loc_key = (round(lon, 6), round(lat, 6), clean(a.get("RP_AssetID")))
        if loc_key in seen_loc:
            dups.append({"reason": "same asset id at same location", "id": a[oid], "kept": seen_loc[loc_key]})
            continue
        seen_loc[loc_key] = a[oid]
        rec = {k: clean(a.get(k)) for k in RAMP_FIELDS}
        for k in KEY_RAMP_FIELDS:
            if rec.get(k) in (None, ""):
                missing[k] += 1
        rec["RemediatedDate"] = epoch_ms_to_iso(a.get("RemediatedDate"))
        for k in ("RP_Slope", "RP_XSlope", "RP_GutterLipHt", "RP_Wid", "ActualCosts"):
            rec[k] = num(rec.get(k))
        out.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 7), round(lat, 7)]},
                    "properties": rec})
    return out, {"duplicates_removed": dups, "missing": dict(missing), "count": len(out)}


def normalize_sidewalks(feats, tf, oid):
    out, missing = [], Counter()
    for f in feats:
        a, g = f["attributes"], f.get("geometry")
        if not g or not g.get("paths"):
            missing["geometry"] += 1
            continue
        for path in g["paths"]:
            coords = [list(map(lambda v: round(v, 7), tf(x, y))) for x, y in path]
            if len(coords) < 2:
                continue
            props = {k: clean(a.get(k)) for k in ("OBJECTID", "AssetID", "SidewalkPresence", "Street", "FromStreet", "ToStreet",
                                                    "StreetClassification", "SidewalkWidth", "PlantingStripPresence", "Location")}
            if props["SidewalkPresence"] is None:
                missing["SidewalkPresence"] += 1
            out.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": coords}, "properties": props})
    return out, {"missing": dict(missing), "count": len(out)}


def normalize_bus_stops(feats, tf, oid):
    out = []
    for f in feats:
        a, g = f["attributes"], f.get("geometry")
        if not g:
            continue
        lon, lat = tf(g["x"], g["y"])
        props = {k: clean(a.get(k)) for k in ("OBJECTID", "StopID", "StopDesc", "Nearest_Inter", "routes", "Direction",
                                              "Bench", "Shelter", "Sidewalk", "Avg_Board", "Avg_Alight")}
        out.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 7), round(lat, 7)]}, "properties": props})
    return out, {"count": len(out)}


DRIVE_HIGHWAYS = {"motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street",
                  "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link"}
OSM_TAGS = {"amenity": ["hospital", "clinic", "doctors", "pharmacy", "dentist", "school", "college", "university", "library",
                        "kindergarten", "community_centre"],
            "healthcare": True, "landuse": ["residential"], "building": True}
PAD = 0.0015  # pad the street graph so intersections on the bbox edge keep all legs


def fetch_osm(refresh: bool) -> dict:
    """Primary path: Overpass API through OSMnx."""

    import osmnx as ox

    ox.settings.cache_folder = str(CACHE / "osmnx")
    ox.settings.use_cache = not refresh
    ox.settings.log_console = False
    ox.settings.requests_timeout = 90
    w, s, e, n = AREA["bbox"]
    bbox = (w - PAD, s - PAD, e + PAD, n + PAD)
    G = ox.graph_from_bbox(bbox, network_type="drive", simplify=True, retain_all=False, truncate_by_edge=True)
    feats = ox.features_from_bbox((w, s, e, n), OSM_TAGS)
    return process_osm(ox.convert.to_undirected(G), feats, "overpass")


def fetch_osm_api_xml(refresh: bool) -> dict:
    """Fallback: one OSM API 0.6 map call for the (small) padded bbox, cached."""

    import osmnx as ox

    w, s, e, n = AREA["bbox"]
    path = CACHE / "osm_api_map.osm"
    if refresh or not path.exists():
        url = f"https://api.openstreetmap.org/api/0.6/map?bbox={w - PAD},{s - PAD},{e + PAD},{n + PAD}"
        log(f"OSM API: {url}")
        r = httpx.get(url, timeout=120, headers={"User-Agent": "StreetMend/0.1 (hackathon research prototype)"})
        r.raise_for_status()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(r.content)
    G = ox.graph_from_xml(path, bidirectional=True, simplify=False, retain_all=True)
    drop = [(u, v, k) for u, v, k, d in G.edges(keys=True, data=True)
            if (d.get("highway")[0] if isinstance(d.get("highway"), list) else d.get("highway")) not in DRIVE_HIGHWAYS
            or d.get("area") == "yes"]
    G.remove_edges_from(drop)
    G.remove_nodes_from([x for x in list(G.nodes) if G.degree(x) == 0])
    G = ox.simplify_graph(G)
    G = ox.truncate.largest_component(G)
    feats = ox.features_from_xml(path, tags=OSM_TAGS)
    w2, s2, e2, n2 = AREA["bbox"]
    feats = feats.cx[w2:e2, s2:n2]
    return process_osm(ox.convert.to_undirected(G), feats, "osm-api-0.6-map")


def process_osm(G, feats, source: str) -> dict:
    nodes = [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(d["x"], 7), round(d["y"], 7)]},
              "properties": {"osmid": int(k), "street_count": int(d.get("street_count", 0)),
                             "highway": d.get("highway") if isinstance(d.get("highway"), str) else None}}
             for k, d in G.nodes(data=True)]
    edges = []
    seen = set()
    for u, v, k, d in G.edges(keys=True, data=True):
        key = (min(u, v), max(u, v), k)
        if key in seen:
            continue
        seen.add(key)
        if "geometry" in d:
            coords = [[round(x, 7), round(y, 7)] for x, y in d["geometry"].coords]
        else:
            coords = [[round(G.nodes[u]["x"], 7), round(G.nodes[u]["y"], 7)], [round(G.nodes[v]["x"], 7), round(G.nodes[v]["y"], 7)]]
        # Orient geometry from u to v.
        if hav(coords[0], (G.nodes[u]["x"], G.nodes[u]["y"])) > hav(coords[-1], (G.nodes[u]["x"], G.nodes[u]["y"])):
            coords = coords[::-1]
        def one(x):
            return x[0] if isinstance(x, list) else x
        edges.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": coords},
                      "properties": {"u": int(u), "v": int(v), "key": int(k), "name": one(d.get("name")),
                                     "highway": one(d.get("highway")), "lanes": one(d.get("lanes")),
                                     "oneway": bool(d.get("oneway", False)), "length_m": round(float(d.get("length", 0)), 2),
                                     "osmid": one(d.get("osmid"))}})
    pois, residential, buildings = [], [], []
    for idx, row in feats.iterrows():
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue
        el, osmid = idx if isinstance(idx, tuple) else ("node", idx)
        amenity = row.get("amenity") if isinstance(row.get("amenity"), str) else None
        healthcare = row.get("healthcare") if isinstance(row.get("healthcare"), str) else None
        name = row.get("name") if isinstance(row.get("name"), str) else None
        c = geom.representative_point() if geom.geom_type != "Point" else geom
        if amenity or healthcare:
            pois.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(c.x, 7), round(c.y, 7)]},
                         "properties": {"osm_type": el, "osmid": int(osmid), "name": name, "amenity": amenity, "healthcare": healthcare,
                                        "area_m2": None}})
        if row.get("landuse") == "residential" and geom.geom_type in ("Polygon", "MultiPolygon"):
            residential.append({"type": "Feature", "geometry": json.loads(json.dumps(geom.__geo_interface__)),
                                "properties": {"osm_type": el, "osmid": int(osmid)}})
        b = row.get("building")
        if isinstance(b, str) and geom.geom_type in ("Polygon", "MultiPolygon"):
            buildings.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(c.x, 7), round(c.y, 7)]},
                              "properties": {"osmid": int(osmid), "building": b, "name": name}})
    log(f"osm ({source}): {len(nodes)} nodes, {len(edges)} street edges, {len(pois)} POIs, {len(residential)} residential areas, {len(buildings)} buildings")
    return {"nodes": nodes, "edges": edges, "pois": pois, "residential": residential, "buildings": buildings, "source": source}


def write(name: str, obj: Any) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    log(f"wrote {name} ({(OUT / name).stat().st_size / 1024:.0f} KB)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="ignore cached responses")
    ap.add_argument("--skip-osm", action="store_true")
    ap.add_argument("--overpass", action="store_true", help="try Overpass mirrors before the OSM API map call")
    args = ap.parse_args()
    retrieved = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    provenance, quality = [], {"area": AREA, "retrieved_at": retrieved, "layers": {}}
    with httpx.Client(headers={"User-Agent": "StreetMend/0.1 (hackathon research prototype)"}) as client:
        for key, norm in (("ramps", normalize_ramps), ("sidewalks", normalize_sidewalks), ("bus_stops", normalize_bus_stops)):
            try:
                meta, feats, extra = fetch_layer(client, key, args.refresh)
            except RuntimeError as exc:
                log(f"{key} UNAVAILABLE: {exc}")
                provenance.append({"id": key, "name": LAYERS[key]["name"], "kind": "municipal", "url": LAYERS[key]["url"],
                                   "status": "unavailable", "error": str(exc), "retrieved_at": retrieved})
                continue
            oid = meta.get("objectIdField") or "OBJECTID"
            tf, epsg = to_wgs84(extra["native_sr"])
            features, q = norm(feats, tf, oid)
            q["transform"] = {"from_epsg": epsg, "to_epsg": 4326, **validate_transform(feats, extra["check"], tf, oid)}
            q["server_count"] = extra["server_count"]
            quality["layers"][key] = q
            write(f"{key}.geojson", {"type": "FeatureCollection", "features": features})
            edit = (meta.get("editingInfo") or {}).get("dataLastEditDate")
            provenance.append({
                "id": key, "name": LAYERS[key]["name"], "kind": "municipal", "url": LAYERS[key]["url"],
                "official_mapserver": LAYERS[key].get("official_mapserver"), "publisher": "City of Charlotte",
                "retrieved_at": retrieved, "data_last_edit": epoch_ms_to_iso(edit), "record_count": len(features),
                "native_crs": f"EPSG:{epsg}", "status": "ok",
                "license": "City of Charlotte Open Data (see source portal terms)",
            })
    if not args.skip_osm:
        try:
            osm = fetch_osm(args.refresh)
            write("osm_streets.geojson", {"type": "FeatureCollection", "features": osm["edges"]})
            write("osm_nodes.geojson", {"type": "FeatureCollection", "features": osm["nodes"]})
            write("osm_pois.geojson", {"type": "FeatureCollection", "features": osm["pois"]})
            write("osm_residential.geojson", {"type": "FeatureCollection", "features": osm["residential"]})
            write("osm_buildings.geojson", {"type": "FeatureCollection", "features": osm["buildings"]})
            provenance.append({"id": "osm", "name": f"OpenStreetMap (OSMnx, {osm['source']})", "kind": "osm",
                               "url": "https://www.openstreetmap.org/copyright", "retrieved_at": retrieved,
                               "record_count": len(osm["edges"]), "license": "ODbL 1.0, (c) OpenStreetMap contributors", "status": "ok"})
            quality["layers"]["osm"] = {k: len(v) for k, v in osm.items() if isinstance(v, list)}
        except Exception as exc:
            log(f"OSM UNAVAILABLE: {exc}")
            provenance.append({"id": "osm", "name": "OpenStreetMap", "kind": "osm", "status": "unavailable", "error": str(exc)})
    write("provenance.json", provenance)
    write("quality.json", quality)


if __name__ == "__main__":
    main()
