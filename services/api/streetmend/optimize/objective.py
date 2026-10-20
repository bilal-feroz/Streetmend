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
    fast: bool = True  # key-node evaluation (exact); False = full Dijkstra per set

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
        self._cache: dict[frozenset[str], np.ndarray] = {}  # bounded: distance matrices
        self._score_cache: dict[frozenset[str], float] = {}
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
        """Origin x destination network distances in metres (inf = unreachable).

        Exact for every distance within the access threshold. Uses the
        key-node method (``_distances_fast``) unless ``fast`` is disabled.
        """

        key = frozenset(applied)
        hit = self._cache.get(key)
        if hit is not None:
            return hit
        unknown = key - self._iv.keys()
        if unknown:
            raise KeyError(f"unknown interventions: {sorted(unknown)}")
        if len(self._oi) == 0 or len(self._di) == 0:
            d = np.full((len(self._oi), len(self._di)), np.inf)
        elif self.fast:
            d = self._distances_fast(key)
        else:
            d = self._distances_full(key)
        if len(self._cache) >= 256:
            self._cache.pop(next(iter(self._cache)))
        self._cache[key] = d
        return d

    def _distances_full(self, key: frozenset[str]) -> np.ndarray:
        limit = np.inf if self.cutoff_m is None else self.cutoff_m + 1e-9
        full = dijkstra(self._matrix(key), directed=False, indices=self._oi, limit=limit)
        return np.atleast_2d(full)[:, self._di]

    # ---- key-node evaluation -------------------------------------------
    # Any route in G + S that uses repaired edges enters the first repaired
    # edge at some endpoint a and leaves the last one at endpoint b, with base
    # network (G) shortest paths in between. So with base distances
    #   A = origins->P, B = P->destinations, K = P->P   (P: candidate endpoints)
    # the distance in G + S is min(D0, min_{a,b} A[o,a] + M*[a,b] + B[b,d]),
    # where M* is the all-pairs closure (Floyd-Warshall) over S's endpoints of
    # K plus S's edges. Precomputation runs one multi-source Dijkstra; every
    # combination afterwards costs a few tiny array operations.
    def _prepare_fast(self) -> None:
        pts = sorted({int(x) for r, c, _ in self._iv.values() for x in np.concatenate([r, c])})
        self._P = np.array(pts, dtype=np.int64)
        pos = {n: i for i, n in enumerate(pts)}
        self._ivl = {k: (np.array([pos[int(x)] for x in r]), np.array([pos[int(x)] for x in c]), w) for k, (r, c, w) in self._iv.items()}
        limit = np.inf if self.cutoff_m is None else self.cutoff_m + 1e-9
        src = np.concatenate([self._oi, self._P]) if len(self._P) else self._oi
        full = np.atleast_2d(dijkstra(self._matrix(frozenset()), directed=False, indices=src, limit=limit))
        no = len(self._oi)
        self._D0 = full[:no][:, self._di]
        self._A = full[:no][:, self._P] if len(self._P) else np.zeros((no, 0))
        self._B = full[no:][:, self._di] if len(self._P) else np.zeros((0, len(self._di)))
        self._K = full[no:][:, self._P] if len(self._P) else np.zeros((0, 0))
        # Batch kernel works only on origins/destinations that some repair could
        # possibly connect, and only on pairs not already reachable at baseline.
        lim = np.inf if self.cutoff_m is None else self.cutoff_m + 1e-9
        base_reach = self._D0 <= lim if self.cutoff_m is not None else np.isfinite(self._D0)
        self._base_score = float((self.pair_weights * base_reach).sum())
        ro = np.flatnonzero(np.isfinite(self._A).any(axis=1)) if self._A.size else np.zeros(0, dtype=np.int64)
        rd = np.flatnonzero(np.isfinite(self._B).any(axis=0)) if self._B.size else np.zeros(0, dtype=np.int64)
        self._bo, self._bd = ro, rd
        self._bA = self._A[ro].astype(np.float32)
        self._bB = self._B[:, rd].astype(np.float32)
        self._bK = self._K.astype(np.float32)
        self._bD0 = self._D0[np.ix_(ro, rd)].astype(np.float32)
        self._bW = (self.pair_weights[np.ix_(ro, rd)] * ~base_reach[np.ix_(ro, rd)]).astype(np.float32)
        self._fast_ready = True

    def _distances_fast(self, key: frozenset[str]) -> np.ndarray:
        if not getattr(self, "_fast_ready", False):
            self._prepare_fast()
        if not key:
            return self._D0
        parts = [self._ivl[i] for i in sorted(key)]
        ea = np.concatenate([p[0] for p in parts])
        eb = np.concatenate([p[1] for p in parts])
        ew = np.concatenate([p[2] for p in parts])
        sub, inv = np.unique(np.concatenate([ea, eb]), return_inverse=True)
        m = len(sub)
        if m > 48:  # closure cost grows as m^3; a full Dijkstra is cheaper for large sets
            return self._distances_full(key)
        ia, ib = inv[: len(ea)], inv[len(ea):]
        M = self._K[np.ix_(sub, sub)].copy()
        for a, b, w in zip(ia, ib, ew):
            if w < M[a, b]:
                M[a, b] = M[b, a] = w
        np.fill_diagonal(M, 0.0)
        for k in range(m):  # Floyd-Warshall on at most 2|S| nodes
            np.minimum(M, M[:, k : k + 1] + M[k : k + 1, :], out=M)
        T = (self._A[:, sub][:, :, None] + M[None, :, :]).min(axis=1)
        R = (T[:, :, None] + self._B[sub, :][None, :, :]).min(axis=1)
        return np.minimum(self._D0, R)

    def reachable(self, applied=frozenset()) -> np.ndarray:
        d = self.distances(applied)
        if self.cutoff_m is None:
            return np.isfinite(d)
        return d <= self.cutoff_m + 1e-9

    def score(self, applied=frozenset()) -> float:
        """Objective value; ``evaluations`` counts distinct repair sets scored."""

        key = frozenset(applied)
        hit = self._score_cache.get(key)
        if hit is None:
            self.evaluations += 1
            hit = float((self.pair_weights * self.reachable(key)).sum())
            self._score_cache[key] = hit
        return hit

    def score_many(self, sets: list[tuple[str, ...]] | list[frozenset[str]], batch: int = 192) -> list[float]:
        """Score many repair sets at once (vectorised key-node evaluation).

        Same result as ``[score(s) for s in sets]``; used by the solvers so
        exact enumeration over tens of thousands of combinations stays fast.
        """

        keys = [frozenset(s) for s in sets]
        out: list[float | None] = [self._score_cache.get(k) for k in keys]
        todo = [i for i, v in enumerate(out) if v is None]
        if not todo:
            return [float(v) for v in out]  # type: ignore[arg-type]
        if not self.fast or len(self._oi) == 0 or len(self._di) == 0:
            for i in todo:
                out[i] = self.score(keys[i])
            return [float(v) for v in out]  # type: ignore[arg-type]
        if not getattr(self, "_fast_ready", False):
            self._prepare_fast()
        lim = np.inf if self.cutoff_m is None else self.cutoff_m + 1e-9
        by_len: dict[int, list[int]] = {}
        for i in todo:
            n_edges = sum(len(self._ivl[x][0]) for x in keys[i])
            by_len.setdefault(n_edges, []).append(i)
        for n_edges, idxs in by_len.items():
            if n_edges == 0:
                for i in idxs:
                    out[i] = self.score(keys[i])
                continue
            if 2 * n_edges > 48:
                for i in idxs:
                    out[i] = self.score(keys[i])
                continue
            for start in range(0, len(idxs), batch):
                chunk = idxs[start : start + batch]
                P = np.empty((len(chunk), 2 * n_edges), dtype=np.int64)
                W = np.empty((len(chunk), n_edges))
                for r, i in enumerate(chunk):
                    parts = [self._ivl[x] for x in sorted(keys[i])]
                    a = np.concatenate([p[0] for p in parts])
                    b = np.concatenate([p[1] for p in parts])
                    P[r, 0::2], P[r, 1::2] = a, b
                    W[r] = np.concatenate([p[2] for p in parts])
                M = self._bK[P[:, :, None], P[:, None, :]]
                rows = np.arange(len(chunk))
                W32 = W.astype(np.float32)
                for e in range(n_edges):
                    ia, ib = 2 * e, 2 * e + 1
                    v = np.minimum(M[rows, ia, ib], W32[:, e])
                    M[rows, ia, ib] = v
                    M[rows, ib, ia] = v
                for k in range(2 * n_edges):
                    np.minimum(M, M[:, :, k : k + 1] + M[:, k : k + 1, :], out=M)
                A = np.transpose(self._bA[:, P], (1, 0, 2))  # (B, n_o', m)
                T = (A[:, :, :, None] + M[:, None, :, :]).min(axis=2)
                R = (T[:, :, :, None] + self._bB[P][:, None, :, :]).min(axis=2)  # (B, n_o', n_d')
                # float32 on sums of metres: compare with a small tolerance
                reach = R <= np.float32(lim) + np.float32(1e-3) if self.cutoff_m is not None else np.isfinite(R)
                scores = self._base_score + (self._bW[None] * reach).sum(axis=(1, 2), dtype=np.float64)
                for r, i in enumerate(chunk):
                    out[i] = float(scores[r])
                    self._score_cache[keys[i]] = float(scores[r])
                    self.evaluations += 1
        return [float(v) for v in out]  # type: ignore[arg-type]

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
