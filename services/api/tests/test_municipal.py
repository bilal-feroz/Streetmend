"""Municipal (Charlotte) graph construction tests. Skipped if data is not prepared."""

import json

import pytest

from streetmend.graph import EdgeKind, Evidence, NodeKind, Passability
from streetmend.municipal.build import classify_ramp
from streetmend.municipal.scenario import AREA_DIR

pytestmark = pytest.mark.skipif(not (AREA_DIR / "ramps.geojson").exists(), reason="municipal data not prepared")


@pytest.fixture(scope="module")
def scenarios():
    from streetmend.municipal.scenario import load_municipal_scenario

    return {p: load_municipal_scenario(p) for p in ("moderate", "strict", "lenient")}


def test_builds_and_validates(scenarios):
    for sc in scenarios.values():
        sc.validate()
        assert len(sc.graph.nodes) > 500 and len(sc.origins) > 10 and len(sc.destinations) > 10
        assert sc.mode == "municipal"


def test_coordinates_are_wgs84_in_charlotte(scenarios):
    sc = scenarios["moderate"]
    for n in sc.graph.nodes.values():
        assert -80.85 < n.lon < -80.80 and 35.19 < n.lat < 35.23, n.id  # never projected feet


def test_corners_only_connect_through_crossings_or_sidewalks(scenarios):
    g = scenarios["moderate"].graph
    for e in g.edges.values():
        ku, kv = g.nodes[e.u].kind, g.nodes[e.v].kind
        if e.kind == EdgeKind.CROSSING:
            assert ku == kv == NodeKind.CURB  # crossings end at curb landings, never at corners
        if e.kind == EdgeKind.RAMP:
            assert {ku, kv} == {NodeKind.CORNER, NodeKind.CURB}
        if e.kind == EdgeKind.SIDEWALK and ku == kv == NodeKind.CORNER:
            # a sidewalk never joins two corners of the same intersection
            assert e.u.split(":")[1] != e.v.split(":")[1]


def test_two_sides_of_a_street_never_share_a_corner(scenarios):
    g = scenarios["moderate"].graph
    sides: dict[tuple[str, str], set[str]] = {}
    for e in g.edges.values():
        if e.kind == EdgeKind.SIDEWALK and e.id.startswith("S:"):
            _, seg, side, _ = e.id.split(":")
            ends = {n for n in (e.u, e.v) if g.nodes[n].kind == NodeKind.CORNER}
            sides.setdefault((seg, side), set()).update(ends)
    for (seg, side), corners in sides.items():
        if side == "L" and (seg, "R") in sides:
            assert not (corners & sides[(seg, "R")]), seg  # includes dead ends and study-area stubs


def test_missing_evidence_stays_unknown(scenarios):
    g = scenarios["moderate"].graph
    unknown = [e for e in g.edges.values() if e.state == Passability.UNKNOWN]
    assert unknown
    ramps_without_record = [e for e in g.edges.values() if e.kind == EdgeKind.RAMP and not e.source_ids]
    assert ramps_without_record and all(e.state == Passability.UNKNOWN for e in ramps_without_record)


def test_candidates_are_recorded_barrier_ramps(scenarios):
    sc = scenarios["moderate"]
    for iv in sc.interventions.values():
        assert iv.source_ids and iv.source_ids[0].startswith("OBJECTID")
        for eid in iv.edge_ids:
            e = sc.graph.edges[eid]
            assert e.kind == EdgeKind.RAMP and e.state == Passability.BLOCKED and e.source == "CDOT ADA Curb Ramps"


def test_policy_ordering(scenarios):
    from streetmend.optimize.objective import Evaluator

    s = {p: Evaluator(sc).score() for p, sc in scenarios.items()}
    assert s["strict"] <= s["moderate"] <= s["lenient"]
    n = {p: len(sc.interventions) for p, sc in scenarios.items()}
    assert n["strict"] >= n["moderate"] >= n["lenient"]


def test_ramp_classification_rules():
    base = {"RP_SurveyDate": "10/01/2018 13:19", "RP_ComplianceStatus": "No", "RP_Type": "Perp", "Remediated": "No"}
    assert classify_ramp({**base, "RP_Type": "NoRamp"}, "lenient").state == Passability.BLOCKED
    assert classify_ramp({**base, "Remediated": "Yes"}, "strict").state == Passability.TRAVERSABLE
    assert classify_ramp({**base, "RP_ComplianceStatus": None}, "moderate").state == Passability.UNKNOWN
    minor = {**base, "RP_Slope": 9.0}
    severe = {**base, "RP_Slope": 14.0}
    assert classify_ramp(minor, "moderate").state == Passability.TRAVERSABLE
    assert classify_ramp(minor, "moderate").evidence == Evidence.ASSUMED  # an explicit, labeled assumption
    assert classify_ramp(severe, "moderate").state == Passability.BLOCKED
    assert classify_ramp(minor, "strict").state == Passability.BLOCKED
    assert classify_ramp(severe, "lenient").state == Passability.TRAVERSABLE
    assert "2018-10-01" in classify_ramp({**base, "RP_Type": "NoRamp"}, "moderate").reason


def test_transform_validated_against_server():
    q = json.loads((AREA_DIR / "quality.json").read_text(encoding="utf-8"))
    for key in ("ramps", "sidewalks"):
        t = q["layers"][key]["transform"]
        assert t["from_epsg"] == 2264 and t["samples"] > 0 and t["max_error_m"] < 2.0


def test_real_data_exact_never_below_greedy(scenarios):
    from streetmend.optimize.objective import PRIORITY_PRESETS, Evaluator
    from streetmend.optimize.solvers import greedy, solve

    for policy in ("moderate", "lenient"):
        sc = scenarios[policy]
        ev = Evaluator(sc, PRIORITY_PRESETS["healthcare"])
        ex = solve(ev, list(sc.interventions), 2)
        gr = greedy(ev, list(sc.interventions), 2)
        assert ex.exact and ex.score >= gr.score - 1e-9


def test_municipal_api_endpoints():
    from fastapi.testclient import TestClient

    from streetmend.api.main import app

    with TestClient(app) as c:
        ids = {s["id"]: s for s in c.get("/api/scenarios").json()}
        assert ids["charlotte-elizabeth"]["available"]
        sc = c.get("/api/scenarios/charlotte-elizabeth").json()
        assert sc["mode"] == "municipal" and any(p["kind"] == "municipal" for p in sc["provenance"])
        rec = c.get("/api/municipal/records").json()
        assert len(rec["ramps"]) == 320
        a = c.post("/api/scenarios/charlotte-elizabeth/optimize", json={"budget": 2, "priority": "healthcare"}).json()
        assert a["recommendation"]["exact"] and a["objective"]["gain"] >= 0
