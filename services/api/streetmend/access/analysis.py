"""Discover and diagnose: which homes lack network access to essential services, and why.

Service categories and walking thresholds follow REACH (Mohammad Umar), which
measured straight-line distance. StreetMend measures the same thresholds along
the modeled pedestrian network, per travel profile, and keeps three answers
apart that straight-line analysis cannot separate:

  PASS          reachable within the threshold using only links of known condition;
  INCONCLUSIVE  reachable only if links of unknown condition are passable, or a
                facility just outside the study area might serve the home;
  FAIL          not reachable within the threshold in the modeled network.

Each failing home also gets a deterministic diagnosis (``factor``):

  barrier      the physical street network has a route within the threshold,
               but recorded barriers (missing ramps, missing sidewalk) cut it;
  detour       a facility lies within the threshold as the crow flies, but even
               with every modeled link open the walk is longer;
  distance     no facility of this kind within the threshold even in a straight
               line: a service-availability gap, which repairs cannot fix.

Demand is a count of homes: OSM residential buildings, plus untyped buildings
of 60 m² or more inside OSM residential land use. One building counts once,
whatever its size (a proxy; not population).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

import h3
import numpy as np
from scipy.spatial import cKDTree
from shapely import STRtree
from shapely.geometry import shape

from streetmend.graph import Passability
from streetmend.municipal.scenario import AREA_DIR, DATA_DIR
from streetmend.scenario.model import Scenario
from streetmend.verify.profiles import Profile

from .network import INF, AccessNetwork, Snap, state_key

CATEGORIES = ("healthcare", "education", "grocery", "transit", "parks", "services")
CATEGORY_LABEL = {"healthcare": "Healthcare", "education": "Education", "grocery": "Grocery", "transit": "Public transport",
                  "parks": "Parks", "services": "Essential services"}
# Walking thresholds in metres (REACH defaults, applied here to network distance).
THRESHOLD_M = {"healthcare": 1500.0, "education": 1200.0, "grocery": 800.0, "parks": 1000.0, "transit": 600.0, "services": 1000.0}
H3_RES = 9
RESIDENTIAL = {"house", "apartments", "semidetached_house", "terrace", "residential", "detached", "dormitory", "bungalow"}
UNTYPED_MIN_M2 = 60.0  # an untyped building this large inside OSM residential land use counts as a home
FACTOR_LABEL = {
    "served": "Reachable in the model",
    "unknown_links": "Depends on links of unknown condition",
    "outside_area": "May be served from outside the study area",
    "barrier": "Connectivity barrier",
    "detour": "Network detour",
    "distance": "No facility within reach",
}
STATUS_OF = {"served": "PASS", "unknown_links": "INCONCLUSIVE", "outside_area": "INCONCLUSIVE", "barrier": "FAIL", "detour": "FAIL", "distance": "FAIL"}


@dataclass
class Facility:
    id: str
    category: str
    name: str
    kind: str
    lon: float
    lat: float
    source: str
    snap: Snap | None = None  # None: outside the modeled network (straight-line screening only)
    hypothetical: bool = False


@dataclass
class Home:
    id: str
    lon: float
    lat: float
    building: str
    cell: str
    snap: Snap | None


@dataclass
class AccessModel:
    sc: Scenario
    net: AccessNetwork
    facilities: list[Facility]
    homes: list[Home]
    retrieved: str | None = None
    provenance: list[dict[str, Any]] = field(default_factory=list)

    def fac(self, category: str, extra: list[Facility] | None = None) -> list[Facility]:
        return [f for f in self.facilities if f.category == category] + [f for f in (extra or []) if f.category == category]


def _centroid(geom: dict) -> tuple[float, float]:
    if geom["type"] == "Point":
        return tuple(geom["coordinates"])  # type: ignore[return-value]
    ring = geom["coordinates"][0] if geom["type"] == "Polygon" else geom["coordinates"][0][0]
    xs = [p[0] for p in ring[:-1] or ring]
    ys = [p[1] for p in ring[:-1] or ring]
    return sum(xs) / len(xs), sum(ys) / len(ys)


def _entries(net: AccessNetwork, poly) -> list[tuple[float, float, Snap]]:
    ring = poly.exterior if poly.geom_type == "Polygon" else max(poly.geoms, key=lambda g: g.area).exterior
    pj = net.proj
    pts = [(x, y) for x, y in ring.coords]
    out = []
    acc = 0.0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        a, b = pj.xy(x0, y0), pj.xy(x1, y1)
        seg = float(np.hypot(b[0] - a[0], b[1] - a[1]))
        while acc <= seg:
            t = acc / seg if seg else 0.0
            lon, lat = x0 + t * (x1 - x0), y0 + t * (y1 - y0)
            if net.inside(lon, lat):
                sn = net.snap(lon, lat)
                if sn is not None and sn.connector_m <= 40.0:
                    out.append((lon, lat, sn))
            acc += 50.0
        acc -= seg
    return out


def build_model(sc: Scenario) -> AccessModel:
    net = AccessNetwork(sc)
    raw = json.loads((AREA_DIR / "facilities.geojson").read_text(encoding="utf-8"))
    facs: list[Facility] = []
    for f in raw["features"]:
        p = f["properties"]
        lon, lat = p["point"]
        if f["geometry"]["type"] in ("Polygon", "MultiPolygon"):
            # an area (a park): every 50 m of its edge within 40 m of a sidewalk is an entry point
            entries = _entries(net, shape(f["geometry"]))
            if entries:
                for elon, elat, sn in entries:
                    facs.append(Facility(p["id"], p["category"], p["name"], p["kind"], elon, elat, "osm", sn))
                continue
        facs.append(Facility(p["id"], p["category"], p["name"], p["kind"], lon, lat, "osm"))
    stops = json.loads((AREA_DIR / "bus_stops.geojson").read_text(encoding="utf-8"))
    for f in stops["features"]:
        lon, lat = f["geometry"]["coordinates"][:2]
        pr = f["properties"]
        sid = pr.get("StopID") or pr.get("stop_id") or pr.get("STOPID") or pr.get("id") or ""
        facs.append(Facility(f"cats:{sid}", "transit", pr.get("StopName") or pr.get("stop_name") or f"Bus stop {sid}", "cats_bus_stop", lon, lat, "cats"))
    for f in facs:
        if f.snap is None and net.inside(f.lon, f.lat):
            f.snap = net.snap(f.lon, f.lat)
    blds = json.loads((DATA_DIR / "samples" / "charlotte_city" / "buildings.geojson").read_text(encoding="utf-8"))
    landuse = [shape(f["geometry"]) for f in json.loads((AREA_DIR / "osm_residential.geojson").read_text(encoding="utf-8"))["features"]]
    tree = STRtree(landuse)
    homes: list[Home] = []
    for k, f in enumerate(blds["features"]):
        b = f["properties"].get("b")
        if b not in RESIDENTIAL and b != "yes":
            continue
        lon, lat = _centroid(f["geometry"])
        if not net.inside(lon, lat):
            continue
        if b == "yes":
            g = shape(f["geometry"])
            pt = g.representative_point()
            area = g.area * net.proj.kx * net.proj.ky
            if area < UNTYPED_MIN_M2 or not any(landuse[int(i)].contains(pt) for i in tree.query(pt)):
                continue
            b = "untyped (residential land use)"
        homes.append(Home(f"H{k}", lon, lat, f["properties"]["b"], h3.latlng_to_cell(lat, lon, H3_RES), net.snap(lon, lat)))
    prov = [
        {"id": "osm-facilities", "name": "Essential-service facilities", "source": raw["properties"]["source"],
         "retrieved": raw["properties"].get("retrieved"), "kind": "osm"},
        {"id": "cats-stops", "name": "CATS bus stops", "source": "Charlotte Area Transit System (municipal GIS)", "kind": "municipal_record"},
        {"id": "osm-buildings", "name": "Homes (demand proxy): OSM residential buildings, plus untyped buildings of 60 m² or more inside OSM residential land use",
         "source": "OpenStreetMap contributors (ODbL)", "kind": "osm"},
    ]
    return AccessModel(sc, net, facs, homes, raw["properties"].get("retrieved"), prov)


@lru_cache(maxsize=2)
def municipal_model(policy: str = "moderate") -> AccessModel:
    from streetmend.municipal.scenario import load_municipal_scenario

    return build_model(load_municipal_scenario(policy))


# ---- distances ------------------------------------------------------------
def _straight(model: AccessModel, facs: list[Facility], homes: list[Home]) -> tuple[np.ndarray, np.ndarray]:
    """Straight-line distance to the nearest routable facility and to the nearest one outside the network."""

    pj = model.net.proj
    hx = np.array([pj.xy(h.lon, h.lat) for h in homes]) if homes else np.zeros((0, 2))
    out = []
    for group in ([f for f in facs if f.snap is not None], [f for f in facs if f.snap is None]):
        if not group or not len(hx):
            out.append(np.full(len(homes), INF))
            continue
        tree = cKDTree(np.array([pj.xy(f.lon, f.lat) for f in group]))
        d, _ = tree.query(hx)
        out.append(d)
    return out[0], out[1]


def distances(model: AccessModel, category: str, keys: list[str], enabled: frozenset[str] = frozenset(), closed: frozenset[str] = frozenset(),
              extra: list[Facility] | None = None, homes: list[Home] | None = None) -> dict[str, np.ndarray]:
    net = model.net
    hs = model.homes if homes is None else homes
    facs = [f for f in model.fac(category, extra) if f.snap is not None]
    snaps = [f.snap for f in facs]
    pts = [h.snap for h in hs]
    out = {}
    for k in keys:
        m = net.mask(k, enabled, closed)
        d = net.node_dist(snaps, m)
        out[k] = net.point_dist(d, pts, m, snaps)
    return out


def classify(d_verified: np.ndarray, d_possible: np.ndarray, d_physical: np.ndarray, s_in: np.ndarray, s_out: np.ndarray, T: float) -> list[str]:
    out = []
    for a, b, c, si, so in zip(d_verified, d_possible, d_physical, s_in, s_out):
        if a <= T:
            out.append("served")
        elif b <= T:
            out.append("unknown_links")
        elif so <= T:
            out.append("outside_area")
        elif c <= T:
            out.append("barrier")
        elif si <= T:
            out.append("detour")
        else:
            out.append("distance")
    return out


def access_score(d: np.ndarray, T: float) -> np.ndarray:
    """REACH-style score: 100 up to the threshold, falling linearly to 0 at twice the threshold."""

    with np.errstate(invalid="ignore"):
        return np.where(np.isfinite(d), np.clip(100.0 * (2.0 - d / T), 0.0, 100.0), 0.0)


def home_status(model: AccessModel, category: str, profile: Profile = Profile.STEP_FREE, T: float | None = None,
                enabled: frozenset[str] = frozenset(), closed: frozenset[str] = frozenset(), extra: list[Facility] | None = None,
                homes: list[Home] | None = None) -> dict[str, Any]:
    T = T or THRESHOLD_M[category]
    hs = model.homes if homes is None else homes
    kv, kp = state_key(profile, "verified"), state_key(profile, "possible")
    d = distances(model, category, [kv, kp, "physical"], enabled, closed, extra, hs)
    s_in, s_out = _straight(model, model.fac(category, extra), hs)
    factors = classify(d[kv], d[kp], d["physical"], s_in, s_out, T)
    return {"T": T, "verified": d[kv], "possible": d[kp], "physical": d["physical"], "straight": s_in, "straight_outside": s_out, "factor": factors}


def _r(x: float) -> float | None:
    return None if not np.isfinite(x) else round(float(x), 1)


def analyze(model: AccessModel, category: str, profile: Profile = Profile.STEP_FREE, T: float | None = None) -> dict[str, Any]:
    """Per-cell access for one category and profile, with diagnosis counts."""

    st = home_status(model, category, profile, T)
    walk = home_status(model, category, Profile.PEDESTRIAN, T) if profile == Profile.STEP_FREE else None
    T = st["T"]
    cells: dict[str, dict[str, Any]] = {}
    score_v = access_score(st["verified"], T)
    score_p = access_score(st["possible"], T)
    for k, h in enumerate(model.homes):
        c = cells.setdefault(h.cell, {"id": h.cell, "homes": 0, "factors": {f: 0 for f in FACTOR_LABEL}, "_dv": [], "_dp": [], "_ds": [],
                                      "_sv": 0.0, "_sp": 0.0, "walk_pass": 0})
        c["homes"] += 1
        c["factors"][st["factor"][k]] += 1
        c["_dv"].append(st["verified"][k])
        c["_dp"].append(st["possible"][k])
        c["_ds"].append(st["straight"][k])
        c["_sv"] += score_v[k]
        c["_sp"] += score_p[k]
        if walk is not None and walk["factor"][k] == "served":
            c["walk_pass"] += 1
    out_cells = []
    for c in cells.values():
        n = c["homes"]
        f = c["factors"]
        failing = {k: v for k, v in f.items() if STATUS_OF[k] == "FAIL" and v}
        uncertain = f["unknown_links"] + f["outside_area"]
        passed = f["served"]
        status = "PASS" if passed / n >= 0.8 else ("FAIL" if (passed + uncertain) / n < 0.8 else "INCONCLUSIVE")
        primary = max(failing, key=lambda k: (failing[k], k)) if failing else ("unknown_links" if f["unknown_links"] >= f["outside_area"] and uncertain else ("outside_area" if uncertain else "served"))
        lat, lon = h3.cell_to_latlng(c["id"])
        out_cells.append({
            "id": c["id"], "lon": round(lon, 6), "lat": round(lat, 6),
            "boundary": [[round(x[1], 6), round(x[0], 6)] for x in h3.cell_to_boundary(c["id"])],
            "homes": n, "served": passed, "uncertain": uncertain, "failing": n - passed - uncertain,
            "served_share": round(passed / n, 3), "possible_share": round((passed + uncertain) / n, 3),
            "walk_served_share": round(c["walk_pass"] / n, 3) if walk is not None else None,
            "status": status, "primary_factor": primary, "factors": f,
            "score_verified": round(c["_sv"] / n, 1), "score_possible": round(c["_sp"] / n, 1),
            "median_network_m": _r(float(np.median(c["_dp"]))), "median_straight_m": _r(float(np.median(c["_ds"]))),
            "unmet_homes": n - passed - uncertain,
        })
    out_cells.sort(key=lambda c: (-c["unmet_homes"], -c["uncertain"], c["id"]))
    tot = {k: sum(c["factors"][k] for c in out_cells) for k in FACTOR_LABEL}
    n = len(model.homes)
    facs = model.fac(category)
    return {
        "category": category, "label": CATEGORY_LABEL[category], "profile": Profile(profile).value, "threshold_m": T,
        "h3_resolution": H3_RES, "cells": out_cells,
        "summary": {"homes": n, "factors": tot, "served": tot["served"], "uncertain": tot["unknown_links"] + tot["outside_area"],
                    "failing": tot["barrier"] + tot["detour"] + tot["distance"],
                    "walk_served": None if walk is None else sum(1 for x in walk["factor"] if x == "served")},
        "facilities": [{"id": f.id, "name": f.name, "kind": f.kind, "lon": f.lon, "lat": f.lat, "source": f.source, "in_network": f.snap is not None} for f in facs],
        "ranking": [c["id"] for c in out_cells if c["unmet_homes"] > 0][:10],
    }


def overview(model: AccessModel, profile: Profile = Profile.STEP_FREE) -> dict[str, Any]:
    rows = []
    for c in CATEGORIES:
        a = analyze(model, c, profile)
        s = a["summary"]
        rows.append({"category": c, "label": CATEGORY_LABEL[c], "threshold_m": a["threshold_m"], "homes": s["homes"], "served": s["served"],
                     "uncertain": s["uncertain"], "failing": s["failing"], "factors": s["factors"], "walk_served": s["walk_served"],
                     "facilities": len(a["facilities"]), "in_network": sum(1 for f in a["facilities"] if f["in_network"])})
    return {"profile": Profile(profile).value, "categories": rows}


def diagnose(model: AccessModel, cell: str, category: str, profile: Profile = Profile.STEP_FREE, T: float | None = None) -> dict[str, Any]:
    """Why is access poor in one cell? Distances, barriers, unknowns and the dominant factor."""

    homes = [h for h in model.homes if h.cell == cell]
    if not homes:
        raise KeyError(cell)
    T = T or THRESHOLD_M[category]
    st = home_status(model, category, profile, T, homes=homes)
    walk = home_status(model, category, Profile.PEDESTRIAN, T, homes=homes)
    net = model.net
    facs = [f for f in model.fac(category) if f.snap is not None]
    snaps = [f.snap for f in facs]
    # a representative home: the median by possible distance among snapped homes
    idx = [k for k, h in enumerate(homes) if h.snap is not None]
    rep = sorted(idx, key=lambda k: (st["possible"][k] if np.isfinite(st["possible"][k]) else 1e12, homes[k].id))[len(idx) // 2] if idx else 0
    h = homes[rep]
    evidence: dict[str, Any] = {}
    for key in (state_key(profile, "verified"), state_key(profile, "possible"), "physical"):
        m = net.mask(key)
        d, pred = net.node_dist(snaps, m, predecessors=True)
        path = net.path_edges(pred, d, h.snap, m) if h.snap else []
        evidence[key] = path
    g = model.sc.graph
    phys = evidence["physical"]
    barriers = [e for e in phys if g.edges[e].state == Passability.BLOCKED]
    unknown = [e for e in evidence[state_key(profile, "possible")] if g.edges[e].state == Passability.UNKNOWN]
    pj = net.proj
    hx = pj.xy(h.lon, h.lat)
    near = sorted(model.fac(category), key=lambda f: (np.hypot(*(np.subtract(pj.xy(f.lon, f.lat), hx))), f.id))[:1]
    counts = {f: st["factor"].count(f) for f in FACTOR_LABEL}
    failing = {k: v for k, v in counts.items() if STATUS_OF[k] == "FAIL" and v}
    primary = max(failing, key=lambda k: (failing[k], k)) if failing else max(counts, key=lambda k: (counts[k], k))
    sentence = {
        "served": f"Most homes here reach {CATEGORY_LABEL[category].lower()} within {T:.0f} m on links of known condition.",
        "unknown_links": f"Homes here reach {CATEGORY_LABEL[category].lower()} within {T:.0f} m only if links of unknown condition are passable. The access gap is a data gap: verify these links before acting.",
        "outside_area": f"The nearest {CATEGORY_LABEL[category].lower()} facility is outside the modeled network; access cannot be verified here.",
        "barrier": f"A {CATEGORY_LABEL[category].lower()} facility is within {T:.0f} m along the street network, but recorded barriers cut the {('step-free ' if profile == Profile.STEP_FREE else '')}route. Repairing connections could restore access; a new facility is not required for these homes.",
        "detour": f"A {CATEGORY_LABEL[category].lower()} facility is within {T:.0f} m as the crow flies, but the walk along the network is longer even with every modeled link open.",
        "distance": f"No {CATEGORY_LABEL[category].lower()} facility lies within {T:.0f} m, even in a straight line. Repairs cannot close this gap; it is a service-availability problem.",
    }[primary]
    return {
        "cell": cell, "category": category, "label": CATEGORY_LABEL[category], "profile": Profile(profile).value, "threshold_m": T,
        "homes": len(homes), "factors": counts, "walk_factors": {f: walk["factor"].count(f) for f in FACTOR_LABEL},
        "primary_factor": primary, "primary_label": FACTOR_LABEL[primary], "sentence": sentence,
        "representative": {
            "home": h.id, "lon": h.lon, "lat": h.lat,
            "straight_m": _r(st["straight"][rep]), "straight_outside_m": _r(st["straight_outside"][rep]),
            "step_free_verified_m": _r(st["verified"][rep]), "step_free_possible_m": _r(st["possible"][rep]),
            "walking_verified_m": _r(walk["verified"][rep]), "walking_possible_m": _r(walk["possible"][rep]),
            "physical_m": _r(st["physical"][rep]),
            "nearest_facility": None if not near else {"id": near[0].id, "name": near[0].name, "in_network": near[0].snap is not None},
            "route_edges": evidence[state_key(profile, "possible")], "physical_edges": phys,
            "barriers": [{"id": e, "kind": g.edges[e].kind.value, "reason": g.edges[e].reason, "source_ids": g.edges[e].source_ids[:3]} for e in barriers],
            "unknown": [{"id": e, "kind": g.edges[e].kind.value, "reason": g.edges[e].reason} for e in unknown][:12],
            "unknown_count": len(unknown),
        },
        "assumptions": [
            "Demand: OSM residential buildings (and large untyped buildings in residential land use), one per building: a proxy, not population.",
            "Homes and facilities join the network by a straight connector to the nearest sidewalk (inferred).",
            "Facilities outside the modeled network are used for straight-line screening only.",
            f"Threshold {T:.0f} m along the network (REACH default for this category, measured there in a straight line).",
        ],
    }
