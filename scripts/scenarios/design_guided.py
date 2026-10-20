"""Design the guided scenario: hypothetical barriers on real Elizabeth streets.

Searches the real Elizabeth corner/crossing graph (all links assumed
traversable) for a crossing on a short home -> Novant Health Presbyterian route
such that, with both of its curb ramps hypothetically blocked (A, B) plus the
fewest extra scenario settings, the engine confirms:
  * the journey is unavailable, with A only, and with B only;
  * A + B reconnects it within the access threshold;
  * exact search selects {A, B} at budget 2 (healthcare priority);
and prefers configurations where a simple baseline does worse.

The chosen configuration is written to data/scenarios/charlotte_guided.json.
Everything it claims is re-verified by tests/test_guided.py.

    uv run --project services/api python scripts/scenarios/design_guided.py
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "api"))

import networkx as nx  # noqa: E402

from streetmend.graph import EdgeKind, NodeKind  # noqa: E402
from streetmend.municipal.scenario import load_municipal_scenario  # noqa: E402
from streetmend.optimize.objective import PRIORITY_PRESETS, Evaluator  # noqa: E402
from streetmend.optimize.solvers import exact_enumeration, greedy  # noqa: E402
from streetmend.scenario.guided import apply_spec, hypothetical_graph  # noqa: E402

OUT = ROOT / "data" / "scenarios" / "charlotte_guided.json"
MAJOR = {"primary", "secondary", "tertiary"}
HEALTH = PRIORITY_PRESETS["healthcare"]


def main() -> None:
    base = load_municipal_scenario("moderate")
    H = hypothetical_graph(base.graph)
    T = next(d.id for d in base.destinations if "Presbyterian" in d.label)
    edges = H.edges

    def graph(skip: set[str]) -> nx.MultiGraph:
        G = nx.MultiGraph()
        G.add_nodes_from(H.nodes)
        for e in edges.values():
            if e.id not in skip:
                G.add_edge(e.u, e.v, key=e.id, weight=e.length_m)
        return G

    def path_edges(G, nodes):
        out = []
        for a, b in zip(nodes, nodes[1:]):
            d = G.get_edge_data(a, b)
            out.append(min(d, key=lambda k: (d[k]["weight"], k)))
        return out

    def ramps_of(x_id: str) -> list[str]:
        x = edges[x_id]
        out = []
        for c in (x.u, x.v):
            out += [e.id for e in H.incident_edges(c) if e.kind == EdgeKind.RAMP]
        return out

    def mid(eid):
        g = edges[eid].geometry
        return g[len(g) // 2]

    G0 = graph(set())
    dist0 = nx.single_source_dijkstra_path_length(G0, T, weight="weight")
    configs = []
    for L in (700.0, 800.0):
        cands = [o for o in base.origins if o.id in dist0 and 0.5 * L <= dist0[o.id] <= 0.95 * L and o.weight >= 2]
        for o in cands:
            _, nodes = nx.single_source_dijkstra(G0, o.id, T, weight="weight")
            P = path_edges(G0, nodes)
            for X in [e for e in P if edges[e].kind == EdgeKind.CROSSING and edges[e].attrs.get("highway") in MAJOR]:
                rA, rB = ramps_of(X)[:2]
                # A = the ramp the journey reaches first.
                first = next(e for e in P if e in (rA, rB))
                A, B = (rA, rB) if first == rA else (rB, rA)
                extras: list[str] = []
                ok = False
                for _ in range(4):
                    G = graph({A, B, *extras})
                    try:
                        length, alt = nx.single_source_dijkstra(G, o.id, T, weight="weight")
                    except nx.NetworkXNoPath:
                        ok = True
                        break
                    if length > L:
                        ok = True
                        break
                    alt_edges = path_edges(G, alt)
                    xs = [e for e in alt_edges if edges[e].kind == EdgeKind.CROSSING and e not in P]
                    if not xs:
                        break
                    same = [e for e in xs if edges[e].attrs.get("leg") == edges[X].attrs.get("leg")]
                    pick = min(same or xs, key=lambda e: math.dist(mid(e), mid(X)))
                    extras.append(pick)
                if ok:
                    configs.append({"L": L, "o": o.id, "X": X, "A": A, "B": B, "extras": extras})
    print(f"{len(configs)} candidate configurations")

    results = []
    for c in configs:
        for soft in (False, True):
            if soft and not c["extras"]:
                continue
            spec = make_spec(base, H, T, c, soft, ramps_of)
            if spec is None:
                continue
            try:
                sc = apply_spec(base, spec)
            except ValueError:
                continue
            r = evaluate(sc, c, spec)
            if r:
                results.append((r["score"], spec, r))
    results.sort(key=lambda t: -t[0])
    for s, spec, r in results[:8]:
        print(round(s, 1), r["summary"])
    if not results:
        raise SystemExit("no configuration satisfied the story checks")
    best = results[0][1]
    best["story"] = results[0][2]["story"]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(best, indent=1), encoding="utf-8")
    print("wrote", OUT)


def make_spec(base, H, T, c, soft, ramps_of):
    edges = H.edges
    X = edges[c["X"]]
    street = X.attrs.get("leg") or "the street"
    inter = X.attrs.get("intersection") or "the intersection"
    barriers = [
        {"edge": c["A"], "candidate": "A", "kind": "install_curb_ramp", "crossing": c["X"], "pair": "B",
         "label": f"Install curb ramp at the {street} crossing, {inter} (near side)",
         "reason": f"Hypothetical: no curb ramp at this end of the {street} crossing (scenario setting, not a survey finding)."},
        {"edge": c["B"], "candidate": "B", "kind": "install_curb_ramp", "crossing": c["X"], "pair": "A",
         "label": f"Install curb ramp at the {street} crossing, {inter} (far side)",
         "reason": f"Hypothetical: no curb ramp at the far end of the {street} crossing (scenario setting, not a survey finding)."},
    ]
    used = {c["A"], c["B"]}
    for i, x in enumerate(c["extras"]):
        xe = edges[x]
        if soft and i == 0:
            r = ramps_of(x)
            if not r:
                return None
            barriers.append({"edge": r[0], "candidate": "C", "kind": "reconstruct_curb_ramp", "crossing": x,
                             "label": f"Reconstruct curb ramp, {xe.attrs.get('leg')} crossing at {xe.attrs.get('intersection')}",
                             "reason": "Hypothetical: damaged curb ramp at one end of this crossing (scenario setting, not a survey finding)."})
            used.add(r[0])
        else:
            barriers.append({"edge": x, "candidate": None,
                             "reason": f"Hypothetical: no usable crossing of {xe.attrs.get('leg')} on this leg (scenario setting)."})
            used.add(x)
    # Decoys: the two ramps closest to the hospital that change no modeled distance.
    tx = (H.nodes[T].lon, H.nodes[T].lat)
    ramps = sorted((e for e in edges.values() if e.kind == EdgeKind.RAMP and e.id not in used),
                   key=lambda e: math.dist(e.geometry[-1], tx))
    letters = iter("DEFG")
    decoys = 0
    for e in ramps[:40]:
        if decoys == 2:
            break
        barriers.append({"edge": e.id, "candidate": next(letters), "kind": "reconstruct_curb_ramp",
                         "label": f"Reconstruct curb ramp, {e.attrs.get('intersection')}",
                         "reason": "Hypothetical: damaged curb ramp (scenario setting, not a survey finding)."})
        decoys += 1
    # Places: homes within the threshold of the hospital, and nearby essential destinations.
    G = nx.MultiGraph()
    G.add_nodes_from(H.nodes)
    for e in edges.values():
        G.add_edge(e.u, e.v, key=e.id, weight=e.length_m)
    dT = nx.single_source_dijkstra_path_length(G, T, cutoff=c["L"] * 1.1, weight="weight")
    origins = sorted([o for o in base.origins if o.id in dT], key=lambda o: (-o.weight, o.id))[:14]
    if c["o"] not in {o.id for o in origins}:
        origins.append(next(o for o in base.origins if o.id == c["o"]))
    dO = nx.single_source_dijkstra_path_length(G, c["o"], cutoff=c["L"] * 1.2, weight="weight")
    near = [d for d in base.destinations if d.id in dO and d.id != T]
    pick = []
    for cat, n in (("healthcare", 2), ("transit", 2), ("education", 1)):
        pick += sorted((d for d in near if d.category.value == cat), key=lambda d: dO[d.id])[:n]
    o_label = next(o.label for o in base.origins if o.id == c["o"])
    return {
        "description": (f"Hypothetical scenario on real Elizabeth streets: residents of {o_label.split(' (')[0].replace('Homes along ', '')} "
                        f"need a step-free route to Novant Health Presbyterian Medical Center. Barrier locations are scenario settings."),
        "max_distance_m": c["L"],
        "default_journey": [c["o"], T],
        "origins": [o.id for o in origins],
        "destinations": [T] + [d.id for d in pick],
        "barriers": barriers,
    }


def evaluate(sc, c, spec):
    from streetmend.graph.algorithms import shortest_route

    def connected(applied):
        g = sc.graph.to_networkx(sc.enabled_edges(applied))
        return shortest_route(sc.graph, g, c["o"], spec["default_journey"][1], sc.max_distance_m)

    if connected([]).found or connected(["A"]).found or connected(["B"]).found or not connected(["A", "B"]).found:
        return None
    ev = Evaluator(sc, HEALTH)
    base = ev.score()
    cands = list(sc.interventions)
    ex2 = exact_enumeration(ev, cands, 2)
    if sorted(ex2.selected) != ["A", "B"]:
        return None
    ex1 = exact_enumeration(ev, cands, 1)
    gr2 = greedy(ev, cands, 2)
    g_ab = ex2.score - base
    g_gr = gr2.score - base
    route = connected(["A", "B"])
    n_extra_hard = sum(1 for b in spec["barriers"] if b["candidate"] is None)
    score = (g_ab - g_gr) + 2 * g_ab / max(1, base) - 3 * n_extra_hard + (4 if "C" in sc.interventions and ex1.selected == ["C"] else 0)
    story = {"route_m": round(route.length_m, 1), "gain_ab": g_ab, "greedy_selected": gr2.selected, "greedy_gain": g_gr,
             "budget1_selected": ex1.selected, "budget1_gain": ex1.score - base, "hard_settings": n_extra_hard}
    return {"score": score, "story": story,
            "summary": f"L={c['L']:.0f} o={sc.graph.nodes[c['o']].label[:40]} X={sc.graph.edges[c['X']].attrs.get('leg')} @ "
                       f"{sc.graph.edges[c['X']].attrs.get('intersection')} | AB +{g_ab:g} vs greedy {gr2.selected} +{g_gr:g} | "
                       f"b1 {ex1.selected} | hard {n_extra_hard} | route {route.length_m:.0f} m"}


if __name__ == "__main__":
    main()
