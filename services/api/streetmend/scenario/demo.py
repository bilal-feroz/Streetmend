"""Guided Simulation: a deterministic, synthetic pedestrian network.

SYNTHETIC DATA. This district does not exist. It was designed to demonstrate
the combined-repair problem: a residential area west of a four-lane boulevard
and a clinic to its east. Coordinates are metres in a local frame converted
to lon/lat around (0, 0) purely so web-map tooling can render them.

Geometry conventions (local metres, x east, y north):
* Street centrelines at X (avenues, north-south) and Y (streets, east-west).
* Sidewalk centrelines run ``half_width + SIDEWALK_OFFSET`` from the centreline.
* Every corner has a sidewalk-junction node and two perpendicular curb ramps,
  one for each crossing that starts at that corner. A crossing is usable only
  when the crossing itself and the ramps at both ends are traversable.
"""

from __future__ import annotations

import random
from dataclasses import dataclass

from streetmend.graph import (
    DestinationCategory,
    Edge,
    EdgeKind,
    Evidence,
    Node,
    NodeKind,
    Passability,
    PedGraph,
    polyline_length_m,
)
from streetmend.scenario.model import Destination, Intervention, Origin, Scenario

M_PER_DEG_LAT = 110_574.0
M_PER_DEG_LON = 111_320.0  # at the equator; the frame is anchored at (0, 0)
SIDEWALK_OFFSET = 3.0

AVENUES = [("Ash Ave", 0.0, 6.0), ("Elm Ave", 150.0, 6.0), ("Oak Ave", 300.0, 6.0),
           ("Harbor Blvd", 470.0, 15.0), ("Pine Ave", 640.0, 6.0), ("Willow Ave", 790.0, 6.0)]
STREETS = [("Linden St", 0.0, 6.0), ("Maple St", 130.0, 6.0), ("Cedar St", 260.0, 6.0), ("Birch St", 390.0, 6.0)]
HARBOR = 3
STUB = 70.0  # streets continue past the modeled district


def ll(x: float, y: float) -> tuple[float, float]:
    return (round(x / M_PER_DEG_LON, 9), round(y / M_PER_DEG_LAT, 9))


CORNERS = {"NE": (1, 1), "NW": (-1, 1), "SE": (1, -1), "SW": (-1, -1)}


def outside(i: int, j: int, c: str) -> bool:
    """Corners facing away from the modeled district (no sidewalks modeled there)."""

    return ((i == 0 and c in ("NW", "SW")) or (i == len(AVENUES) - 1 and c in ("NE", "SE"))
            or (j == 0 and c in ("SE", "SW")) or (j == len(STREETS) - 1 and c in ("NE", "NW")))


@dataclass
class RampSpec:
    state: Passability
    reason: str
    candidate: str | None = None  # intervention id
    label: str = ""
    kind: str = "reconstruct_curb_ramp"


