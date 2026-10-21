"""Deterministic benchmark fixtures for change verification.

Each fixture is a small hand-built street network with real-looking
coordinates (100 m grid units), one planner proposal, explicit access
requirements and a mitigation catalog, plus the answer a correct engine must
give. Crossings are built the way the Charlotte graph is: corner, curb ramp,
curb landing, crossing, curb landing, curb ramp, corner.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

from streetmend.graph import Edge, EdgeKind, Evidence, Node, NodeKind, Passability, PedGraph, haversine_m
from streetmend.scenario.model import Destination, DestinationCategory, Intervention, Origin, Scenario
from streetmend.verify.changes import Change
from streetmend.verify.checks import Requirement
from streetmend.verify.profiles import Profile

LON0, LAT0, UNIT = -80.83, 35.21, 100.0
OPEN, BLOCKED, UNKNOWN = Passability.TRAVERSABLE, Passability.BLOCKED, Passability.UNKNOWN


def ll(x: float, y: float) -> tuple[float, float]:
    return (LON0 + x * UNIT / (111_320 * math.cos(math.radians(LAT0))), LAT0 + y * UNIT / 110_540)


class Net:
    def __init__(self) -> None:
        self.g = PedGraph()
        self.xy: dict[str, tuple[float, float]] = {}
        self.ivs: dict[str, Intervention] = {}

    def node(self, nid: str, x: float, y: float, kind: NodeKind = NodeKind.CORNER) -> None:
        self.xy[nid] = (x, y)
        lon, lat = ll(x, y)
        self.g.add_node(Node(nid, kind, lon, lat, label=nid))

    def edge(self, eid: str, u: str, v: str, kind: EdgeKind = EdgeKind.SIDEWALK, state: Passability = OPEN, barrier: str | None = None) -> None:
        a, b = ll(*self.xy[u]), ll(*self.xy[v])
        attrs = {"barrier": barrier} if barrier else {}
        reason = {"missing_ramp": "No curb ramp (fixture setting).", "no_crossing": "No usable crossing (fixture setting)."}.get(barrier or "", "")
        self.g.add_edge(Edge(eid, u, v, kind, max(haversine_m(a, b), 0.5), [a, b], state, Evidence.SYNTHETIC, label=eid, reason=reason, attrs=attrs))

    def crossing(self, cid: str, a: str, b: str, crossing: Passability = OPEN, ramp_a: Passability = OPEN, ramp_b: Passability = OPEN,
                 crossing_barrier: str | None = None) -> None:
        (xa, ya), (xb, yb) = self.xy[a], self.xy[b]
        la, lb = f"L:{cid}:a", f"L:{cid}:b"
        self.node(la, xa + 0.05 * (xb - xa), ya + 0.05 * (yb - ya), NodeKind.CURB)
        self.node(lb, xb - 0.05 * (xb - xa), yb - 0.05 * (yb - ya), NodeKind.CURB)
        self.edge(f"R:{cid}:a", a, la, EdgeKind.RAMP, ramp_a, "missing_ramp" if ramp_a == BLOCKED else None)
        self.edge(f"X:{cid}", la, lb, EdgeKind.CROSSING, crossing, crossing_barrier or ("no_crossing" if crossing == BLOCKED else None))
        self.edge(f"R:{cid}:b", lb, b, EdgeKind.RAMP, ramp_b, "missing_ramp" if ramp_b == BLOCKED else None)

    def iv(self, iid: str, kind: str, edges: list[str], cost: int = 1, requires: list[str] | None = None) -> None:
        e = self.g.edges[edges[0]]
        mid = e.geometry[0]
        self.ivs[iid] = Intervention(iid, f"{iid}: {kind.replace('_', ' ')} on {', '.join(edges)}", kind, edges, mid[0], mid[1], cost_units=cost,
                                     attrs={"requires": requires or [], "hypothetical": True})

    def scenario(self, sid: str, origins: list[str], dests: list[tuple[str, DestinationCategory]], max_m: float) -> Scenario:
        sc = Scenario(sid, sid, "synthetic", f"Benchmark fixture {sid}", self.g, [Origin(o, o) for o in origins],
                      [Destination(d, d, c) for d, c in dests], self.ivs, max_distance_m=max_m, default_journey=(origins[0], dests[0][0]))
        sc.validate()
        return sc


@dataclass
class Fixture:
    id: str
    title: str
    claim: str
    sc: Scenario
    proposal: list[Change]
    reqs: list[Requirement]
    expect: dict[str, Any]
    budget: int | None = None
    notes: list[str] = field(default_factory=list)


H = DestinationCategory.HEALTHCARE
TR = DestinationCategory.TRANSIT


def _corridor(alt: dict[str, Any] | None = None, extra=None) -> Net:
    """O --- X1 =c1= Y1 --- T, with an optional parallel crossing c2 one block north."""

    n = Net()
    n.node("O", 0, 0, NodeKind.ORIGIN)
    n.node("X1", 1, 0)
    n.node("Y1", 2, 0)
    n.node("T", 3, 0, NodeKind.DESTINATION)
    n.edge("s:O-X1", "O", "X1")
    n.crossing("c1", "X1", "Y1")
    n.edge("s:Y1-T", "Y1", "T")
    if alt is not None:
        n.node("X2", 1, 1)
        n.node("Y2", 2, 1)
        n.edge("s:X1-X2", "X1", "X2")
        n.edge("s:Y1-Y2", "Y1", "Y2")
        n.crossing("c2", "X2", "Y2", **alt)
    # a far-away dead-end with a barrier: a decoy candidate that can never help
    n.node("Z1", 3, -2)
    n.node("Z2", 4, -2)
    n.edge("s:T-Z1", "T", "Z1")
    n.crossing("cz", "Z1", "Z2", ramp_a=BLOCKED)
    if extra:
        extra(n)
    return n


def _req(rid: str, profile: Profile, o: str, d: str, m: float, kind: str = "route", ratio: float | None = None) -> Requirement:
    pl = "step-free" if profile == Profile.STEP_FREE else "walking"
    label = f"{pl} route {o} to {d} within {m:.0f} m" if kind == "route" else f"{pl} detour {o} to {d} at most +{round((ratio - 1) * 100)}%"
    return Requirement(rid, kind, label, profile, o, d, max_m=m if kind == "route" else None, max_ratio=ratio)


CLOSE_C1 = [Change("P", "close", "X:c1", "Proposed closure of crossing c1")]


def fixtures() -> list[Fixture]:
    out: list[Fixture] = []

    # 1 single bottleneck: the only usable crossing closes; a temporary crossing elsewhere restores access
    n = _corridor({"crossing": BLOCKED})
    n.iv("M1", "temporary_accessible_crossing", ["X:c2"])
    n.iv("Dz", "temporary_curb_ramp", ["R:cz:a"])
    sc = n.scenario("single_bottleneck", ["O"], [("T", H)], 600)
    out.append(Fixture("single_bottleneck", "Single bottleneck", "A closure disconnects the only route; one intervention restores it.", sc, CLOSE_C1,
                       [_req("R1", Profile.STEP_FREE, "O", "T", 600), _req("R2", Profile.PEDESTRIAN, "O", "T", 600)],
                       {"regressions": ["R1", "R2"], "proposed": {"R1": "FAIL", "R2": "FAIL"}, "fix": ["M1"], "status": "found"}))

    # 2 two-repair dependency: the alternative crossing lacks ramps at both ends
    n = _corridor({"ramp_a": BLOCKED, "ramp_b": BLOCKED})
    n.iv("A", "temporary_curb_ramp", ["R:c2:a"])
    n.iv("B", "temporary_curb_ramp", ["R:c2:b"])
    n.iv("Dz", "temporary_curb_ramp", ["R:cz:a"])
    sc = n.scenario("two_repair_dependency", ["O"], [("T", H)], 600)
    out.append(Fixture("two_repair_dependency", "Two-repair dependency", "Neither ramp alone restores the step-free route; both together do. Walkers keep a route.",
                       sc, CLOSE_C1, [_req("R1", Profile.STEP_FREE, "O", "T", 600), _req("R2", Profile.PEDESTRIAN, "O", "T", 600)],
                       {"regressions": ["R1"], "proposed": {"R1": "FAIL", "R2": "PASS"}, "fix": ["A", "B"], "status": "found", "singles_fail": ["A", "B"]}))

    # 3 alternative route: an open detour within the threshold means no regression (no false alarm)
    n = _corridor({})
    n.iv("Dz", "temporary_curb_ramp", ["R:cz:a"])
    sc = n.scenario("alternative_route", ["O"], [("T", H)], 600)
    out.append(Fixture("alternative_route", "Existing alternative route", "The closure leaves a step-free route within the threshold: nothing to fix.",
                       sc, CLOSE_C1, [_req("R1", Profile.STEP_FREE, "O", "T", 600)],
                       {"regressions": [], "proposed": {"R1": "PASS"}, "fix": [], "status": "nothing_to_fix"}))

    # 4 multiple destinations: only the requirement whose journey crosses the closure regresses
    def stop(n: Net) -> None:
        n.node("S", 0, 1, NodeKind.DESTINATION)
        n.edge("s:O-S", "O", "S")

    n = _corridor({"crossing": BLOCKED}, stop)
    n.iv("M1", "temporary_accessible_crossing", ["X:c2"])
    sc = n.scenario("multiple_destinations", ["O"], [("T", H), ("S", TR)], 600)
    out.append(Fixture("multiple_destinations", "Multiple destinations", "Clinic access regresses; bus-stop access does not and is not flagged.", sc, CLOSE_C1,
                       [_req("R1", Profile.STEP_FREE, "O", "T", 600),
                        Requirement("R3", "category", "step-free access to a bus stop within 600 m", Profile.STEP_FREE, "O", category="transit", max_m=600)],
                       {"regressions": ["R1"], "proposed": {"R1": "FAIL", "R3": "PASS"}, "fix": ["M1"], "status": "found"}))

    # 5 infeasible budget: the only fix costs two units; the budget allows one
    n = _corridor({"ramp_a": BLOCKED, "ramp_b": BLOCKED})
    n.iv("A", "temporary_curb_ramp", ["R:c2:a"])
    n.iv("B", "temporary_curb_ramp", ["R:c2:b"])
    sc = n.scenario("infeasible_budget", ["O"], [("T", H)], 600)
    out.append(Fixture("infeasible_budget", "Infeasible budget", "No fix fits the budget: the engine reports infeasibility and the fix it excludes.", sc, CLOSE_C1,
                       [_req("R1", Profile.STEP_FREE, "O", "T", 600)],
                       {"regressions": ["R1"], "proposed": {"R1": "FAIL"}, "fix": [], "status": "over_budget", "over_budget": ["A", "B"]}, budget=1))

    # 6 unknown state: the only detour crosses a link of unknown condition
    n = _corridor({"crossing": UNKNOWN})
    n.iv("M1", "restore_crossing", ["X:c2"])
    sc = n.scenario("unknown_state", ["O"], [("T", H)], 600)
    out.append(Fixture("unknown_state", "Unknown accessibility state", "Unknown data makes the check INCONCLUSIVE, never PASS.", sc, CLOSE_C1,
                       [_req("R1", Profile.STEP_FREE, "O", "T", 600)],
                       {"regressions": ["R1"], "proposed": {"R1": "INCONCLUSIVE"}, "fix": ["M1"], "status": "found"}))

    # 7 two requirements, two repairs: a two-site closure breaks two journeys, each needing its own fix
    def second(n: Net) -> None:
        n.node("O2", 0, 3, NodeKind.ORIGIN)
        n.node("X3", 1, 3)
        n.node("Y3", 2, 3)
        n.node("T2", 3, 3, NodeKind.DESTINATION)
        n.node("X4", 1, 2)
        n.node("Y4", 2, 2)
        n.edge("s:O2-X3", "O2", "X3")
        n.crossing("c3", "X3", "Y3")
        n.edge("s:Y3-T2", "Y3", "T2")
        n.edge("s:X3-X4", "X3", "X4")
        n.edge("s:Y3-Y4", "Y3", "Y4")
        n.crossing("c4", "X4", "Y4", crossing=BLOCKED)

    n = _corridor({"crossing": BLOCKED}, second)
    n.iv("A", "temporary_accessible_crossing", ["X:c2"])
    n.iv("B", "temporary_accessible_crossing", ["X:c4"])
    sc = n.scenario("two_requirements", ["O", "O2"], [("T", H), ("T2", H)], 600)
    out.append(Fixture("two_requirements", "Two requirements, two repairs", "Each regressed journey needs its own repair; greedy does as well as exact here.",
                       sc, CLOSE_C1 + [Change("P2", "close", "X:c3", "Proposed closure of crossing c3")],
                       [_req("R1", Profile.STEP_FREE, "O", "T", 600), _req("R2", Profile.STEP_FREE, "O2", "T2", 600)],
                       {"regressions": ["R1", "R2"], "proposed": {"R1": "FAIL", "R2": "FAIL"}, "fix": ["A", "B"], "status": "found"}))

    # 8 redundant candidates: two interchangeable fixes; the cheaper one wins, the other is listed
    def south(n: Net) -> None:
        n.node("X5", 1, -1)
        n.node("Y5", 2, -1)
        n.edge("s:X1-X5", "X1", "X5")
        n.edge("s:Y1-Y5", "Y1", "Y5")
        n.crossing("c5", "X5", "Y5", crossing=BLOCKED)

    n = _corridor({"crossing": BLOCKED}, south)
    n.iv("M1", "temporary_accessible_crossing", ["X:c2"], cost=2)
    n.iv("M2", "temporary_accessible_crossing", ["X:c5"], cost=1)
    sc = n.scenario("redundant_candidates", ["O"], [("T", H)], 600)
    out.append(Fixture("redundant_candidates", "Redundant candidates", "Two single fixes exist; deterministic ranking picks the cheaper and lists the other.",
                       sc, CLOSE_C1, [_req("R1", Profile.STEP_FREE, "O", "T", 600)],
                       {"regressions": ["R1"], "proposed": {"R1": "FAIL"}, "fix": ["M2"], "status": "found", "alternatives": [["M1"]]}))

    # 9 no feasible mitigation: the catalog cannot fix the regression; the engine says so
    n = _corridor({"crossing": BLOCKED})
    n.iv("Dz", "temporary_curb_ramp", ["R:cz:a"])
    sc = n.scenario("no_mitigation", ["O"], [("T", H)], 600)
    out.append(Fixture("no_mitigation", "No feasible mitigation", "Nothing in the catalog restores access: reported as none, not faked.", sc, CLOSE_C1,
                       [_req("R1", Profile.STEP_FREE, "O", "T", 600)],
                       {"regressions": ["R1"], "proposed": {"R1": "FAIL"}, "fix": [], "status": "none"}))

    # 10 detour limit: a route still exists within the distance threshold, but the detour is too long
    def near(n: Net) -> None:
        n.node("X6", 1, 0.2)
        n.node("Y6", 2, 0.2)
        n.edge("s:X1-X6", "X1", "X6")
        n.edge("s:Y1-Y6", "Y1", "Y6")
        n.crossing("c6", "X6", "Y6", crossing=BLOCKED)

    n = _corridor({}, near)
    n.iv("M3", "temporary_accessible_crossing", ["X:c6"])
    sc = n.scenario("detour_limit", ["O"], [("T", H)], 600)
    out.append(Fixture("detour_limit", "Detour limit", "The route survives within 600 m but is 60% longer; a nearby temporary crossing keeps it within +15%.",
                       sc, CLOSE_C1, [_req("R1", Profile.STEP_FREE, "O", "T", 600), _req("R2", Profile.STEP_FREE, "O", "T", 600, "detour", 1.15)],
                       {"regressions": ["R2"], "proposed": {"R1": "PASS", "R2": "FAIL"}, "fix": ["M3"], "status": "found"}))
    return out
