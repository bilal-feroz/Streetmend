"""The intervention model: every change to the network is a typed, checked operation.

An intervention specifies:

  id            stable identifier
  type          one of TYPES below
  targets       the graph edges it acts on (existing modeled edges only: no
                intervention adds geometry that is not in the source network)
  state change  what each target becomes (open or closed), per edge
  preconditions what must hold before it applies (checked, not assumed)
  profiles      the travel profiles whose reachability it can change
  cost units    a planning count, not money
  dependencies  other interventions it requires
  provenance    the evidence and source records behind its targets
  status        "record-backed" when it acts on a barrier recorded in a
                municipal source, otherwise "simulated"

Planner proposals (close, reopen) and catalog mitigations share this model, so
the fix search, the change check and the access analysis read one definition.
Road closures are listed but unsupported: this build has no vehicular graph
with turn and one-way restrictions, and pretending otherwise would be fiction.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from streetmend.graph import EdgeKind, Evidence, Passability
from streetmend.scenario.model import Intervention, Scenario

Effect = Literal["open", "close"]
BOTH = ("step_free", "pedestrian")


@dataclass(frozen=True)
class InterventionType:
    key: str
    label: str
    targets: tuple[EdgeKind, ...]
    effect: Effect
    profiles: tuple[str, ...]
    precondition: str
    supported: bool = True
    note: str = ""


TYPES: dict[str, InterventionType] = {t.key: t for t in [
    InterventionType("close_sidewalk", "Close sidewalk", (EdgeKind.SIDEWALK,), "close", BOTH, "the sidewalk is open"),
    InterventionType("reopen_sidewalk", "Reopen sidewalk", (EdgeKind.SIDEWALK,), "open", BOTH, "the sidewalk is closed or blocked"),
    InterventionType("build_sidewalk", "Build missing sidewalk", (EdgeKind.SIDEWALK,), "open", BOTH, "a sidewalk gap is recorded on this block face"),
    InterventionType("close_crossing", "Close crossing", (EdgeKind.CROSSING,), "close", BOTH, "the crossing is open"),
    InterventionType("restore_crossing", "Restore crossing connection", (EdgeKind.CROSSING,), "open", BOTH, "the crossing is closed or has no usable crossing"),
    InterventionType("temporary_accessible_crossing", "Add temporary accessible crossing", (EdgeKind.CROSSING,), "open", BOTH,
                     "the crossing alignment exists in the model but is not usable"),
    InterventionType("close_ramp", "Close curb ramp", (EdgeKind.RAMP,), "close", BOTH, "the ramp connection is open"),
    InterventionType("reconstruct_curb_ramp", "Repair curb-ramp connection", (EdgeKind.RAMP,), "open", ("step_free",), "the ramp is a recorded or modeled barrier"),
    InterventionType("install_curb_ramp", "Install curb ramp", (EdgeKind.RAMP,), "open", ("step_free",), "no usable ramp exists at this landing"),
    InterventionType("temporary_curb_ramp", "Add temporary step-free link (curb ramp)", (EdgeKind.RAMP,), "open", ("step_free",),
                     "no usable ramp exists at this landing"),
    InterventionType("close_road", "Close road segment", (), "close", (), "", False, "No vehicular graph in this build."),
    InterventionType("reopen_road", "Reopen road segment", (), "open", (), "", False, "No vehicular graph in this build."),
]}

# planner change operations, by the kind of edge they act on
CHANGE_TYPE = {("close", EdgeKind.SIDEWALK): "close_sidewalk", ("close", EdgeKind.CROSSING): "close_crossing", ("close", EdgeKind.RAMP): "close_ramp",
               ("reopen", EdgeKind.SIDEWALK): "reopen_sidewalk", ("reopen", EdgeKind.CROSSING): "restore_crossing",
               ("reopen", EdgeKind.RAMP): "reconstruct_curb_ramp"}
RECORD_EVIDENCE = {Evidence.MUNICIPAL_RECORD, Evidence.MUNICIPAL_HISTORICAL}


class InterventionError(ValueError):
    pass


def requires(iv: Intervention) -> list[str]:
    return list(iv.attrs.get("requires", []))


def preconditions(sc: Scenario, iv: Intervention) -> list[dict[str, Any]]:
    t = TYPES.get(iv.kind)
    out = []
    for eid in iv.edge_ids:
        e = sc.graph.edges.get(eid)
        if e is None:
            out.append({"edge": eid, "text": "target edge exists", "holds": False})
            continue
        if t is None:
            out.append({"edge": eid, "text": f"known intervention type '{iv.kind}'", "holds": False})
            continue
        out.append({"edge": eid, "text": f"target is a {'/'.join(k.value for k in t.targets)} edge", "holds": e.kind in t.targets})
        if t.effect == "open":
            out.append({"edge": eid, "text": t.precondition, "holds": e.state != Passability.TRAVERSABLE})
        else:
            out.append({"edge": eid, "text": t.precondition, "holds": e.state == Passability.TRAVERSABLE})
    for r in requires(iv):
        out.append({"edge": None, "text": f"requires intervention {r}", "holds": r in sc.interventions})
    return out


def validate_catalog(sc: Scenario) -> None:
    """Every catalog intervention is typed, its preconditions hold, and its dependencies resolve without cycles."""

    for iv in sc.interventions.values():
        t = TYPES.get(iv.kind)
        if t is None or not t.supported:
            raise InterventionError(f"{iv.id}: unsupported intervention type '{iv.kind}'")
        bad = [p for p in preconditions(sc, iv) if not p["holds"]]
        if bad:
            raise InterventionError(f"{iv.id}: precondition fails: {bad[0]['text']} ({bad[0]['edge']})")
    seen: dict[str, int] = {}

    def visit(i: str, stack: tuple[str, ...]) -> None:
        if i in stack:
            raise InterventionError(f"dependency cycle: {' -> '.join(stack + (i,))}")
        if seen.get(i):
            return
        for r in requires(sc.interventions[i]):
            visit(r, stack + (i,))
        seen[i] = 1

    for i in sc.interventions:
        visit(i, ())


def closed_under_requires(sc: Scenario, ids: tuple[str, ...] | list[str]) -> bool:
    s = set(ids)
    return all(r in s for i in ids for r in requires(sc.interventions[i]))


def spec(sc: Scenario, iv: Intervention) -> dict[str, Any]:
    t = TYPES.get(iv.kind)
    g = sc.graph
    targets = [g.edges[e] for e in iv.edge_ids if e in g.edges]
    record = any(e.evidence in RECORD_EVIDENCE for e in targets) or iv.evidence in RECORD_EVIDENCE
    return {
        "id": iv.id,
        "type": iv.kind,
        "type_label": t.label if t else iv.kind,
        "label": iv.label,
        "targets": [{"edge": e.id, "kind": e.kind.value, "label": e.label} for e in targets],
        "state_changes": [{"edge": e.id, "from": e.state.value, "to": "traversable" if (t is None or t.effect == "open") else "closed"} for e in targets],
        "preconditions": preconditions(sc, iv),
        "profiles": list(iv.attrs.get("profiles") or (t.profiles if t else BOTH)),
        "cost_units": iv.cost_units,
        "dependencies": requires(iv),
        "duration": iv.attrs.get("duration", "permanent"),
        "provenance": {"evidence": iv.evidence.value, "source_ids": list(iv.source_ids[:3]),
                       "target_evidence": sorted({e.evidence.value for e in targets})},
        "status": "record-backed" if record and not iv.attrs.get("hypothetical") else "simulated",
        "location": {"lon": iv.lon, "lat": iv.lat},
    }


def catalog(sc: Scenario) -> dict[str, Any]:
    return {
        "types": [{"key": t.key, "label": t.label, "targets": [k.value for k in t.targets], "effect": t.effect, "profiles": list(t.profiles),
                   "precondition": t.precondition, "supported": t.supported, "note": t.note} for t in TYPES.values()],
        "interventions": [spec(sc, iv) for iv in sc.interventions.values()],
    }