class DemoBuilder:
    def __init__(self) -> None:
        self.g = PedGraph()
        self.interventions: dict[str, Intervention] = {}

    # ---- helpers ------------------------------------------------------
    def inter_name(self, i: int, j: int) -> str:
        return f"{STREETS[j][0]} & {AVENUES[i][0]}"

    def corner_xy(self, i: int, j: int, c: str) -> tuple[float, float]:
        sx, sy = CORNERS[c]
        x, hx = AVENUES[i][1], AVENUES[i][2]
        y, hy = STREETS[j][1], STREETS[j][2]
        return (x + sx * (hx + SIDEWALK_OFFSET), y + sy * (hy + SIDEWALK_OFFSET))

    def node(self, nid: str, kind: NodeKind, xy: tuple[float, float], label: str = "", **attrs) -> str:
        if nid not in self.g.nodes:
            lon, lat = ll(*xy)
            self.g.add_node(Node(nid, kind, lon, lat, label, dict(attrs, x=xy[0], y=xy[1])))
        return nid

    def edge(self, eid: str, u: str, v: str, kind: EdgeKind, state: Passability = Passability.TRAVERSABLE,
             label: str = "", reason: str = "", via: list[tuple[float, float]] | None = None, **attrs) -> Edge:
        nu, nv = self.g.nodes[u], self.g.nodes[v]
        pts = [(nu.attrs["x"], nu.attrs["y"])] + (via or []) + [(nv.attrs["x"], nv.attrs["y"])]
        geom = [ll(*p) for p in pts]
        e = Edge(eid, u, v, kind, polyline_length_m(geom), geom, state, Evidence.SYNTHETIC,
                 source="streetmend-synthetic-demo", label=label, reason=reason, attrs=attrs)
        return self.g.add_edge(e)

    # ---- network ------------------------------------------------------
    def build_network(self, ramp_specs: dict[tuple[int, int, str, str], RampSpec],
                      crossing_exists, sidewalk_specs: dict[tuple, tuple[Passability, str]]) -> None:
        ni, nj = len(AVENUES), len(STREETS)
        # Crossings. 'x' crossings cross the avenue (east-west movement) on the
        # north ('N') or south ('S') leg; 'y' crossings cross the street on the
        # east ('E') or west ('W') leg.
        for i in range(ni):
            x, hx = AVENUES[i][1], AVENUES[i][2]
            for j in range(nj):
                y, hy = STREETS[j][1], STREETS[j][2]
                legs = {
                    "N": ("NW", "NE", "x"),
                    "S": ("SW", "SE", "x"),
                    "W": ("NW", "SW", "y"),
                    "E": ("NE", "SE", "y"),
                }
                for leg, (ca, cb, axis) in legs.items():
                    if outside(i, j, ca) or outside(i, j, cb) or not crossing_exists(i, j, leg):
                        continue
                    curbs = []
                    for c in (ca, cb):
                        self.corner(i, j, c)
                        kx, ky = self.corner_xy(i, j, c)
                        sx, sy = CORNERS[c]
                        cxy = (x + sx * hx, ky) if axis == "x" else (kx, y + sy * hy)
                        cid = self.node(f"C:{i},{j}:{c}:{axis}", NodeKind.CURB, cxy,
                                        f"Curb ramp, {c} corner of {self.inter_name(i, j)}")
                        spec = ramp_specs.get((i, j, c, axis), RampSpec(Passability.TRAVERSABLE, "Ramp meets modeled criteria"))
                        rid = f"R:{i},{j}:{c}:{axis}"
                        if rid not in self.g.edges:
                            facing = {"x": "east-west crossing of " + AVENUES[i][0], "y": "north-south crossing of " + STREETS[j][0]}[axis]
                            self.edge(rid, f"K:{i},{j}:{c}", cid, EdgeKind.RAMP, spec.state,
                                      label=f"{c} ramp ({facing})", reason=spec.reason,
                                      intersection=self.inter_name(i, j), corner=c)
                            if spec.candidate:
                                lon, lat = ll(*cxy)
                                self.interventions[spec.candidate] = Intervention(
                                    id=spec.candidate, label=spec.label or f"{c} ramp, {self.inter_name(i, j)}",
                                    kind=spec.kind, edge_ids=[rid], lon=lon, lat=lat,
                                    description=spec.reason, evidence=Evidence.SYNTHETIC,
                                    attrs={"intersection": self.inter_name(i, j), "corner": c, "crossing": facing},
                                )
                        curbs.append(cid)
                    street = AVENUES[i][0] if axis == "x" else STREETS[j][0]
                    self.edge(f"X:{i},{j}:{leg}", curbs[0], curbs[1], EdgeKind.CROSSING,
                              label=f"Crossing of {street} ({leg} leg of {self.inter_name(i, j)})",
                              reason="Crossing provided (modeled)", intersection=self.inter_name(i, j), leg=leg)
        # Sidewalks along block faces, optionally split at access points.
        self.access_points: dict[tuple, list[tuple[float, str]]] = getattr(self, "access_points", {})
        for j in range(nj):
            for i in range(ni - 1):
                for side, (ca, cb) in {"N": ("NE", "NW"), "S": ("SE", "SW")}.items():
                    self._sidewalk(("ew", i, j, side), f"K:{i},{j}:{ca}", f"K:{i + 1},{j}:{cb}",
                                   f"{STREETS[j][0]} {side} sidewalk, {AVENUES[i][0]} to {AVENUES[i + 1][0]}",
                                   sidewalk_specs)
        for i in range(ni):
            for j in range(nj - 1):
                for side, (ca, cb) in {"E": ("NE", "SE"), "W": ("NW", "SW")}.items():
                    self._sidewalk(("ns", i, j, side), f"K:{i},{j}:{ca}", f"K:{i},{j + 1}:{cb}",
                                   f"{AVENUES[i][0]} {side} sidewalk, {STREETS[j][0]} to {STREETS[j + 1][0]}",
                                   sidewalk_specs)

    def corner(self, i: int, j: int, c: str) -> str:
        return self.node(f"K:{i},{j}:{c}", NodeKind.CORNER, self.corner_xy(i, j, c), f"{c} corner, {self.inter_name(i, j)}")

    def _sidewalk(self, key: tuple, a: str, b: str, label: str, specs) -> None:
        for nid in (a, b):
            _, ij, c = nid.split(":")
            i, j = map(int, ij.split(","))
            if outside(i, j, c):
                return
            self.corner(i, j, c)
        state, reason = specs.get(key, (Passability.TRAVERSABLE, "Sidewalk present (modeled)"))
        stops = sorted(self.access_points.get(key, []))
        prev = a
        ax, ay = self.g.nodes[a].attrs["x"], self.g.nodes[a].attrs["y"]
        bx, by = self.g.nodes[b].attrs["x"], self.g.nodes[b].attrs["y"]
        seg = 0
        for t, jid in stops:
            self.node(jid, NodeKind.JUNCTION, (ax + (bx - ax) * t, ay + (by - ay) * t), "Sidewalk access point")
            self.edge(f"S:{key[0]}:{key[1]},{key[2]}:{key[3]}:{seg}", prev, jid, EdgeKind.SIDEWALK, state, label, reason)
            prev, seg = jid, seg + 1
        self.edge(f"S:{key[0]}:{key[1]},{key[2]}:{key[3]}:{seg}", prev, b, EdgeKind.SIDEWALK, state, label, reason)

    def sidewalk_point(self, key: tuple, t: float) -> tuple[float, float]:
        kind, i, j, side = key
        if kind == "ew":
            ca, cb = ("NE", "NW") if side == "N" else ("SE", "SW")
            a, b = self.corner_xy(i, j, ca), self.corner_xy(i + 1, j, cb)
        else:
            ca, cb = ("NE", "SE") if side == "E" else ("NW", "SW")
            a, b = self.corner_xy(i, j, ca), self.corner_xy(i, j + 1, cb)
        return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


