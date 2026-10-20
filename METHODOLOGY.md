# Methodology

## 1. Pedestrian accessibility graph

**Nodes**
* *corner*: sidewalk junction at one corner of an intersection
* *curb*: curb-ramp landing / crossing endpoint
* *junction*: a sidewalk point where a place connects
* *origin*, *destination*

**Edges**
* *sidewalk*: one side of one street segment, between two corners
* *ramp*: corner ↔ curb landing; one per crossing direction (perpendicular ramp), or one record serving two crossings (diagonal ramp)
* *crossing*: curb ↔ curb across one intersection leg
* *entrance*: junction ↔ place connector

**Passability** (per edge)
* `traversable`: traversable under the stated model assumptions; not a field-verified guarantee
* `blocked`: known barrier
* `unknown`: no reliable evidence. Always excluded from modeled traversability.

A repaired candidate makes its edges traversable in simulation (shown as *repaired*). The underlying graph is never mutated.

**Evidence labels**: `synthetic`, `municipal_record`, `municipal_historical` (survey before 2022), `osm`, `inferred` (StreetMend geometry), `assumed` (explicit modeling assumption).

A crossing is usable only when the crossing edge **and** the ramp edges at both ends are traversable. That is exactly why two individually useless repairs can be jointly decisive.

## 2. Objective

```
Score(S) = Σ_{o∈O} Σ_{d∈D}  w_o · w_cat(d) · w_d · 1[ dist_S(o, d) ≤ L ]
```

* `dist_S(o,d)`: shortest network distance (metres, Dijkstra) over edges that are traversable in the base model or made traversable by repairs in `S`.
* `L`: access threshold. The demo uses 600 m and Charlotte uses 800 m; both are adjustable in the UI. It is a planning parameter, not a medical or legal standard.
* `w_cat`: planner priority weights. Presets: healthcare 3/1/1, transit 1/3/1, education 1/1/3, balanced 1/1/1; sliders allow any values 0–5.
* `w_o`: origin weight. Demo: 1 per residential cluster. Charlotte: number of OSM residential buildings aggregated on a sidewalk segment, which is a proxy and **not** population.
* `w_d`: destination weight, 1 by default.

The score counts **weighted origin–destination pairs**, not people. Relative gain is shown only when the baseline score is positive.

## 3. Solvers

**Exact enumeration** evaluates every repair set of size ≤ B (after sound pruning, see ARCHITECTURE.md). It returns the maximum score, preferring fewer repairs on ties, then lexicographically smaller IDs. The result is optimal for the stated candidate set, objective, weights and threshold. It is used whenever the pruned combination count is ≤ 150,000.

**Beam search** is used beyond that limit. Seeds:
* the exact optimum of the largest tractable smaller budget;
* all pairs among the 40 candidates with the highest leave-one-out potential.

The beam keeps width 60. It is reported as *approximate* and is never called optimal.

**Baselines**, implemented exactly as shown in the product (none is weakened):
* *Greedy*: repeatedly add the repair with the largest immediate gain; stop when none adds value.
* *Individual ranking*: score each repair alone and take the top B with positive gain.
* *Nearest to priority destination*: repair the barriers closest in straight-line distance to destinations of the highest-weighted category.

## 4. Explaining a recommendation

For the selected set S, the analysis reports:
* each repair's **gain alone**: `Score({i}) − Score(∅)`;
* its **marginal value within the set**: `Score(S) − Score(S∖{i})`;
* **synergy**: `gain(S) − Σ_i gain({i})`;
* newly connected O-D pairs with before/after route lengths, and newly reachable destinations;
* up to five alternative sets;
* comparison with every baseline;
* **sensitivity**: the same analysis with unknown edges treated as traversable (an optimistic bound).

Explanation sentences are generated from templates filled with these computed facts.

## 5. Synthetic guided scenario

Harbor District is a 6 × 4 street grid split by a four-lane boulevard (Harbor Blvd) that can be crossed only at two signalized intersections. Every corner has perpendicular curb ramps. Nine ramps are blocked candidates, and three sidewalk segments are unknown or missing. The Cedar St crossing of Harbor Blvd has failed ramps at both ends (A, B), so neither repair alone connects anything. Recommendations, routes and metrics are computed live. Only the scenario states are designed; outcomes are not hardcoded.

## 6. Charlotte candidate graph

Built from data (see DATA_SOURCES.md) in UTM 17N metres:

1. **Street skeleton.** OSM drive-network centerlines; motorways, trunks and busways are excluded. Street half-width comes from the highway class or lane count.
2. **Corners.** Each intersection gets one corner per angular sector between consecutive legs, placed on the sector bisector at `(half-width + 2.5 m) / sin(θ/2)`, capped at 22 m.
3. **Sidewalks.** One edge per street side, between matching corners. CDOT Sidewalk Inventory lines are matched to a side by perpendicular offset, direction (≤ 35°), coverage overlap and street-name agreement.
   * Coverage ≥ 40% of the segment: the majority presence class decides the state (`Sidewalk` → traversable; `No Sidewalk` / `Not possible to construct` → blocked).
   * Otherwise the side is UNKNOWN.
4. **Crossings and ramps.** At intersections with three or more legs, one crossing per leg joins the two adjacent corners through curb-ramp edges.
   * CDOT ramp records are grouped by `RP_IntID` and assigned to the nearest OSM intersection within 35 m. Ambiguous matches (second candidate within 1.3× distance) are flagged.
   * Each record goes to a corner by bearing sector, and to a crossing when its recorded crosswalk direction (`RP_XWalk1Dir` / `RP_XWalk2Dir`) is within 67.5° of the crossing direction.
   * A corner with no matching record → UNKNOWN.
5. **Ramp passability policy** (selectable; all are planning assumptions, not ADA determinations):

| Policy | Barrier (blocked, repair candidate) | Assumed passable |
|---|---|---|
| strict | every ramp not recorded compliant or remediated | compliant, remediated |
| moderate (default) | missing ramp; non-compliant with running slope > 12%, gutter lip ≥ 1 in, poor surface or recorded obstruction | other non-compliant ramps (labeled `assumed`), compliant, remediated |
| lenient | missing ramp only | every existing ramp |

   Remediated = Yes → traversable ("not field-verified"). Missing compliance status → UNKNOWN.

6. **Places.**
   * Destinations: OSM healthcare and education POIs, snapped to the nearest modeled sidewalk within 70 m (160 m for hospital and college campuses), plus CATS bus stops within 30 m.
   * Origins: OSM residential buildings, plus `building=yes` inside residential land use, assigned to the nearest sidewalk within 60 m and aggregated per segment.
   * Connectors are `inferred`; entrance accessibility is not verified.

## 7. Assistant

1. A deterministic rule parser handles common phrasing offline in well under 1 ms.
2. If it does not recognize the request and the local model is enabled and available, Ollama (`qwen3:4b`, temperature 0, JSON-schema constrained decoding) proposes an intent.
3. Every intent is validated by Pydantic against eleven allowlisted operations with typed arguments. Unknown repair IDs are rejected.
4. The operation runs in the engine. Facts are produced by templates from engine output.
5. Optional model narration is accepted only if every number in it (digits or number words) appears in the computed facts.

Measured on this machine (NVIDIA RTX 3050 Laptop GPU, 4 GB): about 3.7 s per warm model call, about 13 s cold.
