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
* **Opening**: US state boundaries from the US Census Bureau's cartographic boundary files (via us-atlas, 1:10m) in Web Mercator. The national outline is drawn in the same projection and from the same camera as the live map, so the hand-off is geometric, not a scaled image.
  * The flight targets the app's journey composition in the Elizabeth study area, not a hard-coded screen position.
  * The North Carolina highlight is checked in the E2E suite: Charlotte and Raleigh fall inside the state's geometry; Columbia SC and Richmond VA do not.
  * Alaska and Hawaii appear as insets in their own projections in the opening frame only.
* **Visual hierarchy**: the modeled network is drawn as quiet context. Strong colour is reserved for:
  * the selected journey (ink);
  * the point where it breaks (coral, with a "Blocked crossing" callout);
  * recommended and repaired interventions;
  * the computed route (emerald), traced once along its real geometry.
  * Nothing unrelated to the journey animates.
* **3D buildings**: 5,113 OpenStreetMap building footprints in and around the study area (`data/samples/charlotte_city/buildings.geojson`). Heights come from:

  | Source | Buildings | Height used |
  |---|---|---|
  | OSM `height` tag | 333 | the tagged height |
  | OSM `building:levels` | 59 | levels × 3.2 m, plus roof levels |
  | neither tag | 4,721 | a type-based estimate (for example 7 m for a house) |

  Estimated heights are a visualization assumption and do not affect any computation. The building inspector shows each building's height source. Facade windows are a shader pattern drawn from wall geometry (floors every 3.4 m), and building colours follow the OSM building type; both are visual only.
* **Trees**: 55,807 crowns.
  * 4,300 are OSM-mapped trees at their real positions.
  * The rest are placed so that each area's canopy share matches the City's 2022 tree canopy assessment, avoiding buildings, streets and water; their positions are illustrative.
  * The 3D view draws a lighter canopy than the data holds, so buildings stay the subject: every OSM-mapped tree, 42% of the generated ones, crowns at 70% size and heights capped at 12 m. Trees within 15 m of the selected journey and its barriers are not drawn. The data file keeps the full measured amount.
  * The route and the selected journey are also drawn as a faint line that ignores depth, so they stay traceable where trees remain.
* **Buildings**: bright roofs over darker walls, walls shaded darker toward the ground, a soft ground-contact shadow around each footprint, sun shadows and edge lines. All of it is display only; footprints and heights are unchanged.
* **Alignment**: the Three.js layer renders with MapLibre's own projection matrices, so footprints, network lines, routes and markers stay on the basemap at every zoom, pitch and bearing; the E2E suite measures the agreement (< 0.5 px required).
* **Curb-ramp inspector**: the small 3D crossing view is illustrative (generic road, curbs, crosswalk and ramps). Its dimensions and slopes are not surveyed; only the ramp states (blocked / repaired) come from the engine.
* **Status is never colour-only**: markers carry glyphs (bar = blocked, check = repaired, ? = unknown, letter = candidate) and hypothetical barriers have a dashed ring; journey state is also written in words in the panel.

## 9. Change verification (preflight)

**Network states.** A proposal is a list of typed changes on real edges:
* `close`: the edge becomes unusable for every profile (barrier `closure`).
* `reopen`: a closed or blocked edge becomes usable.

Each change is validated: the edge must exist, the kind must be allowed (sidewalk, crossing or ramp), no edge may be changed twice, and a reopen needs a closed edge. StreetMend builds three states from the immutable baseline:
* **baseline**: today's network;
* **proposed**: baseline + proposal;
* **fixed**: proposed + mitigation interventions.

