"""Assistant: interpret -> validate -> execute an allowlisted engine operation.

Interpretation order: deterministic rules first (instant, offline); if the
rules do not recognise the request and the local model is available, the
model proposes an intent, which is validated against the same schema. Every
number in a response comes from the engine.
"""

from __future__ import annotations

import re
import time
from typing import Any

from pydantic import ValidationError

from streetmend.graph import haversine_m
from streetmend.optimize.analysis import AnalysisParams, analyze
from streetmend.optimize.objective import PRIORITY_PRESETS, CategoryWeights, Evaluator
from streetmend.scenario.evaluate import evaluate_state
from streetmend.scenario.model import Scenario

from . import llm, rules
from .intents import Intent

SUPPORTED_HELP = (
    "I can: find the best repairs for a budget and priority, explain the recommendation, compare budgets, "
    "compare priorities, list journeys that remain disconnected, compare repairs near a destination type, "
    "apply a repair by id, undo, reset, or show the selected route."
)


def interpret(text: str, known_ids: set[str], use_llm: bool) -> tuple[Intent | None, dict[str, Any]]:
    t0 = time.perf_counter()
    intent = rules.parse(text, known_ids)
    if intent is not None:
        return intent, {"source": "rules", "latency_ms": round((time.perf_counter() - t0) * 1000, 2)}
    status = llm.llm_status()
    if use_llm and status.get("available"):
        intent, meta = llm.interpret(text)
        if intent is not None and intent.operation == "apply_repair" and intent.intervention_id not in known_ids:
            return Intent(operation="unsupported"), {"source": "llm", **meta,
                                                     "error": f"unknown intervention id '{intent.intervention_id}'"}
        if intent is not None:
            return intent, {"source": "llm", **meta}
        return None, {"source": "llm", **meta}
    reason = "not recognised by the rule parser" + ("" if use_llm else "; local model disabled") + (
        "" if status.get("available") or not use_llm else f"; local model unavailable ({status.get('detail', '')})")
    return None, {"source": "rules", "error": reason}


def _w(weights: CategoryWeights, priority: str | None) -> CategoryWeights:
    return PRIORITY_PRESETS[priority] if priority else weights


def _summ(a: dict) -> dict:
    r = a["recommendation"]
    return {"selected": r["selected"], "selected_labels": r["selected_labels"], "gain": a["objective"]["gain"],
            "after": a["objective"]["after"], "exact": r["exact"], "solver": r["solver"],
            "connected_pairs_after": a["objective"]["connected_pairs_after"]}


