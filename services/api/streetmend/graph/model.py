"""Pedestrian accessibility graph data model.

The graph is undirected: pedestrians are not bound by vehicle one-way rules.
Every edge carries an explicit passability state and an evidence label so that
uncertain or synthetic information can never silently become "accessible".
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Iterable

import networkx as nx


class NodeKind(str, Enum):
    CORNER = "corner"  # sidewalk junction at a street corner
    CURB = "curb"  # curb-ramp landing / crossing endpoint
    JUNCTION = "junction"  # intermediate sidewalk vertex
    ORIGIN = "origin"  # modeled trip origin (e.g. residential cluster)
    DESTINATION = "destination"  # essential service access point


class EdgeKind(str, Enum):
    SIDEWALK = "sidewalk"
    CROSSING = "crossing"
    RAMP = "ramp"
    ENTRANCE = "entrance"  # facility / origin access connector


class Passability(str, Enum):
    """Modeled passability for a wheelchair user.

    TRAVERSABLE: traversable under the current model assumptions.
    BLOCKED: known barrier (missing ramp, missing sidewalk, failed ramp...).
    UNKNOWN: no reliable evidence either way. Never treated as traversable
             when computing verified/modeled reachability.
    """

    TRAVERSABLE = "traversable"
    BLOCKED = "blocked"
    UNKNOWN = "unknown"


class Evidence(str, Enum):
    SYNTHETIC = "synthetic"  # demonstration scenario, not a real place
    MUNICIPAL_RECORD = "municipal_record"  # attribute from an official record
    MUNICIPAL_HISTORICAL = "municipal_historical"  # official, but survey is dated
    OSM = "osm"  # OpenStreetMap contributors
    INFERRED = "inferred"  # geometric inference by StreetMend
    ASSUMED = "assumed"  # explicit modeling assumption


class DestinationCategory(str, Enum):
    HEALTHCARE = "healthcare"
    TRANSIT = "transit"
    EDUCATION = "education"


@dataclass
class Node:
    id: str
    kind: NodeKind
    lon: float
    lat: float
    label: str = ""
    attrs: dict[str, Any] = field(default_factory=dict)


@dataclass
class Edge:
    id: str
    u: str
    v: str
    kind: EdgeKind
    length_m: float
    geometry: list[tuple[float, float]]  # lon/lat polyline from u to v
    state: Passability
    evidence: Evidence
    source: str = ""
    source_ids: list[str] = field(default_factory=list)
    label: str = ""
    reason: str = ""  # human-readable explanation of the state
    attrs: dict[str, Any] = field(default_factory=dict)


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Great-circle distance in metres between two lon/lat points."""
    lon1, lat1 = map(math.radians, a)
    lon2, lat2 = map(math.radians, b)
    dlon, dlat = lon2 - lon1, lat2 - lat1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * 6_371_008.8 * math.asin(math.sqrt(h))


def polyline_length_m(coords: Iterable[tuple[float, float]]) -> float:
    pts = list(coords)
    return sum(haversine_m(pts[i], pts[i + 1]) for i in range(len(pts) - 1))


class PedGraph:
    """Container for nodes and edges with explicit passability state.

    Multiple parallel edges between the same pair of nodes are allowed (for
    example a sidewalk and an unrelated path); edges are always addressed by id.
    """

    def __init__(self) -> None:
        self.nodes: dict[str, Node] = {}
        self.edges: dict[str, Edge] = {}

    # ---- construction -------------------------------------------------
    def add_node(self, node: Node) -> Node:
        if node.id in self.nodes:
            raise ValueError(f"duplicate node id {node.id}")
        self.nodes[node.id] = node
        return node

    def add_edge(self, edge: Edge) -> Edge:
        if edge.id in self.edges:
            raise ValueError(f"duplicate edge id {edge.id}")
        if edge.u not in self.nodes or edge.v not in self.nodes:
            raise ValueError(f"edge {edge.id} references unknown node")
        if edge.u == edge.v:
            raise ValueError(f"edge {edge.id} is a self-loop")
        if not (edge.length_m > 0 and math.isfinite(edge.length_m)):
            raise ValueError(f"edge {edge.id} has invalid length {edge.length_m}")
        self.edges[edge.id] = edge
        return edge

    # ---- views ---------------------------------------------------------
    def to_networkx(
        self,
        enabled_edges: set[str] | None = None,
        include_unknown: bool = False,
    ) -> nx.MultiGraph:
        """Build the traversable subgraph.

        An edge is included when its state is TRAVERSABLE, or its id is in
        ``enabled_edges`` (edges made traversable by applied interventions), or
        (only for sensitivity analysis) its state is UNKNOWN and
        ``include_unknown`` is set.
        """

        enabled_edges = enabled_edges or set()
        g = nx.MultiGraph()
        g.add_nodes_from(self.nodes)
        for e in self.edges.values():
            ok = (
                e.state == Passability.TRAVERSABLE
                or e.id in enabled_edges
                or (include_unknown and e.state == Passability.UNKNOWN)
            )
            if ok:
                g.add_edge(e.u, e.v, key=e.id, weight=e.length_m)
        return g

    def incident_edges(self, node_id: str) -> list[Edge]:
        return [e for e in self.edges.values() if e.u == node_id or e.v == node_id]

    def copy(self) -> "PedGraph":
        import copy

        return copy.deepcopy(self)
