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
    "I can: find access gaps for a service category, diagnose why access is poor, compare repairing the network with "
    "a new facility, compare straight-line and network distance, find the links whose closure would disconnect the most "
    "journeys, explain why a change check failed, find the best repairs for a budget and priority, explain the "
    "recommendation, compare budgets or priorities, list disconnected journeys, apply a repair by id, undo or reset."
)
CAT_LABEL = {"healthcare": "healthcare", "education": "education", "grocery": "grocery", "transit": "public transport", "parks": "parks",
             "services": "essential services"}


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


def _profile(intent: Intent):
    from streetmend.verify.profiles import Profile

    return Profile(intent.profile or "step_free")


def _access(intent: Intent, cell: str | None) -> dict[str, Any]:
    """Access gaps, diagnosis, fix-or-build and network-vs-straight-line on the real Elizabeth records."""

    import numpy as np

    from streetmend.access.analysis import THRESHOLD_M, analyze, diagnose, home_status, municipal_model
    from streetmend.access.intervene import compare

    m = municipal_model("moderate")
    prof = _profile(intent)
    pl = "step-free" if prof.value == "step_free" else "walking"
    op = intent.operation
    cat = intent.category or "healthcare"
    T = THRESHOLD_M[cat]
    a = analyze(m, cat, prof)
    target = cell if cell and any(c["id"] == cell for c in a["cells"]) else (a["ranking"][0] if a["ranking"] else None)
    if op == "identify_access_gaps":
        s = a["summary"]
        facts = [f"{CAT_LABEL[cat].capitalize()} within {T:.0f} m ({pl}, along the modeled network): {s['served']} of {s['homes']} homes reach it "
                 f"on links of known condition, {s['uncertain']} only if links of unknown condition are passable, and {s['failing']} do not."]
        for c in [x for x in a["cells"] if x["unmet_homes"] > 0][:3]:
            facts.append(f"Cell {c['id']}: {c['unmet_homes']} of {c['homes']} homes fail; main cause: {c['primary_factor'].replace('_', ' ')}.")
        if not a["ranking"]:
            facts.append("No cell has homes that fail outright; the remaining gaps are unknown data, not confirmed barriers.")
        return {"facts": facts, "result": {"summary": s, "ranking": a["ranking"][:5]},
                "client_action": {"type": "show_access", "category": cat, "profile": prof.value, "cell": target}}
    if op == "diagnose_access":
        if target is None:
            return {"facts": [f"No cell fails {CAT_LABEL[cat]} access outright under the {pl} profile."], "result": None}
        d = diagnose(m, target, cat, prof)
        r = d["representative"]
        net = r["step_free_possible_m"] if prof.value == "step_free" else r["walking_possible_m"]
        if r["straight_m"] is None:
            facts = [d["sentence"], f"No {CAT_LABEL[cat]} facility lies inside the modeled network; the nearest is outside it "
                     f"({r['straight_outside_m'] or 'none'}{' m' if r['straight_outside_m'] else ''} in a straight line)."]
        else:
            facts = [d["sentence"], f"Typical home in cell {target}: {r['straight_m']} m in a straight line to the nearest routable facility; "
                     f"{pl} network {str(net) + ' m' if net else 'no route'}; with every modeled link open {str(r['physical_m']) + ' m' if r['physical_m'] else 'no route'}."]
        if r["barriers"]:
            facts.append("Recorded barriers on the shortest physical route: " + "; ".join(f"{b['id']} ({b['reason']})" for b in r["barriers"][:3]) + ".")
        if r["unknown_count"]:
            facts.append(f"{r['unknown_count']} links of unknown condition lie on the best route.")
        return {"facts": facts, "result": {"diagnosis": d}, "client_action": {"type": "show_access", "category": cat, "profile": prof.value, "cell": target}}
    if op == "compare_interventions":
        if target is None:
            return {"facts": [f"No cell fails {CAT_LABEL[cat]} access outright, so there is nothing to compare."], "result": None}
        c = compare(m, cat, [target], prof, "possible", intent.budget or 2)
        facts = [c["why"]]
        if c["fix"]["status"] == "found":
            facts.append("Repairs: " + "; ".join(f"{x['label']} (alone +{x['alone_gain']})" for x in c["fix"]["repairs"]) + ".")
        if c["build"]["status"] == "found":
            facts.append(f"Best site: {c['build']['site']['label']} (+{c['build']['gain']}). The site is hypothetical; land, zoning and cost are not assessed.")
        facts.append("Costs are not compared.")
        return {"facts": facts, "result": {"compare": c},
                "client_action": {"type": "show_compare", "category": cat, "profile": prof.value, "cell": target, "budget": intent.budget or 2}}
    rows = []  # network_vs_straight
    for c in ([cat] if intent.category else ["healthcare", "education", "transit", "parks"]):
        st = home_status(m, c, prof)
        s_, d_ = st["straight"], st["possible"]
        ok = np.isfinite(s_) & np.isfinite(d_) & (s_ > 1)
        ratio = float(np.median(d_[ok] / s_[ok])) if ok.any() else None
        over = int(np.sum((s_ <= THRESHOLD_M[c]) & ~(d_ <= THRESHOLD_M[c])))
        rows.append({"category": c, "median_ratio": None if ratio is None else round(ratio, 2), "overstated": over})
    facts = [f"{CAT_LABEL[r['category']].capitalize()}: the {pl} network route is a median {r['median_ratio']} times the straight-line distance; "
             f"straight-line distance would wrongly place {r['overstated']} homes within reach." for r in rows if r["median_ratio"] is not None]
    return {"facts": facts or ["No routable facilities for that category in the modeled network."], "result": {"rows": rows}, "client_action": None}


