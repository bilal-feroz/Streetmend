"""Intervene: fix the network or build a facility? Both judged on one objective.

For a selected set of homes (one or more H3 cells), one service category, one
travel profile and one threshold, StreetMend compares:

  FIX    the best set of up to ``budget`` network repairs: CDOT-recorded curb
         ramp barriers (reconstruct or install), or sidewalk gaps the CDOT
         inventory records as "No Sidewalk" (build that block face);
  BUILD  one hypothetical new facility of the category at an existing
         non-residential building (commercial, retail, office or parking).
         These sites are real buildings, but nothing here establishes that the
         land is available, zoned or affordable: they are hypothetical.

Both options are evaluated on the same graph, the same homes and the same
declared objective: the number of selected homes that reach the category
within the threshold under the declared unknown-data policy. A repair changes
traversable edges; a new facility changes the destination set. The winner is
whichever restores more homes. Equal counts are reported as a tie: a pair of
ramp repairs and a new clinic are not comparable by count, and costs are not
compared because no defensible estimates exist.

The repair search is exact, up to the budget, over every candidate that can
lie on a route within the threshold (a network-ellipse test with all
candidates applied, which can only over-include), unless the number of sets
exceeds ``max_sets``; larger sizes are then explored by a beam search from
the best smaller sets, and the result says it is not exhaustive. Every reported option is then
re-verified by an independent full recomputation.
"""

from __future__ import annotations

import itertools
import json
import math
import time
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from streetmend.graph import EdgeKind, Passability
from streetmend.municipal.scenario import DATA_DIR
from streetmend.verify.profiles import Profile

from .analysis import CATEGORY_LABEL, THRESHOLD_M, AccessModel, Facility, Home, _centroid, home_status
from .network import state_key

SITE_TYPES = {"commercial", "retail", "office", "parking"}
REQUIRED_SHARE = 0.8
BEAM = 25


@dataclass
class Repair:
    id: str
    kind: str  # reconstruct_curb_ramp | install_curb_ramp | build_sidewalk
    label: str
    edge_ids: list[str]
    lon: float
    lat: float
    evidence: str
    source_ids: list[str] = field(default_factory=list)
    reason: str = ""


