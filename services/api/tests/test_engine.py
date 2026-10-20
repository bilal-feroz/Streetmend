"""Correctness tests for the graph engine and the combined-repair optimizer."""

from itertools import chain, combinations

import networkx as nx
import numpy as np
import pytest

from conftest import random_scenario
from streetmend.graph import Passability
from streetmend.graph.algorithms import shortest_route
from streetmend.optimize.analysis import AnalysisParams, analyze
from streetmend.optimize.objective import PRIORITY_PRESETS, CategoryWeights, Evaluator
from streetmend.optimize.solvers import beam_search, exact_enumeration, greedy, independent_ranking, solve
from streetmend.scenario.demo import build_demo_scenario
from streetmend.scenario.evaluate import evaluate_state
from streetmend.scenario.state import RepairState, StateError

O, D = "O2", "D_CLINIC"
HEALTH = PRIORITY_PRESETS["healthcare"]


def route(sc, applied):
    g = sc.graph.to_networkx(sc.enabled_edges(applied))
    return shortest_route(sc.graph, g, O, D, sc.max_distance_m)


def nx_score(sc, applied, weights=CategoryWeights(), include_unknown=False):
    """Independent reference implementation of the objective using NetworkX."""

    g = sc.graph.to_networkx(sc.enabled_edges(applied), include_unknown=include_unknown)
    total = 0.0
    for o in sc.origins:
        dist = nx.single_source_dijkstra_path_length(g, o.id, weight="weight")
        for d in sc.destinations:
            if d.id in dist and (sc.max_distance_m is None or dist[d.id] <= sc.max_distance_m + 1e-9):
                total += o.weight * d.weight * weights.of(d.category)
    return total


# 1 ---------------------------------------------------------------------------
def test_initial_graph_has_expected_disconnected_destinations(demo):
    ev = Evaluator(demo)
    reach = ev.reachable()
    j = ev.dest_ids.index(D)
    # No western origin can reach the clinic in the unrepaired network.
    for o in ("O1", "O2", "O3", "O4"):
        assert not reach[ev.origin_ids.index(o), j]
    # The eastern origin can, so the clinic itself is not isolated.
    assert reach[ev.origin_ids.index("O5"), j]
    assert not route(demo, []).found


# 2, 3 -----------------------------------------------------------------------
@pytest.mark.parametrize("single", ["A", "B"])
def test_single_dependent_repair_does_not_unlock_journey(demo, single):
    r = route(demo, [single])
    assert not r.found
    assert Evaluator(demo).score([single]) == Evaluator(demo).score([])


# 4 ---------------------------------------------------------------------------
def test_both_dependent_repairs_create_traversable_path(demo):
    r = route(demo, ["A", "B"])
    assert r.found
    for iid in ("A", "B"):
        assert set(demo.interventions[iid].edge_ids) <= set(r.edge_ids)
    assert "X:3,2:S" in r.edge_ids  # the Cedar St crossing of Harbor Blvd
    assert r.length_m <= demo.max_distance_m


# 5 ---------------------------------------------------------------------------
def test_unrelated_repairs_do_not_falsely_connect(demo):
    others = sorted(set(demo.interventions) - {"A", "B"})
    subsets = chain.from_iterable(combinations(others, k) for k in range(len(others) + 1))
    for s in subsets:
        for extra in ([], ["A"], ["B"]):
            assert not route(demo, list(s) + extra).found, (s, extra)


# 6 ---------------------------------------------------------------------------
def test_unknown_edges_excluded_from_traversability(demo):
    unknown = {e.id for e in demo.graph.edges.values() if e.state == Passability.UNKNOWN}
    assert unknown
    g = demo.graph.to_networkx(demo.enabled_edges(list(demo.interventions)))
    assert not (unknown & {k for _, _, k in g.edges(keys=True)})
    ev, ev_opt = Evaluator(demo), Evaluator(demo, include_unknown=True)
    assert (ev.distances() >= ev_opt.distances() - 1e-9).all()
    # And on random networks: no route ever uses an unknown edge.
    for seed in range(10):
        sc = random_scenario(seed)
        unk = {e.id for e in sc.graph.edges.values() if e.state == Passability.UNKNOWN}
        g = sc.graph.to_networkx(set())
        assert not (unk & {k for _, _, k in g.edges(keys=True)})


# 7, 8 -----------------------------------------------------------------------
@pytest.mark.parametrize("budget", [0, 1, 2, 3, 4])
def test_repair_count_constraint_respected(demo, budget):
    ev = Evaluator(demo, HEALTH)
    cands = list(demo.interventions)
    for solver in (exact_enumeration, greedy, independent_ranking, beam_search):
        r = solver(ev, cands, budget)
        assert len(r.selected) <= budget
        assert len(set(r.selected)) == len(r.selected)


