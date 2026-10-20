"""Accessibility objective and fast batch evaluation.

ReachabilityScore(S) = sum_{o in O} sum_{d in D} w_o * w_cat(d) * w_d * 1[dist_S(o, d) <= L]

where dist_S is the shortest network distance over edges that are traversable
in the base model or made traversable by the interventions in S, and L is the
scenario's access threshold (infinite when the scenario sets none).

Evaluation uses scipy's compiled Dijkstra on a CSR matrix so that exact
enumeration over candidate combinations stays fast. Results are cached per
intervention set. A NetworkX cross-check lives in the test suite.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra

from streetmend.graph import DestinationCategory, Passability
from streetmend.scenario.model import Scenario


@dataclass(frozen=True)
class CategoryWeights:
    healthcare: float = 1.0
    transit: float = 1.0
    education: float = 1.0

    def of(self, cat: DestinationCategory) -> float:
        return float(getattr(self, cat.value))

    def as_dict(self) -> dict[str, float]:
        return {"healthcare": self.healthcare, "transit": self.transit, "education": self.education}


PRIORITY_PRESETS: dict[str, CategoryWeights] = {
    "balanced": CategoryWeights(1, 1, 1),
    "healthcare": CategoryWeights(3, 1, 1),
    "transit": CategoryWeights(1, 3, 1),
    "education": CategoryWeights(1, 1, 3),
}


@dataclass
class Evaluator:
    scenario: Scenario
    weights: CategoryWeights = field(default_factory=CategoryWeights)
    include_unknown: bool = False  # sensitivity analysis only
    cutoff_m: float | None = None  # defaults to scenario.max_distance_m

    def __post_init__(self) -> None:
        sc = self.scenario
        if self.cutoff_m is None:
            self.cutoff_m = sc.max_distance_m
        g = sc.graph
        self.node_ids = sorted(g.nodes)
        self.index = {n: i for i, n in enumerate(self.node_ids)}
        rows, cols, w = [], [], []
        for e in g.edges.values():
            if e.state == Passability.TRAVERSABLE or (self.include_unknown and e.state == Passability.UNKNOWN):
                rows.append(self.index[e.u])
                cols.append(self.index[e.v])
                w.append(e.length_m)
        self._base = (np.array(rows, dtype=np.int64), np.array(cols, dtype=np.int64), np.array(w, dtype=float))
        self._iv: dict[str, tuple[np.ndarray, np.ndarray, np.ndarray]] = {}
        for iv in sc.interventions.values():
            es = [g.edges[eid] for eid in iv.edge_ids]
            self._iv[iv.id] = (
                np.array([self.index[e.u] for e in es], dtype=np.int64),
                np.array([self.index[e.v] for e in es], dtype=np.int64),
                np.array([e.length_m for e in es], dtype=float),
            )
        self.origin_ids = [o.id for o in sc.origins]
        self.dest_ids = [d.id for d in sc.destinations]
        self._oi = np.array([self.index[o] for o in self.origin_ids], dtype=np.int64)
        self._di = np.array([self.index[d] for d in self.dest_ids], dtype=np.int64)
        self.w_o = np.array([o.weight for o in sc.origins], dtype=float)
        self.w_d = np.array([d.weight * self.weights.of(d.category) for d in sc.destinations], dtype=float)
        self.pair_weights = np.outer(self.w_o, self.w_d)
        self._cache: dict[frozenset[str], np.ndarray] = {}
        self.evaluations = 0

    # ------------------------------------------------------------------
    def _matrix(self, applied: frozenset[str]) -> csr_matrix:
        parts = [self._base] + [self._iv[i] for i in sorted(applied)]
        r = np.concatenate([p[0] for p in parts])
        c = np.concatenate([p[1] for p in parts])
        w = np.concatenate([p[2] for p in parts])
        # Undirected: store each pair once as (min, max) and keep the shortest
        # parallel edge. csr_matrix would otherwise *sum* duplicate entries.
        a, b = np.minimum(r, c), np.maximum(r, c)
        order = np.lexsort((w, b, a))
        a, b, w = a[order], b[order], w[order]
        if len(a):
            keep = np.ones(len(a), dtype=bool)
            keep[1:] = (a[1:] != a[:-1]) | (b[1:] != b[:-1])
            a, b, w = a[keep], b[keep], w[keep]
        n = len(self.node_ids)
        return csr_matrix((w, (a, b)), shape=(n, n))

    def distances(self, applied: frozenset[str] | set[str] | list[str] = frozenset()) -> np.ndarray:
        """Origin x destination network distances in metres (inf = unreachable)."""

        key = frozenset(applied)
        hit = self._cache.get(key)
        if hit is not None:
            return hit
        unknown = key - self._iv.keys()
        if unknown:
            raise KeyError(f"unknown interventions: {sorted(unknown)}")
        self.evaluations += 1
        m = self._matrix(key)
        if len(self._oi) == 0 or len(self._di) == 0:
            d = np.full((len(self._oi), len(self._di)), np.inf)
        else:
            limit = np.inf if self.cutoff_m is None else self.cutoff_m + 1e-9
            full = dijkstra(m, directed=False, indices=self._oi, limit=limit)
            d = np.atleast_2d(full)[:, self._di]
        self._cache[key] = d
        return d

    def reachable(self, applied=frozenset()) -> np.ndarray:
        d = self.distances(applied)
        if self.cutoff_m is None:
            return np.isfinite(d)
        return d <= self.cutoff_m + 1e-9

    def score(self, applied=frozenset()) -> float:
        return float((self.pair_weights * self.reachable(applied)).sum())

    def max_possible_score(self) -> float:
        return float(self.pair_weights.sum())

    def gain(self, applied, base=frozenset()) -> float:
        return self.score(applied) - self.score(base)

    # ------------------------------------------------------------------
    def relevant_interventions(self, candidates: list[str]) -> list[str]:
        """Sound pruning: keep only candidates that can lie on some origin ->
        destination path within the threshold when *every* candidate is
        repaired. Others have zero marginal gain for every repair set."""

        if not candidates:
            return []
        m = self._matrix(frozenset(candidates))
        limit = np.inf if self.cutoff_m is None else self.cutoff_m + 1e-9
        from_o = np.atleast_2d(dijkstra(m, directed=False, indices=self._oi, limit=limit)).min(axis=0)
        to_d = np.atleast_2d(dijkstra(m, directed=False, indices=self._di, limit=limit)).min(axis=0)
        keep = []
        for cid in candidates:
            r, c, w = self._iv[cid]
            best = np.minimum(from_o[r] + w + to_d[c], from_o[c] + w + to_d[r]).min()
            if np.isfinite(best) and (self.cutoff_m is None or best <= self.cutoff_m + 1e-9):
                keep.append(cid)
        return keep
