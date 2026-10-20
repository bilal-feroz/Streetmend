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
* `L`: access threshold. The guided scenario and Charlotte use 800 m (the synthetic test district uses 600 m); it is adjustable in the UI. It is a planning parameter, not a medical or legal standard.
* `w_cat`: planner priority weights. Presets: healthcare 3/1/1, transit 1/3/1, education 1/1/3, balanced 1/1/1; sliders allow any values 0–5.
* `w_o`: origin weight. Charlotte and the guided scenario: number of OSM residential buildings aggregated on a sidewalk segment, which is a proxy and **not** population. Synthetic test district: 1 per residential cluster.
* `w_d`: destination weight, 1 by default.

The score counts **weighted origin–destination pairs**, not people. Relative gain is shown only when the baseline score is positive.

## 3. Solvers

**Exact enumeration** evaluates every repair set of size ≤ B (after sound pruning, see ARCHITECTURE.md). It returns the maximum score, preferring fewer repairs on ties, then lexicographically smaller IDs. The result is optimal for the stated candidate set, objective, weights and threshold. It is used whenever the pruned combination count is ≤ 150,000.

**Beam search** is used beyond that limit. Seeds:
* the exact optimum of the largest tractable smaller budget;
* all pairs among the 40 candidates with the highest leave-one-out potential.

The beam keeps width 60. If greedy finds a better set, the greedy set is reported instead, so the heuristic never shows less than a baseline. It is reported as *approximate* and is never called optimal.

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
* **sensitivity**: the same analysis with unknown edges treated as traversable (an optimistic bound). The optimistic optimum is computed exactly when it needs at most 25,000 combinations; otherwise a greedy set is shown, labeled as such, and no claim is made about whether the recommendation would change.

Explanation sentences are generated from templates filled with these computed facts.

## 5. Guided scenario: real streets, hypothetical barriers

The guided scenario runs on the real Elizabeth candidate graph (§6): the same corners, crossings, curb landings, sidewalk sides, destinations and bus stops. Only the **passability states are hypothetical**:

* every modeled link is set to *traversable* with evidence `assumed` and the reason "Hypothetical scenario: assumed traversable (scenario setting, not a survey finding)";
* the barrier states listed in `data/scenarios/charlotte_guided.json` are set to *blocked* and tagged `hypothetical`:
  * the curb ramps at both ends of the East 7th Street crossing at Hawthorne Lane (repair candidates A and B);
  * two decoy ramps on Hawthorne Lane (D, E);
  * two "no usable crossing" settings that keep the detour longer than the threshold.

The configuration was found by `scripts/scenarios/design_guided.py`, which searched the real graph for a crossing on a short home → Novant Health Presbyterian route where the engine confirms four facts:
* the journey is unavailable with neither repair, with A only and with B only;
* A + B reconnects it within 800 m;
* exact search selects A + B at budget 2;
* a simple baseline does worse.

`tests/test_guided.py` re-verifies every one of these claims against the engine. The journey has 14 origins and 6 destinations:
* Novant Health Presbyterian;
* St. Jude Affiliate Clinic;
* ABS Kids;
* Elizabeth Traditional Elementary;
* CATS stops 07930 and 07980.

Recommendations, routes and metrics are computed live; only the scenario states are designed. The UI labels the scenario *Hypothetical barriers · real Charlotte streets* on the map and in every barrier's details, so no viewer should read a barrier as a claim about real conditions at that corner.

The original fully synthetic Harbor District (a 6 × 4 grid split by a boulevard, with a dependent pair A, B on the Cedar St crossing) remains in the engine as a test fixture and as section 1b of the benchmark.

## 6. Charlotte candidate graph

Built from data (see DATA_SOURCES.md) in UTM 17N metres:

1. **Street skeleton.** OSM drive-network centerlines; motorways, trunks and busways are excluded. Street half-width comes from the highway class or lane count.
2. **Corners.** Each intersection gets one corner per angular sector between consecutive legs, placed on the sector bisector at `(half-width + 2.5 m) / sin(θ/2)`, capped at 22 m. A dead end (cul-de-sac, or a street cut by the study-area edge) gets separate left and right corners, so the two sides of a street never join without a crossing.
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
5. Optional model narration is accepted only if every standalone number, number word and magnitude word (hundred, double, percent...) in it also appears in the computed facts. Digits inside identifiers such as `R20740` do not count as numbers. Budgets above the interactive limit of 6 are capped, with a note.

Measured on this machine (NVIDIA RTX 3050 Laptop GPU, 4 GB): about 3.7 s per warm model call, about 13 s cold.

## 8. Map, 3D city and visual encodings

* **Basemap**: OpenFreeMap vector tiles (OpenMapTiles schema, OpenStreetMap data), no API key, attribution always visible. No Google Maps or Google Earth imagery is used.
* **3D buildings**: 5,113 OpenStreetMap building footprints in and around the study area (`data/samples/charlotte_city/buildings.geojson`). Heights come from:

  | Source | Buildings | Height used |
  |---|---|---|
  | OSM `height` tag | 333 | the tagged height |
  | OSM `building:levels` | 59 | levels × 3.2 m, plus roof levels |
  | neither tag | 4,721 | a type-based estimate (for example 7 m for a house) |

  Estimated heights are a visualization assumption and do not affect any computation. The building inspector shows each building's height source.
* **Alignment**: the Three.js layer renders with MapLibre's own projection matrices, so footprints, network lines, routes and markers stay on the basemap at every zoom, pitch and bearing; the E2E suite measures the agreement (< 0.5 px required).
* **Curb-ramp inspector**: the small 3D crossing view is illustrative (generic road, curbs, crosswalk and ramps). Its dimensions and slopes are not surveyed; only the ramp states (blocked / repaired) come from the engine.
* **Status is never colour-only**: markers carry glyphs (bar = blocked, check = repaired, ? = unknown, letter = candidate) and hypothetical barriers have a dashed ring; journey state is also written in words in the panel.

