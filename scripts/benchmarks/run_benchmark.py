"""Reproducible benchmark: combination-aware exact search vs simple baselines.

Families
1. guided      - the synthetic Harbor District demo (designed to exhibit synergy;
                 reported for transparency, not as evidence of typical gains)
2. districts   - 40 randomized synthetic districts with the same corner/ramp
                 topology but random ramp failures (every failed ramp is a
                 candidate). Seeds 0..39, failure rate 12%.
3. grids       - 40 unstructured random grid graphs (no ramp/crossing structure)
4. charlotte   - the real Elizabeth (Charlotte NC) candidate graph under each
                 passability policy

Baselines are run exactly as implemented in the product (greedy marginal gain,
individual ranking, nearest to priority destination). Nothing is tuned per
instance.

    uv run --project services/api python scripts/benchmarks/run_benchmark.py
"""

from __future__ import annotations

import importlib.util
import json
import platform
import random
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "api"))

from streetmend.graph import Passability  # noqa: E402
from streetmend.optimize.analysis import nearest_to_destination  # noqa: E402
from streetmend.optimize.objective import PRIORITY_PRESETS, Evaluator  # noqa: E402
from streetmend.optimize.solvers import greedy, independent_ranking, solve  # noqa: E402
from streetmend.scenario import demo as demo_mod  # noqa: E402
from streetmend.scenario.demo import RampSpec, build_demo_scenario  # noqa: E402

OUT_MD = ROOT / "docs" / "BENCHMARK.md"
OUT_JSON = ROOT / "docs" / "benchmark_results.json"


def run_instance(sc, weights, budget):
    ev = Evaluator(sc, weights)
    base = ev.score()
    cands = list(sc.interventions)
    t0 = time.perf_counter()
    opt = solve(ev, cands, budget)
    t_opt = (time.perf_counter() - t0) * 1000
    res = {"base": base, "candidates": len(cands), "budget": budget, "solver": opt.solver, "exact": opt.exact,
           "evaluations": opt.evaluations, "runtime_ms": round(t_opt, 2), "opt_gain": opt.score - base, "opt_selected": opt.selected}
    for name, fn in (("greedy", greedy), ("independent", independent_ranking), ("nearest", nearest_to_destination)):
        r = fn(ev, cands, budget)
        res[f"{name}_gain"] = r.score - base
        res[f"{name}_selected"] = r.selected
    return res


def summarize(rows):
    nz = [r for r in rows if r["opt_gain"] > 0]
    out = {"instances": len(rows), "instances_with_positive_gain": len(nz)}
    for b in ("greedy", "independent", "nearest"):
        worse = [r for r in nz if r[f"{b}_gain"] < r["opt_gain"] - 1e-9]
        ratios = [r[f"{b}_gain"] / r["opt_gain"] for r in nz]
        out[b] = {
            "share_below_optimum": round(len(worse) / len(nz), 3) if nz else None,
            "mean_ratio_to_optimum": round(statistics.mean(ratios), 3) if ratios else None,
            "min_ratio_to_optimum": round(min(ratios), 3) if ratios else None,
        }
    out["mean_runtime_ms"] = round(statistics.mean(r["runtime_ms"] for r in rows), 2)
    out["max_runtime_ms"] = round(max(r["runtime_ms"] for r in rows), 2)
    out["all_exact"] = all(r["exact"] for r in rows)
    return out


def random_district(seed: int, p_fail: float = 0.12):
    """Synthetic district with the demo's topology and random ramp failures."""

    clean = build_demo_scenario()
    ramp_keys = []
    for eid, e in clean.graph.edges.items():
        if e.kind.value == "ramp":
            _, ij, c, axis = eid.split(":")
            i, j = map(int, ij.split(","))
            ramp_keys.append((i, j, c, axis))
    rng = random.Random(seed)
    failed = sorted(k for k in ramp_keys if rng.random() < p_fail)
    specs = {k: RampSpec(Passability.BLOCKED, "random failure", f"F{n}", f"ramp {k}") for n, k in enumerate(failed)}
    saved = demo_mod.RAMPS
    try:
        demo_mod.RAMPS = specs
        sc = build_demo_scenario()
    finally:
        demo_mod.RAMPS = saved
    sc.id = f"district-{seed}"
    return sc