def _critical_links(sc: Scenario, intent: Intent, cutoff_m: float | None, top: int = 5, pool: int = 30) -> dict[str, Any]:
    """Which single closures would disconnect the most modeled journeys (step-free unless asked)."""

    from collections import Counter

    from streetmend.verify import Change, NetworkState, apply_changes

    prof = _profile(intent)
    m = cutoff_m or sc.max_distance_m or 800.0
    base = NetworkState(sc, [], "baseline")
    use: Counter = Counter()
    pairs = 0
    for o in sc.origins:
        dist = base.dist_from(o.id, prof, False, m)
        for d in sc.destinations:
            if dist.get(d.id, 1e18) <= m:
                pairs += 1
                use.update(e for e in base.route(o.id, d.id, prof, False, m).edge_ids if sc.graph.edges[e].kind.value in ("sidewalk", "crossing"))
    cand = use.most_common(pool)
    rows = []
    for eid, n in cand:
        st = NetworkState(apply_changes(sc, [Change("q", "close", eid, "what-if closure")]), [], "q")
        kept = sum(1 for o in sc.origins for d in sc.destinations
                   if base.dist_from(o.id, prof, False, m).get(d.id, 1e18) <= m and st.dist_from(o.id, prof, False, m).get(d.id, 1e18) <= m)
        e = sc.graph.edges[eid]
        rows.append({"edge": eid, "label": e.label or eid, "kind": e.kind.value, "routes_using": n, "lost": pairs - kept})
    rows.sort(key=lambda r: (-r["lost"], -r["routes_using"], r["edge"]))
    rows = [r for r in rows if r["lost"] > 0][:top]
    pl = "step-free" if prof.value == "step_free" else "walking"
    facts = [f"Closing one link at a time (the {len(cand)} links most used by today's {pl} routes; {pairs} journeys within {m:.0f} m):"]
    facts += [f"{r['label']} ({r['kind']}, {r['edge']}): {r['lost']} journeys lost." for r in rows]
    if not rows:
        facts.append("No single closure among them disconnects a journey: every one has an alternative within the threshold.")
    return {"facts": facts, "result": {"links": rows, "pairs": pairs}, "client_action": {"type": "highlight_edges", "ids": [r["edge"] for r in rows]}}


def _verification(sc: Scenario, changes: list, mitigations: list[str], journey) -> dict[str, Any]:
    from streetmend.verify import verify
    from streetmend.verify.defaults import default_requirements

    if not changes:
        return {"facts": ["No proposed change is under test. Propose a change and run the access checks first."], "result": None}
    o, d = journey or sc.default_journey or (None, None)
    v = verify(sc, changes, mitigations, default_requirements(sc, o, d), (o, d) if o and d else None)
    st = v["fixed"] or v["proposed"]
    s = st["summary"]
    facts = [f"{'With the mitigations' if v['fixed'] else 'On the proposed network'}: {s['PASS']} checks pass, {s['FAIL']} fail, {s['INCONCLUSIVE']} inconclusive."]
    for c in st["checks"]:
        if c["status"] != "PASS":
            facts.append(f"{c['id']} {c['label']}: {c['status']} ({c['value']}). " + ((c.get("counterexample") or {}).get("summary") or c["detail"]))
    return {"facts": facts, "result": {"verify": {"summary": s, "regressions": st["regressions"]}}, "client_action": None}


