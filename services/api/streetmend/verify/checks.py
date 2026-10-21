"""Access requirements, three-valued checks and graph counterexamples.

A requirement is a configurable planning check (not a legal ADA determination).
Each is evaluated twice per network state: conservatively (unknown edges
excluded) and optimistically (unknown edges included). The status is

  PASS          the conservative evaluation already satisfies it;
  FAIL          even the optimistic evaluation violates it;
  INCONCLUSIVE  it holds only if some unknown links are passable.

so unknown data can never silently become PASS.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

import networkx as nx
import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra

from streetmend.graph import EdgeKind, Passability
from streetmend.graph.algorithms import shortest_route
from streetmend.scenario.model import Scenario

from .profiles import PROFILE_LABEL, Profile, is_curb_step, profile_graph, usable

Status = Literal["PASS", "FAIL", "INCONCLUSIVE"]
Kind = Literal["route", "category", "share", "detour"]


@dataclass(frozen=True)
class Requirement:
    """route    : a route from origin to destination within max_m.
    category : a route from origin to at least one destination of a category within max_m.
    share    : at least min_share of the baseline's connected origin-destination pairs stay connected.
    detour   : the route is at most max_ratio x its baseline length."""

    id: str
    kind: Kind
    label: str
    profile: Profile = Profile.STEP_FREE
    origin: str | None = None
    destination: str | None = None
    category: str | None = None
    max_m: float | None = None
    max_ratio: float | None = None
    min_share: float | None = None


def _graph_facts(pg) -> tuple[dict[str, int], bool]:
    """Node index and whether any edge is of unknown condition, cached on the graph object.

    Cached on the object, never keyed by id(): ids are reused after garbage
    collection, and a stale "no unknown links" answer would turn INCONCLUSIVE
    into FAIL. Graphs are not modified after construction (changes copy them).
    """

    facts = getattr(pg, "_verify_facts", None)
    if facts is None or facts[2] is not pg.edges:
        facts = ({n: i for i, n in enumerate(pg.nodes)}, any(e.state == Passability.UNKNOWN for e in pg.edges.values()), pg.edges)
        pg._verify_facts = facts
    return facts[0], facts[1]


class Dist:
    """Distances from one origin to every node (compiled Dijkstra), read like a dict."""

    __slots__ = ("arr", "idx")

    def __init__(self, arr, idx: dict[str, int]):
        self.arr = arr
        self.idx = idx

    def get(self, k: str, default: float | None = None):
        i = self.idx.get(k)
        if i is None:
            return default
        v = self.arr[i]
        return float(v) if np.isfinite(v) else default

    def __contains__(self, k: str) -> bool:
        return self.get(k) is not None

    def __getitem__(self, k: str) -> float:
        v = self.get(k)
        if v is None:
            raise KeyError(k)
        return v


class NetworkState:
    """One network state (baseline, proposed or fixed) with cached profile graphs."""

    def __init__(self, sc: Scenario, applied: list[str], name: str):
        self.sc = sc
        self.applied = list(applied)
        self.enabled = sc.enabled_edges(self.applied)
        self.name = name
        self._g: dict[tuple[Profile, bool], nx.MultiGraph] = {}
        self._csr: dict[tuple[Profile, bool], Any] = {}
        self._dist: dict[tuple[Profile, bool, str, float | None], Dist] = {}
        self.idx, unknown = _graph_facts(sc.graph)
        # without unknown links the optimistic and conservative networks are the same
        self.has_unknown = unknown

    def graph(self, profile: Profile, optimistic: bool) -> nx.MultiGraph:
        k = (profile, optimistic and self.has_unknown)
        if k not in self._g:
            self._g[k] = profile_graph(self.sc.graph, self.enabled, profile, k[1])
        return self._g[k]

    def csr(self, profile: Profile, optimistic: bool):
        k = (profile, optimistic and self.has_unknown)
        if k not in self._csr:
            us, vs, ws = [], [], []
            idx = self.idx
            for e in self.sc.graph.edges.values():
                if usable(e, self.enabled, profile, k[1]):
                    a, b = idx[e.u], idx[e.v]
                    us.append(min(a, b))
                    vs.append(max(a, b))
                    ws.append(e.length_m)
            n = len(idx)
            u, v, w = np.array(us, dtype=np.int64), np.array(vs, dtype=np.int64), np.array(ws)
            # parallel edges: keep the shortest
            order = np.lexsort((w, u * n + v))
            key = (u * n + v)[order]
            first = np.ones(len(key), dtype=bool)
            first[1:] = key[1:] != key[:-1]
            sel = order[first]
            self._csr[k] = csr_matrix((w[sel], (u[sel], v[sel])), shape=(n, n))
        return self._csr[k]

    def dist_from(self, origin: str, profile: Profile, optimistic: bool, cutoff: float | None = None) -> Dist:
        k = (profile, optimistic and self.has_unknown, origin, cutoff)
        if k not in self._dist:
            i = self.idx.get(origin)
            if i is None:
                arr = np.full(len(self.idx), np.inf)
            else:
                arr = dijkstra(self.csr(profile, optimistic), directed=False, indices=i, limit=np.inf if cutoff is None else cutoff + 1e-9)
            self._dist[k] = Dist(arr, self.idx)
        return self._dist[k]

    def route(self, o: str, d: str, profile: Profile, optimistic: bool, cutoff: float | None):
        return shortest_route(self.sc.graph, self.graph(profile, optimistic), o, d, cutoff)


def _label(sc: Scenario, nid: str | None) -> str:
    if nid is None:
        return "—"
    for p in (*sc.origins, *sc.destinations):
        if p.id == nid:
            return p.label.split(" (")[0]
    n = sc.graph.nodes.get(nid)
    return n.label if n and n.label else nid


def _route_out(r) -> dict[str, Any]:
    return {"length_m": None if r.length_m is None else round(r.length_m, 1), "edge_ids": r.edge_ids, "geometry": [list(p) for p in r.geometry]}


@dataclass
class CheckResult:
    id: str
    label: str
    kind: str
    profile: str
    status: Status
    value: str  # the measured value in words ("648 m", "none within 800 m", "91% kept")
    detail: str
    data: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {"id": self.id, "label": self.label, "kind": self.kind, "profile": self.profile, "status": self.status, "value": self.value, "detail": self.detail, **self.data}


def _tri(cons_ok: bool, opt_ok: bool) -> Status:
    return "PASS" if cons_ok else ("INCONCLUSIVE" if opt_ok else "FAIL")


def _len(d: dict[str, float], t: str) -> float | None:
    return d.get(t)


def evaluate(req: Requirement, st: NetworkState, base: NetworkState) -> CheckResult:
    sc = st.sc
    p = req.profile
    pl = PROFILE_LABEL[p]
    if req.kind in ("route", "detour"):
        o, t = req.origin, req.destination
        assert o and t
        lc = _len(st.dist_from(o, p, False), t)
        lo = _len(st.dist_from(o, p, True), t)
        if req.kind == "route":
            m = req.max_m or float("inf")
            status = _tri(lc is not None and lc <= m, lo is not None and lo <= m)
            value = f"{lc:.0f} m" if lc is not None and lc <= m else ("none within " + f"{m:.0f} m" if m != float("inf") else "no route")
            detail = {
                "PASS": f"A continuous {pl} route of {lc or 0:.0f} m exists.",
                "FAIL": f"No {pl} route within {m:.0f} m." + (f" The shortest {pl} route is {lc:.0f} m." if lc is not None else ""),
                "INCONCLUSIVE": f"A {pl} route within {m:.0f} m exists only through links whose condition is unknown.",
            }[status]
            return CheckResult(req.id, req.label, req.kind, p.value, status, value, detail, {"length_m": None if lc is None else round(lc, 1)})
        # detour
        b = _len(base.dist_from(o, p, False), t)
        if b is None:
            return CheckResult(req.id, req.label, req.kind, p.value, "INCONCLUSIVE", "no baseline", f"There is no conservative {pl} baseline route to compare with.")
        lim = b * (req.max_ratio or 1.0)
        status = _tri(lc is not None and lc <= lim, lo is not None and lo <= lim)
        pct = None if lc is None else round((lc / b - 1) * 100)
        value = "no route" if lc is None else (f"+{pct}%" if pct >= 0 else f"{pct}%")
        detail = (
            f"{pl.capitalize()} route is {lc:.0f} m against {b:.0f} m today ({value}); the limit is +{round(((req.max_ratio or 1) - 1) * 100)}%."
            if lc is not None
            else f"No {pl} route remains, so the detour limit cannot be met."
        )
        return CheckResult(req.id, req.label, req.kind, p.value, status, value, detail, {"length_m": None if lc is None else round(lc, 1), "baseline_m": round(b, 1)})
    if req.kind == "category":
        o = req.origin
        assert o
        m = req.max_m or float("inf")
        targets = [d for d in sc.destinations if d.category.value == req.category]
        dc = st.dist_from(o, p, False)
        do = st.dist_from(o, p, True)
        best_c = min((dc[d.id] for d in targets if d.id in dc), default=None)
        best_o = min((do[d.id] for d in targets if d.id in do), default=None)
        status = _tri(best_c is not None and best_c <= m, best_o is not None and best_o <= m)
        near = next((d for d in sorted(targets, key=lambda d: dc.get(d.id, 1e12)) if d.id in dc), None)
        value = f"{best_c:.0f} m" if best_c is not None and best_c <= m else f"none within {m:.0f} m"
        detail = f"Nearest {req.category} destination by {pl} route: {near.label} at {best_c:.0f} m." if near and best_c is not None else f"No {req.category} destination is reachable by a {pl} route."
        return CheckResult(req.id, req.label, req.kind, p.value, status, value, detail, {"length_m": None if best_c is None else round(best_c, 1)})
    # share of baseline-connected pairs that stay connected
    m = req.max_m or float("inf")
    base_pairs, kept_c, kept_o = 0, 0, 0
    lost: list[list[str]] = []
    for o in sc.origins:
        cut = None if m == float("inf") else m
        db = base.dist_from(o.id, p, False, cut)
        dc = st.dist_from(o.id, p, False, cut)
        do = st.dist_from(o.id, p, True, cut)
        for d in sc.destinations:
            if db.get(d.id, 1e18) <= m:
                base_pairs += 1
                if dc.get(d.id, 1e18) <= m:
                    kept_c += 1
                else:
                    lost.append([o.id, d.id])
                if do.get(d.id, 1e18) <= m:
                    kept_o += 1
    need = req.min_share or 1.0
    if base_pairs == 0:
        return CheckResult(req.id, req.label, req.kind, p.value, "INCONCLUSIVE", "no baseline", "No origin-destination pair is connected in the baseline.")
    sc_c, sc_o = kept_c / base_pairs, kept_o / base_pairs
    status = _tri(sc_c >= need - 1e-12, sc_o >= need - 1e-12)
    value = f"{round(sc_c * 100)}% kept"
    detail = f"{kept_c} of {base_pairs} {pl} journeys connected today stay connected (limit {round(need * 100)}%)."
    return CheckResult(req.id, req.label, req.kind, p.value, status, value, detail, {"kept": kept_c, "baseline_pairs": base_pairs, "lost_pairs": lost[:40]})


def counterexample(req: Requirement, st: NetworkState, base: NetworkState) -> dict[str, Any] | None:
    """For a route-type requirement that no longer holds: what broke, where, and why the alternatives fail."""

    if req.kind not in ("route", "detour", "category") or not req.origin:
        return None
    sc = st.sc
    o = req.origin
    t = req.destination
    if req.kind == "category":
        dc = base.dist_from(o, req.profile, False)
        cands = [d for d in sc.destinations if d.category.value == req.category and d.id in dc]
        if not cands:
            return None
        t = min(cands, key=lambda d: dc[d.id]).id
    assert t
    p = req.profile
    pl = PROFILE_LABEL[p]
    limit = req.max_m if req.kind != "detour" else None
    b = base.route(o, t, p, False, None)
    if not b.found:
        return None
    # edges of the baseline route that this state no longer lets this profile use
    usable = st.graph(p, False)
    broken = []
    for eid in b.edge_ids:
        e = sc.graph.edges[eid]
        u, v = e.u, e.v
        if not (usable.has_edge(u, v, key=eid)):
            broken.append({"id": eid, "kind": e.kind.value, "label": e.attrs.get("change_label") or e.label or eid, "reason": e.reason, "change": e.attrs.get("change"), "geometry": [list(x) for x in e.geometry]})
    same = st.route(o, t, p, False, None)
    alt_same = {"found": same.found, **(_route_out(same) if same.found else {})}
    out: dict[str, Any] = {
        "origin": o,
        "origin_label": _label(sc, o),
        "destination": t,
        "destination_label": _label(sc, t),
        "profile": p.value,
        "baseline_route": _route_out(b),
        "broken_edges": broken,
        "best_alternative": alt_same,
    }
    parts = []
    closure = next((x for x in broken if x.get("change")), None)
    lead = closure["label"] if closure else (broken[0]["label"] if broken else None)
    if broken:
        parts.append(f"{lead} cuts the only modeled {pl} route from {out['origin_label']} to {out['destination_label']}." if not same.found or (limit and (same.length_m or 0) > limit)
                     else f"{lead} interrupts today's {pl} route.")
    if p == Profile.STEP_FREE:
        w = st.route(o, t, Profile.PEDESTRIAN, False, None)
        if w.found:
            steps = []
            for eid in w.edge_ids:
                e = sc.graph.edges[eid]
                if is_curb_step(e):
                    g = e.geometry
                    steps.append({"id": eid, "label": e.label or eid, "lon": g[len(g) // 2][0], "lat": g[len(g) // 2][1], "reason": e.reason})
            out["walking_route"] = {"found": True, **_route_out(w), "steps": steps}
            if steps and (not same.found or (same.length_m or 0) > (w.length_m or 0) + 1):
                where = steps[0]["label"]
                parts.append(f"A walking route of {w.length_m:.0f} m still exists, but it uses {len(steps)} curb step{'s' if len(steps) != 1 else ''} ({where}{' and more' if len(steps) > 1 else ''}), so it does not meet the step-free requirement.")
        else:
            out["walking_route"] = {"found": False}
            parts.append("No walking route remains either.")
    if same.found:
        if limit and same.length_m and same.length_m > limit:
            parts.append(f"The shortest {pl} alternative is {same.length_m:.0f} m, beyond the {limit:.0f} m threshold.")
        elif req.kind == "detour":
            bl = b.length_m or 1
            parts.append(f"The {pl} alternative is {same.length_m:.0f} m, {round((same.length_m / bl - 1) * 100)}% longer than today's {bl:.0f} m.")
    else:
        parts.append(f"No {pl} route remains at any distance in the modeled area.")
    unknown = sum(1 for e in sc.graph.edges.values() if e.state == Passability.UNKNOWN)
    hyp = sum(1 for e in sc.graph.edges.values() if e.attrs.get("hypothetical"))
    out["assumptions"] = [
        x
        for x in (
            f"{unknown} links have unknown condition and were excluded (conservative)." if unknown else None,
            f"{hyp} barrier states are hypothetical scenario settings, not survey findings." if hyp else None,
            "A walking pedestrian is assumed able to step a curb without a usable ramp; a step-free traveller is not.",
            f"Access threshold {limit:.0f} m of modeled network distance." if limit else None,
        )
        if x
    ]
    out["summary"] = " ".join(parts)
    return out


def ramps_on(st: NetworkState, edge_ids: list[str]) -> list[str]:
    return [e for e in edge_ids if st.sc.graph.edges[e].kind == EdgeKind.RAMP]
