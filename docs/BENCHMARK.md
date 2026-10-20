# StreetMend benchmark

Generated 2026-10-20 18:47 UTC by `scripts/benchmarks/run_benchmark.py` on Python 3.12.13 (Windows-11-10.0.26200-SP0). Raw results: `docs/benchmark_results.json`.

Objective: weighted reachable origin-destination pairs within the access threshold (healthcare priority weights 3/1/1 unless noted). Gains are objective increases over the unrepaired network. Baselines are the same implementations the product shows; nothing is tuned per instance.

## 1. Guided scenario (synthetic, designed to illustrate synergy)

Reported for transparency: this scenario was constructed to contain a dependent pair, so it is not evidence of typical gains.

| Priority | Budget | Exact selection | Exact gain | Greedy | Individual | Nearest | Combos | Runtime |
|---|---|---|---|---|---|---|---|---|
| balanced | 1 | E | 5 | 5 | 5 | 0 | 9 | 2.5 ms |
| balanced | 2 | A, B | 12 | 9 | 5 | 12 | 45 | 2.6 ms |
| balanced | 3 | A, B, E | 17 | 10 | 5 | 12 | 129 | 5.0 ms |
| balanced | 4 | A, B, E, K | 18 | 10 | 6 | 12 | 255 | 7.0 ms |
| healthcare | 1 | C | 8 | 8 | 8 | 0 | 9 | 2.2 ms |
| healthcare | 2 | A, B | 28 | 13 | 13 | 0 | 45 | 2.7 ms |
| healthcare | 3 | A, B, E | 33 | 14 | 13 | 28 | 129 | 3.9 ms |
| healthcare | 4 | A, B, E, K | 34 | 14 | 13 | 28 | 255 | 6.6 ms |
| transit | 1 | C | 8 | 8 | 8 | 0 | 9 | 2.5 ms |
| transit | 2 | A, B | 20 | 13 | 13 | 20 | 45 | 2.4 ms |
| transit | 3 | A, B, E | 25 | 14 | 13 | 20 | 129 | 3.9 ms |
| transit | 4 | A, B, E, K | 26 | 14 | 13 | 20 | 255 | 9.1 ms |
| education | 1 | E | 15 | 15 | 15 | 15 | 9 | 2.6 ms |
| education | 2 | C, E | 19 | 19 | 15 | 18 | 45 | 3.6 ms |
| education | 3 | A, B, E | 27 | 22 | 15 | 18 | 129 | 4.0 ms |
| education | 4 | A, B, E, K | 30 | 22 | 18 | 18 | 255 | 6.8 ms |

## 2. Randomized districts (corner/ramp topology)

40 seeds, the demo's street grid with 12% of curb ramps failing at random; every failed ramp is a candidate.

| Budget | Instances with gain | Baseline | Share below optimum | Mean ratio to optimum | Worst ratio | Mean exact runtime |
|---|---|---|---|---|---|---|
| 2 | 23/40 | greedy | 0.043 | 0.97 | 0.32 | 3.15 ms |
| 2 | 23/40 | independent | 0.261 | 0.901 | 0.2 | 3.15 ms |
| 2 | 23/40 | nearest | 0.739 | 0.411 | 0.0 | 3.15 ms |
| 3 | 23/40 | greedy | 0.043 | 0.969 | 0.286 | 6.86 ms |
| 3 | 23/40 | independent | 0.261 | 0.916 | 0.179 | 6.86 ms |
| 3 | 23/40 | nearest | 0.652 | 0.598 | 0.0 | 6.86 ms |

## 3. Unstructured random grids

40 seeds, 7x7 grid graphs with random blocked/unknown edges and 10 candidates; no crossing structure.

| Budget | Instances with gain | Baseline | Share below optimum | Mean ratio to optimum | Worst ratio | Mean exact runtime |
|---|---|---|---|---|---|---|
| 2 | 35/40 | greedy | 0.2 | 0.83 | 0.0 | 2.23 ms |
| 2 | 35/40 | independent | 0.343 | 0.77 | 0.0 | 2.23 ms |
| 2 | 35/40 | nearest | 0.857 | 0.267 | 0.0 | 2.23 ms |
| 3 | 35/40 | greedy | 0.257 | 0.805 | 0.0 | 3.07 ms |
| 3 | 35/40 | independent | 0.429 | 0.738 | 0.0 | 3.07 ms |
| 3 | 35/40 | nearest | 0.857 | 0.305 | 0.0 | 3.07 ms |

## 4. Charlotte, Elizabeth study area (real CDOT records + OSM)

Candidate graph: 2042 nodes, 2584 edges, 99 origins, 39 destinations. Results depend on the stated passability policy and on large UNKNOWN coverage gaps; see LIMITATIONS.md.

| Policy | Budget | Candidates | Solver | Selection | Gain | Greedy | Individual | Nearest | Combos | Runtime |
|---|---|---|---|---|---|---|---|---|---|---|
| strict | 1 | 232 | exact | R20691 | 39 | 39 | 39 | 0 | 206 | 36 ms |
| strict | 2 | 232 | exact | R20740, R20741 | 186 | 53 | 53 | 0 | 21321 | 3156 ms |
| strict | 3 | 232 | beam (approx.) | R20718, R20742, R21684 | 415 | 53 | 53 | 0 | 32413 | 6558 ms |
| moderate | 1 | 58 | exact | R21683 | 304 | 304 | 304 | 0 | 56 | 17 ms |
| moderate | 2 | 58 | exact | R20741, R21683 | 915 | 915 | 915 | 108 | 1596 | 233 ms |
| moderate | 3 | 58 | exact | R20737, R20741, R21683 | 1212 | 1212 | 1143 | 108 | 29316 | 6110 ms |
| lenient | 1 | 14 | exact | R12178 | 240 | 240 | 240 | 0 | 14 | 12 ms |
| lenient | 2 | 14 | exact | R105438, R12178 | 296 | 296 | 296 | 0 | 105 | 24 ms |
| lenient | 3 | 14 | exact | R105438, R10701, R12178 | 348 | 348 | 338 | 13 | 469 | 103 ms |

## Reading these results

- Exact enumeration is optimal only for the stated candidate set, objective and threshold.
- Where repairs act independently, greedy and individual ranking match the optimum; the advantage appears when value exists only in combination (for example both curb ramps of one crossing).
- Beam-search rows are approximate and are never described as optimal.
- Runtimes are wall-clock on the machine above, single process.
