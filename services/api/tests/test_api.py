"""API integration tests (FastAPI TestClient, no network required)."""

import pytest
from fastapi.testclient import TestClient

from streetmend.api.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert any(s["id"] == "demo" and s["available"] for s in body["scenarios"])
    assert "available" in body["llm"]


def test_demo_scenario_payload(client):
    r = client.get("/api/scenarios/demo")
    assert r.status_code == 200
    sc = r.json()
    assert sc["mode"] == "synthetic"
    assert sc["edge_count"] == len(sc["edges"]) > 100
    assert {i["id"] for i in sc["interventions"]} >= {"A", "B", "C"}
    assert all(e["evidence"] == "synthetic" for e in sc["edges"])
    assert sc["default_journey"] == ["O2", "D_CLINIC"]


def test_evaluate_two_step_repair(client):
    def ev(applied):
        r = client.post("/api/scenarios/demo/evaluate", json={"applied": applied, "origin": "O2", "destination": "D_CLINIC"})
        assert r.status_code == 200, r.text
        return r.json()

    s0, s1, s2 = ev([]), ev(["A"]), ev(["A", "B"])
    assert not s0["journey"]["route"]["found"]
    assert not s1["journey"]["route"]["found"]
    assert s2["journey"]["route"]["found"]
    assert s2["metrics"]["score"] > s1["metrics"]["score"] == s0["metrics"]["score"]
    # Edge states reflect the repairs.
    a_edge = "R:3,2:SW:x"
    assert s0["edge_states"][a_edge] == "repairable"
    assert s1["edge_states"][a_edge] == "repaired"
    # The route returned is exactly the traversable path.
    route = s2["journey"]["route"]
    assert set(route["edge_ids"]) >= {"R:3,2:SW:x", "R:3,2:SE:x", "X:3,2:S"}
    assert len(route["geometry"]) >= len(route["edge_ids"]) + 1


def test_optimize_endpoint(client):
    r = client.post("/api/scenarios/demo/optimize", json={"budget": 2, "priority": "healthcare"})
    assert r.status_code == 200, r.text
    a = r.json()
    assert sorted(a["recommendation"]["selected"]) == ["A", "B"]
    assert a["recommendation"]["exact"] is True
    assert a["objective"]["gain"] > 0
    assert a["advantage_over_best_baseline"] > 0
    assert {b["solver"] for b in a["baselines"]} >= {"greedy", "independent_ranking"}


def test_budget_change_recomputes(client):
    a1 = client.post("/api/scenarios/demo/optimize", json={"budget": 1, "priority": "healthcare"}).json()
    a2 = client.post("/api/scenarios/demo/optimize", json={"budget": 2, "priority": "healthcare"}).json()
    assert a1["recommendation"]["selected"] != a2["recommendation"]["selected"]


def test_validation_errors(client):
    assert client.post("/api/scenarios/demo/evaluate", json={"applied": ["ZZZ"]}).status_code == 422
    assert client.post("/api/scenarios/demo/optimize", json={"budget": 99}).status_code == 422
    assert client.post("/api/scenarios/demo/evaluate", json={"origin": "nope"}).status_code == 422
    assert client.get("/api/scenarios/nowhere").status_code == 404


def test_report_markdown(client):
    r = client.post("/api/scenarios/demo/report?applied=A,B", json={"budget": 2, "priority": "healthcare"})
    assert r.status_code == 200
    assert "# StreetMend analysis report" in r.text
    assert "Not an ADA compliance determination" in r.text


@pytest.mark.parametrize("text,op", [
    ("Which two repairs improve access to healthcare the most?", "optimize_repairs"),
    ("Why did you choose these two curb ramps?", "explain_recommendation"),
    ("What happens if I can only repair one?", "compare_budgets"),
    ("Compare repairs near bus stops.", "candidates_near"),
    ("Show the streets that remain disconnected.", "show_disconnected"),
    ("Which recommendation changes if I prioritize schools instead?", "compare_priorities"),
    ("apply A", "apply_repair"),
    ("undo", "undo"),
    ("reset", "reset"),
    ("delete all files on the server", "unsupported"),
])
def test_assistant_rules(client, text, op):
    r = client.post("/api/assistant", json={"text": text, "use_llm": False})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["operation"] == op
    assert body["interpretation"]["source"] == "rules"