**Travel profiles** read the same graph differently:
* **Step-free**: an edge is usable only when traversable (or repaired). A missing or failed curb ramp is a barrier.
* **Walking**: additionally passes a ramp edge whose barrier is a missing or failed ramp, or whose condition is unknown (a walker can step the curb whatever the ramp's state). This is a *curb step*, recorded on the route.
* **Both**: a closure, a missing sidewalk or a leg with no usable crossing stops both profiles.

**Requirements** are configurable planning checks:

| Kind | Holds when |
|---|---|
| `route` | a route from origin to destination within `max_m` exists for the profile |
| `detour` | that route is at most `max_ratio` × its baseline length |
| `category` | some destination of the category is within `max_m` |
| `share` | at least `min_share` of the origin-destination pairs connected in the baseline stay connected |

Each requirement is evaluated twice, with unknown links excluded (conservative) and included (optimistic):
* **PASS** if the conservative evaluation holds;
* **FAIL** if even the optimistic one does not;
* **INCONCLUSIVE** otherwise.

A **regression** is a requirement that passes on the baseline and not on the proposed state.

**Counterexample.** For a route-type regression StreetMend reports:
* the baseline route, and the edges on it that the proposed state no longer allows for that profile (with the change that caused it);
* the shortest walking route and its curb steps, when the profile is step-free;
* the shortest same-profile alternative at any distance;
* the assumptions in force: unknown-link handling, hypothetical settings, the curb-step assumption and the threshold.

**Minimal fix.** The search runs over the scenario's mitigation catalog, excluding anything that would undo the proposal itself. It enumerates sets by increasing size up to `max_size` (default 3). A set is accepted only if, on the recomputed fixed state, every regressed requirement passes and every requirement that passed on the proposed state still passes. The first size with an accepted set is minimal for the catalog. Ties are broken by cost units, then by the step-free length of the focus journey.

The result reports:
* every candidate tested alone, which is how "why not fewer" is explained;
* the number of sets evaluated;
* whether the search was exhaustive.

**Intervention model.** Each catalog intervention specifies:

| Field | Meaning |
|---|---|
| `id` | stable identifier |
| `kind` | for example `temporary_curb_ramp`, `temporary_accessible_crossing`, `reconstruct_curb_ramp` |
| `label` | plain-language name |
| `edge_ids` | the existing edges it makes usable |
| `profiles` | the travel profiles it changes |
| `duration` | temporary or permanent |
| `cost_units` | cost used to break ties |
| evidence | hypothetical or recorded |
| location | where it sits on the map |

Kinds that change an edge's usability without new geometry fit this model directly. New alignments (a new temporary path) would need an explicit new-edge operation, which is not implemented, so no invented paths enter the graph.

**Intervention types and checks** (`verify/interventions.py`). Planner changes and catalog mitigations share one typed model:

| Type | Targets | Effect | Profiles changed |
|---|---|---|---|
| `close_sidewalk` / `close_crossing` / `close_ramp` | sidewalk / crossing / ramp | close | both |
| `reopen_sidewalk` / `restore_crossing` | sidewalk / crossing | open | both |
| `build_sidewalk` | sidewalk with a recorded gap | open | both |
| `temporary_accessible_crossing` | crossing | open | both |
| `reconstruct_curb_ramp` / `install_curb_ramp` / `temporary_curb_ramp` | ramp | open | step-free |
| `close_road` / `reopen_road` | none | unsupported: no vehicular graph in this build | none |

Every intervention also records:
* its state change per edge;
* its preconditions, which are checked: the target kind matches, an opening targets a link that is not already open, and its dependencies exist;
* its cost units and its dependencies (`requires`);
* its provenance;
* whether it is **record-backed** (it acts on a barrier in a municipal record) or **simulated**.

Catalogs are validated in the test suite, including for dependency cycles.

The fix search accepts a set only if it is closed under its dependencies and fits the cost budget. If no set fits the budget but a larger one would work, the result is `over_budget` and names the excluded fix. It never claims that none exists.


**Demo case.** The settings (`data/scenarios/charlotte_preflight.json`) are:
* the proposal: closing crossing `X:172578423:1`;
* missing curb ramps at both ends of the other East 7th Street crossing at the same intersection (`X:172578423:3`);
* no usable crossing on either East 7th Street leg at Park Drive.

They were chosen by closing the crossing and listing the real graph's detours ([`scripts/scenarios/explore_preflight.py`](scripts/scenarios/explore_preflight.py)). All are hypothetical; the streets are real. The 5 requirements and the 5-item catalog are in the same file.

## 10. Access analysis: discover and diagnose (`access/`)

**Homes and facilities.**
* **Homes**: OSM residential buildings, plus untyped buildings of 60 m² or more inside OSM residential land use, in the study-area bounds. There are 951. Each counts once: a proxy, not population.
* **Facilities**: OSM amenities in six categories, plus CATS bus stops (municipal records). They are fetched for the bounds plus about 1.2 km, so homes near the edge can be screened against facilities just outside.
* **Snapping**: each home and facility joins the network at the nearest sidewalk edge, by a straight connector (an inferred assumption). It reaches the network through that edge's two ends, so a home on a sidewalk of unknown condition has unknown access itself.
* **Parks** enter at every 50 m of their boundary that lies within 40 m of a sidewalk.

| Category | OSM tags | Threshold (REACH default) |
|---|---|---|
| Healthcare | amenity = hospital, clinic, doctors, dentist, pharmacy; healthcare = hospital, clinic, doctor, … | 1,500 m |
| Education | amenity = school, kindergarten, college, university | 1,200 m |
| Grocery | shop = supermarket, grocery, greengrocer | 800 m |
| Transit | highway = bus_stop, railway = tram_stop / station, CATS stops | 600 m |
| Parks | leisure = park, playground, nature_reserve, public or community garden | 1,000 m |
| Essential services | amenity = post_office, bank, library, community_centre, social_facility, police, fire_station, townhall | 1,000 m |

**Network states.** One multi-source Dijkstra (SciPy) per state, from all facilities of the category through a virtual source, gives every home's distance. The states are masks over the same edges, built with the verification engine's own `usable` rule, so access results and change checks cannot disagree:
* `verified`: links of unknown condition excluded;
* `possible`: unknown links included;
* `physical`: every modeled link open, whatever its recorded state;

each computed for the step-free and walking profiles. A ramp edge of unknown condition is usable on foot, because a walker can step the curb whatever the ramp's state.

**Status and diagnosis** for one home, category and profile, with threshold T, applied in order:

| Factor | Condition | Status |
|---|---|---|
| served | verified ≤ T | PASS |
| unknown_links | possible ≤ T < verified | INCONCLUSIVE |
| outside_area | possible > T, and a facility outside the network is within T in a straight line | INCONCLUSIVE |
| barrier | possible > T ≥ physical | FAIL |
| detour | physical > T, straight line to a routable facility ≤ T | FAIL |
| distance | no facility within T even in a straight line | FAIL |

**Cells.** Cells are H3 resolution 9 (about 30 homes each).
* **Cell status**: PASS if at least 80% of its homes pass; FAIL if fewer than 80% pass or are inconclusive; otherwise INCONCLUSIVE.
* **REACH-style score**: also reported, 100 up to T and falling linearly to 0 at 2T.
* **Diagnosis**: a cell's diagnosis uses its median home by possible distance. It reports the four distances, the recorded barriers on the shortest physical route (with record ids) and the unknown links on the best route.

**Supply index (E2SFCA-style).** Following Luo & Qi (2009) as adapted by REACH, with network distance in place of straight-line distance:
* **Distance zones**: zone weights are 1, 0.42 and 0.09 for d < T/3, d < 2T/3 and d ≤ T.
* **Step 1**: each facility's ratio is R_j = 1 / Σ_i W_ij.
* **Step 2**: each home's accessibility is A_i = Σ_j R_j W_ij. The index is reported against the area's 75th percentile.

Every facility counts as one unit, because no capacity data exists: this measures availability under competition, not real capacity. Facilities outside the network are not counted. Summed over homes, A equals the number of facilities any home reaches, and a test checks this.

## 11. Fix or build (`access/intervene.py`)

**The comparison.** For the homes in the selected cells, one category, one profile and one threshold, both options use the same objective: homes that newly reach the category within T under the declared policy. The default policy is `possible`; verified counts are always shown beside it.

**Fix** candidates are:
* the scenario's interventions: CDOT ramp barriers to reconstruct or install;
* every block face the CDOT sidewalk inventory records as *No Sidewalk* (`build_sidewalk`).

**Pruning.** A repair is searched only if a route home → repair → facility can be within T:
1. A straight-line screen first.
2. Then a network test with every screened repair applied: the minimum over the repair's edges of d_H(u) + L + d_F(v) ≤ T. Here d_H is the distance from the not-yet-served homes and d_F from the facilities.

Removing repairs only lengthens routes, so this test never drops a useful repair; a brute-force test confirms it on the real data.

**Search.** Sets are enumerated exactly by size up to the budget while the count stays under 1,600. Beyond that, a beam search (width 25) extends the best smaller sets, and the result says it is not exhaustive.

**Build** candidates are existing commercial, retail, office and parking buildings in the study area, within T of a selected home. Each is evaluated as one extra facility. They are labeled hypothetical: land, zoning and cost are not assessed.

**Winner.** Whichever option brings more homes within reach wins. Equal counts are reported as a tie, and costs are not compared.

**Re-verification.** Both options are re-run independently on the full network, for all homes and both policies. The tests check that the recomputation matches the search. The typical home's route is returned for each state and drawn on the map.

## 12. Street intelligence (`ai/`)

Questions are answered in a fixed sequence:

1. **Interpret.** A question becomes one of 18 allowlisted operations: the repair-planner set, plus `identify_access_gaps`, `diagnose_access`, `compare_interventions`, `network_vs_straight`, `critical_links`, `closure_impact`, `explain_verification` and `show_evidence`.
   * The rule parser runs first; for phrasings it does not recognise, the local model (`qwen3:4b` via Ollama) may propose an operation.
   * Both produce a Pydantic-validated intent with typed arguments (category, profile, budget, an H3 cell id pattern).
2. **Execute.** Deterministic functions compute the answer on the scenario, the access model or the proposal under test, which the client sends.
3. **Respond.** The response carries the facts and a client action (show a cell, open the comparison, highlight links), and the map follows it.
4. **Narrate (optional).** The model may rephrase the facts for explanations only. A sentence with any number or magnitude word not present in the facts is rejected.

No generated code, query or file path is ever executed.

`critical_links` closes each of the 30 links most used by today's routes, one at a time, and counts the journeys lost: a what-if built from the same typed `close` change.