def load_grid_generator():
    spec = importlib.util.spec_from_file_location("conftest_gen", ROOT / "services" / "api" / "tests" / "conftest.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.random_scenario


def main() -> None:
    results: dict = {"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
                     "machine": {"python": platform.python_version(), "platform": platform.platform(), "processor": platform.processor()}}
    hw = PRIORITY_PRESETS["healthcare"]

    # 1. guided scenario
    guided = []
    sc = build_demo_scenario()
    for preset, w in PRIORITY_PRESETS.items():
        for b in (1, 2, 3, 4):
            r = run_instance(sc, w, b)
            r["priority"] = preset
            guided.append(r)
    results["guided"] = guided

    # 2. randomized districts (structured topology)
    districts = {}
    for b in (2, 3):
        rows = []
        for seed in range(40):
            rows.append({"seed": seed, **run_instance(random_district(seed), hw, b)})
        districts[b] = {"summary": summarize(rows), "rows": rows}
    results["districts"] = {str(k): v for k, v in districts.items()}

    # 3. unstructured random grids
    gen = load_grid_generator()
    grids = {}
    for b in (2, 3):
        rows = [{"seed": s, **run_instance(gen(s, n=7, n_cand=10), hw, b)} for s in range(40)]
        grids[b] = {"summary": summarize(rows), "rows": rows}
    results["grids"] = {str(k): v for k, v in grids.items()}

    # 4. Charlotte
    charlotte = []
    try:
        from streetmend.municipal.scenario import load_municipal_scenario

        for policy in ("strict", "moderate", "lenient"):
            msc = load_municipal_scenario(policy)
            for b in (1, 2, 3):
                r = run_instance(msc, hw, b)
                r.update(policy=policy, nodes=len(msc.graph.nodes), edges=len(msc.graph.edges), origins=len(msc.origins),
                         destinations=len(msc.destinations))
                charlotte.append(r)
    except FileNotFoundError as exc:
        results["charlotte_error"] = str(exc)
    results["charlotte"] = charlotte

    OUT_JSON.write_text(json.dumps(results, indent=1, default=str), encoding="utf-8")
    OUT_MD.write_text(render(results), encoding="utf-8")
    print(render(results))


def render(R) -> str:
    L = ["# StreetMend benchmark", "",
         f"Generated {R['generated_at']} by `scripts/benchmarks/run_benchmark.py` on Python {R['machine']['python']} "
         f"({R['machine']['platform']}). Raw results: `docs/benchmark_results.json`.", "",
         "Objective: weighted reachable origin-destination pairs within the access threshold "
         "(healthcare priority weights 3/1/1 unless noted). Gains are objective increases over the unrepaired network. "
         "Baselines are the same implementations the product shows; nothing is tuned per instance.", ""]
    L += ["## 1. Guided scenario (synthetic, designed to illustrate synergy)", "",
          "Reported for transparency: this scenario was constructed to contain a dependent pair, so it is not evidence of typical gains.", "",
          "| Priority | Budget | Exact selection | Exact gain | Greedy | Individual | Nearest | Combos | Runtime |", "|---|---|---|---|---|---|---|---|---|"]
    for r in R["guided"]:
        L.append(f"| {r['priority']} | {r['budget']} | {', '.join(r['opt_selected']) or '-'} | {r['opt_gain']:g} | {r['greedy_gain']:g} | "
                 f"{r['independent_gain']:g} | {r['nearest_gain']:g} | {r['evaluations']} | {r['runtime_ms']:.1f} ms |")
    for key, title, desc in (("districts", "2. Randomized districts (corner/ramp topology)",
                              "40 seeds, the demo's street grid with 12% of curb ramps failing at random; every failed ramp is a candidate."),
                             ("grids", "3. Unstructured random grids", "40 seeds, 7x7 grid graphs with random blocked/unknown edges and 10 candidates; no crossing structure.")):
        L += ["", f"## {title}", "", desc, "", "| Budget | Instances with gain | Baseline | Share below optimum | Mean ratio to optimum | Worst ratio | Mean exact runtime |",
              "|---|---|---|---|---|---|---|"]
        for b, v in R[key].items():
            s = v["summary"]
            for name in ("greedy", "independent", "nearest"):
                L.append(f"| {b} | {s['instances_with_positive_gain']}/{s['instances']} | {name} | {s[name]['share_below_optimum']} | "
                         f"{s[name]['mean_ratio_to_optimum']} | {s[name]['min_ratio_to_optimum']} | {s['mean_runtime_ms']} ms |")
    if R.get("charlotte"):
        c0 = R["charlotte"][0]
        L += ["", "## 4. Charlotte, Elizabeth study area (real CDOT records + OSM)", "",
              f"Candidate graph: {c0['nodes']} nodes, {c0['edges']} edges, {c0['origins']} origins, {c0['destinations']} destinations. "
              "Results depend on the stated passability policy and on large UNKNOWN coverage gaps; see LIMITATIONS.md.", "",
              "| Policy | Budget | Candidates | Solver | Selection | Gain | Greedy | Individual | Nearest | Combos | Runtime |",
              "|---|---|---|---|---|---|---|---|---|---|---|"]
        for r in R["charlotte"]:
            L.append(f"| {r['policy']} | {r['budget']} | {r['candidates']} | {'exact' if r['exact'] else 'beam (approx.)'} | {', '.join(r['opt_selected'])} | "
                     f"{r['opt_gain']:g} | {r['greedy_gain']:g} | {r['independent_gain']:g} | {r['nearest_gain']:g} | {r['evaluations']} | {r['runtime_ms']:.0f} ms |")
    L += ["", "## Reading these results", "",
          "- Exact enumeration is optimal only for the stated candidate set, objective and threshold.",
          "- Where repairs act independently, greedy and individual ranking match the optimum; the advantage appears when value exists only in combination "
          "(for example both curb ramps of one crossing).",
          "- Beam-search rows are approximate and are never described as optimal.",
          "- Runtimes are wall-clock on the machine above, single process.", ""]
    return "\n".join(L)


if __name__ == "__main__":
    main()
