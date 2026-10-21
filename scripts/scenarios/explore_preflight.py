"""How the preflight scenario was chosen: close the East 7th Street crossing on the
Hawthorne Lane -> Novant Health Presbyterian step-free route and list the detours the
real Elizabeth graph offers, closing each found crossing in turn. The spec in
data/scenarios/charlotte_preflight.json uses the first detour (the other East 7th
Street crossing at the same intersection) as the crossing with missing ramps, and the
next two (East 7th Street at Park Drive) as legs with no usable crossing, so the
step-free detour exceeds the threshold. tests/test_verify.py re-verifies every claim.

    uv run --project services/api python scripts/scenarios/explore_preflight.py
"""
import sys, math
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "services" / "api"))
import networkx as nx
from streetmend.graph import EdgeKind
from streetmend.municipal.scenario import load_municipal_scenario
from streetmend.scenario.guided import hypothetical_graph
base = load_municipal_scenario('moderate')
H = hypothetical_graph(base.graph)
E = H.edges
T = next(d.id for d in base.destinations if 'Presbyterian' in d.label)
O = 'O:S:300:R'
C1 = 'X:172578423:1'
def G(skip=set(), steps_ok=set()):
    g = nx.MultiGraph(); g.add_nodes_from(H.nodes)
    for e in E.values():
        if e.id in skip: continue
        g.add_edge(e.u, e.v, key=e.id, weight=e.length_m)
    return g
def route(g):
    try:
        L, nodes = nx.single_source_dijkstra(g, O, T, weight='weight')
    except nx.NetworkXNoPath:
        return None, []
    es = []
    for a, b in zip(nodes, nodes[1:]):
        d = g.get_edge_data(a, b); es.append(min(d, key=lambda k: (d[k]['weight'], k)))
    return L, es
def ramps_of(x):
    xe = E[x]; return [e.id for c in (xe.u, xe.v) for e in H.incident_edges(c) if e.kind == EdgeKind.RAMP]
L0, P0 = route(G())
print('baseline', round(L0,1), 'uses C1', C1 in P0, [ (e, E[e].attrs.get('leg')) for e in P0 if E[e].kind==EdgeKind.CROSSING])
blocked = {C1}
for it in range(6):
    L, P = route(G(blocked))
    xs = [e for e in P if E[e].kind == EdgeKind.CROSSING]
    print(f'iter {it}: closed {sorted(blocked)} -> {None if L is None else round(L,1)} m; crossings', [(e, E[e].attrs.get('leg'), E[e].attrs.get('intersection')) for e in xs])
    if L is None or L > 1400: break
    # block the crossing of a major street on this path closest to C1
    maj = [e for e in xs if E[e].attrs.get('highway') in ('primary','secondary','tertiary')]
    if not maj: break
    pick = min(maj, key=lambda e: math.dist(E[e].geometry[len(E[e].geometry)//2], E[C1].geometry[0]))
    print('   ramps of pick', pick, ramps_of(pick))
    blocked.add(pick)
