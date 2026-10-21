"""Change verification: baseline -> proposal -> regression -> minimal fix -> verified.

Every claim the preflight demo makes is re-derived here from the graph engine,
and the three-valued logic is tested on a small hand-built network where the
right answer is obvious.
"""

from __future__ import annotations

from itertools import combinations

import pytest

from streetmend.graph import Edge, EdgeKind, Evidence, Node, NodeKind, Passability, PedGraph
from streetmend.scenario.model import Destination, DestinationCategory, Intervention, Origin, Scenario
from streetmend.verify import Change, ChangeError, NetworkState, Profile, Requirement, apply_changes, evaluate, synthesize, verify

# ---- a tiny network: O -a- X -b- T, plus a detour O -c- Y -d- T ------------------------


def _edge(i, u, v, kind=EdgeKind.SIDEWALK, length=100.0, state=Passability.TRAVERSABLE, **attrs):
    return Edge(i, u, v, kind, length, [(0, 0), (0.001, 0)], state, Evidence.SYNTHETIC, attrs=attrs)


def tiny(detour_state=Passability.TRAVERSABLE, detour_kind=EdgeKind.SIDEWALK, barrier=None) -> Scenario:
    g = PedGraph()
    for n, k in (("O", NodeKind.ORIGIN), ("X", NodeKind.CORNER), ("Y", NodeKind.CORNER), ("T", NodeKind.DESTINATION)):
        g.add_node(Node(n, k, 0, 0))
    g.add_edge(_edge("a", "O", "X"))
    g.add_edge(_edge("b", "X", "T", kind=EdgeKind.CROSSING))
    g.add_edge(_edge("c", "O", "Y", length=150))
    g.add_edge(_edge("d", "Y", "T", kind=detour_kind, length=150, state=detour_state, **({"barrier": barrier} if barrier else {})))
    ivs = {}
    if detour_state != Passability.TRAVERSABLE:
        ivs["M"] = Intervention("M", "repair d", "repair", ["d"], 0, 0)
    return Scenario("t", "tiny", "synthetic", "", g, [Origin("O", "O")], [Destination("T", "T", DestinationCategory.HEALTHCARE)], ivs, max_distance_m=400)


R = Requirement("R1", "route", "step-free O to T", Profile.STEP_FREE, "O", "T", max_m=400)
W = Requirement("R2", "route", "walking O to T", Profile.PEDESTRIAN, "O", "T", max_m=400)
CLOSE_B = [Change("p", "close", "b", "close the crossing")]


def status(sc, req, changes=(), applied=()):
    base = NetworkState(sc, [], "b")
    st = NetworkState(apply_changes(sc, list(changes)), list(applied), "s")
    return evaluate(req, st, base).status


def test_closure_with_open_detour_still_passes():
    assert status(tiny(), R, CLOSE_B) == "PASS"


def test_closure_without_detour_fails():
    sc = tiny(detour_state=Passability.BLOCKED, barrier="closure")
    assert status(sc, R) == "PASS"
    assert status(sc, R, CLOSE_B) == "FAIL"


def test_unknown_detour_is_inconclusive_never_pass():
    sc = tiny(detour_state=Passability.UNKNOWN)
    assert status(sc, R, CLOSE_B) == "INCONCLUSIVE"


def test_missing_ramp_blocks_step_free_but_not_walking():
    sc = tiny(detour_state=Passability.BLOCKED, detour_kind=EdgeKind.RAMP, barrier="missing_ramp")
    assert status(sc, R, CLOSE_B) == "FAIL"
    assert status(sc, W, CLOSE_B) == "PASS"
    assert status(sc, R, CLOSE_B, applied=["M"]) == "PASS"


def test_typed_changes_are_validated():
    sc = tiny()
    with pytest.raises(ChangeError):
        apply_changes(sc, [Change("x", "close", "nope")])
    with pytest.raises(ChangeError):
        apply_changes(sc, [Change("x", "reopen", "a")])  # already open
    with pytest.raises(ChangeError):
        apply_changes(sc, [Change("x", "close", "a"), Change("y", "close", "a")])


def test_baseline_is_never_mutated():
    sc = tiny()
    apply_changes(sc, CLOSE_B)
    assert sc.graph.edges["b"].state == Passability.TRAVERSABLE


# ---- the Charlotte preflight demo --------------------------------------------------------


@pytest.fixture(scope="module")
def pre():
    from streetmend.scenario.preflight import load_preflight_scenario, proposal, requirements

    try:
        sc = load_preflight_scenario()
    except FileNotFoundError:
        pytest.skip("Charlotte data or preflight spec not prepared")
    return sc, requirements(sc), proposal(sc, "P1")