def execute(sc: Scenario, intent: Intent, applied: list[str], budget: int, weights: CategoryWeights,
            cutoff_m: float | None = None, journey: tuple[str, str] | None = None) -> dict[str, Any]:
    op = intent.operation
    if op == "unsupported":
        return {"facts": ["That request is outside the supported planning operations.", SUPPORTED_HELP], "result": None}

    if op in ("optimize_repairs", "explain_recommendation"):
        b = intent.budget if intent.budget is not None else budget
        w = _w(weights, intent.priority)
        a = analyze(sc, AnalysisParams(budget=b, weights=w, cutoff_m=cutoff_m))
        facts = list(a["explanation"])
        if op == "explain_recommendation":
            for c in a["contributions"]:
                facts.append(f"{c['id']} ({c['label']}): gain on its own {c['alone_gain']:g}; "
                             f"removing it from the set loses {c['marginal_in_set']:g}.")
        return {"facts": facts, "result": {"analysis": a}, "client_action": {"type": "show_analysis", "budget": b, "weights": w.as_dict()}}

    if op == "compare_budgets":
        nb = intent.budget if intent.budget is not None else max(0, budget - 1)
        cur = analyze(sc, AnalysisParams(budget=budget, weights=weights, cutoff_m=cutoff_m))
        alt = analyze(sc, AnalysisParams(budget=nb, weights=weights, cutoff_m=cutoff_m))
        cs, as_ = _summ(cur), _summ(alt)
        facts = [
            f"With {budget} repair(s): {', '.join(cs['selected']) or 'none'} for a gain of {cs['gain']:g}.",
            f"With {nb} repair(s): {', '.join(as_['selected']) or 'none'} for a gain of {as_['gain']:g}.",
        ]
        if set(as_["selected"]) - set(cs["selected"]):
            facts.append("The optimal set is not a subset of the larger-budget optimum: the best choice depends on the budget.")
        return {"facts": facts, "result": {"current": cs, "alternative": as_, "budgets": [budget, nb]},
                "client_action": {"type": "set_budget_preview", "budget": nb}}

    if op == "compare_priorities":
        pr = intent.priority or "balanced"
        cur = analyze(sc, AnalysisParams(budget=budget, weights=weights, cutoff_m=cutoff_m))
        alt = analyze(sc, AnalysisParams(budget=budget, weights=PRIORITY_PRESETS[pr], cutoff_m=cutoff_m))
        cs, as_ = _summ(cur), _summ(alt)
        same = sorted(cs["selected"]) == sorted(as_["selected"])
        facts = [
            f"Current weights select {', '.join(cs['selected']) or 'none'}.",
            f"Prioritising {pr} selects {', '.join(as_['selected']) or 'none'}.",
            "The recommendation does not change." if same else "The recommendation changes with the priority.",
        ]
        return {"facts": facts, "result": {"current": cs, "alternative": as_, "priority": pr},
                "client_action": {"type": "set_priority_preview", "priority": pr}}

    if op == "show_disconnected":
        st = evaluate_state(sc, applied, weights=weights, cutoff_m=cutoff_m)
        labels = {d.id: d.label for d in sc.destinations}
        olabels = {o.id: o.label for o in sc.origins}
        missing = []
        for row in st["per_origin"]:
            for d, dist in row["distances_m"].items():
                if dist is None:
                    missing.append({"origin": row["origin"], "origin_label": olabels[row["origin"]], "destination": d,
                                    "destination_label": labels[d]})
        facts = [f"{len(missing)} of {st['metrics']['total_pairs']} origin-destination pairs are not reachable "
                 f"within {st['metrics']['cutoff_m']:g} m in the current modeled network."]
        facts += [f"{m['origin_label']} -> {m['destination_label']}" for m in missing[:8]]
        if len(missing) > 8:
            facts.append(f"...and {len(missing) - 8} more.")
        return {"facts": facts, "result": {"disconnected": missing}, "client_action": {"type": "highlight_disconnected"}}

    if op == "candidates_near":
        cat = intent.category or "transit"
        targets = [d for d in sc.destinations if d.category.value == cat]
        ev = Evaluator(sc, weights, cutoff_m=cutoff_m)
        base = ev.score()
        rows = []
        for iv in sc.interventions.values():
            dist = min((haversine_m((iv.lon, iv.lat), (sc.graph.nodes[d.id].lon, sc.graph.nodes[d.id].lat)) for d in targets), default=None)
            rows.append({"id": iv.id, "label": iv.label, "distance_m": None if dist is None else round(dist, 1),
                         "alone_gain": round(ev.score([iv.id]) - base, 6)})
        rows.sort(key=lambda r: (r["distance_m"] if r["distance_m"] is not None else 1e12, r["id"]))
        rows = rows[:6]
        facts = [f"Candidates nearest to {cat} destinations (straight-line), with their stand-alone gain:"]
        facts += [f"{r['id']} {r['label']}: {r['distance_m']:.0f} m away, gain alone {r['alone_gain']:g}" for r in rows if r["distance_m"] is not None]
        if rows and all(r["alone_gain"] == 0 for r in rows[:2]):
            facts.append("Proximity alone does not predict value: the closest barriers add nothing on their own.")
        return {"facts": facts, "result": {"candidates": rows, "category": cat}, "client_action": {"type": "highlight_candidates", "ids": [r["id"] for r in rows]}}

    if op == "apply_repair":
        iid = intent.intervention_id
        if iid not in sc.interventions:
            return {"facts": [f"Unknown repair id '{iid}'."], "result": None}
        new = applied + ([iid] if iid not in applied else [])
        st = evaluate_state(sc, new, *(journey or sc.default_journey or (None, None)), weights=weights, cutoff_m=cutoff_m)
        found = st["journey"]["route"]["found"] if st["journey"] else None
        facts = [f"Applied {iid} ({sc.interventions[iid].label}).",
                 f"Objective is now {st['metrics']['score']:g}; {st['metrics']['connected_pairs']} of {st['metrics']['total_pairs']} pairs connected."]
        if found is not None:
            facts.append("The selected journey is now connected." if found else "The selected journey is still not connected.")
        return {"facts": facts, "result": {"applied": new}, "client_action": {"type": "apply", "id": iid}}

    if op == "undo":
        return {"facts": ["Undoing the last repair."], "result": None, "client_action": {"type": "undo"}}
    if op == "reset":
        return {"facts": ["Resetting all repairs to the original network."], "result": None, "client_action": {"type": "reset"}}
    if op == "show_route":
        return {"facts": ["Showing the selected journey on the map."], "result": None, "client_action": {"type": "show_route"}}
    return {"facts": [SUPPORTED_HELP], "result": None}


def handle(sc: Scenario, text: str, applied: list[str], budget: int, weights: CategoryWeights, use_llm: bool,
           cutoff_m: float | None = None, journey: tuple[str, str] | None = None) -> dict[str, Any]:
    try:
        intent, meta = interpret(text, set(sc.interventions), use_llm)
    except ValidationError as exc:  # defensive: an out-of-range argument is never a server error
        intent, meta = None, {"source": "rules", "error": f"request arguments out of range ({exc.error_count()} error(s))"}
    if intent is None:
        return {"ok": False, "interpretation": {**meta, "intent": None}, "operation": None,
                "facts": ["I could not map that request to a supported operation.", SUPPORTED_HELP],
                "result": None, "client_action": None, "narrative": None}
    out = execute(sc, intent, applied, budget, weights, cutoff_m, journey)
    asked = [int(x) for x in re.findall(r"(?<![\w.])(\d+)(?![\w])", text)]
    if intent.budget == rules.MAX_BUDGET and any(x > rules.MAX_BUDGET for x in asked):
        out["facts"] = [f"Budget capped at {rules.MAX_BUDGET} repairs (interactive limit)."] + out["facts"]
    narrative, nmeta = None, None
    if use_llm and intent.operation in ("explain_recommendation",) and llm.llm_status().get("available"):
        narrative, nmeta = llm.narrate(out["facts"])
    return {"ok": intent.operation != "unsupported", "interpretation": {**meta, "intent": intent.model_dump()},
            "operation": intent.operation, "facts": out["facts"], "result": out.get("result"),
            "client_action": out.get("client_action"), "narrative": narrative, "narration": nmeta}
