"""Preflight verification: PROPOSE -> TEST -> FIND BREAKAGE -> GENERATE FIX -> VERIFY.

Every state is rebuilt from the immutable baseline scenario:
  baseline = scenario
  proposed = baseline + proposal changes
  fixed    = proposed + mitigation interventions
and every requirement is re-evaluated on each. The fix search is an exact
search by increasing size, so the first sets it returns are minimal for the
stated candidate catalog; a fix is reported only after the graph engine has
verified every regressed requirement on the fixed state.
"""

from __future__ import annotations

import time
from itertools import combinations
from typing import Any

from streetmend.scenario.model import Scenario

from .changes import Change, apply_changes
from .checks import CheckResult, NetworkState, Requirement, counterexample, evaluate
from .profiles import Profile


def run_checks(reqs: list[Requirement], st: NetworkState, base: NetworkState) -> list[CheckResult]:
    return [evaluate(r, st, base) for r in reqs]


def _summary(results: list[CheckResult]) -> dict[str, int]:
    out = {"PASS": 0, "FAIL": 0, "INCONCLUSIVE": 0}
    for r in results:
        out[r.status] += 1
    return out


def _journeys(st: NetworkState, profile: Profile, cutoff: float | None) -> int:
    m = cutoff or float("inf")
    return sum(1 for o in st.sc.origins for d in st.sc.destinations if st.dist_from(o.id, profile, False).get(d.id, 1e18) <= m)


def _state_out(name: str, st: NetworkState, base: NetworkState, reqs: list[Requirement], focus: tuple[str, str] | None) -> dict[str, Any]:
    res = run_checks(reqs, st, base)
    regress = {r.id for r, b in zip(res, run_checks(reqs, base, base)) if b.status == "PASS" and r.status != "PASS"} if st is not base else set()
    checks = []
    for req, r in zip(reqs, res):
        d = r.as_dict()
        d["regression"] = r.id in regress
        if r.status != "PASS" and st is not base:
            ce = counterexample(req, st, base)
            if ce:
                d["counterexample"] = ce
        checks.append(d)
    route = None
    walk = None
    if focus:
        r = st.route(focus[0], focus[1], Profile.STEP_FREE, False, None)
        route = {"found": r.found, "length_m": None if r.length_m is None else round(r.length_m, 1), "edge_ids": r.edge_ids, "geometry": [list(p) for p in r.geometry]}
        w = st.route(focus[0], focus[1], Profile.PEDESTRIAN, False, None)
        walk = {"found": w.found, "length_m": None if w.length_m is None else round(w.length_m, 1)}
    cutoff = st.sc.max_distance_m
    return {
        "name": name,
        "applied": st.applied,
        "checks": checks,
        "summary": _summary(res),
        "regressions": sorted(regress),
        "step_free_route": route,
        "walking_route": walk,
        "metrics": {
            "step_free_journeys": _journeys(st, Profile.STEP_FREE, cutoff),
            "walking_journeys": _journeys(st, Profile.PEDESTRIAN, cutoff),
            "total_pairs": len(st.sc.origins) * len(st.sc.destinations),
            "cutoff_m": cutoff,
        },
    }


def verify(sc: Scenario, proposal: list[Change], mitigations: list[str], reqs: list[Requirement], focus: tuple[str, str] | None) -> dict[str, Any]:
    t0 = time.perf_counter()
    base = NetworkState(sc, [], "baseline")
    proposed_sc = apply_changes(sc, proposal)
    proposed = NetworkState(proposed_sc, [], "proposed")
    out = {
        "baseline": _state_out("baseline", base, base, reqs, focus),
        "proposed": _state_out("proposed", proposed, base, reqs, focus),
        "fixed": None,
        "changes": [c.__dict__ for c in proposal],
    }
    if mitigations:
        fixed = NetworkState(proposed_sc, mitigations, "fixed")
        out["fixed"] = _state_out("fixed", fixed, base, reqs, focus)
    out["runtime_ms"] = round((time.perf_counter() - t0) * 1000, 1)
    return out


def candidates(sc: Scenario, proposed: Scenario) -> list[str]:
    """Catalog mitigations that are still meaningful once the proposal is in place."""

    out = []
    for iv in sc.interventions.values():
        if any(proposed.graph.edges[e].attrs.get("barrier") == "closure" for e in iv.edge_ids):
            continue  # cannot mitigate by undoing the proposal itself
        out.append(iv.id)
    return sorted(out)


def synthesize(sc: Scenario, proposal: list[Change], reqs: list[Requirement], focus: tuple[str, str] | None, max_size: int = 3, max_evals: int = 20000) -> dict[str, Any]:
    t0 = time.perf_counter()
    base = NetworkState(sc, [], "baseline")
    proposed_sc = apply_changes(sc, proposal)
    proposed = NetworkState(proposed_sc, [], "proposed")
    b_res = run_checks(reqs, base, base)
    p_res = run_checks(reqs, proposed, base)
    targets = [req for req, b, p in zip(reqs, b_res, p_res) if b.status == "PASS" and p.status != "PASS"]
    passing_before = {req.id for req, p in zip(reqs, p_res) if p.status == "PASS"}
    cands = candidates(sc, proposed_sc)
    evals = 0

    def test(ids: tuple[str, ...]):
        nonlocal evals
        evals += 1
        st = NetworkState(proposed_sc, list(ids), "trial")
        res = {r.id: evaluate(r, st, base) for r in reqs}
        ok = all(res[r.id].status == "PASS" for r in targets) and all(res[i].status == "PASS" for i in passing_before)
        return ok, res

    singles = []
    for c in cands:
        ok, res = test((c,))
        iv = sc.interventions[c]
        singles.append({
            "id": c, "label": iv.label, "kind": iv.kind, "resolves": ok,
            "checks": {k: v.status for k, v in res.items()},
            "values": {k: v.value for k, v in res.items()},
        })
    solutions: list[tuple[str, ...]] = []
    size = 0
    if not targets:
        status = "nothing_to_fix"
    else:
        status = "none"
        for k in range(1, max_size + 1):
            for combo in combinations(cands, k):
                if evals >= max_evals:
                    break
                ok, _ = test(combo)
                if ok:
                    solutions.append(combo)
            if solutions:
                size = k
                status = "found"
                break
    # rank minimal sets: cost, then the step-free length of the focus journey
    def rank(ids: tuple[str, ...]):
        st = NetworkState(proposed_sc, list(ids), "rank")
        cost = sum(sc.interventions[i].cost_units for i in ids)
        length = 0.0
        if focus:
            r = st.route(focus[0], focus[1], Profile.STEP_FREE, False, None)
            length = r.length_m if r.length_m is not None else 1e9
        return (cost, length, ids)

    solutions.sort(key=rank)
    best = list(solutions[0]) if solutions else []
    verification = _state_out("fixed", NetworkState(proposed_sc, best, "fixed"), base, reqs, focus) if best else None
    # why no smaller set works: each member alone, from the singles table
    members = [s for s in singles if s["id"] in best]
    return {
        "status": status,
        "size": size,
        "interventions": best,
        "alternatives": [list(s) for s in solutions[1:6]],
        "targets": [r.id for r in targets],
        "candidates": cands,
        "singles": singles,
        "members_alone": members,
        "evaluated": evals,
        "exhaustive": evals < max_evals,
        "max_size": max_size,
        "verification": verification,
        "runtime_ms": round((time.perf_counter() - t0) * 1000, 1),
    }