def test_budget_zero_selects_nothing(demo):
    out = analyze(demo, AnalysisParams(budget=0, weights=HEALTH))
    assert out["recommendation"]["selected"] == []
    assert out["objective"]["gain"] == 0
    assert all(b["selected"] == [] for b in out["baselines"])


# 9 ---------------------------------------------------------------------------
def brute_force_best(sc, weights, budget):
    best = None
    ids = sorted(sc.interventions)
    for k in range(budget + 1):
        for s in combinations(ids, k):
            v = nx_score(sc, list(s), weights)
            if best is None or v > best + 1e-9:
                best = v
    return best


@pytest.mark.parametrize("budget", [1, 2, 3])
def test_exact_matches_bruteforce_on_demo(demo, budget):
    for w in PRIORITY_PRESETS.values():
        r = exact_enumeration(Evaluator(demo, w), list(demo.interventions), budget)
        assert r.exact
        assert r.score == pytest.approx(brute_force_best(demo, w, budget))
        assert r.score == pytest.approx(nx_score(demo, r.selected, w))


@pytest.mark.parametrize("seed", range(12))
def test_exact_matches_bruteforce_on_random_networks(seed):
    sc = random_scenario(seed)
    w = CategoryWeights(2, 1, 1)
    for budget in (1, 2, 3):
        ev = Evaluator(sc, w)
        pruned = exact_enumeration(ev, list(sc.interventions), budget, prune=True)
        full = exact_enumeration(Evaluator(sc, w), list(sc.interventions), budget, prune=False)
        ref = brute_force_best(sc, w, budget)
        assert pruned.score == pytest.approx(ref)
        assert full.score == pytest.approx(ref)


@pytest.mark.parametrize("seed", range(8))
def test_scipy_evaluator_matches_networkx(seed):
    sc = random_scenario(seed)
    ev = Evaluator(sc, CategoryWeights(1, 2, 3))
    ids = sorted(sc.interventions)
    for k in range(3):
        for s in combinations(ids, k):
            assert ev.score(frozenset(s)) == pytest.approx(nx_score(sc, list(s), CategoryWeights(1, 2, 3)))


def test_heuristic_never_beats_exact():
    for seed in range(10):
        sc = random_scenario(seed, n_cand=9)
        ev = Evaluator(sc)
        ex = exact_enumeration(ev, list(sc.interventions), 3)
        for r in (greedy(ev, list(sc.interventions), 3), beam_search(ev, list(sc.interventions), 3)):
            assert r.score <= ex.score + 1e-9
            assert not r.exact


# 10, 11, 12 -----------------------------------------------------------------
def test_repairing_already_repaired_is_idempotent(demo):
    st = RepairState(demo)
    assert st.apply("A") is True
    edges = set(st.enabled_edges)
    assert st.apply("A") is False
    assert st.applied == ["A"]
    assert st.enabled_edges == edges
    with pytest.raises(StateError):
        st.apply("NOPE")
    # Duplicates in a client-supplied list are collapsed, not double counted.
    assert RepairState.from_applied(demo, ["A", "A", "B"]).applied == ["A", "B"]


def test_undo_restores_previous_state(demo):
    st = RepairState(demo)
    st.apply("A")
    before = evaluate_state(demo, st.applied, O, D)
    st.apply("B")
    assert evaluate_state(demo, st.applied, O, D)["journey"]["route"]["found"]
    assert st.undo()
    assert st.applied == ["A"]
    assert evaluate_state(demo, st.applied, O, D) == before


def test_reset_restores_original_graph(demo):
    pristine = build_demo_scenario()
    initial = evaluate_state(demo, [], O, D)
    st = RepairState(demo)
    for iid in ("A", "B", "C"):
        st.apply(iid)
    st.reset()
    assert st.applied == []
    assert evaluate_state(demo, st.applied, O, D) == initial
    # The scenario graph is never mutated by repairs.
    assert {k: v.state for k, v in demo.graph.edges.items()} == {k: v.state for k, v in pristine.graph.edges.items()}


# 13 --------------------------------------------------------------------------
def _strip_runtime(x):
    if isinstance(x, dict):
        return {k: _strip_runtime(v) for k, v in x.items() if k != "runtime_ms"}
    if isinstance(x, list):
        return [_strip_runtime(v) for v in x]
    return x


