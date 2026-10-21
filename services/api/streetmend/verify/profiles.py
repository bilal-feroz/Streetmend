"""Travel profiles: the same street network, different requirements.

STEP_FREE  : needs a continuous step-free path. A ramp edge is usable only when
             it is traversable (or repaired); a missing or failed curb ramp is a
             barrier. This is the profile the original StreetMend model encodes.
PEDESTRIAN : an ambulatory pedestrian can step down a curb, so a missing or
             failed curb ramp does not stop them (it is recorded as a "curb
             step" on their route). Closures, missing sidewalks and crossings
             with no usable crossing stop them too.

Unknown edges are excluded under the conservative policy and included under the
optimistic one; checks compare both, so unknown data can make a result
INCONCLUSIVE but never silently PASS.
"""

from __future__ import annotations

from enum import Enum

import networkx as nx

from streetmend.graph import EdgeKind, Passability, PedGraph


class Profile(str, Enum):
    STEP_FREE = "step_free"
    PEDESTRIAN = "pedestrian"


PROFILE_LABEL = {Profile.STEP_FREE: "step-free", Profile.PEDESTRIAN: "walking"}

# Barriers a walking pedestrian can pass (a curb without a usable ramp).
_STEPPABLE = {"missing_ramp", "failed_ramp", None}


def is_curb_step(e) -> bool:
    """A blocked ramp edge that a walking pedestrian can still use (by stepping a curb)."""

    return e.kind == EdgeKind.RAMP and e.state == Passability.BLOCKED and e.attrs.get("barrier") in _STEPPABLE


def usable(e, enabled: set[str], profile: Profile, include_unknown: bool) -> bool:
    if e.state == Passability.TRAVERSABLE or e.id in enabled:
        return True
    if include_unknown and e.state == Passability.UNKNOWN:
        return True
    return profile == Profile.PEDESTRIAN and is_curb_step(e)


def profile_graph(pg: PedGraph, enabled: set[str], profile: Profile, include_unknown: bool) -> nx.MultiGraph:
    g = nx.MultiGraph()
    g.add_nodes_from(pg.nodes)
    for e in pg.edges.values():
        if usable(e, enabled, profile, include_unknown):
            g.add_edge(e.u, e.v, key=e.id, weight=e.length_m)
    return g
