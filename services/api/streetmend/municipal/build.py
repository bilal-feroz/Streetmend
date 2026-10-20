"""Build a candidate pedestrian accessibility graph from Charlotte records + OSM.

Inputs (written by scripts/ingest/fetch_charlotte.py):
  ramps.geojson, sidewalks.geojson, bus_stops.geojson   City of Charlotte (CDOT / CATS)
  osm_streets.geojson, osm_nodes.geojson, osm_pois.geojson,
  osm_buildings.geojson, osm_residential.geojson        OpenStreetMap contributors

Construction (all geometry in UTM 17N metres):
1. OSM drive-network centerlines give intersections and street legs.
2. Each intersection gets one corner node per angular sector between legs.
   Corners are never connected to each other directly.
3. Sidewalk edges run along each side of each street segment between the
   matching corners. Their state comes from the CDOT Sidewalk Inventory line
   on that side (matched by perpendicular offset, direction and coverage);
   no matching record -> UNKNOWN.
4. At intersections with 3+ legs, a crossing across each leg connects the
   two adjacent corners through curb-ramp edges. CDOT ramp records are
   assigned to an intersection (by RP_IntID group and distance), to a corner
   (by bearing sector), and to a crossing (by the recorded crosswalk
   direction). Ramp state follows an explicit passability policy; a corner
   with no matched ramp record -> UNKNOWN.
5. Destinations (OSM healthcare/education POIs, CATS bus stops) and origins
   (OSM residential buildings aggregated per sidewalk segment) connect to
   the nearest sidewalk through INFERRED entrance connectors.

Nothing here is invented to make the network look complete: missing
evidence stays UNKNOWN and is excluded from modeled traversability.
"""

from __future__ import annotations

import json
import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
from pyproj import Transformer
from shapely.geometry import LineString, Point, shape
from shapely.ops import substring
from shapely.strtree import STRtree

from streetmend.graph import (
    DestinationCategory,
    Edge,
    EdgeKind,
    Evidence,
    Node,
    NodeKind,
    Passability,
    PedGraph,
)
from streetmend.scenario.model import Destination, Intervention, Origin, Scenario

TO_M = Transformer.from_crs("EPSG:4326", "EPSG:32617", always_xy=True)
TO_LL = Transformer.from_crs("EPSG:32617", "EPSG:4326", always_xy=True)

EXCLUDED_HIGHWAYS = {"motorway", "motorway_link", "trunk", "trunk_link", "busway"}
HALF_WIDTH = {"primary": 9.0, "primary_link": 5.5, "secondary": 7.5, "secondary_link": 5.0, "tertiary": 6.5,
              "tertiary_link": 4.5, "residential": 4.5, "unclassified": 4.5, "living_street": 3.5}
SIDEWALK_OFFSET = 2.5  # metres beyond the curb line
RESIDENTIAL_BUILDINGS = {"house", "apartments", "residential", "terrace", "detached", "semidetached_house", "dormitory", "bungalow"}

COMPASS = {"N": 0, "NE": 45, "E": 90, "SE": 135, "S": 180, "SW": 225, "W": 270, "NW": 315}

# Severe-defect thresholds used by the "moderate" policy. These are planning
# assumptions for prioritisation, not ADA determinations (the ADA maximum
# running slope is 8.33%; these thresholds flag far larger defects).
SEVERE_RUNNING_SLOPE_PCT = 12.0
SEVERE_GUTTER_LIP_IN = 1.0

POLICIES = {
    "moderate": "Missing ramps and non-compliant ramps with a severe measured defect (running slope > 12%, gutter lip >= 1 in, "
                "poor surface or recorded obstruction) are barriers. Other non-compliant ramps are assumed passable.",
    "strict": "Every ramp not recorded as compliant or remediated is a barrier.",
    "lenient": "Only missing ramps are barriers; every existing ramp is assumed passable.",
}


def ll(x: float, y: float) -> tuple[float, float]:
    lon, lat = TO_LL.transform(x, y)
    return (round(lon, 7), round(lat, 7))


def bearing_deg(dx: float, dy: float) -> float:
    """Compass bearing (0 = north, clockwise)."""
    return (math.degrees(math.atan2(dx, dy)) + 360) % 360


def ang_diff(a: float, b: float) -> float:
    d = abs(a - b) % 360
    return min(d, 360 - d)


_SUFFIX = re.compile(r"\b(street|st|avenue|ave|av|road|rd|drive|dr|boulevard|blvd|lane|ln|place|pl|court|ct|way|parkway|pkwy|"
                     r"circle|cir|terrace|ter|n|s|e|w|north|south|east|west)\b")


def norm_name(s: str | None) -> str:
    if not s:
        return ""
    s = s.lower().replace("_", " ")
    s = _SUFFIX.sub(" ", s)
    return re.sub(r"\s+", " ", s).strip()