def test_deterministic_output():
    a = analyze(build_demo_scenario(), AnalysisParams(budget=2, weights=HEALTH))
    b = analyze(build_demo_scenario(), AnalysisParams(budget=2, weights=HEALTH))
    assert _strip_runtime(a) == _strip_runtime(b)
    assert evaluate_state(build_demo_scenario(), ["A"], O, D) == evaluate_state(build_demo_scenario(), ["A"], O, D)


# 14 --------------------------------------------------------------------------
def test_disconnected_path_returns_valid_unavailable_result(demo):
    r = route(demo, ["A"])
    assert r.found is False
    assert r.reason
    s = evaluate_state(demo, ["A"], O, D)
    assert s["journey"]["route"]["found"] is False
    # The reach wave stops at the remaining barrier (ramp B).
    assert demo.interventions["B"].edge_ids[0] in s["journey"]["frontier_barriers"]


def test_beyond_threshold_is_unavailable_with_reason(demo):
    # Repair C opens a long detour via Linden St that exceeds the threshold.
    g = demo.graph.to_networkx(demo.enabled_edges(["C"]))
    r = shortest_route(demo.graph, g, O, D, None)
    assert r.found and r.length_m > demo.max_distance_m
    r2 = shortest_route(demo.graph, g, O, D, demo.max_distance_m)
    assert r2.found is False and "beyond" in r2.reason


# 15 --------------------------------------------------------------------------
def test_route_length_matches_selected_edges(demo):
    r = route(demo, ["A", "B"])
    assert r.length_m == pytest.approx(sum(demo.graph.edges[e].length_m for e in r.edge_ids))
    # Consecutive edges share endpoints and the geometry is continuous.
    for a, b, eid in zip(r.node_ids, r.node_ids[1:], r.edge_ids):
        e = demo.graph.edges[eid]
        assert {e.u, e.v} == {a, b}
        assert e.state == Passability.TRAVERSABLE or eid in demo.enabled_edges(["A", "B"])
    assert r.geometry[0] == (demo.graph.nodes[O].lon, demo.graph.nodes[O].lat)
    assert r.geometry[-1] == (demo.graph.nodes[D].lon, demo.graph.nodes[D].lat)


# Core innovation ---------------------------------------------------------------
def test_synergy_greedy_misses_dependent_pair(demo):
    ev = Evaluator(demo, HEALTH)
    cands = list(demo.interventions)
    base = ev.score()
    assert ev.score(["A"]) == base and ev.score(["B"]) == base  # zero immediate value each
    ex = solve(ev, cands, 2)
    gr = greedy(ev, cands, 2)
    assert ex.exact and sorted(ex.selected) == ["A", "B"]
    assert "A" not in gr.selected and "B" not in gr.selected
    assert ex.score > gr.score
    out = analyze(demo, AnalysisParams(budget=2, weights=HEALTH))
    assert out["synergy"] == pytest.approx(out["objective"]["gain"])
    assert all(c["alone_gain"] == 0 for c in out["contributions"])
    assert all(c["marginal_in_set"] == out["objective"]["gain"] for c in out["contributions"])


def test_priority_change_changes_recommendation(demo):
    h = analyze(demo, AnalysisParams(budget=2, weights=PRIORITY_PRESETS["healthcare"]))
    e = analyze(demo, AnalysisParams(budget=2, weights=PRIORITY_PRESETS["education"]))
    assert sorted(h["recommendation"]["selected"]) == ["A", "B"]
    assert sorted(e["recommendation"]["selected"]) != ["A", "B"]


def test_budget_one_counterfactual(demo):
    out = analyze(demo, AnalysisParams(budget=1, weights=HEALTH))
    assert out["recommendation"]["selected"] == ["C"]
    # With one repair, the greedy baseline is optimal too.
    assert out["advantage_over_best_baseline"] == 0


def test_zero_base_relative_gain_is_none():
    sc = random_scenario(3)
    ev = Evaluator(sc)
    if ev.score() == 0:
        out = analyze(sc, AnalysisParams(budget=2))
        assert out["objective"]["relative_gain"] is None


def test_scenario_validation_rejects_bad_interventions(demo):
    from streetmend.scenario.model import Intervention

    sc = build_demo_scenario()
    traversable = next(e.id for e in sc.graph.edges.values() if e.state == Passability.TRAVERSABLE)
    sc.interventions["BAD"] = Intervention("BAD", "bad", "x", [traversable], 0, 0)
    with pytest.raises(ValueError):
        sc.validate()


