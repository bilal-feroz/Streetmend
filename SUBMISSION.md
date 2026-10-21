# StreetMend: Devpost submission

**Tagline:** Test the city before you change it.
**Category:** Urban infrastructure verification and intervention intelligence
**Track:** Geospatial Intelligence for Action · **Theme:** Beyond 2030: Build the World You Want to Live In
**Repo:** https://github.com/bilal-feroz/Streetmend · **Video:** `docs/media/streetmend-demo.mp4` (screen capture of the working app)

## Inspiration
Cities close sidewalks for construction, rebuild intersections and reroute pedestrians every week. Each change is reviewed at the work site, but its effect is felt elsewhere in the network, and it is not the same for everyone. Someone who can step off a curb may still get to the clinic. Someone in a wheelchair may have just lost their only route. Software teams don't ship a change without running the tests first. Cities have no equivalent for their streets.

## The problem and who it affects
People who use wheelchairs, walkers or strollers, and anyone who cannot step a curb, depend on continuous step-free routes to clinics, bus stops and schools. When a proposed change removes the last such route, nobody notices until someone is stranded. Connectivity is a property of the whole network, so these regressions are invisible when you look at one asset or one site.

## What StreetMend does
StreetMend is a **preflight check for street changes**: **PROPOSE → TEST → FIND BREAKAGE → GENERATE FIX → VERIFY**.

1. **Propose**: the planner adds a typed, validated change, such as "close this crossing", to a separate *proposed* network. Pick a prepared proposal or any sidewalk or crossing on the 3D map.
2. **Test**: configurable access requirements run on today's network and on the proposed one:
   * a step-free route within 800 m;
   * a detour limit;
   * access to a bus stop;
   * 90% of the area's step-free journeys kept.

   Each returns PASS, FAIL or INCONCLUSIVE. Unknown data can make a check inconclusive, never a silent pass.
3. **Find breakage**: for each regression, a graph **counterexample**: today's route, the exact edge the proposal removes, the walking route that remains and the curb steps that make it unusable step-free, and the shortest step-free alternative and why it fails.
4. **Generate fix**: an **exact search by increasing size** over a catalog of typed mitigations (temporary curb ramps, temporary accessible crossings, ramp reconstruction), with the proposal kept in place. It returns the smallest set and explains why every smaller set fails.
5. **Verify**: the fix is applied to a third network state and every check runs again. Nothing counts as fixed until the graph engine says so. Switch an intervention off and the checks fail again.

On the real Elizabeth (Charlotte) street graph, a hypothetical closure of the East 7th Street crossing at Hawthorne Lane plays out as follows:
* **Regression:** 3 of 5 checks fail, and step-free journeys fall from 55 to 44. Walkers keep a 648 m route through the other crossing, but only by stepping 2 curbs. The shortest step-free detour is 868 m.
* **Fix:** the search checks 20 sets in about 0.4 s and returns **A + B**, temporary ramps at both ends of the other crossing. Neither alone helps. A temporary crossing at Park Drive restores a route but fails the 15% detour limit.
* **Verified:** with A + B, all 5 checks pass and all 55 journeys are back.

StreetMend also keeps its original tools:
* **Repair planner**: the combination of repairs that reconnects the most journeys, compared with greedy and ranking baselines.
* **Charlotte Data Explorer**: 320 real CDOT curb-ramp records, 557 sidewalk segments and 19 CATS bus stops.

## How the pedestrian graph works
* Each intersection gets one corner node per angular sector between street legs. Corners connect only through sidewalks along a block face, or through a crossing whose two ends are curb-ramp edges. Corners on opposite sides of a street are never joined directly.
* In Charlotte, CDOT ramp records are matched to intersections (by intersection ID group and distance), to corners (by bearing) and to crossings (by the surveyed crosswalk direction). Sidewalk inventory lines are matched to street sides by offset, direction and coverage.
* Anything without matching evidence stays **unknown** and is excluded from modeled traversability. A sensitivity pass shows what would change if it were passable.
* Because nearly every surveyed ramp is recorded as non-compliant, ramp passability is an explicit, selectable policy (strict / severe defects only / missing ramps only), never a hidden assumption.

## Why exact search (not ranking) matters
* **Guided scenario** (hypothetical barriers on real streets): the two curb ramps of the East 7th Street crossing at Hawthorne Lane are each worth 0 alone and +123 together. A + B reconnect 10 journeys, including a 648 m route to Novant Health Presbyterian. Exact search picks A + B; greedy and individual ranking recommend nothing.
* **Real Charlotte records**: homes along East 5th Street cannot reach Novant Health Presbyterian within 800 m. The route is blocked by two recorded barrier ramps; one of them (R112391) has zero value on its own. With both repaired, the route is 775 m.
* **Charlotte, strict policy, budget 2**: exact +186 vs greedy +53.
* **Honest counterpoint**: under the moderate and lenient policies, and in most of 40 randomized districts, greedy already matches the optimum. StreetMend is valuable exactly where repairs interact, and it tells you whether that is the case.