def survey_iso(s: str | None) -> str | None:
    if not s:
        return None
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", s)
    return f"{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}" if m else None


@dataclass
class RampClass:
    state: Passability
    reason: str
    candidate_kind: str | None
    evidence: Evidence
    category: str  # compact label for the records layer


def classify_ramp(p: dict, policy: str) -> RampClass:
    date = survey_iso(p.get("RP_SurveyDate"))
    when = f" (CDOT survey {date})" if date else " (survey date missing)"
    ev = Evidence.MUNICIPAL_HISTORICAL if date and date < "2022-01-01" else Evidence.MUNICIPAL_RECORD
    rem = p.get("Remediated")
    rtype = p.get("RP_Type")
    committed = " City record lists remediation as committed." if rem == "Committed" else ""
    if rem == "Yes":
        d = p.get("RemediatedDate")
        return RampClass(Passability.TRAVERSABLE, f"Remediated per city record{' on ' + d if d else ''}; not field-verified by StreetMend.",
                         None, Evidence.MUNICIPAL_RECORD, "remediated")
    if rtype == "NoRamp" or p.get("RP_InitValidStatus") == "NoRamp":
        return RampClass(Passability.BLOCKED, f"No curb ramp recorded at this crossing landing{when}.{committed}",
                         "install_curb_ramp", ev, "no_ramp")
    comp = p.get("RP_ComplianceStatus")
    if comp == "Yes":
        return RampClass(Passability.TRAVERSABLE, f"Ramp recorded as compliant{when}.", None, ev, "compliant")
    if comp is None:
        return RampClass(Passability.UNKNOWN, f"Ramp record has no compliance status{when}.", None, ev, "unknown")
    severe = []
    slope, lip = p.get("RP_Slope"), p.get("RP_GutterLipHt")
    if slope is not None and slope > SEVERE_RUNNING_SLOPE_PCT:
        severe.append(f"running slope {slope:g}%")
    if lip is not None and lip >= SEVERE_GUTTER_LIP_IN:
        severe.append(f"{lip:g}-inch gutter lip")
    if p.get("RP_SurfCond") == "Poor":
        severe.append("poor surface condition")
    if p.get("RP_Obs") == "Yes":
        severe.append(f"obstruction ({p.get('RP_ObsType') or 'unspecified'})")
    detail = "; ".join(severe)
    if policy == "lenient" or (policy == "moderate" and not severe):
        why = "minor or unmeasured defects" if not severe else detail
        return RampClass(Passability.TRAVERSABLE, f"Ramp present but non-compliant ({why}){when}; assumed passable under the {policy} policy.",
                         None, Evidence.ASSUMED, "noncompliant_minor" if not severe else "noncompliant_severe")
    reason = f"Non-compliant ramp{': ' + detail if detail else ''}{when}; treated as a barrier under the {policy} policy.{committed}"
    return RampClass(Passability.BLOCKED, reason, "reconstruct_curb_ramp", ev, "noncompliant_severe" if severe else "noncompliant_minor")


@dataclass
class Leg:
    edge: int  # index into streets
    angle: float  # math angle (rad, ccw from east) leaving the node
    half_width: float
    name: str


@dataclass
class Inter:
    osmid: int
    x: float
    y: float
    legs: list[Leg] = field(default_factory=list)
    corners: list[tuple[float, float]] = field(default_factory=list)
    ramps: dict[int, list[dict]] = field(default_factory=lambda: defaultdict(list))  # corner -> ramp records


@dataclass
class BuildReport:
    counts: Counter = field(default_factory=Counter)
    unmatched_ramps: list[dict] = field(default_factory=list)
    ambiguous_ramps: list[dict] = field(default_factory=list)
    unsnapped_places: list[dict] = field(default_factory=list)


def _load(d: Path, name: str) -> list[dict]:
    return json.loads((d / name).read_text(encoding="utf-8"))["features"]


def _xy(lonlat) -> tuple[float, float]:
    return TO_M.transform(lonlat[0], lonlat[1])


def _half_width(props: dict) -> float:
    hw = HALF_WIDTH.get(props.get("highway") or "", 4.5)
    try:
        lanes = float(str(props.get("lanes")).split(";")[0])
        hw = max(hw, lanes * 1.65)
    except (TypeError, ValueError):
        pass
    return hw