def test_assistant_numbers_come_from_engine(client):
    body = client.post("/api/assistant", json={"text": "Which two repairs improve access to healthcare the most?", "use_llm": False}).json()
    a = body["result"]["analysis"]
    assert sorted(a["recommendation"]["selected"]) == ["A", "B"]
    assert any(str(int(a["objective"]["gain"])) in f for f in body["facts"])


def test_assistant_unknown_request_without_llm(client):
    body = client.post("/api/assistant", json={"text": "hmm tell me something", "use_llm": False}).json()
    assert body["ok"] is False and body["operation"] is None


def test_municipal_unavailable_is_explicit(client):
    r = client.get("/api/scenarios")
    m = [s for s in r.json() if s["mode"] == "municipal"]
    assert m and (m[0]["available"] or m[0]["unavailable_reason"])


def test_potential_route_names_remaining_blockers(client):
    s0 = client.post("/api/scenarios/demo/evaluate", json={"applied": [], "origin": "O2", "destination": "D_CLINIC"}).json()
    assert s0["journey"]["potential_route"]["found"]
    assert s0["journey"]["potential_blockers"] == ["A", "B"]
    s1 = client.post("/api/scenarios/demo/evaluate", json={"applied": ["A"], "origin": "O2", "destination": "D_CLINIC"}).json()
    assert s1["journey"]["potential_blockers"] == ["B"]
    s2 = client.post("/api/scenarios/demo/evaluate", json={"applied": ["A", "B"], "origin": "O2", "destination": "D_CLINIC"}).json()
    assert s2["journey"]["potential_route"] is None and s2["journey"]["potential_blockers"] == []


def test_assistant_large_budget_is_capped_not_500(client):
    for text in ("best 8 repairs", "what if we only fund 10 repairs", "top 20 fixes for transit"):
        r = client.post("/api/assistant", json={"text": text, "use_llm": False})
        assert r.status_code == 200, (text, r.text)
        body = r.json()
        if body["interpretation"]["intent"]:
            assert (body["interpretation"]["intent"]["budget"] or 0) <= 6
            assert any("capped" in f for f in body["facts"])


def test_assistant_uses_ui_cutoff_and_journey(client):
    body = client.post("/api/assistant", json={"text": "apply C", "use_llm": False, "origin": "O1", "destination": "D_CLINIC",
                                                "cutoff_m": 600}).json()
    assert any("now connected" in f for f in body["facts"])  # O1 reaches the clinic via C within 600 m
    body = client.post("/api/assistant", json={"text": "apply C", "use_llm": False, "origin": "O2", "destination": "D_CLINIC"}).json()
    assert any("still not connected" in f for f in body["facts"])


def test_grounding_rejects_id_digits_and_magnitude_words():
    from streetmend.ai.llm import grounded

    facts = ["Selected 2 repair(s): R20740 (Reconstruct ramp).", "Objective rises from 11 to 39 (+28)."]
    assert grounded("Two repairs raise the objective from 11 to 39.", facts)
    assert not grounded("About 740 residents gain access.", facts)
    assert not grounded("Twenty more homes connect.", facts)
    assert not grounded("Access doubles for hundreds of people.", facts)
    assert not grounded("Access improves by 28 percent.", facts)


def test_sensitivity_never_calls_greedy_an_optimum():
    from streetmend.municipal.scenario import AREA_DIR

    if not (AREA_DIR / "ramps.geojson").exists():
        pytest.skip("municipal data not prepared")
    from streetmend.municipal.scenario import load_municipal_scenario
    from streetmend.optimize.analysis import AnalysisParams, analyze
    from streetmend.optimize.objective import PRIORITY_PRESETS

    a = analyze(load_municipal_scenario("strict"), AnalysisParams(budget=2, weights=PRIORITY_PRESETS["healthcare"]))
    s = a["sensitivity"]
    if not s["optimal_is_exact"]:
        assert s["recommendation_changes"] is None and s["optimal_method"] == "greedy"


