"""Run the change-verification benchmark: the exact engine against two honest baselines.

For every fixture (and the real Charlotte preflight case) this checks the ten
claims StreetMend makes and compares the minimal-fix search with:

  greedy      add the intervention with the best gain per cost unit (requirements
              newly passing, then step-free distance saved), one at a time,
              until every regressed requirement passes or nothing improves;
  proximity   rank interventions by straight-line distance to the proposed
              change ("fix nearest the work site") and add them in that order
              until every regressed requirement passes.

Ties break by intervention id in all three methods. Baselines are reported as
they come out, including where they match the exact search.
"""

from __future__ import annotations

import time
from typing import Any

import networkx as nx

from streetmend.graph import haversine_m
from streetmend.scenario.model import Scenario
from streetmend.verify import NetworkState, apply_changes, evaluate, synthesize
from streetmend.verify.checks import Requirement, counterexample
from streetmend.verify.changes import Change
from streetmend.verify.engine import candidates, run_checks
from streetmend.verify.interventions import validate_catalog
from streetmend.verify.profiles import Profile, profile_graph

from .fixtures import Fixture, fixtures


def _states(sc: Scenario, proposal: list[Change]):
    base = NetworkState(sc, [], "baseline")
    psc = apply_changes(sc, proposal)
    return base, psc


def _passes(psc: Scenario, base: NetworkState, reqs: list[Requirement], targets: list[Requirement], keep: set[str], ids: list[str]) -> tuple[bool, dict[str, str]]:
    st = NetworkState(psc, list(ids), "trial")
    res = {r.id: evaluate(r, st, base).status for r in reqs}
    return all(res[r.id] == "PASS" for r in targets) and all(res[i] == "PASS" for i in keep), res


def _focus_len(psc: Scenario, ids: list[str], focus) -> float:
    if not focus:
        return 0.0
    r = NetworkState(psc, list(ids), "f").route(focus[0], focus[1], Profile.STEP_FREE, False, None)
    return r.length_m if r.length_m is not None else 1e9


def greedy(sc: Scenario, proposal: list[Change], reqs: list[Requirement], budget: int | None = None) -> dict[str, Any]:
    base, psc = _states(sc, proposal)
    pre = run_checks(reqs, NetworkState(psc, [], "p"), base)
    b = run_checks(reqs, base, base)
    targets = [r for r, x, y in zip(reqs, b, pre) if x.status == "PASS" and y.status != "PASS"]
    keep = {r.id for r, y in zip(reqs, pre) if y.status == "PASS"}
    pool = candidates(sc, psc)
    chosen: list[str] = []
    focus = sc.default_journey

    def score(ids):
        ok, res = _passes(psc, base, reqs, targets, keep, ids)
        return ok, sum(res[r.id] == "PASS" for r in targets), _focus_len(psc, ids, focus)

    ok, npass, length = score(chosen)
    while not ok:
        best = None
        for c in pool:
            if c in chosen:
                continue
            cost = sc.interventions[c].cost_units
            if budget is not None and sum(sc.interventions[i].cost_units for i in chosen) + cost > budget:
                continue
            ok2, n2, l2 = score(chosen + [c])
            gain = ((n2 - npass) / cost, (length - l2) / cost)
            if gain <= (0, 0):
                continue
            key = (-gain[0], -gain[1], c)
            if best is None or key < best[0]:
                best = (key, c, ok2, n2, l2)
        if best is None:
            break
        chosen.append(best[1])
        ok, npass, length = best[2], best[3], best[4]
    return {"ids": chosen, "passes": ok}


def proximity(sc: Scenario, proposal: list[Change], reqs: list[Requirement], budget: int | None = None) -> dict[str, Any]:
    base, psc = _states(sc, proposal)
    pre = run_checks(reqs, NetworkState(psc, [], "p"), base)
    b = run_checks(reqs, base, base)
    targets = [r for r, x, y in zip(reqs, b, pre) if x.status == "PASS" and y.status != "PASS"]
    keep = {r.id for r, y in zip(reqs, pre) if y.status == "PASS"}
    sites = [sc.graph.edges[c.edge_id].geometry for c in proposal]

    def dist(iid: str) -> float:
        iv = sc.interventions[iid]
        return min(haversine_m((iv.lon, iv.lat), p) for g in sites for p in g)

    order = sorted(candidates(sc, psc), key=lambda c: (dist(c), c))
    chosen: list[str] = []
    ok, _ = _passes(psc, base, reqs, targets, keep, chosen)
    for c in order:
        if ok:
            break
        if budget is not None and sum(sc.interventions[i].cost_units for i in chosen + [c]) > budget:
            break
        chosen.append(c)
        ok, _ = _passes(psc, base, reqs, targets, keep, chosen)
    return {"ids": chosen, "passes": ok}


