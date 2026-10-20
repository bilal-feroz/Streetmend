import random

import pytest

from streetmend.graph import (
    DestinationCategory,
    Edge,
    EdgeKind,
    Evidence,
    Node,
    NodeKind,
    Passability,
    PedGraph,
)
from streetmend.scenario.demo import build_demo_scenario
from streetmend.scenario.model import Destination, Intervention, Origin, Scenario


@pytest.fixture(scope="session")
def demo() -> Scenario:
    return build_demo_scenario()


def random_scenario(seed: int, n: int = 6, p_block: float = 0.25, p_unknown: float = 0.08,
                    n_cand: int = 7, cutoff: float | None = 900.0) -> Scenario:
    """A random grid network with random barriers, used for property tests."""

    rng = random.Random(seed)
    g = PedGraph()
    step = 0.001  # ~111 m
    for i in range(n):
        for j in range(n):
            g.add_node(Node(f"n{i}_{j}", NodeKind.CORNER, i * step, j * step))
    blocked = []
    k = 0
    for i in range(n):
        for j in range(n):
            for di, dj in ((1, 0), (0, 1)):
                a, b = i + di, j + dj
                if a >= n or b >= n or rng.random() < 0.1:
                    continue
                r = rng.random()
                state = Passability.BLOCKED if r < p_block else Passability.UNKNOWN if r < p_block + p_unknown else Passability.TRAVERSABLE
                length = 111.0 * (1 + rng.random() * 0.3)
                e = Edge(f"e{k}", f"n{i}_{j}", f"n{a}_{b}", EdgeKind.SIDEWALK, length,
                         [(i * step, j * step), (a * step, b * step)], state, Evidence.SYNTHETIC)
                g.add_edge(e)
                if state == Passability.BLOCKED:
                    blocked.append(e.id)
                k += 1
    rng.shuffle(blocked)
    ivs = {}
    for c, eid in enumerate(sorted(blocked[:n_cand])):
        e = g.edges[eid]
        ivs[f"c{c}"] = Intervention(f"c{c}", f"cand {c}", "reconstruct_curb_ramp", [eid],
                                    e.geometry[0][0], e.geometry[0][1])
    nodes = sorted(g.nodes)
    picks = rng.sample(nodes, 6)
    cats = list(DestinationCategory)
    origins = [Origin(x, x, rng.choice([1.0, 2.0])) for x in picks[:3]]
    dests = [Destination(x, x, cats[t % 3], rng.choice([1.0, 1.5])) for t, x in enumerate(picks[3:])]
    sc = Scenario(f"rand{seed}", "random", "synthetic", "", g, origins, dests, ivs, max_distance_m=cutoff)
    sc.validate()
    return sc