# Fast (key-node) evaluator --------------------------------------------------------
def _assert_same_reach(a: Evaluator, b: Evaluator, s):
    ra, rb = a.reachable(frozenset(s)), b.reachable(frozenset(s))
    assert (ra == rb).all(), s
    da, db = a.distances(frozenset(s)), b.distances(frozenset(s))
    assert np.allclose(np.where(ra, da, 0), np.where(rb, db, 0)), s


def test_fast_evaluator_matches_full_dijkstra_on_demo(demo):
    fast, full = Evaluator(demo, HEALTH, fast=True), Evaluator(demo, HEALTH, fast=False)
    ids = sorted(demo.interventions)
    for k in range(4):
        for s in combinations(ids, k):
            _assert_same_reach(fast, full, s)


@pytest.mark.parametrize("seed", range(15))
def test_fast_evaluator_matches_full_dijkstra_on_random(seed):
    sc = random_scenario(seed, n=7, n_cand=8, cutoff=None if seed % 3 == 0 else 700.0)
    fast, full = Evaluator(sc, fast=True), Evaluator(sc, fast=False)
    ids = sorted(sc.interventions)
    for k in range(4):
        for s in combinations(ids, k):
            _assert_same_reach(fast, full, s)


def test_fast_evaluator_handles_multi_edge_interventions():
    from streetmend.scenario.model import Intervention

    sc = random_scenario(5, n=6, n_cand=6)
    blocked = sorted(e.id for e in sc.graph.edges.values() if e.state == Passability.BLOCKED and e.id not in sc.enabled_edges(list(sc.interventions)))
    if len(blocked) >= 2:
        e = sc.graph.edges[blocked[0]]
        sc.interventions["multi"] = Intervention("multi", "two edges", "x", blocked[:2], e.geometry[0][0], e.geometry[0][1])
        sc.validate()
    fast, full = Evaluator(sc, fast=True), Evaluator(sc, fast=False)
    for k in range(3):
        for s in combinations(sorted(sc.interventions), k):
            _assert_same_reach(fast, full, s)


@pytest.mark.parametrize("seed", range(8))
def test_score_many_matches_score(seed):
    sc = random_scenario(seed, n=7, n_cand=8)
    ev_batch, ev_one = Evaluator(sc), Evaluator(sc, fast=False)
    sets = [s for k in range(4) for s in combinations(sorted(sc.interventions), k)]
    assert ev_batch.score_many(sets) == pytest.approx([ev_one.score(frozenset(s)) for s in sets])


def test_batch_scores_identical_to_score_near_cutoff_and_ties():
    """float64 batch kernel: exact agreement at the threshold and for fractional weights."""
    from streetmend.graph import Edge, EdgeKind, Evidence, Node, NodeKind, PedGraph
    from streetmend.scenario.model import Destination, Intervention, Origin, Scenario
    from streetmend.graph import DestinationCategory

    g = PedGraph()
    for i, x in enumerate([0.0, 0.003, 0.006]):
        g.add_node(Node(f"n{i}", NodeKind.CORNER, x, 0.0))
    g.add_node(Node("d1", NodeKind.DESTINATION, 0.006, 0.001))
    g.add_node(Node("d2", NodeKind.DESTINATION, 0.006, -0.001))
    def edge(eid, u, v, length, state):
        return Edge(eid, u, v, EdgeKind.SIDEWALK, length, [(0, 0), (0.001, 0)], state, Evidence.SYNTHETIC)
    g.add_edge(edge("e0", "n0", "n1", 300.0, Passability.TRAVERSABLE))
    g.add_edge(edge("e1", "n1", "n2", 300.0005, Passability.BLOCKED))  # route 600.0005 m vs L = 600
    g.add_edge(edge("e2", "n1", "d1", 100.0, Passability.BLOCKED))
    g.add_edge(edge("e3", "n1", "d2", 100.0, Passability.BLOCKED))
    g.add_edge(edge("e4", "n2", "d1", 0.5, Passability.TRAVERSABLE))
    ivs = {k: Intervention(k, k, "x", [e], 0, 0) for k, e in (("A", "e1"), ("Y", "e2"), ("Z", "e3"))}
    dests = [Destination("d1", "d1", DestinationCategory.HEALTHCARE, 0.1), Destination("d2", "d2", DestinationCategory.HEALTHCARE, 0.3)]
    sc = Scenario("t", "t", "synthetic", "", g, [Origin("n0", "o")], dests, ivs, max_distance_m=600.0)
    sc.validate()
    sets = [s for k in range(3) for s in combinations(sorted(ivs), k)]
    batch = Evaluator(sc).score_many(sets)
    single = [Evaluator(sc, fast=False).score(frozenset(s)) for s in sets]
    assert batch == single  # exact equality, not approximate