## Technical architecture
* **Engine (Python)**: NetworkX for routing and inspection; SciPy compiled Dijkstra for evaluation; an exact *key-node* evaluator that scores a repair combination with one tiny Floyd–Warshall over the repaired edges' endpoints plus vectorized min-plus products; sound candidate pruning. Exact search over 21,321 combinations of real Charlotte candidates takes 3–5 s on a laptop.
* **Verification engine (Python, `streetmend.verify`)**:
  * typed changes produce new network states; the baseline is never mutated;
  * two travel profiles on one graph;
  * three-valued checks: conservative versus optimistic handling of unknown links;
  * counterexamples built from shortest paths on each profile;
  * minimal-fix synthesis by exact enumeration by size, each candidate set verified on the recomputed network.

  Distances use SciPy's compiled Dijkstra: about 0.15 s per proposal check and 0.4 s for the fix search.
* **API**: FastAPI with Pydantic contracts: `/verify`, `/verify/fix`, and `/evaluate` with proposed changes. Stateless: every state is rebuilt from the proposal and mitigation lists.
* **Web**: React 19, TypeScript, Tailwind v4, MapLibre GL JS on OpenFreeMap vector tiles (no API key), and a Three.js custom layer that renders with MapLibre's own camera matrices.
  * Buildings, network, route and markers stay aligned to the basemap within a fraction of a pixel; the tests check this.
  * Every map fact is also in the panel.
  * Keyboard operation, reduced-motion support and WCAG AA contrast.
* **AI**: a deterministic rule parser first. For unrecognized phrasing, a local Ollama model (`qwen3:4b`, JSON-schema decoding) may only choose one of eleven allowlisted operations with typed arguments. The engine executes it; any model-written sentence containing a standalone number, number word or magnitude word (hundred, double, percent...) that is not in the computed facts is rejected. The product works fully without the model.

## Datasets
City of Charlotte / CDOT ADA Curb Ramps, CDOT Sidewalk Inventory and CATS Bus Stops: ArcGIS REST, NC State Plane EPSG:2264, reprojected with pyproj and cross-checked against server reprojection (max difference 0.82 m).

OpenStreetMap via OSMnx and Overpass (ODbL):
* streets and destinations;
* 5,113 building footprints. Heights come from OSM tags for 392 of them; the rest are disclosed estimates.

Basemap: OpenFreeMap. Provenance, retrieval times, missing-field statistics and match coverage are visible in the app.

## Quantitative evaluation
* 134 Python tests:
  * exact search vs brute force using an independent NetworkX implementation;
  * fast evaluator vs full Dijkstra for every subset of up to three repairs;
  * the dependent-pair synergy case (synthetic district and guided scenario);
  * the change check act by act. The closure regresses step-free but not walking access, and A + B is the only minimal fix; every single candidate and pair is re-checked independently;
  * three-valued logic on a hand-built network: unknown is INCONCLUSIVE, never PASS;
  * unknown-edge exclusion, budget limits, undo/reset, determinism;
  * builder invariants and ingestion pagination/reprojection.
* 18 Playwright end-to-end tests against the real API:
  * the change check end to end, with every check status, the counterexample and the fix compared with the API, plus the six presentation acts;
  * a 20-step repair-planner flow (map, 2D/3D, rotate/zoom, inspect, analyze, Repair A, Repair B, route, split, undo, reset, explorer record, back), checking that UI numbers match API responses;
  * 3D/basemap projection agreement under 0.5 px at several cameras;
  * budget one, presentation steps, assistant allowlist, keyboard operation, phone layout;
  * the opening: North Carolina geometry checked against known cities, landing position and alignment, skip and replay, return visit, reduced motion;
  * axe scans with no serious or critical findings.
* Reproducible benchmark (`scripts/benchmarks/run_benchmark.py` → `docs/BENCHMARK.md`): guided scenario, synthetic district, 40 randomized districts, 40 random grids, Charlotte × 3 policies × budgets 1–3.

## Safety and limitations
StreetMend is a planning and research prototype: not navigation, not an ADA compliance determination, not a construction authorization, and not endorsed by the City.
* **Coverage**: only about 35% of modeled crossing landings in the study area matched a ramp record.
* **Data age**: surveys date from 2017–2019.
* **Not modeled**: signals and traffic.
* **Origins**: OSM residential buildings as a proxy, not population.
* **Results depend on assumptions**: the stated passability policy and access threshold.
* **3D heights**: most building heights are estimates (disclosed in the app); the curb-ramp 3D view is illustrative.

Details are in LIMITATIONS.md.

## Scalability and future deployment
The pipeline is parameterized by bounding box, and the evaluator's precomputation scales with the number of candidates rather than combinations. Deployment would need:
* field verification to resolve unknown links;
* current ramp conditions and remediation dates;
* cost estimates per intervention;
* census-based origin weights;
* signal and crossing-risk data;
* review by the city's ADA transition-plan staff.

## What we did not do
No user interviews, municipal partnership, deployment, or cost-savings claims were made or are implied.