def _counterexample_valid(sc: Scenario, psc: Scenario, base: NetworkState, req: Requirement, ce: dict[str, Any], proposal: list[Change]) -> bool:
    """Independent check: the baseline route is a real usable path, it uses a proposed change, and the proposed network has no compliant route."""

    if not ce:
        return False
    route = ce["baseline_route"]["edge_ids"]
    g0 = profile_graph(sc.graph, set(), req.profile, False)
    # a connected chain of usable edges from origin to destination
    at = ce["origin"]
    for eid in route:
        e = sc.graph.edges[eid]
        if not g0.has_edge(e.u, e.v, key=eid) or at not in (e.u, e.v):
            return False
        at = e.v if at == e.u else e.u
    if at != ce["destination"]:
        return False
    changed = {c.edge_id for c in proposal}
    if not ({b["id"] for b in ce["broken_edges"]} & changed and set(route) & changed):
        return False
    g1 = profile_graph(psc.graph, set(), req.profile, True)  # optimistic: unknown links allowed
    try:
        d = nx.shortest_path_length(g1, ce["origin"], ce["destination"], weight="weight")
    except nx.NetworkXNoPath:
        return True
    if req.kind == "route":
        g2 = profile_graph(psc.graph, set(), req.profile, False)
        try:
            d2 = nx.shortest_path_length(g2, ce["origin"], ce["destination"], weight="weight")
        except nx.NetworkXNoPath:
            return True
        return d2 > (req.max_m or float("inf")) + 1e-6 or d > (req.max_m or float("inf"))
    if req.kind == "detour":
        b = ce["baseline_route"]["length_m"]
        g2 = profile_graph(psc.graph, set(), req.profile, False)
        d2 = nx.shortest_path_length(g2, ce["origin"], ce["destination"], weight="weight")
        return d2 > b * (req.max_ratio or 1.0) + 1e-6
    return True


def run_case(fid: str, sc: Scenario, proposal: list[Change], reqs: list[Requirement], expect: dict[str, Any] | None, budget: int | None = None) -> dict[str, Any]:
    validate_catalog(sc)
    base, psc = _states(sc, proposal)
    prop = NetworkState(psc, [], "proposed")
    b_res = run_checks(reqs, base, base)
    p_res = run_checks(reqs, prop, base)
    regress = [r.id for r, x, y in zip(reqs, b_res, p_res) if x.status == "PASS" and y.status != "PASS"]
    ces = {}
    for req, y in zip(reqs, p_res):
        if req.id in regress:
            ce = counterexample(req, prop, base)
            ces[req.id] = {"valid": _counterexample_valid(sc, psc, base, req, ce, proposal) if ce else None,
                           "responsible": sorted({x["change"] for x in (ce or {}).get("broken_edges", []) if x.get("change")}),
                           "summary": (ce or {}).get("summary")}
    t0 = time.perf_counter()
    fix = synthesize(sc, proposal, reqs, sc.default_journey, budget=budget)
    ms = (time.perf_counter() - t0) * 1000
    ids = fix["interventions"]
    # undoing any member of the fix must bring a regression back (minimality, re-verified)
    undo_regresses = None
    if ids:
        targets = [r for r in reqs if r.id in regress]
        keep = {r.id for r, y in zip(reqs, p_res) if y.status == "PASS"}
        undo_regresses = all(not _passes(psc, base, reqs, targets, keep, [i for i in ids if i != x])[0] for x in ids)
    gr = greedy(sc, proposal, reqs, budget)
    px = proximity(sc, proposal, reqs, budget)
    after = fix["verification"]["summary"] if fix["verification"] else None
    out = {
        "id": fid,
        "baseline": {r.id: x.status for r, x in zip(reqs, b_res)},
        "proposed": {r.id: y.status for r, y in zip(reqs, p_res)},
        "regressions": regress,
        "counterexamples": ces,
        "exact": {"status": fix["status"], "ids": ids, "size": fix["size"], "evaluated": fix["evaluated"], "runtime_ms": round(ms, 1),
                  "alternatives": fix["alternatives"], "after": after, "undo_regresses": undo_regresses, "over_budget": fix.get("over_budget")},
        "greedy": {**gr, "minimal": gr["passes"] and len(gr["ids"]) == len(ids)},
        "proximity": {**px, "minimal": px["passes"] and len(px["ids"]) == len(ids)},
        "inconclusive": sum(1 for y in p_res if y.status == "INCONCLUSIVE"),
    }
    if expect is not None:
        ok = {
            "regressions": sorted(regress) == sorted(expect["regressions"]),
            "proposed": all(out["proposed"][k] == v for k, v in expect["proposed"].items()),
            "fix": sorted(ids) == sorted(expect["fix"]) and fix["status"] == expect["status"],
            "counterexamples": all(c["valid"] for c in ces.values()),
            "responsible": all(c["responsible"] for c in ces.values()),
            "reverified": (after is None and not ids) or (after is not None and after["FAIL"] == 0 and after["INCONCLUSIVE"] == 0) or not regress,
        }
        if "singles_fail" in expect:
            singles = {s["id"]: s["resolves"] for s in fix["singles"]}
            ok["singles_fail"] = all(not singles[i] for i in expect["singles_fail"])
        if "over_budget" in expect:
            ok["over_budget"] = bool(fix["over_budget"]) and fix["over_budget"][0]["ids"] == expect["over_budget"]
        if "alternatives" in expect:
            ok["alternatives"] = fix["alternatives"] == expect["alternatives"]
        if ids:
            ok["undo_regresses"] = bool(undo_regresses)
        out["checks"] = ok
        out["correct"] = all(ok.values())
    return out


def run_all() -> dict[str, Any]:
    rows = []
    for f in fixtures():
        r = run_case(f.id, f.sc, f.proposal, f.reqs, f.expect, f.budget)
        rows.append({"title": f.title, "claim": f.claim, **r})
    from streetmend.scenario.preflight import load_preflight_scenario, proposal, requirements

    pre = load_preflight_scenario()
    real = run_case("charlotte_preflight", pre, proposal(pre, "P1"), requirements(pre), None)
    real["title"] = "Charlotte, Elizabeth (real streets, hypothetical settings)"
    real["claim"] = "Closure of the East 7th Street crossing at Hawthorne Lane."
    return {"fixtures": rows, "real": real}