# ---------------------------------------------------------------------------
# Scenario definition
# ---------------------------------------------------------------------------

# Access points: (sidewalk key, position along segment 0..1, place id, inward offset vector)
PLACES = [
    # origins (synthetic residential clusters)
    ("O1", "origin", "Linden Court Apartments", ("ns", HARBOR, 0, "W"), 0.45, (-22, 0), None),
    ("O2", "origin", "Maple Row Homes", ("ew", 2, 2, "S"), 0.62, (0, -22), None),
    ("O3", "origin", "Cedar Terrace", ("ew", 1, 2, "N"), 0.5, (0, 22), None),
    ("O4", "origin", "Ash Gardens", ("ns", 1, 1, "W"), 0.5, (-22, 0), None),
    ("O5", "origin", "Willow Park Flats", ("ns", 4, 1, "E"), 0.5, (22, 0), None),
    # destinations
    ("D_CLINIC", "destination", "Harbor Community Health Clinic", ("ew", HARBOR, 2, "S"), 0.45, (0, -24), DestinationCategory.HEALTHCARE),
    ("D_PHARMACY", "destination", "Cedar Pharmacy", ("ew", HARBOR, 2, "N"), 0.62, (0, 22), DestinationCategory.HEALTHCARE),
    ("D_BUS_NB", "destination", "Route 12 stop, Harbor Blvd northbound", ("ns", HARBOR, 1, "E"), 0.2, (6, 0), DestinationCategory.TRANSIT),
    ("D_BUS_W", "destination", "Route 4 stop, Linden St", ("ew", 1, 0, "N"), 0.5, (0, 6), DestinationCategory.TRANSIT),
    ("D_SCHOOL", "destination", "Ridgeview Elementary School", ("ew", 0, 2, "N"), 0.5, (0, 24), DestinationCategory.EDUCATION),
    ("D_LIBRARY", "destination", "Westside Learning Library", ("ew", 0, 3, "S"), 0.5, (0, -22), DestinationCategory.EDUCATION),
]

ORIGIN_WEIGHT_BASIS = "synthetic: equal weight per residential cluster (no population data)"


def _crossing_exists(i: int, j: int, leg: str) -> bool:
    # Harbor Blvd is a four-lane arterial: crossings of the boulevard itself
    # exist only on the south leg of two signalised intersections.
    if i == HARBOR and leg in ("N", "S"):
        return (j, leg) in {(0, "N"), (2, "S")}
    return True


