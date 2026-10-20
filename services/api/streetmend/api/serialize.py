"""Scenario -> JSON payloads, and the compact Markdown analysis report."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from streetmend.scenario.model import Scenario


def summary(sc: Scenario) -> dict[str, Any]:
    return {
        "id": sc.id,
        "name": sc.name,
        "mode": sc.mode,
        "description": sc.description,
        "node_count": len(sc.graph.nodes),
        "edge_count": len(sc.graph.edges),
        "candidate_count": len(sc.interventions),
        "origin_count": len(sc.origins),
        "destination_count": len(sc.destinations),
        "available": True,
        "unavailable_reason": None,
    }


def scenario_payload(sc: Scenario) -> dict[str, Any]:
    g = sc.graph
    return {
        **summary(sc),
        "nodes": [{"id": n.id, "kind": n.kind.value, "lon": n.lon, "lat": n.lat, "label": n.label} for n in g.nodes.values()],
        "edges": [
            {
                "id": e.id, "u": e.u, "v": e.v, "kind": e.kind.value, "length_m": round(e.length_m, 2),
                "geometry": [list(p) for p in e.geometry], "state": e.state.value, "evidence": e.evidence.value,
                "source": e.source, "source_ids": e.source_ids, "label": e.label, "reason": e.reason,
                "attrs": {k: v for k, v in e.attrs.items() if isinstance(v, (str, int, float, bool)) or v is None},
            }
            for e in g.edges.values()
        ],
        "origins": [{"id": o.id, "label": o.label, "weight": o.weight, "weight_basis": o.weight_basis,
                     "lon": g.nodes[o.id].lon, "lat": g.nodes[o.id].lat} for o in sc.origins],
        "destinations": [{"id": d.id, "label": d.label, "category": d.category.value, "weight": d.weight,
                          "evidence": d.evidence.value, "source_ids": d.source_ids,
                          "lon": g.nodes[d.id].lon, "lat": g.nodes[d.id].lat} for d in sc.destinations],
        "interventions": [{"id": i.id, "label": i.label, "kind": i.kind, "edge_ids": i.edge_ids, "lon": i.lon, "lat": i.lat,
                           "description": i.description, "evidence": i.evidence.value, "source_ids": i.source_ids,
                           "cost_units": i.cost_units, "attrs": i.attrs} for i in sc.interventions.values()],
        "max_distance_m": sc.max_distance_m,
        "default_journey": list(sc.default_journey) if sc.default_journey else None,
        "bounds": list(sc.bounds) if sc.bounds else None,
        "context": sc.context,
        "assumptions": sc.assumptions,
        "provenance": sc.provenance,
    }


def markdown_report(sc: Scenario, analysis: dict[str, Any], state: dict[str, Any] | None = None) -> str:
    o = analysis["objective"]
    r = analysis["recommendation"]
    lines = [
        f"# StreetMend analysis report - {sc.name}",
        "",
        f"Generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} by the StreetMend engine.",
        f"Data mode: **{sc.mode}**." + (" All network conditions are synthetic scenario settings." if sc.mode == "synthetic" else ""),
        "",
        "## Parameters",
        f"- Repair budget: {analysis['params']['budget']} (repair count)",
        f"- Category weights: " + ", ".join(f"{k} {v:g}" for k, v in analysis["params"]["weights"].items()),
        f"- Access threshold L: {analysis['params']['cutoff_m']:g} m" if analysis["params"]["cutoff_m"] else "- Access threshold: none",
        f"- Candidates: {analysis['params']['candidate_count']}",
        "",
        "## Objective",
        f"`{o['formula']}`",
        "",
        f"| | Value |\n|---|---|\n| Before | {o['before']:g} |\n| After | {o['after']:g} |\n| Gain | {o['gain']:g} |"
        f"\n| Connected O-D pairs | {o['connected_pairs_before']} -> {o['connected_pairs_after']} of {o['total_pairs']} |",
        "",
        "## Recommendation",
        f"Solver: {r['solver']} ({'exact within the candidate set' if r['exact'] else 'approximate'}), "
        f"{r['evaluations']} combinations evaluated in {r['runtime_ms']:.1f} ms.",
        "",
    ]
    for c in analysis["contributions"]:
        lines.append(f"- **{c['id']}** {c['label']} - gain alone {c['alone_gain']:g}, marginal within set {c['marginal_in_set']:g}")
    lines += ["", "## Baselines", "| Method | Selected | Objective | Gain |", "|---|---|---|---|"]
    lines.append(f"| {r['solver']} (StreetMend) | {', '.join(r['selected']) or '-'} | {r['score']:g} | {r['gain']:g} |")
    for b in analysis["baselines"]:
        lines.append(f"| {b['solver']} | {', '.join(b['selected']) or '-'} | {b['score']:g} | {b['gain']:g} |")
    lines += ["", "## Newly connected journeys"]
    if analysis["newly_connected_pairs"]:
        lines += ["| Origin | Destination | Category | Route after (m) |", "|---|---|---|---|"]
        for p in analysis["newly_connected_pairs"]:
            lines.append(f"| {p['origin_label']} | {p['destination_label']} | {p['category']} | {p['after_m']:.0f} |")
    else:
        lines.append("None.")
    lines += ["", "## Explanation"] + [f"- {x}" for x in analysis["explanation"]]
    s = analysis["sensitivity"]
    if s.get("optimal_is_exact", True):
        verdict = (f"exact optimistic optimum {', '.join(s['optimal_selected']) or '-'} "
                   f"({'differs from' if s['recommendation_changes'] else 'matches'} the recommendation)")
    else:
        verdict = (f"best set found by greedy under the optimistic assumption: {', '.join(s['optimal_selected']) or '-'} "
                   "(not an optimum; too many combinations for an exact re-run)")
    lines += ["", "## Sensitivity", f"- {s['assumption']}", f"- Unknown-condition edges: {s['unknown_edge_count']}; {verdict}."]
    if state:
        lines += ["", "## Current map state", f"- Applied repairs: {', '.join(state['applied']) or 'none'}",
                  f"- Objective at current state: {state['metrics']['score']:g}"]
    lines += ["", "## Assumptions"] + [f"- {a}" for a in analysis["assumptions"]]
    lines += ["", "## Provenance"] + [f"- {p.get('name')}: {p.get('url', p.get('description', ''))}" for p in sc.provenance]
    lines += ["", "_Planning estimate from a modeled network. Not an ADA compliance determination, a certified "
              "accessible-route assessment, or an authorization for construction._", ""]
    return "\n".join(lines)
