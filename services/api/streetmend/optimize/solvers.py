"""Repair-selection solvers.

* exact_enumeration - evaluates every combination of at most ``budget``
  candidates. Optimal within the candidate set and objective. Ties prefer
  fewer repairs, then lexicographically smaller id tuples (deterministic).
* greedy - repeatedly adds the candidate with the largest marginal gain,
  stopping when no candidate adds value. A standard, legitimate baseline.
* independent_ranking - ranks candidates by their individual (stand-alone)
  gain and takes the top ``budget`` with positive gain. This mirrors ranking
  each barrier in isolation.
* beam_search - approximate search for candidate sets too large to enumerate.
  Never reported as optimal.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from itertools import combinations
from math import comb

from .objective import Evaluator

EPS = 1e-9


@dataclass
class SolverResult:
    solver: str
    exact: bool
    selected: list[str]
    score: float
    evaluations: int
    runtime_ms: float
    candidate_count: int
    considered_count: int
    ranked_sets: list[tuple[list[str], float]] = field(default_factory=list)  # best alternatives
    notes: list[str] = field(default_factory=list)


def _better(a: tuple[float, tuple[str, ...]], b: tuple[float, tuple[str, ...]] | None) -> bool:
    """Higher score wins; then fewer repairs; then lexicographic ids."""

    if b is None:
        return True
    if a[0] > b[0] + EPS:
        return True
    if a[0] < b[0] - EPS:
        return False
    if len(a[1]) != len(b[1]):
        return len(a[1]) < len(b[1])
    return a[1] < b[1]


def combination_count(n: int, budget: int) -> int:
    return sum(comb(n, k) for k in range(0, min(budget, n) + 1))


def exact_enumeration(ev: Evaluator, candidates: list[str], budget: int, keep_top: int = 6, prune: bool = True) -> SolverResult:
    t0 = time.perf_counter()
    start_evals = ev.evaluations
    cands = sorted(candidates)
    considered = ev.relevant_interventions(cands) if prune else cands
    budget = max(0, budget)
    scored: list[tuple[float, tuple[str, ...]]] = []
    best: tuple[float, tuple[str, ...]] | None = None
    for k in range(0, min(budget, len(considered)) + 1):
        for combo in combinations(considered, k):
            s = ev.score(frozenset(combo))
            item = (s, combo)
            scored.append(item)
            if _better(item, best):
                best = item
    assert best is not None
    # Alternatives: best set per distinct score among sets of the maximal size
    # that do not merely pad the optimum with zero-value repairs.
    scored.sort(key=lambda t: (-t[0], len(t[1]), t[1]))
    ranked: list[tuple[list[str], float]] = []
    for s, combo in scored:
        if len(ranked) >= keep_top:
            break
        if any(set(prev) < set(combo) and abs(ps - s) < EPS for prev, ps in ranked):
            continue  # superset with no extra value
        ranked.append((list(combo), s))
    notes = []
    if prune and len(considered) < len(cands):
        notes.append(
            f"{len(cands) - len(considered)} candidate(s) were pruned because they cannot lie on any "
            "origin-destination path within the access threshold even if every candidate were repaired "
            "(provably zero marginal value)."
        )
    return SolverResult(
        solver="exact_enumeration",
        exact=True,
        selected=list(best[1]),
        score=best[0],
        evaluations=ev.evaluations - start_evals,
        runtime_ms=(time.perf_counter() - t0) * 1000,
        candidate_count=len(cands),
        considered_count=len(considered),
        ranked_sets=ranked,
        notes=notes,
    )


def greedy(ev: Evaluator, candidates: list[str], budget: int) -> SolverResult:
    t0 = time.perf_counter()
    start_evals = ev.evaluations
    cands = sorted(candidates)
    chosen: list[str] = []
    current = ev.score(frozenset())
    notes = []
    for _ in range(max(0, budget)):
        best_gain, best_c = 0.0, None
        for c in cands:
            if c in chosen:
                continue
            g = ev.score(frozenset(chosen + [c])) - current
            if g > best_gain + EPS:
                best_gain, best_c = g, c
        if best_c is None:
            notes.append("Stopped early: no remaining candidate has a positive immediate gain on its own.")
            break
        chosen.append(best_c)
        current += best_gain
    return SolverResult(
        solver="greedy",
        exact=False,
        selected=chosen,
        score=ev.score(frozenset(chosen)),
        evaluations=ev.evaluations - start_evals,
        runtime_ms=(time.perf_counter() - t0) * 1000,
        candidate_count=len(cands),
        considered_count=len(cands),
        notes=notes,
    )


def independent_ranking(ev: Evaluator, candidates: list[str], budget: int) -> SolverResult:
    t0 = time.perf_counter()
    start_evals = ev.evaluations
    cands = sorted(candidates)
    base = ev.score(frozenset())
    gains = sorted(((ev.score(frozenset([c])) - base, c) for c in cands), key=lambda t: (-t[0], t[1]))
    chosen = [c for g, c in gains if g > EPS][: max(0, budget)]
    notes = []
    if len(chosen) < budget:
        notes.append("Fewer repairs than the budget were selected because the remaining candidates have zero individual gain.")
    return SolverResult(
        solver="independent_ranking",
        exact=False,
        selected=chosen,
        score=ev.score(frozenset(chosen)),
        evaluations=ev.evaluations - start_evals,
        runtime_ms=(time.perf_counter() - t0) * 1000,
        candidate_count=len(cands),
        considered_count=len(cands),
        ranked_sets=[([c], base + g) for g, c in gains],
        notes=notes,
    )


def beam_search(ev: Evaluator, candidates: list[str], budget: int, width: int = 40) -> SolverResult:
    """Approximate search. Seeds include high-potential pairs so that synergistic
    pairs with zero stand-alone value are not discarded at the first level."""

    t0 = time.perf_counter()
    start_evals = ev.evaluations
    cands = sorted(candidates)
    considered = ev.relevant_interventions(cands)
    full = frozenset(considered)
    full_score = ev.score(full)
    # Leave-one-out potential in the fully repaired network.
    potential = {c: full_score - ev.score(full - {c}) for c in considered}
    ordered = sorted(considered, key=lambda c: (-potential[c], c))
    beam: list[tuple[float, tuple[str, ...]]] = [(ev.score(frozenset()), ())]
    best = beam[0]
    top = ordered[: min(len(ordered), 25)]
    seeds = [(ev.score(frozenset(p)), tuple(sorted(p))) for p in combinations(top, 2)] if budget >= 2 else []
    for level in range(1, max(0, budget) + 1):
        nxt: dict[tuple[str, ...], float] = {}
        for _, s in beam:
            for c in considered:
                if c in s:
                    continue
                t = tuple(sorted(s + (c,)))
                if t not in nxt:
                    nxt[t] = ev.score(frozenset(t))
        if level == 2:
            for sc, t in seeds:
                nxt[t] = sc
        if not nxt:
            break
        beam = sorted(((v, k) for k, v in nxt.items()), key=lambda t: (-t[0], t[1]))[:width]
        for item in beam:
            if _better(item, best):
                best = item
    return SolverResult(
        solver="beam_search",
        exact=False,
        selected=list(best[1]),
        score=best[0],
        evaluations=ev.evaluations - start_evals,
        runtime_ms=(time.perf_counter() - t0) * 1000,
        candidate_count=len(cands),
        considered_count=len(considered),
        notes=[f"Approximate result (beam width {width}); not guaranteed optimal."],
    )


def solve(ev: Evaluator, candidates: list[str], budget: int, max_exact_evaluations: int = 20_000) -> SolverResult:
    """Exact when the (pruned) combination count is tractable, otherwise beam search."""

    considered = ev.relevant_interventions(sorted(candidates))
    if combination_count(len(considered), budget) <= max_exact_evaluations:
        return exact_enumeration(ev, candidates, budget)
    return beam_search(ev, candidates, budget)
