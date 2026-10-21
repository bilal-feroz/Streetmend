"""Typed, validated infrastructure changes.

A change is an operation on the modeled network, not an annotation: applying
it produces a new network state (the baseline is never mutated) in which
reachability and routing are recomputed. Proposals (what the planner wants to
do) and mitigations (what fixes a broken requirement) are both lists of changes
or catalog interventions.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Literal

from streetmend.graph import Edge, EdgeKind, Evidence, Passability, PedGraph
from streetmend.scenario.model import Scenario

ChangeOp = Literal["close", "reopen"]

# What each operation may target, and what it does.
_TARGETS: dict[str, set[EdgeKind]] = {
    "close": {EdgeKind.SIDEWALK, EdgeKind.CROSSING, EdgeKind.RAMP},
    "reopen": {EdgeKind.SIDEWALK, EdgeKind.CROSSING, EdgeKind.RAMP},
}


class ChangeError(ValueError):
    pass


@dataclass(frozen=True)
class Change:
    """One operation on one edge of the modeled network.

    close  : the edge becomes unusable for every travel profile (construction,
             closure, removed connection). Recorded as barrier "closure".
    reopen : a closed or blocked edge becomes usable for every profile
             (restored segment, temporary connection on an existing alignment).
    """

    id: str
    op: ChangeOp
    edge_id: str
    label: str = ""
    reason: str = ""
    temporary: bool = True
    hypothetical: bool = True


@dataclass
class ChangeSet:
    changes: list[Change] = field(default_factory=list)

    def ids(self) -> list[str]:
        return [c.id for c in self.changes]


def validate(sc: Scenario, changes: list[Change]) -> None:
    seen: set[str] = set()
    for c in changes:
        if c.op not in _TARGETS:
            raise ChangeError(f"change {c.id}: unknown operation '{c.op}'")
        e = sc.graph.edges.get(c.edge_id)
        if e is None:
            raise ChangeError(f"change {c.id}: unknown edge '{c.edge_id}'")
        if e.kind not in _TARGETS[c.op]:
            raise ChangeError(f"change {c.id}: cannot {c.op} a {e.kind.value} edge")
        if c.edge_id in seen:
            raise ChangeError(f"edge {c.edge_id} is changed twice")
        seen.add(c.edge_id)
        if c.op == "reopen" and e.state == Passability.TRAVERSABLE:
            raise ChangeError(f"change {c.id}: edge {c.edge_id} is already open")


def apply_changes(sc: Scenario, changes: list[Change]) -> Scenario:
    """A new scenario whose graph reflects the changes. Nodes are shared, edges copied on write."""

    if not changes:
        return sc
    validate(sc, changes)
    g = PedGraph()
    g.nodes = sc.graph.nodes
    g.edges = dict(sc.graph.edges)
    for c in changes:
        e: Edge = g.edges[c.edge_id]
        if c.op == "close":
            attrs = {**e.attrs, "barrier": "closure", "change": c.id, "change_label": c.label, "proposed": c.hypothetical}
            g.edges[c.edge_id] = replace(e, state=Passability.BLOCKED, evidence=Evidence.ASSUMED, reason=c.reason or f"Proposed change: {c.label}", attrs=attrs)
        else:  # reopen
            attrs = {**{k: v for k, v in e.attrs.items() if k != "barrier"}, "change": c.id, "change_label": c.label, "proposed": c.hypothetical}
            g.edges[c.edge_id] = replace(e, state=Passability.TRAVERSABLE, evidence=Evidence.ASSUMED, reason=c.reason or f"Proposed change: {c.label}", attrs=attrs)
    return replace(sc, graph=g)
