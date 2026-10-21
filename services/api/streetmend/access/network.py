"""Network distances from homes to essential services on the pedestrian graph.

One street graph, several network states. Every state is a mask over the same
sidewalk, crossing and ramp edges, built with the verification engine's own
``usable`` rule, so access analysis and change checks cannot disagree:

  (profile, "verified")  unknown links excluded  (conservative)
  (profile, "possible")  unknown links included  (optimistic)
  "physical"             every modeled link open, whatever its recorded state

Homes and facilities are not graph nodes. Each is snapped to the nearest
sidewalk edge (a straight connector, an inferred assumption) and reaches the
network through that edge's two ends, so a home on a sidewalk of unknown
condition is itself of unknown access. Distances from a set of facilities use
one multi-source Dijkstra (SciPy) through a virtual source node.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable

import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra
from shapely import STRtree
from shapely.geometry import LineString, Point

from streetmend.graph import EdgeKind
from streetmend.scenario.model import Scenario
from streetmend.verify.profiles import Profile, usable

NETWORK_KINDS = (EdgeKind.SIDEWALK, EdgeKind.CROSSING, EdgeKind.RAMP)
SNAP_MAX_M = 150.0
INF = np.inf


class Projector:
    """Local equirectangular projection (metres), adequate at neighbourhood scale."""

    def __init__(self, lon0: float, lat0: float):
        self.lon0, self.lat0 = lon0, lat0
        self.kx = 111_320.0 * math.cos(math.radians(lat0))
        self.ky = 110_540.0

    def xy(self, lon: float, lat: float) -> tuple[float, float]:
        return (lon - self.lon0) * self.kx, (lat - self.lat0) * self.ky


@dataclass(frozen=True)
class Snap:
    edge: int  # index into AccessNetwork.edge_ids
    t: float  # position along the edge from u (0) to v (1)
    connector_m: float  # straight connector from the point to the edge


def state_key(profile: Profile | str, policy: str) -> str:
    return "physical" if policy == "physical" else f"{Profile(profile).value}:{policy}"


class AccessNetwork:
    """Edge arrays and per-state masks for one scenario graph."""

    def __init__(self, sc: Scenario):
        self.sc = sc
        g = sc.graph
        self.edge_ids = [e.id for e in g.edges.values() if e.kind in NETWORK_KINDS]
        nodes = sorted({n for eid in self.edge_ids for n in (g.edges[eid].u, g.edges[eid].v)})
        self.node_ids = nodes
        self.nidx = {n: i for i, n in enumerate(nodes)}
        self.eidx = {e: i for i, e in enumerate(self.edge_ids)}
        self.n = len(nodes)
        es = [g.edges[e] for e in self.edge_ids]
        self.u = np.array([self.nidx[e.u] for e in es], dtype=np.int64)
        self.v = np.array([self.nidx[e.v] for e in es], dtype=np.int64)
        self.w = np.array([max(e.length_m, 0.01) for e in es])
        w, s, e_, n_ = sc.bounds or (min(x.lon for x in g.nodes.values()), min(x.lat for x in g.nodes.values()),
                                     max(x.lon for x in g.nodes.values()), max(x.lat for x in g.nodes.values()))
        self.bounds = (w, s, e_, n_)
        self.proj = Projector((w + e_) / 2, (s + n_) / 2)
        self.sidewalk = np.array([e.kind == EdgeKind.SIDEWALK for e in es])
        self._lines = [LineString([self.proj.xy(*p) for p in e.geometry]) for e in es]
        sw = [i for i in range(len(es)) if self.sidewalk[i]]
        self._sw = np.array(sw)
        self._tree = STRtree([self._lines[i] for i in sw])
        self._masks: dict[tuple[str, frozenset[str], frozenset[str]], np.ndarray] = {}

    # ---- states ---------------------------------------------------------
    def mask(self, key: str, enabled: Iterable[str] = (), closed: Iterable[str] = ()) -> np.ndarray:
        en, cl = frozenset(enabled), frozenset(closed)
        k = (key, frozenset(), cl)
        if k not in self._masks:
            g = self.sc.graph
            if key == "physical":
                m = np.ones(len(self.edge_ids), dtype=bool)
            else:
                prof, policy = key.split(":")
                p = Profile(prof)
                m = np.array([usable(g.edges[e], set(), p, policy == "possible") for e in self.edge_ids])
            for e in cl:
                if e in self.eidx:
                    m[self.eidx[e]] = False
            m.setflags(write=False)
            self._masks[k] = m
        base = self._masks[k]
        if not en:
            return base
        # an enabled (repaired) edge is usable in every state, as in verify.profiles.usable
        m = base.copy()
        m[[self.eidx[e] for e in en if e in self.eidx]] = True
        return m

    # ---- snapping -------------------------------------------------------
    def inside(self, lon: float, lat: float, pad_deg: float = 0.0) -> bool:
        w, s, e, n = self.bounds
        return w - pad_deg <= lon <= e + pad_deg and s - pad_deg <= lat <= n + pad_deg

    def snap(self, lon: float, lat: float) -> Snap | None:
        p = Point(self.proj.xy(lon, lat))
        j = self._tree.nearest(p)
        if j is None:
            return None
        i = int(self._sw[int(j)])
        line = self._lines[i]
        d = line.distance(p)
        if d > SNAP_MAX_M:
            return None
        t = line.project(p, normalized=True) if line.length > 0 else 0.0
        return Snap(i, float(t), float(d))

    # ---- distances ------------------------------------------------------
    def _csr(self, m: np.ndarray, extra: tuple[np.ndarray, np.ndarray, np.ndarray] | None = None):
        u, v, w = self.u[m], self.v[m], self.w[m]
        n = self.n
        if extra is not None:
            n += 1
            u, v, w = np.concatenate([u, extra[0]]), np.concatenate([v, extra[1]]), np.concatenate([w, extra[2]])
        a, b = np.minimum(u, v), np.maximum(u, v)
        order = np.lexsort((w, a * n + b))
        key = (a * n + b)[order]
        first = np.ones(len(key), dtype=bool)
        first[1:] = key[1:] != key[:-1]
        sel = order[first]
        return csr_matrix((w[sel], (a[sel], b[sel])), shape=(n, n))

    def _attach(self, snaps: list[Snap], m: np.ndarray, extra_m: np.ndarray | None = None):
        """Virtual-source edges for a set of snapped points (only through usable edges)."""

        src = self.n
        us, vs, ws = [], [], []
        for k, s in enumerate(snaps):
            if not m[s.edge]:
                continue
            base = s.connector_m + (0.0 if extra_m is None else float(extra_m[k]))
            L = self.w[s.edge]
            us += [self.u[s.edge], self.v[s.edge]]
            vs += [src, src]
            ws += [base + s.t * L, base + (1 - s.t) * L]
        return np.array(us, dtype=np.int64), np.array(vs, dtype=np.int64), np.array(ws, dtype=float)

    def node_dist(self, sources: list[Snap], m: np.ndarray, limit: float = INF, predecessors: bool = False):
        """Distance from the nearest of ``sources`` to every node, in state ``m``."""

        extra = self._attach(sources, m)
        if len(extra[0]) == 0:
            d = np.full(self.n + 1, INF)
            return (d, np.full(self.n + 1, -9999)) if predecessors else d
        g = self._csr(m, extra)
        out = dijkstra(g, directed=False, indices=self.n, limit=limit, return_predecessors=predecessors)
        return out

    def point_dist(self, d: np.ndarray, points: list[Snap | None], m: np.ndarray, sources: list[Snap] | None = None) -> np.ndarray:
        """Distance for snapped points given node distances ``d`` (from node_dist)."""

        out = np.full(len(points), INF)
        same: dict[int, list[Snap]] = {}
        for s in sources or []:
            same.setdefault(s.edge, []).append(s)
        for k, p in enumerate(points):
            if p is None or not m[p.edge]:
                continue
            L = self.w[p.edge]
            best = p.connector_m + min(p.t * L + d[self.u[p.edge]], (1 - p.t) * L + d[self.v[p.edge]])
            for s in same.get(p.edge, ()):  # a facility on the same block face
                best = min(best, p.connector_m + s.connector_m + abs(p.t - s.t) * L)
            out[k] = best
        return out

    def path_edges(self, pred: np.ndarray, d_nodes: np.ndarray, p: Snap, m: np.ndarray) -> list[str]:
        """Edges of the shortest path from a snapped point back to the virtual source."""

        if not m[p.edge]:
            return []
        L = self.w[p.edge]
        a, b = self.u[p.edge], self.v[p.edge]
        start = a if p.t * L + d_nodes[a] <= (1 - p.t) * L + d_nodes[b] else b
        if not np.isfinite(d_nodes[start]):
            return []
        lookup: dict[tuple[int, int], int] = {}
        for i in np.nonzero(m)[0]:
            k = (int(min(self.u[i], self.v[i])), int(max(self.u[i], self.v[i])))
            if k not in lookup or self.w[i] < self.w[lookup[k]]:
                lookup[k] = int(i)
        out = [self.edge_ids[p.edge]]
        x = int(start)
        while x != self.n and x >= 0:
            y = int(pred[x])
            if y < 0 or y == self.n:
                break
            k = (min(x, y), max(x, y))
            if k in lookup:
                out.append(self.edge_ids[lookup[k]])
            x = y
        return out
