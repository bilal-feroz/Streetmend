"""End-to-end repair analysis: optimization, baselines, synergy and evidence.

Every number in the returned structure is computed from the scenario graph.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from streetmend.graph import haversine_m
from streetmend.scenario.model import Scenario

from .objective import CategoryWeights, Evaluator
from .solvers import EPS, SolverResult, combination_count, exact_enumeration, greedy, independent_ranking, solve


@dataclass
class AnalysisParams:
    budget: int = 2
    weights: CategoryWeights = field(default_factory=CategoryWeights)
    cutoff_m: float | None = None
    candidate_ids: list[str] | None = None
    max_exact_evaluations: int = 150_000


def nearest_to_destination(ev: Evaluator, candidates: list[str], budget: int) -> SolverResult:
    """Baseline: repair the barriers closest (straight line) to the destinations
    of the highest-weighted category."""

    import time

    t0 = time.perf_counter()
    sc = ev.scenario
    w = ev.weights.as_dict()
    top = max(w, key=lambda k: (w[k], k))
    targets = [d for d in sc.destinations if d.category.value == top] or sc.destinations
    def dist(cid: str) -> float:
        iv = sc.interventions[cid]
        return min(haversine_m((iv.lon, iv.lat), (sc.graph.nodes[d.id].lon, sc.graph.nodes[d.id].lat)) for d in targets)
    ranked = sorted(sorted(candidates), key=lambda c: (dist(c), c))
    chosen = ranked[: max(0, budget)]
    return SolverResult("nearest_to_priority_destination", False, chosen, ev.score(frozenset(chosen)), 0,
                        (time.perf_counter() - t0) * 1000, len(candidates), len(candidates),
                        notes=[f"Ranks barriers by straight-line distance to the nearest {top} destination."])


def _fmt(x: float) -> float:
    return float(round(x, 6))


def _pairs(ev: Evaluator, reach: np.ndarray) -> set[tuple[str, str]]:
    return {(ev.origin_ids[i], ev.dest_ids[j]) for i, j in zip(*np.nonzero(reach))}


def _solver_summary(ev: Evaluator, r: SolverResult, base: float, labels: dict[str, str]) -> dict[str, Any]:
    return {
        "solver": r.solver,
        "exact": r.exact,
        "selected": r.selected,
        "selected_labels": [labels[i] for i in r.selected],
        "score": _fmt(r.score),
        "gain": _fmt(r.score - base),
        "connected_pairs": int(ev.reachable(frozenset(r.selected)).sum()),
        "evaluations": r.evaluations,
        "runtime_ms": round(r.runtime_ms, 3),
        "candidate_count": r.candidate_count,
        "considered_count": r.considered_count,
        "notes": r.notes,
    }


def analyze(sc: Scenario, p: AnalysisParams) -> dict[str, Any]:
    ev = Evaluator(sc, p.weights, cutoff_m=p.cutoff_m)
    cands = sorted(set(p.candidate_ids if p.candidate_ids is not None else sc.interventions))
    labels = {i: sc.interventions[i].label for i in sc.interventions}
    olabel = {o.id: o.label for o in sc.origins}
    dmeta = {d.id: d for d in sc.destinations}

    base_score = ev.score()
    opt = solve(ev, cands, p.budget, p.max_exact_evaluations)
    S = frozenset(opt.selected)
    opt_score = opt.score
    gain = opt_score - base_score

    baselines = [greedy(ev, cands, p.budget), independent_ranking(ev, cands, p.budget),
                 nearest_to_destination(ev, cands, p.budget)]

    # ---- newly connected journeys ------------------------------------
    d0, d1 = ev.distances(), ev.distances(S)
    r0, r1 = ev.reachable(), ev.reachable(S)
    new_pairs = []
    changed = []
    for i, o in enumerate(ev.origin_ids):
        for j, d in enumerate(ev.dest_ids):
            before = float(d0[i, j]) if r0[i, j] else None
            after = float(d1[i, j]) if r1[i, j] else None
            if after is None:
                continue
            entry = {
                "origin": o, "origin_label": olabel[o], "destination": d, "destination_label": dmeta[d].label,
                "category": dmeta[d].category.value,
                "before_m": None if before is None else round(before, 1), "after_m": round(after, 1),
                "weight": _fmt(ev.pair_weights[i, j]),
            }
            if before is None:
                new_pairs.append(entry)
            elif after < before - 1e-6:
                changed.append(entry)
    dest_before = {ev.dest_ids[j] for j in range(len(ev.dest_ids)) if r0[:, j].any()}
    dest_after = {ev.dest_ids[j] for j in range(len(ev.dest_ids)) if r1[:, j].any()}
    newly_reachable_dests = sorted(dest_after - dest_before)

    # ---- synergy ------------------------------------------------------
    singles = {c: ev.score(frozenset([c])) - base_score for c in opt.selected}
    loo = {c: opt_score - ev.score(S - {c}) for c in opt.selected}
    synergy = gain - sum(singles.values())
    contributions = [
        {"id": c, "label": labels[c], "alone_gain": _fmt(singles[c]), "marginal_in_set": _fmt(loo[c])}
        for c in opt.selected
    ]

    # ---- sensitivity: treat unknown edges as traversable ---------------
    ev_opt = Evaluator(sc, p.weights, include_unknown=True, cutoff_m=p.cutoff_m)
    rel_opt = ev_opt.relevant_interventions(cands)
    sens_exact = combination_count(len(rel_opt), p.budget) <= min(p.max_exact_evaluations, 25_000)
    sens = exact_enumeration(ev_opt, cands, p.budget) if sens_exact else greedy(ev_opt, cands, p.budget)
    sensitivity = {
        "assumption": "Unknown-condition edges treated as traversable (optimistic bound; not a verified state).",
        "baseline_score": _fmt(ev_opt.score()),
        "score_with_selected": _fmt(ev_opt.score(S)),
        "optimal_selected": sens.selected,
        "optimal_score": _fmt(sens.score),
        "optimal_method": "exact_enumeration" if sens_exact else "greedy",
        "optimal_is_exact": sens_exact,
        # Only an exact optimistic optimum can show that the recommendation changes.
        "recommendation_changes": (sorted(sens.selected) != sorted(opt.selected)) if sens_exact else None,
        "unknown_edge_count": sum(1 for e in sc.graph.edges.values() if e.state.value == "unknown"),
    }

    alternatives = [
        {"selected": s, "selected_labels": [labels[i] for i in s], "score": _fmt(v), "gain": _fmt(v - base_score)}
        for s, v in opt.ranked_sets if sorted(s) != sorted(opt.selected)
    ][:5]

    best_baseline = max(baselines, key=lambda b: (b.score, -len(b.selected)))
    return {
        "scenario_id": sc.id,
        "params": {
            "budget": p.budget,
            "weights": p.weights.as_dict(),
            "cutoff_m": ev.cutoff_m,
            "candidate_count": len(cands),
        },
        "objective": {
            "name": "weighted_reachable_od_pairs",
            "formula": "sum_o sum_d w_o * w_cat(d) * w_d * 1[dist_S(o,d) <= L]",
            "before": _fmt(base_score),
            "after": _fmt(opt_score),
            "gain": _fmt(gain),
            "relative_gain": None if base_score <= EPS else _fmt(gain / base_score),
            "max_possible": _fmt(ev.max_possible_score()),
            "connected_pairs_before": int(r0.sum()),
            "connected_pairs_after": int(r1.sum()),
            "total_pairs": int(r0.size),
        },
        "recommendation": _solver_summary(ev, opt, base_score, labels),
        "baselines": [_solver_summary(ev, b, base_score, labels) for b in baselines],
        "advantage_over_best_baseline": _fmt(opt_score - best_baseline.score),
        "best_baseline": best_baseline.solver,
        "newly_connected_pairs": new_pairs,
        "shortened_pairs": changed,
        "newly_reachable_destinations": [{"id": d, "label": dmeta[d].label, "category": dmeta[d].category.value} for d in newly_reachable_dests],
        "contributions": contributions,
        "synergy": _fmt(synergy),
        "alternatives": alternatives,
        "sensitivity": sensitivity,
        "explanation": explain(opt, base_score, gain, singles, loo, synergy, new_pairs, best_baseline, base_score, labels, ev, p, baselines),
        "assumptions": sc.assumptions,
    }


def explain(opt, base, gain, singles, loo, synergy, new_pairs, best_baseline, base_score, labels, ev, p, baselines=()) -> list[str]:
    """Deterministic, template-based explanation built only from computed facts."""

    out: list[str] = []
    n = len(opt.selected)
    method = "exact enumeration (optimal for this candidate set and objective)" if opt.exact else "beam search (approximate)"
    if n == 0:
        if p.budget == 0:
            out.append("Budget is zero, so no repairs were selected.")
        else:
            out.append("No candidate repair, alone or in combination within the budget, increases the objective.")
        return out
    names = ", ".join(f"{c} ({labels[c]})" for c in opt.selected)
    out.append(f"Selected {n} repair(s) by {method}: {names}.")
    out.append(f"Objective rises from {base:g} to {base + gain:g} (+{gain:g}); {len(new_pairs)} origin-destination pair(s) become reachable within {ev.cutoff_m:g} m." if ev.cutoff_m else
               f"Objective rises from {base:g} to {base + gain:g} (+{gain:g}); {len(new_pairs)} origin-destination pair(s) become reachable.")
    zero_alone = [c for c in opt.selected if singles[c] <= EPS]
    if zero_alone and synergy > EPS:
        if len(zero_alone) == n:
            out.append(f"None of these repairs adds value on its own (stand-alone gain 0 each); together they add {gain:g}. "
                       "They remove barriers on the same route, so the gain exists only as a combination.")
        else:
            out.append(f"{', '.join(zero_alone)} add nothing on their own but are essential within the set "
                       f"(removing any one loses {', '.join(f'{loo[c]:g}' for c in zero_alone)}).")
    elif synergy > EPS:
        out.append(f"The combination is worth {synergy:g} more than the sum of the individual gains.")
    gr = next((b for b in baselines if b.solver == "greedy"), None)
    if best_baseline.score + EPS < base + gain:
        out.append(f"The best simple baseline ({best_baseline.solver.replace('_', ' ')}) reaches {best_baseline.score:g} "
                   f"with {', '.join(best_baseline.selected) or 'no repairs'}; the recommendation is {base + gain - best_baseline.score:g} higher.")
    elif gr is not None and gr.score + EPS >= base + gain:
        out.append("Greedy also reaches the same objective: these repairs act largely independently, so simple ranking is already optimal here.")
    else:
        out.append(f"The {best_baseline.solver.replace('_', ' ')} baseline happens to reach the same objective here"
                   + (f", while greedy reaches {gr.score:g}." if gr is not None else "."))
    if gr is not None and not gr.selected and gain > EPS:
        out.append("Greedy and individual ranking recommend nothing here: no single repair adds value on its own.")
    return out
