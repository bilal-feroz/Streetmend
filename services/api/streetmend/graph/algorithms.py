"""Deterministic graph operations on the traversable pedestrian subgraph.

All routes returned here are sequences of real graph edges; their length is
the sum of the lengths of exactly those edges.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from itertools import islice

import networkx as nx

from .model import Edge, Passability, PedGraph


@dataclass
class Route:
    found: bool
    origin: str
    destination: str
    node_ids: list[str] = field(default_factory=list)
    edge_ids: list[str] = field(default_factory=list)
    length_m: float | None = None
    geometry: list[tuple[float, float]] = field(default_factory=list)
    reason: str = ""


def _min_key(g: nx.MultiGraph, u: str, v: str) -> str:
    """Among parallel edges, the shortest (ties broken by id for determinism)."""

    data = g.get_edge_data(u, v)
    return min(data, key=lambda k: (data[k]["weight"], k))


def _simple_view(g: nx.MultiGraph) -> nx.Graph:
    s = nx.Graph()
    s.add_nodes_from(g.nodes)
    for u, v, k, d in g.edges(keys=True, data=True):
        w = d["weight"]
        if not s.has_edge(u, v) or (w, k) < (s[u][v]["weight"], s[u][v]["key"]):
            s.add_edge(u, v, weight=w, key=k)
    return s


def oriented_geometry(edge: Edge, start_node: str) -> list[tuple[float, float]]:
    return list(edge.geometry) if edge.u == start_node else list(reversed(edge.geometry))


def route_from_nodes(pg: PedGraph, g: nx.MultiGraph, nodes: list[str]) -> Route:
    edge_ids: list[str] = []
    geom: list[tuple[float, float]] = []
    total = 0.0
    for a, b in zip(nodes, nodes[1:]):
        k = _min_key(g, a, b)
        e = pg.edges[k]
        edge_ids.append(k)
        total += e.length_m
        seg = oriented_geometry(e, a)
        geom.extend(seg if not geom else seg[1:])
    return Route(
        found=True,
        origin=nodes[0],
        destination=nodes[-1],
        node_ids=list(nodes),
        edge_ids=edge_ids,
        length_m=total,
        geometry=geom,
    )


def shortest_route(
    pg: PedGraph,
    g: nx.MultiGraph,
    origin: str,
    destination: str,
    cutoff_m: float | None = None,
) -> Route:
    """Dijkstra shortest traversable route. Returns found=False when unavailable."""

    if origin not in g or destination not in g:
        return Route(False, origin, destination, reason="node not in graph")
    try:
        length, nodes = nx.single_source_dijkstra(g, origin, destination, weight="weight")
    except nx.NetworkXNoPath:
        return Route(False, origin, destination, reason="no traversable path in the modeled network")
    if cutoff_m is not None and length > cutoff_m + 1e-9:
        r = route_from_nodes(pg, g, nodes)
        r.found = False
        r.reason = f"shortest traversable path is {length:.0f} m, beyond the {cutoff_m:.0f} m access threshold"
        return r
    return route_from_nodes(pg, g, nodes)


def reachable(g: nx.MultiGraph, source: str, cutoff_m: float | None = None) -> dict[str, float]:
    """Network distance (m) from source to every node reachable within cutoff."""

    if source not in g:
        return {}
    return nx.single_source_dijkstra_path_length(g, source, cutoff=cutoff_m, weight="weight")


def reachable_edges(pg: PedGraph, g: nx.MultiGraph, dist: dict[str, float], cutoff_m: float | None) -> dict[str, float]:
    """Traversable edges fully reachable from the source, keyed by the distance
    at which their far end is reached (used to animate a reach wave)."""

    out: dict[str, float] = {}
    for u, v, k in g.edges(keys=True):
        if u in dist and v in dist:
            e = pg.edges[k]
            far = min(dist[u], dist[v]) + e.length_m
            if cutoff_m is None or far <= cutoff_m + 1e-9:
                out[k] = min(dist[u], dist[v])
    return out


def frontier_barriers(pg: PedGraph, reached_nodes: set[str], enabled: set[str]) -> list[str]:
    """Non-traversable edges with at least one endpoint in the reached set.

    These are the barriers that stop the reach wave: blocked or unknown links
    whose repair (or verification) would let the journey continue.
    """

    out = []
    for e in pg.edges.values():
        if e.state == Passability.TRAVERSABLE or e.id in enabled:
            continue
        if e.u in reached_nodes or e.v in reached_nodes:
            out.append(e.id)
    return sorted(out)


def components(g: nx.MultiGraph) -> list[set[str]]:
    comps = [set(c) for c in nx.connected_components(g)]
    comps.sort(key=lambda c: (-len(c), min(c)))
    return comps


def alternative_routes(
    pg: PedGraph,
    g: nx.MultiGraph,
    origin: str,
    destination: str,
    k: int = 3,
    cutoff_m: float | None = None,
) -> list[Route]:
    """Up to k loop-free routes in increasing length order (Yen's algorithm)."""

    if origin not in g or destination not in g or not nx.has_path(g, origin, destination):
        return []
    s = _simple_view(g)
    routes: list[Route] = []
    for nodes in islice(nx.shortest_simple_paths(s, origin, destination, weight="weight"), k):
        r = route_from_nodes(pg, g, nodes)
        if cutoff_m is not None and (r.length_m or math.inf) > cutoff_m + 1e-9:
            break
        routes.append(r)
    return routes
