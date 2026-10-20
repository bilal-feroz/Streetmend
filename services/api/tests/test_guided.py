"""Guided scenario: hypothetical barriers on real Charlotte streets."""

import pytest

from streetmend.graph import Evidence, Passability
from streetmend.graph.algorithms import shortest_route
from streetmend.municipal.scenario import AREA_DIR
from streetmend.optimize.analysis import AnalysisParams, analyze
from streetmend.optimize.objective import PRIORITY_PRESETS

pytestmark = pytest.mark.skipif(not (AREA_DIR / "ramps.geojson").exists(), reason="municipal data not prepared")
HEALTH = PRIORITY_PRESETS["healthcare"]


@pytest.fixture(scope="module")
def guided():
    from streetmend.scenario.guided import load_guided_scenario

    return load_guided_scenario()


@pytest.fixture(scope="module")
def real():
    from streetmend.municipal.scenario import load_municipal_scenario

    return load_municipal_scenario("moderate")


def journey(sc, applied):
    o, d = sc.default_journey
    g = sc.graph.to_networkx(sc.enabled_edges(applied))
    return shortest_route(sc.graph, g, o, d, sc.max_distance_m)


def test_geometry_is_the_real_charlotte_graph(guided, real):
    assert set(guided.graph.edges) == set(real.graph.edges)
    for eid, e in guided.graph.edges.items():
        assert e.geometry == real.graph.edges[eid].geometry and e.length_m == real.graph.edges[eid].length_m
    assert guided.mode == "hypothetical"


def test_every_barrier_is_labelled_hypothetical(guided):
    blocked = [e for e in guided.graph.edges.values() if e.state != Passability.TRAVERSABLE]
    assert blocked
    for e in blocked:
        assert e.evidence == Evidence.SYNTHETIC and "Hypothetical" in e.reason and e.attrs.get("hypothetical")
    for iv in guided.interventions.values():
        assert iv.evidence == Evidence.SYNTHETIC and iv.attrs["hypothetical"]
    assert any("HYPOTHETICAL" in a for a in guided.assumptions)


def test_two_repair_dependency_on_real_streets(guided):
    assert not journey(guided, []).found
    assert not journey(guided, ["A"]).found
    assert not journey(guided, ["B"]).found
    r = journey(guided, ["A", "B"])
    assert r.found and r.length_m <= guided.max_distance_m
    for iid in ("A", "B"):
        assert set(guided.interventions[iid].edge_ids) <= set(r.edge_ids)


def test_exact_finds_the_pair_and_greedy_finds_nothing(guided):
    a1 = analyze(guided, AnalysisParams(budget=1, weights=HEALTH))
    a2 = analyze(guided, AnalysisParams(budget=2, weights=HEALTH))
    assert a1["recommendation"]["selected"] == []  # no single repair helps
    assert sorted(a2["recommendation"]["selected"]) == ["A", "B"] and a2["recommendation"]["exact"]
    greedy = next(b for b in a2["baselines"] if b["solver"] == "greedy")
    assert greedy["gain"] == 0 and a2["objective"]["gain"] > 0
    assert a2["synergy"] == a2["objective"]["gain"]
    assert any("no single repair adds value" in x for x in a2["explanation"])


def test_guided_scenario_served_by_api():
    from fastapi.testclient import TestClient

    from streetmend.api.main import app

    with TestClient(app) as c:
        sc = c.get("/api/scenarios/guided").json()
        assert sc["mode"] == "hypothetical" and sc["default_journey"]
        ev = c.post("/api/scenarios/guided/evaluate", json={"applied": ["A", "B"], "origin": sc["default_journey"][0],
                                                          "destination": sc["default_journey"][1]}).json()
        assert ev["journey"]["route"]["found"]