def test_duplicate_candidate_ids_are_deduplicated(client):
    a = client.post("/api/scenarios/demo/optimize", json={"budget": 2, "candidate_ids": ["E", "E", "E", "F", "G"]}).json()
    assert a["params"]["candidate_count"] == 3
    for alt in a["alternatives"]:
        assert len(alt["selected"]) == len(set(alt["selected"]))


def test_buildings_context_endpoint(client):
    r = client.get("/api/context/buildings", headers={"Accept-Encoding": "gzip"})
    if r.status_code == 503:
        pytest.skip("buildings not prepared")
    assert r.status_code == 200
    fc = r.json()
    assert fc["metadata"]["license"].startswith("ODbL") and len(fc["features"]) > 1000
    f = fc["features"][0]
    assert f["geometry"]["type"] in ("Polygon", "MultiPolygon") and "h" in f["properties"]
    lon, lat = (f["geometry"]["coordinates"][0][0] if f["geometry"]["type"] == "Polygon" else f["geometry"]["coordinates"][0][0][0])
    assert -80.86 < lon < -80.80 and 35.19 < lat < 35.24


def test_trees_context_endpoint(client):
    r = client.get("/api/context/trees", headers={"Accept-Encoding": "gzip"})
    if r.status_code == 503:
        pytest.skip("trees not prepared")
    assert r.status_code == 200
    d = r.json()
    meta = d["metadata"]
    assert "2022" in meta["sources"]["canopy"] and "illustrative" in meta["method"]
    assert meta["count"] == len(d["trees"]) > 1000
    lng, lat, r_m, h_m, src = d["trees"][0]
    assert -80.86 < lng < -80.80 and 35.19 < lat < 35.24 and 0 < r_m < 12 and 0 < h_m < 40 and src in (0, 1)


P1 = [{"id": "P1", "op": "close", "edge_id": "X:172578423:1", "label": "Temporary closure"}]


@pytest.mark.parametrize("text,op,changes", [
    ("Which neighborhood has the poorest access to hospitals?", "identify_access_gaps", []),
    ("Why is grocery access poor here?", "diagnose_access", []),
    ("Is repairing better than adding a new school?", "compare_interventions", []),
    ("Compare direct distance with actual pedestrian network distance.", "network_vs_straight", []),
    ("Show the streets that disconnect the most modeled journeys if closed.", "critical_links", []),
    ("Which schools become unreachable after this crossing closes?", "closure_impact", P1),
    ("Why did verification fail?", "explain_verification", P1),
    ("Which two connections should be repaired to restore clinic access?", "optimize_repairs", P1),
])
def test_street_intelligence_tools(client, text, op, changes):
    r = client.post("/api/assistant", json={"text": text, "scenario_id": "preflight", "use_llm": False, "changes": changes})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["operation"] == op and body["ok"] and body["facts"]


def test_street_intelligence_numbers_come_from_engine(client):
    fix = client.post("/api/assistant", json={"text": "Which two connections should be repaired to restore clinic access?", "scenario_id": "preflight",
                                              "use_llm": False, "changes": P1}).json()
    assert fix["result"]["fix"]["interventions"] == ["A", "B"]
    cmp = client.post("/api/assistant", json={"text": "Is repairing better than adding a new school?", "scenario_id": "preflight", "use_llm": False}).json()
    c = cmp["result"]["compare"]
    assert c["winner"] == "fix" and str(c["fix"]["gain"]) in cmp["facts"][0]
    bad = client.post("/api/assistant", json={"text": "why did it fail", "scenario_id": "preflight", "use_llm": False,
                                              "changes": [{"id": "x", "op": "close", "edge_id": "nope"}]})
    assert bad.status_code == 422


def test_evaluation_endpoint_serves_the_generated_report(client):
    r = client.get("/api/evaluation")
    assert r.status_code == 200
    body = r.json()
    assert all(f["correct"] for f in body["verification"]["fixtures"])
