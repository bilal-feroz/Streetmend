"""Guided scenario: hypothetical barrier states on real Charlotte streets.

Geometry and places are real. They come from the Elizabeth candidate graph
(OpenStreetMap centerlines, CDOT-derived corner/crossing topology, OSM
destinations, CATS stops). Passability is hypothetical: every modeled link is
assumed traversable except the barriers listed in the scenario spec
(data/scenarios/charlotte_guided.json). Those barriers are scenario settings
chosen to demonstrate the combined-repair problem. They are NOT survey findings
and NOT claims about conditions at those locations.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from streetmend.graph import Edge, EdgeKind, Evidence, Passability, PedGraph
from streetmend.scenario.model import Intervention, Scenario

HYPOTHETICAL_REASON = "Hypothetical scenario: assumed traversable (scenario setting, not a survey finding)."


def hypothetical_graph(real: PedGraph) -> PedGraph:
    """Same nodes and edge geometry, with every edge assumed traversable."""

    g = PedGraph()
    for n in real.nodes.values():
        g.add_node(n)
    for e in real.edges.values():
        g.add_edge(Edge(e.id, e.u, e.v, e.kind, e.length_m, e.geometry, Passability.TRAVERSABLE, Evidence.ASSUMED,
                        "hypothetical-scenario", list(e.source_ids), e.label, HYPOTHETICAL_REASON, dict(e.attrs)))
    return g


def apply_spec(base: Scenario, spec: dict[str, Any]) -> Scenario:
    """Build the guided scenario from the real geometry scenario and a barrier spec."""

    g = hypothetical_graph(base.graph)
    interventions: dict[str, Intervention] = {}
    for b in spec["barriers"]:
        e = g.edges[b["edge"]]
        e.state = Passability.BLOCKED
        e.evidence = Evidence.SYNTHETIC
        e.source = "hypothetical-scenario"
        e.reason = b["reason"]
        e.attrs = {**e.attrs, "hypothetical": True}
        if b.get("candidate"):
            # Marker at the curb landing (the non-corner end of the ramp edge).
            curb = e.v if g.nodes[e.v].kind.value == "curb" else e.u
            node = g.nodes[curb]
            interventions[b["candidate"]] = Intervention(
                id=b["candidate"], label=b["label"], kind=b.get("kind", "install_curb_ramp"), edge_ids=[e.id],
                lon=node.lon, lat=node.lat, description=b["reason"], evidence=Evidence.SYNTHETIC,
                attrs={"hypothetical": True, "intersection": e.attrs.get("intersection"), "crossing": b.get("crossing"),
                       "pair": b.get("pair")},
            )
    keep_o, keep_d = set(spec["origins"]), set(spec["destinations"])
    origins = [o for o in base.origins if o.id in keep_o]
    dests = [d for d in base.destinations if d.id in keep_d]
    sc = Scenario(
        id="guided",
        name="Guided scenario - Elizabeth, Charlotte (hypothetical barriers on real streets)",
        mode="hypothetical",
        description=spec["description"],
        graph=g, origins=origins, destinations=dests, interventions=interventions,
        max_distance_m=spec["max_distance_m"], default_journey=tuple(spec["default_journey"]),
        assumptions=[
            "HYPOTHETICAL SCENARIO on real Charlotte streets: barrier locations are illustrative settings, not survey findings "
            "and not claims about current conditions.",
            "Street geometry, places and the corner/crossing topology are real-data derived (OpenStreetMap, CDOT, CATS).",
            "Every modeled link not listed as a scenario barrier is assumed traversable for this scenario.",
            "A crossing is usable only if the crossing and the curb ramps at both ends are traversable.",
            f"A destination counts as reachable when the shortest traversable route is at most {spec['max_distance_m']:.0f} m.",
            "Each repair costs one unit of the repair-count budget; no construction costs are modeled.",
            "Origins are OSM residential buildings aggregated per sidewalk segment (a proxy, not population).",
        ],
        provenance=[
            {"id": "guided-spec", "name": "StreetMend guided scenario specification", "kind": "synthetic",
             "description": "Hypothetical barrier set designed by scripts/scenarios/design_guided.py and verified by the engine."},
        ] + list(base.provenance),
        bounds=base.bounds,
        context={**base.context, "scenario_story": spec.get("story", {})},
    )
    sc.validate()
    return sc


def load_spec(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def spec_path() -> Path:
    from streetmend.municipal.scenario import DATA_DIR

    return DATA_DIR / "scenarios" / "charlotte_guided.json"


def load_guided_scenario() -> Scenario:
    from streetmend.municipal.scenario import load_municipal_scenario

    path = spec_path()
    if not path.exists():
        raise FileNotFoundError(str(path))
    return apply_spec(load_municipal_scenario("moderate"), load_spec(path))


def crossing_of_ramp(g: PedGraph, ramp_edge: str) -> str | None:
    """The crossing edge that starts at this ramp's curb landing."""

    e = g.edges[ramp_edge]
    curb = e.v if g.nodes[e.v].kind.value == "curb" else e.u
    for x in g.incident_edges(curb):
        if x.kind == EdgeKind.CROSSING:
            return x.id
    return None
