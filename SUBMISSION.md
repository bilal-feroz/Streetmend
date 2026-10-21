# StreetMend: Devpost submission

**Tagline:** Understand the gap. Test the change. Restore access.
**Category:** Urban access intelligence and infrastructure decision verification
**Track:** Geospatial Intelligence for Action · **Theme:** Beyond 2030: Build the World You Want to Live In
**Live demo:** https://streetmend.vercel.app · **Repo:** https://github.com/bilal-feroz/Streetmend · **Video:** `docs/media/streetmend-pitch.mp4` (2.5 min narrated pitch with real app footage; plain screen capture in `docs/media/streetmend-demo.mp4`)

## Inspiration
Cities usually know where their infrastructure is. Knowing which physical change will actually improve someone's access to a clinic, a school or a bus stop is harder. It depends on how facilities, routes and barriers interact across the whole network.

A sidewalk closure is reviewed at the work site, but its effect is felt blocks away, and not equally: someone who can step off a curb may still get to the clinic, while someone in a wheelchair may have lost their only route. Software teams don't ship a change without running the tests. Cities have no equivalent for their streets.

## The problem
An area with poor access to essential services can have three different problems:
* **connectivity**: a facility is close, but a missing sidewalk or curb ramp cuts the route;
* **availability**: nothing is within reach at all;
* **a change**: a proposed closure removes access that existed yesterday.

A new clinic will not fix a missing sidewalk, a repaired ramp will not create a grocery store, and a closure should be tested before it is built. Straight-line access maps cannot tell these cases apart. On Charlotte's real records they place **522** more homes within reach of a school (step-free) than the network does.

People who use wheelchairs, walkers or strollers, and anyone who cannot step a curb, carry the cost of getting this wrong.

## What it does
StreetMend is one geospatial decision engine on the real pedestrian network of Elizabeth, Charlotte. It answers four questions.

1. **Discover: where is access failing?**
   * Measures 951 homes' distance to six essential-service categories along the network, separately for step-free and walking travel.
   * Each result is PASS (on links of known condition), INCONCLUSIVE (only if links of unknown condition are passable) or FAIL. Missing data never becomes a pass.
2. **Diagnose: why?** For a selected area it compares four distances: straight line, walking, step-free, and every link open. From these it separates:
   * a connectivity barrier, named by its CDOT records;
   * a network detour;
   * a missing facility;
   * a data gap.

   It adds an E2SFCA-style supply index, after REACH.
3. **Intervene: fix or build?** It compares the best set of repairs (CDOT ramp barriers and recorded sidewalk gaps) with one hypothetical new facility, on the same homes and the same objective. The search finds the winner; a tie is reported as a tie.
4. **Verify: does the change work?**
   * Every option is re-run on the full network.
   * The **change check** tests a *proposed* street change before it is made: **PROPOSE → TEST → FIND BREAKAGE → GENERATE FIX → VERIFY**.
     * It builds a separate proposed network and runs explicit access requirements.
     * For each regression it produces a graph **counterexample**: the route lost, the exact edge, the walking route that survives and the curb steps that make it unusable step-free.
     * It searches for the **smallest set of typed mitigations** that restores every check, and verifies them on a recomputed network.

Questions in plain English ("Is repairing better than adding a new school?", "Why did verification fail?") map to typed, allowlisted graph tools. No generated code is executed.

## Measured on the real data
**Change check** (real streets, hypothetical closure and barriers):
* **Today**: a 648 m step-free route from Hawthorne Lane to Novant Health Presbyterian; all 5 checks pass.
* **The proposed closure**:
  * 3 checks fail, and step-free journeys fall from 55 to 44;
  * walkers keep 648 m by stepping 2 curbs;
  * the step-free detour is 868 m.
* **The fix**: the search tests 20 sets in about 0.4 s and returns two temporary ramps that only work together. With them all 5 checks pass; switching one off fails them again.

**Fix or build** (real CDOT records), for 51 homes cut off from schools:

| Budget | Fix | Build | Winner |
|---|---|---|---|
| 1 repair | +32 homes | +35 (a hypothetical school site) | **build** |
| 2 repairs | **+42**: two missing sidewalks, one worth **0** alone | +35 | **fix** |

**Grocery**: no supermarket lies inside the modeled network. Repairs cannot help, and StreetMend says so.

**Honesty about data**: for healthcare, **754** homes are INCONCLUSIVE because their routes use sidewalks with no inventory record. StreetMend does not call them served.

## How we built it
* **Graph engine (Python)**:
  * a pedestrian graph of corners, curb landings, ramps and crossings, with an explicit state (traversable / blocked / unknown) and evidence label on every edge;
  * travel profiles as capability constraints on the same graph;
  * typed changes applied copy-on-write, so the baseline is never mutated;
  * three-valued checks;
  * SciPy compiled Dijkstra, with multi-source searches through a virtual source;
  * Shapely snapping and H3 cells.
* **Verification**:
  * counterexamples from the shortest paths per profile;
  * minimal-fix synthesis by exact enumeration by size over a typed intervention model (preconditions, dependencies, cost budget, provenance, record-backed or simulated);
  * every candidate re-verified on the recomputed network.