RAMPS: dict[tuple[int, int, str, str], RampSpec] = {
    # The dependent pair: both ends of the Cedar St crossing of Harbor Blvd.
    (HARBOR, 2, "SW", "x"): RampSpec(Passability.BLOCKED, "No curb ramp: 6-inch vertical curb at the crosswalk landing.",
                                     "A", "Install ramp, SW corner of Cedar St & Harbor Blvd", "install_curb_ramp"),
    (HARBOR, 2, "SE", "x"): RampSpec(Passability.BLOCKED, "Ramp present but unusable: 2.5-inch lip at gutter seam, 13% running slope.",
                                     "B", "Reconstruct ramp, SE corner of Cedar St & Harbor Blvd"),
    # Linden St crossing of Harbor Blvd: one failed ramp.
    (HARBOR, 0, "NE", "x"): RampSpec(Passability.BLOCKED, "Ramp present but unusable: landing obstructed by signal cabinet.",
                                     "C", "Reconstruct ramp, SE corner of Linden St & Harbor Blvd"),
    # West-side school access.
    (1, 2, "SW", "y"): RampSpec(Passability.BLOCKED, "No curb ramp on the west leg crossing of Cedar St.",
                                "E", "Install ramp, SW corner of Cedar St & Elm Ave", "install_curb_ramp"),
    (1, 2, "NE", "x"): RampSpec(Passability.BLOCKED, "Ramp cracked and heaved; 3-inch vertical displacement.",
                                "F", "Reconstruct ramp, NE corner of Cedar St & Elm Ave"),
    (0, 2, "NE", "y"): RampSpec(Passability.BLOCKED, "No curb ramp; crossing ends at a raised curb.",
                                "G", "Install ramp, NE corner of Cedar St & Ash Ave", "install_curb_ramp"),
    (1, 3, "SW", "x"): RampSpec(Passability.BLOCKED, "Ramp flares broken; 1.5-inch lip at landing.",
                                "K", "Reconstruct ramp, SW corner of Birch St & Elm Ave"),
    # East-side barriers near the clinic (close to destinations, low network value).
    (4, 2, "SW", "x"): RampSpec(Passability.BLOCKED, "Ramp running slope 14%; exceeds modeled limit.",
                                "H", "Reconstruct ramp, SW corner of Cedar St & Pine Ave"),
    (4, 1, "NE", "y"): RampSpec(Passability.BLOCKED, "No detectable landing; ramp drains into ponding gutter.",
                                "J", "Reconstruct ramp, NE corner of Maple St & Pine Ave"),
}

UNSURVEYED = "Condition not surveyed; excluded from modeled traversability."
SIDEWALKS: dict[tuple, tuple[Passability, str]] = {
    ("ew", 2, 3, "S"): (Passability.BLOCKED, "No sidewalk (gap; sidewalk construction is outside this ramp-repair candidate set)."),
    ("ns", 1, 2, "W"): (Passability.BLOCKED, "No sidewalk (gap; sidewalk construction is outside this ramp-repair candidate set)."),
    ("ns", 4, 1, "W"): (Passability.UNKNOWN, UNSURVEYED),
    ("ns", 2, 1, "W"): (Passability.UNKNOWN, UNSURVEYED),
    ("ew", 4, 1, "S"): (Passability.UNKNOWN, UNSURVEYED),
}


def build_demo_scenario(max_distance_m: float = 600.0) -> Scenario:
    b = DemoBuilder()
    b.access_points = {}
    for pid, _, _, key, t, _, _ in PLACES:
        b.access_points.setdefault(key, []).append((t, f"J:{pid}"))
    b.build_network(RAMPS, _crossing_exists, SIDEWALKS)

    origins: list[Origin] = []
    dests: list[Destination] = []
    places_ctx = []
    for pid, role, label, key, t, off, cat in PLACES:
        px, py = b.sidewalk_point(key, t)
        kind = NodeKind.ORIGIN if role == "origin" else NodeKind.DESTINATION
        b.node(pid, kind, (px + off[0], py + off[1]), label, role=role)
        b.edge(f"E:{pid}", f"J:{pid}", pid, EdgeKind.ENTRANCE, label=f"Entrance, {label}",
               reason="Step-free entrance (modeled)")
        if role == "origin":
            origins.append(Origin(pid, label, 1.0, ORIGIN_WEIGHT_BASIS))
        else:
            dests.append(Destination(pid, label, cat, 1.0, Evidence.SYNTHETIC))
        places_ctx.append({"id": pid, "role": role, "label": label, "category": cat.value if cat else None,
                           "lon": b.g.nodes[pid].lon, "lat": b.g.nodes[pid].lat})

    sc = Scenario(
        id="demo",
        name="Guided Simulation - Harbor District (synthetic)",
        mode="synthetic",
        description=(
            "A synthetic neighborhood split by Harbor Blvd, a four-lane arterial with only two crossings. "
            "Every state in this network is a scenario setting, not a field observation."
        ),
        graph=b.g,
        origins=origins,
        destinations=dests,
        interventions=b.interventions,
        max_distance_m=max_distance_m,
        default_journey=("O2", "D_CLINIC"),
        context=_context_layers(b, places_ctx),
        assumptions=[
            "SYNTHETIC scenario: the district, its barriers and its destinations are invented for demonstration.",
            "A crossing is usable only if the crossing and the curb ramps at both ends are traversable.",
            "Edges with unknown condition are excluded from modeled traversability.",
            f"A destination counts as reachable when the shortest traversable route is at most {max_distance_m:.0f} m (planner-configurable).",
            "Each candidate repair costs one unit of the repair-count budget; no construction costs are modeled.",
            "Origins have equal weight; the objective counts weighted origin-destination pairs, not people.",
        ],
        provenance=[{
            "id": "synthetic-demo",
            "name": "StreetMend synthetic Harbor District",
            "kind": "synthetic",
            "description": "Deterministically generated by streetmend.scenario.demo; contains no real-world observations.",
        }],
    )
    lons = [n.lon for n in b.g.nodes.values()]
    lats = [n.lat for n in b.g.nodes.values()]
    sc.bounds = (min(lons), min(lats), max(lons), max(lats))
    sc.validate()
    return sc


