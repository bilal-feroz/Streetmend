# StreetMend: Devpost submission

**Tagline:** Fix the missing links. Reconnect the city.
**Track:** Geospatial Intelligence for Action · **Theme:** Beyond 2030: Build the World You Want to Live In
**Repo:** https://github.com/bilal-feroz/Streetmend · **Video:** `docs/media/streetmend-demo.mp4` (screen capture of the working app)

## Inspiration
For a wheelchair user, one missing curb ramp can make an otherwise ordinary trip impossible. Cities like Charlotte already maintain detailed inventories of curb ramps and sidewalks. What they lack is a way to answer the budget question: if we can fix only two, which two? Ranking barriers one by one misses the most important case, where two repairs are each useless alone but together reconnect a route, because a crossing needs a working ramp at both ends.

## The problem and who it affects
People who use wheelchairs, walkers or strollers, and anyone who cannot step up a curb, depend on continuous step-free routes to clinics, bus stops and schools. Infrastructure assessments describe the condition of each asset, but connectivity is a property of the network. Two interventions that each look unimportant can be decisive in combination.

## What StreetMend does
StreetMend turns pedestrian infrastructure into an accessibility graph of corners, curb ramps, crossings and sidewalk sides. Every link carries an explicit state (traversable, blocked or unknown) and an evidence label. Given candidate repairs, a repair budget and destination priorities, it:

1. computes which origins can reach which essential destinations within an access threshold;
2. evaluates every combination of repairs within the budget;
3. recommends the set that maximizes weighted reachable origin–destination pairs;
4. explains the result: gain of each repair alone, its marginal value within the set, synergy, newly connected journeys, and comparison against three baselines (greedy, individual ranking, nearest-to-destination);
5. shows it on an interactive map. Apply one repair and the reach wave stops at the remaining barrier. Apply the second and the actual graph route traces through to the clinic.

Two modes:
* **Guided Simulation**: a synthetic district built to demonstrate the dependent-repair problem. Works fully offline.
* **Charlotte Data Explorer**: 320 real CDOT curb-ramp records, 557 sidewalk-inventory segments, 19 CATS bus stops and OpenStreetMap streets and destinations in the Elizabeth neighborhood around Novant Health Presbyterian Medical Center.

## How the pedestrian graph works
* Each intersection gets one corner node per angular sector between street legs. Corners connect only through sidewalks along a block face, or through a crossing whose two ends are curb-ramp edges. Corners on opposite sides of a street are never joined directly.
* In Charlotte, CDOT ramp records are matched to intersections (by intersection ID group and distance), to corners (by bearing) and to crossings (by the surveyed crosswalk direction). Sidewalk inventory lines are matched to street sides by offset, direction and coverage.
* Anything without matching evidence stays **unknown** and is excluded from modeled traversability. A sensitivity pass shows what would change if it were passable.
* Because nearly every surveyed ramp is recorded as non-compliant, ramp passability is an explicit, selectable policy (strict / severe defects only / missing ramps only), never a hidden assumption.

## Why combined optimization matters
* **Guided scenario**: ramps A and B are each worth 0 alone and +28 together. Exact search picks A + B; greedy and individual ranking pick C + E for +13.
* **Real Charlotte records**: homes along East 5th Street cannot reach Novant Health Presbyterian within 800 m. The route is blocked by two recorded barrier ramps; one of them (R112391) has zero value on its own. With both repaired, the route is 775 m.
* **Charlotte, strict policy, budget 2**: exact +186 vs greedy +53.
* **Honest counterpoint**: under the moderate and lenient policies, and in most of 40 randomized districts, greedy already matches the optimum. StreetMend is valuable exactly where repairs interact, and it tells you whether that is the case.

## Technical architecture
* **Engine (Python)**: NetworkX for routing and inspection; SciPy compiled Dijkstra for evaluation; an exact *key-node* evaluator that scores a repair combination with one tiny Floyd–Warshall over the repaired edges' endpoints plus vectorized min-plus products; sound candidate pruning. Exact search over 21,321 combinations of real Charlotte candidates takes about 3 s.
* **API**: FastAPI with Pydantic contracts. Stateless evaluation from the applied-repair list; undo restores the exact previous repair set and the map is always recomputed from it.
* **Web**: React 19, TypeScript, Tailwind v4, MapLibre GL JS (WebGL), Motion. Accessible DOM buttons for every repair and place, a full text alternative list, reduced-motion support.
* **AI**: a deterministic rule parser first. For unrecognized phrasing, a local Ollama model (`qwen3:4b`, JSON-schema decoding) may only choose one of eleven allowlisted operations with typed arguments. The engine executes it; any model-written sentence containing a standalone number, number word or magnitude word (hundred, double, percent...) that is not in the computed facts is rejected. The product works fully without the model.

## Datasets
City of Charlotte / CDOT ADA Curb Ramps, CDOT Sidewalk Inventory, CATS Bus Stops (ArcGIS REST, NC State Plane EPSG:2264 reprojected with pyproj and cross-checked against server reprojection, max difference 0.82 m); OpenStreetMap via OSMnx (ODbL). Provenance, retrieval times, missing-field statistics and match coverage are visible in the app.

## Quantitative evaluation
* 115 Python tests:
  * exact search vs brute force using an independent NetworkX implementation;
  * fast evaluator vs full Dijkstra for every subset of up to three repairs;
  * the dependent-pair synergy case;
  * unknown-edge exclusion, budget limits, undo/reset, determinism;
  * builder invariants and ingestion pagination/reprojection.
* 8 Playwright end-to-end tests:
  * automate the whole live demo and check that UI numbers match API responses;
  * cover recomputation, the Charlotte explorer and keyboard operation;
  * run an axe accessibility scan with no serious violations.
* Reproducible benchmark (`scripts/benchmarks/run_benchmark.py` → `docs/BENCHMARK.md`): guided scenario, 40 randomized districts, 40 random grids, Charlotte × 3 policies × budgets 1–3.

## Safety and limitations
StreetMend is a planning and research prototype: not navigation, not an ADA compliance determination, not a construction authorization, and not endorsed by the City.
* **Coverage**: only about 35% of modeled crossing landings in the study area matched a ramp record.
* **Data age**: surveys date from 2017–2019.
* **Not modeled**: signals and traffic.
* **Origins**: OSM residential buildings as a proxy, not population.
* **Results depend on assumptions**: the stated passability policy and access threshold.

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