def repair_candidates(model: AccessModel) -> list[Repair]:
    sc = model.sc
    out = [Repair(iv.id, iv.kind, iv.label, list(iv.edge_ids), iv.lon, iv.lat, iv.evidence.value, list(iv.source_ids[:3]), iv.description)
           for iv in sc.interventions.values()]
    groups: dict[str, list] = {}
    for e in sc.graph.edges.values():
        if e.kind == EdgeKind.SIDEWALK and e.state == Passability.BLOCKED:
            groups.setdefault(e.id.rsplit(":", 1)[0], []).append(e)
    for gid, es in sorted(groups.items()):
        es.sort(key=lambda e: e.id)
        pts = [p for e in es for p in e.geometry]
        mid = pts[len(pts) // 2]
        name = (es[0].label or "Sidewalk").replace("Sidewalk, ", "")
        out.append(Repair(f"SW:{gid}", "build_sidewalk", f"Build the missing sidewalk on {name}", [e.id for e in es], mid[0], mid[1],
                          es[0].evidence.value, sorted({s for e in es for s in e.source_ids})[:3], es[0].reason))
    return out


def site_candidates(model: AccessModel, category: str) -> list[Facility]:
    blds = json.loads((DATA_DIR / "samples" / "charlotte_city" / "buildings.geojson").read_text(encoding="utf-8"))
    out = []
    for k, f in enumerate(blds["features"]):
        b = f["properties"].get("b")
        if b not in SITE_TYPES:
            continue
        lon, lat = _centroid(f["geometry"])
        if not model.net.inside(lon, lat):
            continue
        sn = model.net.snap(lon, lat)
        if sn is None:
            continue
        name = f["properties"].get("name")
        label = f"{name} ({b} building)" if name else f"{b.capitalize()} building"
        out.append(Facility(f"SITE:{k}", category, f"Hypothetical {CATEGORY_LABEL[category].lower()} site: {label}", f"site={b}", lon, lat, "hypothetical", sn, True))
    return out


def _xy(model: AccessModel, lon: float, lat: float) -> np.ndarray:
    return np.array(model.net.proj.xy(lon, lat))


class _Eval:
    """Counts selected homes within the threshold for one policy, fast (search only)."""

    def __init__(self, model: AccessModel, category: str, homes: list[Home], key: str, T: float):
        self.model, self.homes, self.key, self.T = model, homes, key, T
        self.snaps = [f.snap for f in model.fac(category) if f.snap is not None]
        self.pts = [h.snap for h in homes]
        self.n = 0

    def dists(self, enabled: frozenset[str] = frozenset(), extra: list[Facility] | None = None) -> np.ndarray:
        self.n += 1
        net = self.model.net
        m = net.mask(self.key, enabled)
        snaps = self.snaps + [f.snap for f in extra or [] if f.snap is not None]
        d = net.node_dist(snaps, m, limit=self.T + 1.0)
        return net.point_dist(d, self.pts, m, snaps)

    def count(self, enabled: frozenset[str] = frozenset(), extra: list[Facility] | None = None) -> int:
        return int(np.sum(self.dists(enabled, extra) <= self.T))


def _req_status(verified: int, possible: int, n: int) -> str:
    if n == 0:
        return "INCONCLUSIVE"
    if verified / n >= REQUIRED_SHARE:
        return "PASS"
    return "INCONCLUSIVE" if possible / n >= REQUIRED_SHARE else "FAIL"


def _verify(model: AccessModel, category: str, profile: Profile, T: float, homes: list[Home], enabled=frozenset(), extra=None) -> dict[str, Any]:
    """Independent recomputation of one network state (all homes, both policies)."""

    st = home_status(model, category, profile, T, enabled=frozenset(enabled), extra=extra)
    sel = {h.id for h in homes}
    ix = [k for k, h in enumerate(model.homes) if h.id in sel]
    v = int(np.sum(st["verified"][ix] <= T))
    p = int(np.sum(st["possible"][ix] <= T))
    dp = st["possible"][ix]
    fin = dp[np.isfinite(dp)]
    return {
        "verified": v, "possible": p, "homes": len(ix),
        "all_verified": int(np.sum(st["verified"] <= T)), "all_possible": int(np.sum(st["possible"] <= T)),
        "mean_possible_m": None if not len(fin) else round(float(np.mean(np.minimum(fin, 2 * T))), 1),
        "status": _req_status(v, p, len(ix)),
        "factors": {f: [st["factor"][k] for k in ix].count(f) for f in ("served", "unknown_links", "outside_area", "barrier", "detour", "distance")},
    }


def compare(model: AccessModel, category: str, cells: list[str], profile: Profile = Profile.STEP_FREE, policy: str = "possible",
            budget: int = 2, T: float | None = None, max_sets: int = 1600) -> dict[str, Any]:
    t0 = time.perf_counter()
    T = float(T or THRESHOLD_M[category])
    homes = [h for h in model.homes if h.cell in set(cells) and h.snap is not None]
    if not homes:
        raise KeyError("no homes in the selected cells")
    key = state_key(profile, policy)
    ev = _Eval(model, category, homes, key, T)
    base_d = ev.dists()
    base = int(np.sum(base_d <= T))
    hx = np.array([_xy(model, h.lon, h.lat) for h in homes])
    facs = [f for f in model.fac(category) if f.snap is not None]
    fx = np.array([_xy(model, f.lon, f.lat) for f in facs]) if facs else np.zeros((0, 2))

    # ---- FIX: exact search over repairs that can lie on a route within T ----
    reps = repair_candidates(model)
    live = []
    for r in reps:
        p = _xy(model, r.lon, r.lat)
        dh = np.min(np.hypot(*(hx - p).T)) if len(hx) else math.inf
        df = np.min(np.hypot(*(fx - p).T)) if len(fx) else math.inf
        if dh + df <= T + 200.0:  # coarse straight-line screen (a repair is a segment, not a point)
            live.append(r)
    # Network ellipse: with every screened repair applied, a repair can matter only if
    # some route home -> repair -> facility through one of its edges is within T.
    # Subsets only remove edges, so this test never discards a useful repair.
    net = model.net
    all_en = frozenset(e for r in live for e in r.edge_ids)
    m_all = net.mask(key, all_en)
    dH = net.node_dist([h.snap for h in homes], m_all, limit=T + 1.0)
    dF = net.node_dist(ev.snaps, m_all, limit=T + 1.0)

    def relevant(r: Repair) -> bool:
        for e in r.edge_ids:
            i = net.eidx.get(e)
            if i is None:
                continue
            a, b, L = net.u[i], net.v[i], net.w[i]
            if min(dH[a] + L + dF[b], dH[b] + L + dF[a]) <= T:
                return True
        return False

    screened = len(live)
    live = [r for r in live if relevant(r)]
    # homes already served cannot add to the objective: prune with the unserved ones only
    unserved = [h for h, d in zip(homes, base_d) if not d <= T]
    if unserved and len(unserved) < len(homes):
        dH = net.node_dist([h.snap for h in unserved], m_all, limit=T + 1.0)
        live = [r for r in live if relevant(r)]
    singles = []
    for r in live:
        g = ev.count(frozenset(r.edge_ids))
        singles.append({"id": r.id, "label": r.label, "kind": r.kind, "gain": g - base})
    singles.sort(key=lambda s: (-s["gain"], s["id"]))
    by_id = {r.id: r for r in live}
    best_fix = None
    evaluated = 0
    exact = True
    scored: dict[int, list[tuple]] = {}

    def score(combo: tuple[str, ...]) -> tuple:
        nonlocal evaluated, best_fix
        en = frozenset(e for i in combo for e in by_id[i].edge_ids)
        d = ev.dists(en)
        evaluated += 1
        gain = int(np.sum(d <= T)) - base
        fin = d[np.isfinite(d)]
        mean = float(np.mean(np.minimum(fin, 2 * T))) if len(fin) else math.inf
        cand = (-gain, len(combo), mean, combo)
        if gain > 0 and (best_fix is None or cand < best_fix):
            best_fix = cand
        return cand

    used = 0
    for k in range(1, budget + 1):
        n_k = math.comb(len(by_id), k)
        if used + n_k <= max_sets:
            scored[k] = sorted(score(c) for c in itertools.combinations(sorted(by_id), k))
            used += n_k
        else:
            # too many sets: extend the best sets of the previous size (beam search; not exhaustive)
            exact = False
            seeds = [c[3] for c in scored.get(k - 1, [])[:BEAM]]
            nxt = {tuple(sorted(set(sd) | {i})) for sd in seeds for i in by_id if i not in sd}
            scored[k] = sorted(score(c) for c in sorted(nxt))
            used += len(nxt)
    pool = list(by_id.values())
    # ---- BUILD: one hypothetical facility at an existing non-residential building ----
    sites = site_candidates(model, category)
    near = [s for s in sites if len(hx) and np.min(np.hypot(*(hx - _xy(model, s.lon, s.lat)).T)) <= T]
    best_build = None
    site_rows = []
    for s in near:
        d = ev.dists(extra=[s])
        gain = int(np.sum(d <= T)) - base
        fin = d[np.isfinite(d)]
        mean = float(np.mean(np.minimum(fin, 2 * T))) if len(fin) else math.inf
        site_rows.append({"id": s.id, "label": s.name, "gain": gain, "lon": s.lon, "lat": s.lat})
        cand = (-gain, mean, s.id)
        if gain > 0 and (best_build is None or cand < best_build):
            best_build = cand
    site_rows.sort(key=lambda r: (-r["gain"], r["id"]))

    # ---- independent re-verification ----
    before = _verify(model, category, profile, T, homes)
    fix_out = {"status": "none", "repairs": [], "candidates": len(reps), "screened": screened, "relevant": len(live), "searched": len(pool), "evaluated": evaluated,
               "exact": exact, "budget": budget, "singles": singles[:8]}
    if best_fix is not None:
        ids = list(best_fix[3])
        en = frozenset(e for i in ids for e in by_id[i].edge_ids)
        after = _verify(model, category, profile, T, homes, enabled=en)
        alone = {s["id"]: s["gain"] for s in singles}
        fix_out.update({
            "status": "found", "gain": -best_fix[0],
            "repairs": [{"id": i, "label": by_id[i].label, "kind": by_id[i].kind, "edge_ids": by_id[i].edge_ids, "lon": by_id[i].lon, "lat": by_id[i].lat,
                         "evidence": by_id[i].evidence, "source_ids": by_id[i].source_ids, "reason": by_id[i].reason, "alone_gain": alone.get(i, 0)} for i in ids],
            "after": after, "edge_ids": sorted(en),
            "synergy": len(ids) > 1 and sum(alone.get(i, 0) for i in ids) < -best_fix[0],
        })
    build_out = {"status": "none", "site": None, "candidates": len(sites), "relevant": len(near), "evaluated": len(near), "top": site_rows[:5]}
    if best_build is not None:
        s = next(x for x in near if x.id == best_build[2])
        after = _verify(model, category, profile, T, homes, extra=[s])
        build_out.update({"status": "found", "gain": -best_build[0], "site": {"id": s.id, "label": s.name, "lon": s.lon, "lat": s.lat, "kind": s.kind,
                                                                            "hypothetical": True}, "after": after})

    fg = fix_out.get("gain", 0) if fix_out["status"] == "found" else 0
    bg = build_out.get("gain", 0) if build_out["status"] == "found" else 0
    cat = CATEGORY_LABEL[category].lower()
    pol = "assuming links of unknown condition are passable" if policy == "possible" else "using only links of known condition"
    if fg == 0 and bg == 0:
        winner, why = "neither", f"Neither option brings more of these homes within {T:.0f} m of {cat} under the modeled conditions ({pol})."
    elif fg > bg:
        winner, why = "fix", f"Repairing {len(fix_out['repairs'])} connection{'s' if len(fix_out['repairs']) > 1 else ''} brings {fg} of {len(homes)} homes within {T:.0f} m of existing {cat}; the best new site brings {bg}."
    elif bg > fg:
        winner, why = "build", f"A new {cat} facility at the best hypothetical site brings {bg} of {len(homes)} homes within {T:.0f} m; the best {budget} repair{'s' if budget > 1 else ''} bring {fg}."
    else:
        winner, why = "tie", f"Both options bring {fg} of {len(homes)} homes within {T:.0f} m. The model cannot separate them on access alone; cost and feasibility decide, and neither is modeled here."
    return {
        "category": category, "label": CATEGORY_LABEL[category], "cells": cells, "profile": Profile(profile).value, "policy": policy,
        "threshold_m": T, "homes": len(homes), "baseline": base, "before": before,
        "requirement": {"id": "A1", "label": f"At least {int(REQUIRED_SHARE * 100)}% of the selected homes reach {cat} within {T:.0f} m ({'step-free' if profile == Profile.STEP_FREE else 'walking'})",
                        "share": REQUIRED_SHARE},
        "fix": fix_out, "build": build_out, "winner": winner, "why": why,
        "notes": [
            f"Objective: selected homes within {T:.0f} m, {pol}. Verified counts use only links of known condition.",
            "Costs are not compared: there are no defensible estimates for a ramp repair against a new facility.",
            "Hypothetical sites are existing non-residential buildings; land availability, zoning and cost are not assessed.",
            "The repair search is exact over every repair that can lie on a route within the threshold" + ("" if exact else f" up to the sizes it could enumerate; larger sets were explored by beam search (width {BEAM}), so they are not proven optimal") + ".",
        ],
        "runtime_ms": round((time.perf_counter() - t0) * 1000, 1),
    }
