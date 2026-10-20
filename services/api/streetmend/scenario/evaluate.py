"""Network state for a given set of applied repairs.

Used by the interactive map: effective edge states, the selected journey,
the reach wave from the journey origin and the barriers that stop it.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from streetmend.graph import Passability
from streetmend.graph.algorithms import (
    alternative_routes,
    components,
    frontier_barriers,
    reachable,
    reachable_edges,
    shortest_route,
)
from streetmend.optimize.objective import CategoryWeights, Evaluator

from .model import Scenario
from .state import RepairState


def effective_state(sc: Scenario, enabled: set[str]) -> dict[str, str]:
    """traversable | blocked | unknown | repaired | repairable (blocked/unknown with a candidate)."""

    owner = sc.intervention_for_edge()
    out = {}
    for e in sc.graph.edges.values():
        if e.id in enabled:
            out[e.id] = "repaired"
        elif e.state == Passability.TRAVERSABLE:
            out[e.id] = "traversable"
        elif e.id in owner:
            out[e.id] = "repairable"
        else:
            out[e.id] = e.state.value
    return out


def route_dict(r) -> dict[str, Any]:
    return {
        "found": r.found,
        "origin": r.origin,
        "destination": r.destination,
        "node_ids": r.node_ids,
        "edge_ids": r.edge_ids,
        "length_m": None if r.length_m is None else round(r.length_m, 2),
        "geometry": [list(p) for p in r.geometry],
        "reason": r.reason,
    }


def evaluate_state(
    sc: Scenario,
    applied: list[str],
    origin: str | None = None,
    destination: str | None = None,
    weights: CategoryWeights | None = None,
    cutoff_m: float | None = None,
    alternatives: int = 0,
) -> dict[str, Any]:
    state = RepairState.from_applied(sc, applied)
    enabled = state.enabled_edges
    cutoff = cutoff_m if cutoff_m is not None else sc.max_distance_m
    g = sc.graph.to_networkx(enabled)
    ev = Evaluator(sc, weights or CategoryWeights(), cutoff_m=cutoff)
    reach = ev.reachable(frozenset(state.applied))
    dist = ev.distances(frozenset(state.applied))

    journey = None
    if origin or destination:
        o = origin or (sc.default_journey or (None, None))[0]
        d = destination or (sc.default_journey or (None, None))[1]
        r = shortest_route(sc.graph, g, o, d, cutoff)
        wave_d = reachable(g, o, cutoff)
        wave = reachable_edges(sc.graph, g, wave_d, cutoff)
        reached = set(wave_d)
        barriers = frontier_barriers(sc.graph, reached, enabled)
        alts = [route_dict(a) for a in alternative_routes(sc.graph, g, o, d, alternatives, cutoff)[1:]] if alternatives and r.found else []
        potential, blockers = None, []
        if not r.found:
            # The route that would exist if every candidate repair were made.
            # Drawn as an interrupted route; unknown edges stay excluded.
            g_all = sc.graph.to_networkx(sc.enabled_edges(list(sc.interventions)))
            pr = shortest_route(sc.graph, g_all, o, d, cutoff)
            if pr.found:
                potential = route_dict(pr)
                owner = sc.intervention_for_edge()
                blockers = sorted({owner[e] for e in pr.edge_ids if e in owner and e not in enabled})
        journey = {
            "route": route_dict(r),
            "potential_route": potential,
            "potential_blockers": blockers,
            "reach_wave": {k: round(v, 2) for k, v in sorted(wave.items(), key=lambda kv: (kv[1], kv[0]))},
            "reached_destinations": [x.id for x in sc.destinations if x.id in reached],
            "frontier_barriers": barriers,
            "alternatives": alts,
        }

    comps = components(g)
    per_origin = []
    for i, oid in enumerate(ev.origin_ids):
        per_origin.append({
            "origin": oid,
            "reachable": [ev.dest_ids[j] for j in range(len(ev.dest_ids)) if reach[i, j]],
            "distances_m": {ev.dest_ids[j]: (round(float(dist[i, j]), 1) if reach[i, j] else None) for j in range(len(ev.dest_ids))},
        })
    states = effective_state(sc, enabled)
    counts: dict[str, int] = {}
    for s in states.values():
        counts[s] = counts.get(s, 0) + 1
    return {
        "scenario_id": sc.id,
        "applied": state.applied,
        "edge_states": states,
        "state_counts": counts,
        "journey": journey,
        "metrics": {
            "score": float(round(ev.score(frozenset(state.applied)), 6)),
            "max_possible": float(round(ev.max_possible_score(), 6)),
            "connected_pairs": int(reach.sum()),
            "total_pairs": int(reach.size),
            "reachable_destinations": int(np.any(reach, axis=0).sum()),
            "total_destinations": len(ev.dest_ids),
            "components": len(comps),
            "cutoff_m": cutoff,
        },
        "per_origin": per_origin,
    }