def _closure_impact(sc: Scenario, intent: Intent, changes: list, cutoff_m: float | None) -> dict[str, Any]:
    from streetmend.verify import NetworkState, apply_changes

    if not changes:
        return {"facts": ["No proposed change is under test. Propose a change first."], "result": None}
    prof = _profile(intent)
    m = cutoff_m or sc.max_distance_m or 800.0
    base = NetworkState(sc, [], "b")
    st = NetworkState(apply_changes(sc, changes), [], "p")
    lost = []
    for dst in sc.destinations:
        if intent.category and dst.category.value != intent.category:
            continue
        before = [o for o in sc.origins if base.dist_from(o.id, prof, False, m).get(dst.id, 1e18) <= m]
        after = [o for o in before if st.dist_from(o.id, prof, False, m).get(dst.id, 1e18) <= m]
        if len(after) < len(before):
            lost.append({"destination": dst.id, "label": dst.label, "category": dst.category.value, "origins_lost": len(before) - len(after),
                         "origins_before": len(before)})
    pl = "step-free" if prof.value == "step_free" else "walking"
    what = (f"{CAT_LABEL.get(intent.category, '')} " if intent.category else "") + ("destination" if len(lost) == 1 else "destinations")
    facts = [f"After the proposed change, {len(lost)} {what} {'loses' if len(lost) == 1 else 'lose'} {pl} access from at least one modeled origin (within {m:.0f} m)."]
    facts += [f"{x['label']}: {x['origins_lost']} of {x['origins_before']} origins lose it." for x in lost[:6]]
    return {"facts": facts, "result": {"lost": lost}, "client_action": None}


def _fix_for_proposal(sc: Scenario, changes: list, journey) -> dict[str, Any]:
    from streetmend.verify import synthesize
    from streetmend.verify.defaults import default_requirements

    o, d = journey or sc.default_journey
    fx = synthesize(sc, changes, default_requirements(sc, o, d), (o, d))
    if fx["status"] != "found":
        return {"facts": [f"No mitigation in the catalog restores the regressed checks (status: {fx['status'].replace('_', ' ')})."], "result": {"fix": fx["status"]}}
    facts = [f"The smallest fix is {' + '.join(fx['interventions'])}: " + "; ".join(sc.interventions[i].label for i in fx["interventions"]) + ".",
             f"The graph engine tested {fx['evaluated']} candidate sets; every regressed check passes with this one."]
    facts += [f"{s['id']} alone {'resolves' if s['resolves'] else 'does not resolve'} the regression." for s in fx["members_alone"]]
    return {"facts": facts, "result": {"fix": {k: fx[k] for k in ("status", "interventions", "evaluated", "size")}}, "client_action": {"type": "find_fix"}}


def execute(sc: Scenario, intent: Intent, applied: list[str], budget: int, weights: CategoryWeights,
            cutoff_m: float | None = None, journey: tuple[str, str] | None = None, changes: list | None = None,
            mitigations: list[str] | None = None, cell: str | None = None) -> dict[str, Any]:
    op = intent.operation
    changes = changes or []
    if op == "unsupported":
        return {"facts": ["That request is outside the supported planning operations.", SUPPORTED_HELP], "result": None}
    if op in ("identify_access_gaps", "diagnose_access", "compare_interventions", "network_vs_straight"):
        return _access(intent, cell)
    if op == "critical_links":
        return _critical_links(sc, intent, cutoff_m)
    if op == "closure_impact":
        return _closure_impact(sc, intent, changes, cutoff_m)
    if op == "explain_verification" or (op == "show_evidence" and changes):
        return _verification(sc, changes, mitigations or [], journey)
    if op == "show_evidence":
        op = "explain_recommendation"
    if op == "optimize_repairs" and changes and sc.context.get("verify"):
        return _fix_for_proposal(sc, changes, journey)

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
           cutoff_m: float | None = None, journey: tuple[str, str] | None = None, changes: list | None = None,
           mitigations: list[str] | None = None, cell: str | None = None) -> dict[str, Any]:
    try:
        intent, meta = interpret(text, set(sc.interventions), use_llm)
    except ValidationError as exc:  # defensive: an out-of-range argument is never a server error
        intent, meta = None, {"source": "rules", "error": f"request arguments out of range ({exc.error_count()} error(s))"}
    if intent is None:
        return {"ok": False, "interpretation": {**meta, "intent": None}, "operation": None,
                "facts": ["I could not map that request to a supported operation.", SUPPORTED_HELP],
                "result": None, "client_action": None, "narrative": None}
    out = execute(sc, intent, applied, budget, weights, cutoff_m, journey, changes, mitigations, cell)
    asked = [int(x) for x in re.findall(r"(?<![\w.])(\d+)(?![\w])", text)]
    if intent.budget == rules.MAX_BUDGET and any(x > rules.MAX_BUDGET for x in asked):
        out["facts"] = [f"Budget capped at {rules.MAX_BUDGET} repairs (interactive limit)."] + out["facts"]
    narrative, nmeta = None, None
    if use_llm and intent.operation in ("explain_recommendation", "explain_verification") and llm.llm_status().get("available"):
        narrative, nmeta = llm.narrate(out["facts"])
    return {"ok": intent.operation != "unsupported", "interpretation": {**meta, "intent": intent.model_dump()},
            "operation": intent.operation, "facts": out["facts"], "result": out.get("result"),
            "client_action": out.get("client_action"), "narrative": narrative, "narration": nmeta}
