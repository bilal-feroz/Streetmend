"""Scenario: a pedestrian graph plus the planning problem defined on it."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from streetmend.graph import DestinationCategory, Evidence, Passability, PedGraph


@dataclass
class Origin:
    id: str  # graph node id
    label: str
    weight: float = 1.0
    weight_basis: str = "uniform"  # what the weight represents, stated honestly


@dataclass
class Destination:
    id: str  # graph node id
    label: str
    category: DestinationCategory
    weight: float = 1.0
    evidence: Evidence = Evidence.SYNTHETIC
    source_ids: list[str] = field(default_factory=list)


@dataclass
class Intervention:
    """A candidate repair. Applying it makes ``edge_ids`` traversable."""

    id: str
    label: str
    kind: str  # e.g. install_curb_ramp, reconstruct_curb_ramp
    edge_ids: list[str]
    lon: float
    lat: float
    description: str = ""
    evidence: Evidence = Evidence.SYNTHETIC
    source_ids: list[str] = field(default_factory=list)
    cost_units: int = 1
    attrs: dict[str, Any] = field(default_factory=dict)


@dataclass
class Scenario:
    id: str
    name: str
    mode: Literal["synthetic", "municipal", "hypothetical"]
    description: str
    graph: PedGraph
    origins: list[Origin]
    destinations: list[Destination]
    interventions: dict[str, Intervention]
    max_distance_m: float | None = None
    default_journey: tuple[str, str] | None = None
    context: dict[str, Any] = field(default_factory=dict)  # drawing-only layers
    assumptions: list[str] = field(default_factory=list)
    provenance: list[dict[str, Any]] = field(default_factory=list)
    bounds: tuple[float, float, float, float] | None = None  # west, south, east, north

    def validate(self) -> None:
        g = self.graph
        for o in self.origins:
            if o.id not in g.nodes:
                raise ValueError(f"origin {o.id} not in graph")
            if o.weight < 0:
                raise ValueError(f"origin {o.id} has negative weight")
        for d in self.destinations:
            if d.id not in g.nodes:
                raise ValueError(f"destination {d.id} not in graph")
            if d.weight < 0:
                raise ValueError(f"destination {d.id} has negative weight")
        seen_edges: dict[str, str] = {}
        for iv in self.interventions.values():
            if not iv.edge_ids:
                raise ValueError(f"intervention {iv.id} changes no edges")
            for eid in iv.edge_ids:
                if eid not in g.edges:
                    raise ValueError(f"intervention {iv.id} references unknown edge {eid}")
                if g.edges[eid].state == Passability.TRAVERSABLE:
                    raise ValueError(f"intervention {iv.id} targets already traversable edge {eid}")
                if eid in seen_edges:
                    raise ValueError(f"edge {eid} claimed by {seen_edges[eid]} and {iv.id}")
                seen_edges[eid] = iv.id
        if self.default_journey:
            o, d = self.default_journey
            if o not in {x.id for x in self.origins} or d not in {x.id for x in self.destinations}:
                raise ValueError("default journey must reference an origin and a destination")

    def intervention_for_edge(self) -> dict[str, str]:
        return {eid: iv.id for iv in self.interventions.values() for eid in iv.edge_ids}

    def enabled_edges(self, applied: set[str] | frozenset[str] | list[str]) -> set[str]:
        out: set[str] = set()
        for iid in applied:
            out.update(self.interventions[iid].edge_ids)
        return out