def build_municipal(data_dir: Path, policy: str = "moderate", max_distance_m: float = 800.0) -> tuple[Scenario, dict]:
    if policy not in POLICIES:
        raise ValueError(f"unknown policy {policy}")
    rep = BuildReport()
    streets_raw = [f for f in _load(data_dir, "osm_streets.geojson") if f["properties"].get("highway") not in EXCLUDED_HIGHWAYS]
    nodes_raw = {f["properties"]["osmid"]: _xy(f["geometry"]["coordinates"]) for f in _load(data_dir, "osm_nodes.geojson")}
    streets = []
    for f in streets_raw:
        p = f["properties"]
        if p["u"] == p["v"] or p["u"] not in nodes_raw or p["v"] not in nodes_raw:
            rep.counts["street_edges_skipped"] += 1
            continue
        line = LineString([_xy(c) for c in f["geometry"]["coordinates"]])
        if line.length < 1.0:
            continue
        streets.append({"u": p["u"], "v": p["v"], "line": line, "name": p.get("name") or "", "highway": p.get("highway"),
                        "hw": _half_width(p), "osmid": p.get("osmid")})
    rep.counts["street_edges"] = len(streets)

    # ---- intersections and legs ------------------------------------------
    inters: dict[int, Inter] = {}
    for i, s in enumerate(streets):
        for end in ("u", "v"):
            nid = s[end]
            x, y = nodes_raw[nid]
            line = s["line"] if end == "u" else LineString(list(s["line"].coords)[::-1])
            probe = line.interpolate(min(8.0, line.length * 0.5))
            ang = math.atan2(probe.y - y, probe.x - x)
            inters.setdefault(nid, Inter(nid, x, y)).legs.append(Leg(i, ang, s["hw"], s["name"]))
    for it in inters.values():
        it.legs.sort(key=lambda l: l.angle)
        d = len(it.legs)
        if d == 1:
            # Dead end (cul-de-sac or a street cut by the study-area edge): keep the
            # left and right sides as separate corners. Wrapping around the end
            # would join both sides of the street without a crossing or ramps.
            leg = it.legs[0]
            off = leg.half_width + SIDEWALK_OFFSET
            it.corners = [(it.x + off * math.cos(leg.angle + s * math.pi / 2), it.y + off * math.sin(leg.angle + s * math.pi / 2))
                          for s in (1, -1)]  # [left of the outgoing leg, right of it]
            continue
        for k in range(d):
            a, b = it.legs[k], it.legs[(k + 1) % d]
            span = (b.angle - a.angle) % (2 * math.pi) or 2 * math.pi
            mid = a.angle + span / 2
            hw = max(a.half_width, b.half_width) + SIDEWALK_OFFSET
            r = min(hw / max(math.sin(min(span, math.pi) / 2), 0.2), 22.0)
            it.corners.append((it.x + r * math.cos(mid), it.y + r * math.sin(mid)))

    def corner_of(it: Inter, px: float, py: float) -> int:
        d = len(it.legs)
        if d == 1:
            return 0
        ang = math.atan2(py - it.y, px - it.x)
        for k in range(d):
            a = it.legs[k].angle
            span = (it.legs[(k + 1) % d].angle - a) % (2 * math.pi) or 2 * math.pi
            if (ang - a) % (2 * math.pi) <= span:
                return k
        return d - 1

    # ---- ramps -> intersection corners ---------------------------------------
    ramps = _load(data_dir, "ramps.geojson")
    big = [it for it in inters.values() if len(it.legs) >= 3]
    big_xy = np.array([[it.x, it.y] for it in big])
    groups: dict[str, list[dict]] = defaultdict(list)
    for f in ramps:
        p = dict(f["properties"])
        p["_xy"] = _xy(f["geometry"]["coordinates"])
        p["_lonlat"] = f["geometry"]["coordinates"]
        groups[p.get("RP_IntID") or f"solo:{p['OBJECTID']}"].append(p)
    rep.counts["ramp_records"] = len(ramps)
    for gid, recs in groups.items():
        cx = float(np.mean([r["_xy"][0] for r in recs]))
        cy = float(np.mean([r["_xy"][1] for r in recs]))
        dist = np.hypot(big_xy[:, 0] - cx, big_xy[:, 1] - cy)
        order = np.argsort(dist)
        best = order[0]
        if dist[best] > 35.0:
            for r in recs:
                rep.unmatched_ramps.append({"OBJECTID": r["OBJECTID"], "RP_AssetID": r.get("RP_AssetID"),
                                            "reason": f"no OSM intersection within 35 m of intersection group {gid} ({dist[best]:.0f} m)"})
            continue
        if len(order) > 1 and dist[order[1]] < 1.3 * dist[best] and dist[order[1]] < 25:
            rep.ambiguous_ramps.append({"intersection_group": gid, "nearest_m": round(float(dist[best]), 1),
                                        "second_m": round(float(dist[order[1]]), 1), "ramps": [r["OBJECTID"] for r in recs]})
        it = big[best]
        for r in recs:
            r["_inter"] = it.osmid
            it.ramps[corner_of(it, *r["_xy"])].append(r)
            rep.counts["ramps_matched"] += 1

    # ---- graph -----------------------------------------------------------------
    g = PedGraph()

    def add_node(nid: str, kind: NodeKind, xy, label: str = "") -> str:
        if nid not in g.nodes:
            lon, lat = ll(*xy)
            g.add_node(Node(nid, kind, lon, lat, label, {"x": xy[0], "y": xy[1]}))
        return nid

    def add_edge(eid: str, u: str, v: str, kind: EdgeKind, pts_xy: list, state: Passability, evidence: Evidence,
                 source: str, label: str, reason: str, source_ids: list[str] | None = None, **attrs) -> Edge:
        geom = [ll(*p) for p in pts_xy]
        length = max(LineString(pts_xy).length, 0.5)
        return g.add_edge(Edge(eid, u, v, kind, length, geom, state, evidence, source, source_ids or [], label, reason, attrs))

    corner_id = lambda it, k: f"K:{it.osmid}:{k}"  # noqa: E731
    for it in inters.values():
        names = sorted({l.name for l in it.legs if l.name})
        for k, xy in enumerate(it.corners):
            add_node(corner_id(it, k), NodeKind.CORNER, xy, f"Corner of {' & '.join(names) or 'unnamed streets'}")

    # Sidewalk inventory matching: per (street edge, side) coverage by class.
    inv = _load(data_dir, "sidewalks.geojson")
    inv_lines = [LineString([_xy(c) for c in f["geometry"]["coordinates"]]) for f in inv]
    tree = STRtree([s["line"] for s in streets])
    coverage: dict[tuple[int, int], Counter] = defaultdict(Counter)
    cover_ids: dict[tuple[int, int], set] = defaultdict(set)
    for f, line in zip(inv, inv_lines):
        p = f["properties"]
        if line.length < 1:
            continue
        a, b = line.coords[0], line.coords[-1]
        inv_bear = bearing_deg(b[0] - a[0], b[1] - a[1])
        matched = False
        for si in tree.query(line.buffer(15.0)):
            s = streets[int(si)]
            cl = s["line"]
            mid = line.interpolate(0.5, normalized=True)
            if cl.distance(mid) > s["hw"] + 12 or cl.distance(mid) < 0.5:
                continue
            t0, t1 = sorted((cl.project(Point(a)), cl.project(Point(b))))
            overlap = t1 - t0
            if overlap < 2:
                continue
            pa, pb = cl.interpolate(t0), cl.interpolate(t1)
            if ang_diff(inv_bear % 180, bearing_deg(pb.x - pa.x, pb.y - pa.y) % 180) > 35 and ang_diff(inv_bear, bearing_deg(pb.x - pa.x, pb.y - pa.y) + 180) > 35:
                continue
            nm_inv, nm_osm = norm_name(p.get("Street")), norm_name(s["name"])
            if nm_inv and nm_osm and not (set(nm_inv.split()) & set(nm_osm.split())):
                continue
            tm = cl.project(mid)
            q0, q1 = cl.interpolate(max(0, tm - 1)), cl.interpolate(min(cl.length, tm + 1))
            cross = (q1.x - q0.x) * (mid.y - q0.y) - (q1.y - q0.y) * (mid.x - q0.x)
            side = 1 if cross > 0 else -1  # +1 = left of u->v
            coverage[(int(si), side)][p.get("SidewalkPresence") or "Unknown"] += overlap
            cover_ids[(int(si), side)].add(p.get("AssetID") or str(p.get("OBJECTID")))
            matched = True
        rep.counts["inventory_matched" if matched else "inventory_unmatched"] += 1

    sidewalks: list[dict] = []
    for i, s in enumerate(streets):
        iu, iv = inters[s["u"]], inters[s["v"]]
        ku = _leg_index(iu, i, s["line"], True)
        kv = _leg_index(iv, i, s["line"], False)
        du, dv = len(iu.legs), len(iv.legs)
        for side in (1, -1):
            # Dead ends have [left, right] corners relative to their single leg.
            cu = (0 if side == 1 else 1) if du == 1 else (ku if side == 1 else (ku - 1) % du)
            cv = (1 if side == 1 else 0) if dv == 1 else ((kv - 1) % dv if side == 1 else kv)
            off = s["line"].offset_curve(side * (s["hw"] + SIDEWALK_OFFSET))
            mid_pts = list(off.coords)[1:-1] if off.geom_type == "LineString" and not off.is_empty else []
            pts = [iu.corners[cu], *mid_pts, iv.corners[cv]]
            cov = coverage.get((i, side), Counter())
            total = sum(cov.values())
            seg_len = max(s["line"].length, 1)
            if total >= 0.4 * seg_len:
                cls, _ = cov.most_common(1)[0]
                if cls == "Sidewalk":
                    state, ev = Passability.TRAVERSABLE, Evidence.MUNICIPAL_RECORD
                    reason = "Sidewalk present per CDOT Sidewalk Inventory; width, surface and slope not verified for wheelchair use."
                elif cls in ("No Sidewalk", "Not possible to construct"):
                    state, ev = Passability.BLOCKED, Evidence.MUNICIPAL_RECORD
                    reason = f"CDOT Sidewalk Inventory: {cls}."
                else:
                    state, ev, reason = Passability.UNKNOWN, Evidence.MUNICIPAL_RECORD, "Inventory record without presence value."
            else:
                state, ev = Passability.UNKNOWN, Evidence.INFERRED
                reason = "No matching CDOT sidewalk inventory record on this side; condition unknown."
            rep.counts[f"sidewalk_{state.value}"] += 1
            sidewalks.append({"id": f"S:{i}:{'L' if side == 1 else 'R'}", "u": corner_id(iu, cu), "v": corner_id(iv, cv),
                              "pts": pts, "state": state, "ev": ev, "reason": reason, "street": s["name"],
                              "src": sorted(cover_ids.get((i, side), set()))[:6]})

    # Crossings with curb ramps at 3+ leg intersections.
    interventions: dict[str, Intervention] = {}
    ramp_edges: dict[str, list[str]] = defaultdict(list)  # ramp record -> edge ids
    ramp_meta: dict[str, dict] = {}
    for it in inters.values():
        d = len(it.legs)
        if d < 3:
            continue
        names = sorted({l.name for l in it.legs if l.name})
        iname = " & ".join(names) or f"intersection {it.osmid}"
        for k, leg in enumerate(it.legs):
            ca, cb = (k - 1) % d, k  # corners on either side of leg k
            ux, uy = math.cos(leg.angle), math.sin(leg.angle)
            curb = {}
            for c in (ca, cb):
                kx, ky = it.corners[c]
                along = max(3.0, (kx - it.x) * ux + (ky - it.y) * uy)
                lat_sign = 1 if ux * (ky - it.y) - uy * (kx - it.x) > 0 else -1
                curb[c] = (it.x + ux * along - uy * leg.half_width * lat_sign, it.y + uy * along + ux * leg.half_width * lat_sign)
            cnodes = {c: add_node(f"C:{it.osmid}:{c}:{k}", NodeKind.CURB, curb[c], f"Curb ramp landing, {iname}") for c in (ca, cb)}
            marked = False
            for c, other in ((ca, cb), (cb, ca)):
                dirb = bearing_deg(curb[other][0] - curb[c][0], curb[other][1] - curb[c][1])
                recs = it.ramps.get(c, [])
                best, best_diff = None, 999.0
                for r in recs:
                    for dk, wk in (("RP_XWalk1Dir", "RP_XWalk1"), ("RP_XWalk2Dir", "RP_XWalk2")):
                        dv = (r.get(dk) or "").replace("To ", "").strip()
                        if dv in COMPASS and ang_diff(COMPASS[dv], dirb) < best_diff:
                            best, best_diff = r, ang_diff(COMPASS[dv], dirb)
                            if r.get(wk) == "Yes":
                                marked = marked or best_diff <= 67.5
                if best is not None and best_diff > 67.5:
                    best = None
                inferred = False
                if best is None and len(recs) == 1 and not any(recs[0].get(x) for x in ("RP_XWalk1Dir", "RP_XWalk2Dir")):
                    best, inferred = recs[0], True
                eid = f"R:{it.osmid}:{c}:{k}"
                if best is None:
                    state, ev = Passability.UNKNOWN, Evidence.INFERRED
                    reason = "No CDOT ramp record matched to this crossing landing; condition unknown." if not recs else \
                        "Ramp records exist at this corner but none is recorded as serving this crossing direction."
                    add_edge(eid, corner_id(it, c), cnodes[c], EdgeKind.RAMP, [it.corners[c], curb[c]], state, ev, "streetmend-inference",
                             f"Ramp landing, {iname}", reason, intersection=iname)
                    rep.counts["ramp_edges_unknown"] += 1
                    continue
                rc = classify_ramp(best, policy)
                rid = str(best["OBJECTID"])
                add_edge(eid, corner_id(it, c), cnodes[c], EdgeKind.RAMP, [it.corners[c], curb[c]], rc.state,
                         Evidence.INFERRED if inferred else rc.evidence, "CDOT ADA Curb Ramps",
                         f"{best.get('RP_LocInInt') or ''} ramp, {iname}".strip(), rc.reason + (" Ramp-to-crossing assignment inferred (no direction recorded)." if inferred else ""),
                         [f"OBJECTID {rid}", best.get("RP_AssetID") or ""], intersection=iname, ramp_record=rid)
                rep.counts[f"ramp_edges_{rc.state.value}"] += 1
                if rc.state == Passability.BLOCKED and rc.candidate_kind:
                    ramp_edges[rid].append(eid)
                    ramp_meta[rid] = {"rec": best, "cls": rc, "iname": iname}
            add_edge(f"X:{it.osmid}:{k}", cnodes[ca], cnodes[cb], EdgeKind.CROSSING, [curb[ca], curb[cb]], Passability.TRAVERSABLE,
                     Evidence.MUNICIPAL_RECORD if marked else Evidence.ASSUMED, "CDOT ADA Curb Ramps" if marked else "streetmend-inference",
                     f"Crossing of {leg.name or 'street'} at {iname}",
                     "Marked crosswalk recorded in CDOT ramp survey." if marked else
                     "Unmarked crossing at an intersection leg assumed; signals, traffic and crossing time are not modeled.",
                     intersection=iname, leg=leg.name, highway=streets[leg.edge]["highway"] or "")
            rep.counts["crossings"] += 1

    for rid, eids in ramp_edges.items():
        m = ramp_meta[rid]
        r, rc = m["rec"], m["cls"]
        verb = "Install curb ramp" if rc.candidate_kind == "install_curb_ramp" else "Reconstruct curb ramp"
        asset = (r.get("RP_AssetID") or "").replace(" ", "")
        iid = asset if asset.startswith("R") else f"R{asset or rid}"
        if iid in interventions:
            iid = f"{iid}-{rid}"
        lon, lat = r["_lonlat"]
        interventions[iid] = Intervention(
            id=iid, label=f"{verb}, {r.get('RP_LocInInt') or ''} corner of {m['iname']}".replace("  ", " "),
            kind=rc.candidate_kind, edge_ids=sorted(eids), lon=lon, lat=lat, description=rc.reason, evidence=rc.evidence,
            source_ids=[f"OBJECTID {rid}", r.get("RP_AssetID") or "", r.get("ADA_ID") or ""],
            attrs={"record": {k: r.get(k) for k in ("OBJECTID", "RP_AssetID", "RP_Type", "RP_Street1", "RP_Street2", "RP_LocInInt",
                                                     "RP_ComplianceStatus", "Remediated", "RP_Slope", "RP_GutterLipHt")},
                   "survey_date": survey_iso(r.get("RP_SurveyDate")), "crossings_served": len(eids)},
        )

    # ---- places: split sidewalks at access points ------------------------------
    sw_lines = [LineString(s["pts"]) for s in sidewalks]
    sw_tree = STRtree(sw_lines)
    access: dict[int, list[tuple[float, str]]] = defaultdict(list)
    place_xy: dict[str, tuple[float, float]] = {}
    snap_dist: dict[str, float] = {}

    def snap(pid: str, xy, tol: float, prefer_traversable: bool = False) -> bool:
        pt = Point(xy)
        idxs = sw_tree.query(pt.buffer(tol))
        cands = sorted(((sw_lines[int(i)].distance(pt), int(i)) for i in idxs), key=lambda t: t[0])
        if prefer_traversable:
            trav = [c for c in cands if sidewalks[c[1]]["state"] == Passability.TRAVERSABLE and c[0] <= cands[0][0] + 6]
            cands = trav or cands
        if not cands or cands[0][0] > tol:
            return False
        dist, i = cands[0]
        t = sw_lines[i].project(pt) / max(sw_lines[i].length, 1e-9)
        access[i].append((min(max(t, 0.02), 0.98), pid))
        place_xy[pid] = xy
        snap_dist[pid] = dist
        return True

    dests: list[Destination] = []
    pois = _load(data_dir, "osm_pois.geojson")
    seen_names: dict[str, tuple[float, float]] = {}
    for f in pois:
        p = f["properties"]
        am, hc = p.get("amenity"), p.get("healthcare")
        if am in ("hospital", "clinic", "doctors", "pharmacy", "dentist") or (hc and hc not in ("laboratory",) and not am):
            cat = DestinationCategory.HEALTHCARE
        elif am in ("school", "college", "university", "library", "kindergarten"):
            cat = DestinationCategory.EDUCATION
        else:
            continue
        name = p.get("name") or f"Unnamed {am or hc}"
        xy = _xy(f["geometry"]["coordinates"])
        key = name.lower()
        if key in seen_names and math.dist(seen_names[key], xy) < 250:
            rep.counts["poi_duplicates_merged"] += 1
            continue
        seen_names[key] = xy
        pid = f"D:osm:{p['osm_type']}/{p['osmid']}"
        if snap(pid, xy, 160 if am in ("hospital", "college", "university") else 70, prefer_traversable=True):
            dests.append(Destination(pid, name, cat, 1.0, Evidence.OSM, [f"OSM {p['osm_type']}/{p['osmid']}"]))
        else:
            rep.unsnapped_places.append({"id": pid, "name": name, "reason": "no modeled sidewalk within tolerance"})
    for f in _load(data_dir, "bus_stops.geojson"):
        p = f["properties"]
        pid = f"D:cats:{p.get('StopID') or p['OBJECTID']}"
        label = f"Bus stop {p.get('StopID')}: {p.get('StopDesc') or p.get('Nearest_Inter') or ''}".strip()
        if snap(pid, _xy(f["geometry"]["coordinates"]), 30):
            dests.append(Destination(pid, label, DestinationCategory.TRANSIT, 1.0, Evidence.MUNICIPAL_RECORD, [f"CATS StopID {p.get('StopID')}"]))
        else:
            rep.unsnapped_places.append({"id": pid, "name": label, "reason": "no modeled sidewalk within 30 m"})

    # Origins: residential buildings aggregated per sidewalk segment.
    res_polys = [shape(f["geometry"]) for f in _load(data_dir, "osm_residential.geojson")]
    res_polys_m = [_poly_to_m(pg) for pg in res_polys]
    res_tree = STRtree(res_polys_m) if res_polys_m else None
    per_sidewalk: dict[int, int] = Counter()
    for f in _load(data_dir, "osm_buildings.geojson"):
        b = f["properties"].get("building")
        xy = _xy(f["geometry"]["coordinates"])
        is_res = b in RESIDENTIAL_BUILDINGS
        if not is_res and b == "yes" and res_tree is not None:
            pt = Point(xy)
            is_res = any(res_polys_m[int(i)].contains(pt) for i in res_tree.query(pt))
        if not is_res:
            continue
        pt = Point(xy)
        idxs = sw_tree.query(pt.buffer(60))
        cands = sorted(((sw_lines[int(i)].distance(pt), int(i)) for i in idxs))
        if cands and cands[0][0] <= 60:
            per_sidewalk[cands[0][1]] += 1
            rep.counts["residential_buildings_used"] += 1
    origins: list[Origin] = []
    for i, n in sorted(per_sidewalk.items()):
        pid = f"O:{sidewalks[i]['id']}"
        access[i].append((0.5, pid))
        line = sw_lines[i]
        mid = line.interpolate(0.5, normalized=True)
        place_xy[pid] = (mid.x, mid.y)
        snap_dist[pid] = 0.0
        street = sidewalks[i]["street"] or "unnamed street"
        origins.append(Origin(pid, f"Homes along {street} ({n} bldg)", float(n),
                              "OSM residential building count on this sidewalk segment (proxy; not population)"))

    # Emit sidewalk edges, split at access points.
    for i, s in enumerate(sidewalks):
        line = sw_lines[i]
        stops = sorted(access.get(i, []))
        prev, prev_t, seg = s["u"], 0.0, 0
        for t, pid in stops:
            jxy = line.interpolate(t, normalized=True)
            jid = add_node(f"J:{pid}", NodeKind.JUNCTION, (jxy.x, jxy.y), "Sidewalk access point")
            piece = substring(line, prev_t, t, normalized=True)
            if prev != jid:
                add_edge(f"{s['id']}:{seg}", prev, jid, EdgeKind.SIDEWALK, list(piece.coords) if piece.length > 0.3 else [line.interpolate(prev_t, normalized=True).coords[0], (jxy.x, jxy.y)],
                         s["state"], s["ev"], "CDOT Sidewalk Inventory" if s["ev"] == Evidence.MUNICIPAL_RECORD else "streetmend-inference",
                         f"Sidewalk, {s['street'] or 'unnamed street'}", s["reason"], s["src"])
                seg += 1
            kind = NodeKind.ORIGIN if pid.startswith("O:") else NodeKind.DESTINATION
            add_node(pid, kind, place_xy[pid] if kind == NodeKind.DESTINATION else (jxy.x + 0.6, jxy.y + 0.6))
            pts = [(jxy.x, jxy.y), place_xy[pid] if kind == NodeKind.DESTINATION else (jxy.x + 0.6, jxy.y + 0.6)]
            add_edge(f"E:{pid}", jid, pid, EdgeKind.ENTRANCE, pts, Passability.TRAVERSABLE, Evidence.INFERRED, "streetmend-inference",
                     "Access connector", f"Connector to nearest modeled sidewalk ({snap_dist[pid]:.0f} m); entrance accessibility not verified.")
            prev, prev_t = jid, t
        if prev != s["v"]:
            piece = substring(line, prev_t, 1.0, normalized=True)
            add_edge(f"{s['id']}:{seg}", prev, s["v"], EdgeKind.SIDEWALK, list(piece.coords) if piece.length > 0.3 else [line.interpolate(prev_t, normalized=True).coords[0], line.coords[-1]],
                     s["state"], s["ev"], "CDOT Sidewalk Inventory" if s["ev"] == Evidence.MUNICIPAL_RECORD else "streetmend-inference",
                     f"Sidewalk, {s['street'] or 'unnamed street'}", s["reason"], s["src"])

    for d_ in dests:
        g.nodes[d_.id].label = d_.label
    for o in origins:
        g.nodes[o.id].label = o.label

    # Default journey: a home -> hospital pair that is unavailable today but would
    # be connected if candidate repairs were made (so the map shows the barrier).
    default = None
    import networkx as nx

    enabled_all = {e for iv in interventions.values() for e in iv.edge_ids}
    g0, g_all = g.to_networkx(set()), g.to_networkx(enabled_all)
    health = sorted((d_ for d_ in dests if d_.category == DestinationCategory.HEALTHCARE),
                    key=lambda d_: (0 if "presbyterian" in d_.label.lower() else 1 if "hospital" in d_.label.lower() else 2, d_.id))
    for d_ in health:
        r0 = nx.single_source_dijkstra_path_length(g0, d_.id, cutoff=max_distance_m, weight="weight")
        r1 = nx.single_source_dijkstra_path_length(g_all, d_.id, cutoff=max_distance_m, weight="weight")
        cand = [o for o in origins if o.id in r1 and o.id not in r0]
        if cand:
            default = (max(cand, key=lambda o: (o.weight, o.id)).id, d_.id)
            break
    if default is None and origins and dests:
        default = (max(origins, key=lambda o: (o.weight, o.id)).id, (health or dests)[0].id)

    report = {
        "policy": policy,
        "policy_description": POLICIES[policy],
        "counts": dict(rep.counts),
        "candidates": len(interventions),
        "origins": len(origins),
        "destinations": dict(Counter(d_.category.value for d_ in dests)),
        "unmatched_ramps": rep.unmatched_ramps,
        "ambiguous_intersections": rep.ambiguous_ramps,
        "unsnapped_places": rep.unsnapped_places,
    }
    sc = Scenario(
        id="charlotte-elizabeth" if policy == "moderate" else f"charlotte-elizabeth-{policy}",
        name="Charlotte Data Explorer - Elizabeth",
        mode="municipal",
        description=("Candidate pedestrian graph for Elizabeth, Charlotte NC, built from CDOT curb-ramp and sidewalk records and "
                     f"OpenStreetMap streets and destinations. Passability policy: {policy}."),
        graph=g, origins=origins, destinations=dests, interventions=interventions,
        max_distance_m=max_distance_m, default_journey=default,
        assumptions=[
            "Network geometry is derived from OpenStreetMap street centerlines; corners and curb landings are geometric inferences.",
            "Corners on different sides of a street connect only through modeled crossings with curb ramps at both ends.",
            f"Ramp passability policy ({policy}): {POLICIES[policy]}",
            "Ramp surveys date mostly from 2017-2019; current physical conditions may differ.",
            "Sidewalk presence comes from the CDOT Sidewalk Inventory; width, surface and slope are not verified for wheelchair use.",
            "Edges without matching records are UNKNOWN and excluded from modeled traversability.",
            "Unmarked intersection crossings are assumed legal and usable; signals, traffic volume and crossing time are not modeled.",
            "Origins are OSM residential buildings aggregated per sidewalk segment (a proxy, not population).",
            "Destination access connectors are inferred to the nearest modeled sidewalk; entrance accessibility is not verified.",
            f"Reachable means a modeled traversable route of at most {max_distance_m:.0f} m (planner-configurable).",
        ],
    )
    lons = [n.lon for n in g.nodes.values()]
    lats = [n.lat for n in g.nodes.values()]
    sc.bounds = (min(lons), min(lats), max(lons), max(lats))
    sc.validate()
    return sc, report


def _leg_index(it: Inter, edge_index: int, line: LineString, at_u: bool) -> int:
    """Index of the leg of ``edge_index`` at this intersection (handles parallel edges)."""

    ls = line if at_u else LineString(list(line.coords)[::-1])
    probe = ls.interpolate(min(8.0, ls.length * 0.5))
    ang = math.atan2(probe.y - it.y, probe.x - it.x)
    cands = [k for k, l in enumerate(it.legs) if l.edge == edge_index]
    return min(cands, key=lambda k: abs((it.legs[k].angle - ang + math.pi) % (2 * math.pi) - math.pi))


def _poly_to_m(pg):
    import shapely

    return shapely.transform(pg, lambda c: np.column_stack(TO_M.transform(c[:, 0], c[:, 1])))