* **Fix or build**:
  * exact repair search over candidates that pass a network-ellipse test (with every repair applied, only repairs that could lie on a route within the threshold are searched; this can only over-include);
  * a labeled beam search beyond 1,600 sets;
  * hypothetical sites at real non-residential buildings;
  * independent re-verification.
* **API**: FastAPI and Pydantic.
* **Web**: React 19, TypeScript, Tailwind v4, MapLibre GL JS on OpenFreeMap tiles (no API key), and a Three.js custom layer drawing the 3D city with MapLibre's own camera.
* **AI**:
  * a rule parser, then optionally a local `qwen3:4b` model via Ollama, which may only choose one of 18 allowlisted operations with typed arguments;
  * any model-written sentence containing a number that is not in the computed facts is rejected;
  * it works fully without the model.

## Evidence
* `scripts/benchmarks/run_evaluation.py` writes `docs/EVALUATION.md`: **10 of 10 deterministic fixtures fully correct**. For each fixture:
  * the regression is detected;
  * the counterexample is re-walked edge by edge, and NetworkX confirms no compliant route remains;
  * the fix is re-verified;
  * removing any member regresses again;
  * budgets report infeasibility;
  * unknown data gives INCONCLUSIVE.

  The fixtures are: single bottleneck, dependent pair, existing alternative, multiple destinations, infeasible budget, unknown state, two requirements, redundant candidates, no mitigation, detour limit.
* **Honest baselines**:
  * greedy fails both dependent-pair cases, including Charlotte;
  * nearest-first matches the exact search in several cases, including Charlotte, and the report shows where.
* **Tests**: 170 Python tests and 19 Playwright end-to-end tests against the real API. The browser tests compare every number in the UI with the API.
* **A real bug, found by the evaluation and fixed**: graph facts were cached by `id()`, which Python reuses after garbage collection, so a stale "no unknown links" could turn INCONCLUSIVE into FAIL.

## Judging criteria
* **Human impact (25)**:
  * targets the people a single missing ramp or sidewalk strands, and the decision a city faces before it acts;
  * shows who loses access, why, and which response helps most, before money is spent or a crossing is closed.
* **Innovation (20)**:
  * pre-deployment verification of street changes with explicit counterexamples and verified minimal fixes;
  * capability-aware profiles on one graph;
  * a fair repair-vs-facility comparison on one objective.

  Related work and differences are in `docs/COMPARISON.md`.
* **Technical feasibility (20)**: it runs on real Charlotte records and computes in well under a few seconds on a laptop:
  * change check about 0.15 s;
  * fix search about 0.4 s;
  * fix-or-build 0.1–3 s.

  It is tested end to end, and the evaluation is reproducible.
* **Trust, ethics and risks (15)**:
  * unknown never becomes PASS;
  * hypothetical settings and sites are labeled everywhere;
  * homes are a disclosed proxy, not population;
  * no AI decides anything;
  * no cost or compliance claims;
  * limitations are in `LIMITATIONS.md`.
* **Scalability and reusability (10)**:
  * the pipeline is parameterized by bounding box, and the engine is generic over graphs, profiles, requirements and intervention types;
  * the access engine and the change check share one usability rule;
  * new categories or requirements are data, not code.
* **Ease of implementation and adoption (10)**:
  * open data (CDOT ArcGIS services, OpenStreetMap);
  * no paid APIs or keys;
  * one-command local start;
  * works offline except the basemap;
  * planners use it through a map and three buttons.

## Datasets
* **City of Charlotte / CDOT**: ADA Curb Ramps, Sidewalk Inventory and CATS Bus Stops (ArcGIS REST, reprojected from EPSG:2264 with pyproj).
* **OpenStreetMap via Overpass and OSMnx (ODbL)**:
  * the street network;
  * 285 essential-service facilities in six categories;
  * 5,113 building footprints (homes are the residential ones).
* **Basemap**: OpenFreeMap.

Provenance and retrieval times are recorded and shown in the app.

## Credits
* **REACH** by **Mohammad Umar**: the six service categories, walking thresholds, linear access score and E2SFCA supply design. These were re-implemented on network distance, with no code or data reused; REACH has no license file.
* **AskStreets** by **Adam Munawar Rahman**: the idea of asking a street graph questions in plain English. StreetMend's version uses typed, allowlisted tools and never runs generated code.

## Limitations
StreetMend is a planning and research prototype: not navigation, not an ADA compliance determination, not a construction authorization, and not endorsed by the City.
* **Data coverage**: 317 of 760 modeled sidewalk segments, and about two thirds of curb landings, have no CDOT record, so many results are INCONCLUSIVE by design. Surveys date from 2017–2019.
* **Not modeled**: signals, traffic, slope and surface.
* **Change check**: the demo's closure and barriers are hypothetical settings on real streets.
* **Fix or build**: facility sites are hypothetical, and costs are not compared.
* **No vehicular graph**: emergency road access is a documented extension, not a feature.

## What's next
* A drivable graph with one-way and turn restrictions for emergency-access checks.
* A field-verification workflow that turns unknown links into evidence.
* Cost-aware budgets once credible estimates exist.
* Census-weighted homes, and facility capacity data.

## What we did not do
No user interviews, municipal partnership, deployment, population outcome or cost-savings claims were made or are implied.
