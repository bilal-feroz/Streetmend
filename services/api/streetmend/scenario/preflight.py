"""Preflight scenario: verify a proposed street change before it is made.

Real Elizabeth geometry and places (the same candidate graph as the guided
scenario). Every modeled link is assumed passable except the hypothetical
existing conditions in data/scenarios/charlotte_preflight.json: curb ramps
missing at both ends of one crossing (walkers can step the curb, step-free
travellers cannot), and two legs with no usable crossing. The spec also lists
the planner's proposals, the access requirements to verify, and the catalog of
mitigations the fix search may use. None of these settings are survey findings.
"""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path
from typing import Any

from streetmend.graph import Evidence, Passability
from streetmend.scenario.guided import HYPOTHETICAL_REASON, hypothetical_graph
from streetmend.scenario.model import Destination, Intervention, Origin, Scenario
from streetmend.verify.changes import Change
from streetmend.verify.checks import Requirement
from streetmend.verify.profiles import Profile


def spec_path() -> Path:
    from streetmend.municipal.scenario import DATA_DIR

    return DATA_DIR / "scenarios" / "charlotte_preflight.json"


def load_spec(path: Path | None = None) -> dict[str, Any]:
    return json.loads((path or spec_path()).read_text(encoding="utf-8"))


def build(base: Scenario, spec: dict[str, Any]) -> Scenario:
    g = hypothetical_graph(base.graph)
    for x in spec["existing"]:
        e = g.edges[x["edge"]]
        g.edges[e.id] = replace(e, state=Passability.BLOCKED, evidence=Evidence.SYNTHETIC, source="hypothetical-scenario", reason=x["reason"],
                                attrs={**e.attrs, "barrier": x["barrier"], "hypothetical": True})
    interventions: dict[str, Intervention] = {}
    for c in spec["catalog"]:
        e = g.edges[c["edge"]]
        mid = e.geometry[len(e.geometry) // 2]
        interventions[c["id"]] = Intervention(
            id=c["id"], label=c["label"], kind=c["kind"], edge_ids=[c["edge"]], lon=mid[0], lat=mid[1],
            description=c.get("description", ""), evidence=Evidence.SYNTHETIC, cost_units=int(c.get("cost_units", 1)),
            attrs={"hypothetical": True, "duration": c.get("duration", "temporary"), "profiles": c.get("profiles", ["step_free"]),
                   "crossing": c.get("crossing"), "pair": c.get("pair"), "intersection": e.attrs.get("intersection")},
        )
    origins = {o.id: o for o in base.origins}
    dests = {d.id: d for d in base.destinations}
    sc = Scenario(
        id="preflight",
        name="Change check - Elizabeth, Charlotte (hypothetical proposal on real streets)",
        mode="hypothetical",
        description=spec["description"],
        graph=g,
        origins=[Origin(o.id, o.label, o.weight, o.weight_basis) for o in (origins[i] for i in spec["origins"])],
        destinations=[Destination(d.id, d.label, d.category, d.weight, d.evidence, list(d.source_ids)) for d in (dests[i] for i in spec["destinations"])],
        interventions=interventions,
        max_distance_m=float(spec["max_distance_m"]),
        default_journey=tuple(spec["default_journey"]),
        context={**base.context, "verify": {"proposals": spec["proposals"], "requirements": spec["requirements"]}},
        assumptions=[
            "HYPOTHETICAL CHANGE CHECK on real Charlotte streets: the proposed closure, the existing barriers and the mitigation catalog are scenario settings, not survey findings or city plans.",
            HYPOTHETICAL_REASON,
            "Walking profile: a curb without a usable ramp can be stepped. Step-free profile: it cannot.",
            *base.assumptions[:2],
        ],
        provenance=base.provenance,
        bounds=base.bounds,
    )
    sc.validate()
    return sc


def requirements(sc: Scenario) -> list[Requirement]:
    out = []
    for r in sc.context.get("verify", {}).get("requirements", []):
        out.append(Requirement(id=r["id"], kind=r["kind"], label=r["label"], profile=Profile(r.get("profile", "step_free")), origin=r.get("origin"),
                               destination=r.get("destination"), category=r.get("category"), max_m=r.get("max_m"), max_ratio=r.get("max_ratio"),
                               min_share=r.get("min_share")))
    return out


def proposal(sc: Scenario, pid: str) -> list[Change]:
    for p in sc.context.get("verify", {}).get("proposals", []):
        if p["id"] == pid:
            return [Change(id=c["id"], op=c["op"], edge_id=c["edge_id"], label=c.get("label", p["label"]), reason=c.get("reason", "")) for c in p["changes"]]
    raise KeyError(pid)


def load_preflight_scenario() -> Scenario:
    from streetmend.municipal.scenario import load_municipal_scenario

    path = spec_path()
    if not path.exists():
        raise FileNotFoundError(str(path))
    return build(load_municipal_scenario("moderate"), load_spec(path))