def _context_layers(b: DemoBuilder, places: list[dict]) -> dict:
    """Drawing-only geometry (street surfaces, blocks, buildings, labels).

    None of these features take part in routing; they exist so the synthetic
    network reads like a neighbourhood.
    """

    rng = random.Random(7)
    x0, x1 = AVENUES[0][1] - STUB, AVENUES[-1][1] + STUB
    y0, y1 = STREETS[0][1] - STUB, STREETS[-1][1] + STUB

    def rect(ax, ay, bx, by):
        return [[ll(ax, ay), ll(bx, ay), ll(bx, by), ll(ax, by), ll(ax, ay)]]

    streets = []
    for name, x, hw in AVENUES:
        streets.append({"name": name, "class": "arterial" if hw > 10 else "local", "half_width_m": hw,
                        "centerline": [ll(x, y0), ll(x, y1)], "polygon": rect(x - hw, y0, x + hw, y1)})
    for name, y, hw in STREETS:
        streets.append({"name": name, "class": "local", "half_width_m": hw,
                        "centerline": [ll(x0, y), ll(x1, y)], "polygon": rect(x0, y - hw, x1, y + hw)})

    blocks, buildings = [], []
    xs = [x0] + [a[1] for a in AVENUES] + [x1]
    hxs = [0] + [a[2] for a in AVENUES] + [0]
    ys = [y0] + [s[1] for s in STREETS] + [y1]
    hys = [0] + [s[2] for s in STREETS] + [0]
    for a in range(len(xs) - 1):
        for c in range(len(ys) - 1):
            bx0 = xs[a] + hxs[a] + 1.5 if a > 0 else xs[a]
            bx1 = xs[a + 1] - hxs[a + 1] - 1.5 if a + 1 < len(xs) - 1 else xs[a + 1]
            by0 = ys[c] + hys[c] + 1.5 if c > 0 else ys[c]
            by1 = ys[c + 1] - hys[c + 1] - 1.5 if c + 1 < len(ys) - 1 else ys[c + 1]
            edge_block = a in (0, len(xs) - 2) or c in (0, len(ys) - 2)
            blocks.append({"polygon": rect(bx0, by0, bx1, by1), "edge": edge_block})
            # buildings set back from the sidewalk
            ix0, ix1, iy0, iy1 = bx0 + 9, bx1 - 9, by0 + 9, by1 - 9
            if ix1 - ix0 < 20 or iy1 - iy0 < 20:
                continue
            cx = ix0
            while cx < ix1 - 12:
                w = rng.uniform(14, 30)
                if cx + w > ix1:
                    break
                h = rng.uniform(16, 30)
                buildings.append({"polygon": rect(cx, iy0, cx + w, iy0 + h), "edge": edge_block})
                buildings.append({"polygon": rect(cx, iy1 - h * rng.uniform(0.8, 1.1), cx + w, iy1), "edge": edge_block})
                cx += w + rng.uniform(4, 9)

    labels = [{"text": n, "lon": ll(x + hw + 4, (STREETS[0][1] + STREETS[1][1]) / 2)[0],
               "lat": ll(0, (STREETS[0][1] + STREETS[1][1]) / 2)[1], "rotate": -90} for n, x, hw in AVENUES]
    labels += [{"text": n, "lon": ll((AVENUES[0][1] + AVENUES[1][1]) / 2, 0)[0],
                "lat": ll(0, y + hw + 4)[1], "rotate": 0} for n, y, hw in STREETS]
    return {"streets": streets, "blocks": blocks, "buildings": buildings, "street_labels": labels, "places": places,
            "frame": "synthetic local metres around (0,0); not a real location"}