def _states(out):
    return {c["id"]: c["status"] for c in out["checks"]}


def test_act1_baseline_has_a_step_free_route(pre):
    sc, reqs, P = pre
    out = verify(sc, P, [], reqs, sc.default_journey)
    assert set(_states(out["baseline"]).values()) == {"PASS"}
    assert out["baseline"]["step_free_route"]["found"]
    assert 600 < out["baseline"]["step_free_route"]["length_m"] < 700


def test_act3_closure_is_a_regression_with_a_counterexample(pre):
    sc, reqs, P = pre
    out = verify(sc, P, [], reqs, sc.default_journey)
    s = _states(out["proposed"])
    assert s["R1"] == "FAIL" and s["R2"] == "FAIL"
    assert s["R3"] == "PASS"  # walkers keep a route: the regression is specific to step-free travel
    assert "R1" in out["proposed"]["regressions"]
    ce = next(c for c in out["proposed"]["checks"] if c["id"] == "R1")["counterexample"]
    # the closure is on today's route ...
    assert any(b["change"] == "P1-close" for b in ce["broken_edges"])
    assert "X:172578423:1" in ce["baseline_route"]["edge_ids"]
    # ... a walking route exists, but only by stepping curbs without ramps ...
    assert ce["walking_route"]["found"] and len(ce["walking_route"]["steps"]) == 2
    # ... and the shortest step-free alternative is beyond the threshold.
    assert ce["best_alternative"]["length_m"] > 800


def test_act4_minimal_fix_is_two_coordinated_interventions(pre):
    sc, reqs, P = pre
    fix = synthesize(sc, P, reqs, sc.default_journey)
    assert fix["status"] == "found" and fix["size"] == 2
    assert sorted(fix["interventions"]) == ["A", "B"]
    assert fix["exhaustive"]
    # no single candidate works, and each member alone fails: verified independently here
    base = NetworkState(sc, [], "b")
    proposed_sc = apply_changes(sc, P)
    for c in fix["candidates"]:
        st = NetworkState(proposed_sc, [c], "s")
        assert not all(evaluate(r, st, base).status == "PASS" for r in reqs), c
    # A + B is the only pair that works (exact check of every pair)
    good = []
    for pair in combinations(fix["candidates"], 2):
        st = NetworkState(proposed_sc, list(pair), "s")
        if all(evaluate(r, st, base).status == "PASS" for r in reqs):
            good.append(sorted(pair))
    assert good == [["A", "B"]]


def test_act4_a_shorter_alternative_fails_the_detour_check(pre):
    sc, reqs, P = pre
    fix = synthesize(sc, P, reqs, sc.default_journey)
    c = next(s for s in fix["singles"] if s["id"] == "C")
    assert c["checks"]["R1"] == "PASS" and c["checks"]["R2"] == "FAIL"


def test_act5_and_6_fix_verifies_and_removing_one_breaks_again(pre):
    sc, reqs, P = pre
    fixed = verify(sc, P, ["A", "B"], reqs, sc.default_journey)["fixed"]
    assert set(_states(fixed).values()) == {"PASS"}
    assert fixed["step_free_route"]["found"]
    for one in ("A", "B"):
        broken = verify(sc, P, [one], reqs, sc.default_journey)["fixed"]
        assert _states(broken)["R1"] == "FAIL"


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from streetmend.api.main import app

    with TestClient(app) as c:
        yield c


def test_verify_api_round_trip(client):
    sc = client.get("/api/scenarios/preflight")
    if sc.status_code != 200:
        pytest.skip("preflight scenario not available")
    prop = sc.json()["context"]["verify"]["proposals"][0]["changes"]
    r = client.post("/api/scenarios/preflight/verify", json={"proposal": prop})
    assert r.status_code == 200
    assert r.json()["proposed"]["summary"]["FAIL"] >= 1
    f = client.post("/api/scenarios/preflight/verify/fix", json={"proposal": prop})
    assert f.status_code == 200 and sorted(f.json()["interventions"]) == ["A", "B"]
    v = client.post("/api/scenarios/preflight/verify", json={"proposal": prop, "mitigations": ["A", "B"]})
    assert v.json()["fixed"]["summary"]["FAIL"] == 0
    bad = client.post("/api/scenarios/preflight/verify", json={"proposal": [{"id": "x", "op": "close", "edge_id": "nope"}]})
    assert bad.status_code == 422
    ev = client.post("/api/scenarios/preflight/evaluate", json={"changes": prop, "origin": sc.json()["default_journey"][0], "destination": sc.json()["default_journey"][1]})
    assert ev.status_code == 200 and not ev.json()["journey"]["route"]["found"]
