# Limitations

StreetMend is a planning and research prototype. Its outputs are **planning estimates from a modeled network**.

## What StreetMend is not
* Not a certified accessible-navigation or wayfinding system. Do not route people with it.
* Not an ADA compliance determination. Passability policies are prioritization assumptions.
* Not an authorization to conduct construction, and not a cost estimate.
* Not endorsed or reviewed by the City of Charlotte or CDOT.

## Data limitations (Charlotte)
* **Coverage gaps.** Only about 35% of modeled crossing landings matched a CDOT ramp record, and about 51% of sidewalk sides matched an inventory record. Unmatched links are UNKNOWN and excluded, so reachability figures are conservative lower bounds of the modeled network, and many real routes do not appear. 38 ramp records could not be matched to an OSM intersection within 35 m; 4 intersection matches are flagged ambiguous.
* **Historical surveys.** Ramp surveys date mostly from 2017–2019. Conditions may have changed: repairs may have happened, and new damage may exist.
* **Compliance ≠ passability.** 313 of 320 ramps are recorded non-compliant, so results depend on the selected policy. Compare policies before drawing conclusions. The moderate policy's severe-defect thresholds (running slope > 12%, gutter lip ≥ 1 in) are assumptions, not standards.
* **Inferred geometry.** Corners, curb landings and crossing positions are geometric inferences from OSM centerlines. Wide or skewed intersections, slip lanes and medians are simplified, mid-block crossings are not modeled, and sidewalks wrapping around cul-de-sac ends are not modeled (the two sides stay separate).
* **Crossings assumed usable.** Unmarked intersection crossings are assumed legal and usable. Signals, traffic volume, speed and crossing time are not modeled; a four-lane arterial counts the same as a residential street.
* **Origins are a proxy.** Residential building counts from OSM, not population; OSM building coverage is incomplete.
* **Entrances not verified.** Destination connectors snap to the nearest modeled sidewalk.
* **No costs.** `ActualCosts` is empty for every study-area record, so budgets are repair counts.
* **Small study area.** About 1.3 × 1.1 km; citywide behavior is untested.

## Change-check limitations
* **Planning checks, not compliance.** Requirements are configurable planning checks on a modeled network, not ADA determinations, and passing them does not certify a route as safe.
* **Two profiles only.** Step-free and walking. Vehicle access, signal timing, crossing duration, slope and surface are not modeled. A vehicular graph was not built.
* **The walking profile assumes a curb can be stepped** where a ramp is missing or failed. People with other needs may not manage it.
* **The fix is minimal for the catalog.** Mitigations are drawn from the scenario's catalog of typed interventions on existing edges. New alignments, such as a new temporary path, are not generated, so options outside the catalog are not considered. Search is exhaustive up to the stated size and reports when it is not.
* **The demo case is hypothetical.** The closure, the missing ramps on the other crossing and the two legs with no usable crossing are scenario settings on real streets, not city plans or survey findings.

## Access-analysis limitations
* **Homes are a proxy.** 951 OSM residential buildings (plus large untyped buildings in residential land use), one per building: an apartment block counts the same as a house. Not population, and OSM building coverage is incomplete.
* **Facilities come from OpenStreetMap**, which can be incomplete or out of date. No opening hours, eligibility, capacity or quality. The supply index counts one unit per facility because no capacity data exists.
* **Edge effects.** The modeled network stops at the study-area boundary.
  * Facilities just outside it are used for straight-line screening only, so near the edge a home can be *INCONCLUSIVE (beyond study area)* rather than served.
  * No supermarket lies inside the network, so grocery results are mostly edge effects or real gaps, and the app says which.
* **Most step-free uncertainty is a data gap.** 317 of 760 modeled sidewalk segments have no CDOT inventory record. A home on such a sidewalk is INCONCLUSIVE under the verified policy, which is why few homes PASS on known links only.
* **Fix-or-build objective.** The objective counts homes newly within the threshold under the declared policy (unknown links passable by default; verified counts are shown beside it).
  * No costs are compared.
  * Hypothetical facility sites are real non-residential buildings, with no land, zoning, lease or cost assessment.
  * Repair candidates are recorded ramp barriers and recorded sidewalk gaps only.
* **Thresholds are REACH's defaults** (straight-line there, network here). They are configurable planning values, not standards.

## Model and algorithm limitations
* The objective counts weighted origin–destination pairs within a threshold. It ignores route quality beyond length (slope, surface, shade, safety) and partial accessibility.
* "Optimal" means optimal for the stated candidate set, objective, weights and threshold, and only for exact-enumeration results. Beam-search results are approximate.
* Exact enumeration is combinatorial. Large budgets over many candidates fall back to beam search (for example strict policy, budget 3).
* The guided scenario's barrier states are hypothetical and were chosen so that a dependent repair pair exists (as was the synthetic Harbor District used in tests). Their numbers illustrate the method and are not evidence of typical real-world gains or of conditions at those corners.

## Map and 3D limitations
* **Estimated building heights.** 4,721 of 5,113 buildings (92%) have no height or levels tag in OpenStreetMap and are drawn at a type-based estimated height. Roofs are flat and the ground is flat (no terrain). OSM footprint coverage can be incomplete or out of date.
* **Tree positions are illustrative.** Of 55,807 trees, 4,300 are OSM-mapped at their real positions. The rest only reproduce each area's measured 2022 canopy share; individual trees are not surveyed. Species and heights are not modelled. The 3D view also draws fewer, smaller and lower trees than the data holds, and none along the selected journey, so the city stays readable.
* **Illustrative crossing view.** The 3D curb-ramp inspector shows conceptual geometry, not surveyed dimensions or slopes.
* **Basemap needs a connection.** Tiles and label fonts load from OpenFreeMap. Offline, the app says so; the buildings, network, routes, markers and all analysis still work on a plain background.
* **The opening needs the network once.** The USA → Charlotte flight waits until the map tiles along its path have loaded, so it never shows an empty map. Measured on a cold first visit it took about 4.8 s, and 8.7 s with an artificial 700 ms delay on every tile request; a cached replay takes about 4 s. It can be skipped (button or Esc), is shortened on return visits, and is replaced by a direct arrival under reduced motion. If tiles never arrive, the national outline stays up until the 3D city takes over.
* **WebGL2 required.** The 3D city needs a WebGL2 browser. 2D mode flattens the same layer and does not reduce the GPU requirement.

## AI limitations
* The local model (`qwen3:4b` on a 4 GB laptop GPU) takes about 3.7 s per warm call and about 13 s cold. It can misroute unusual phrasing, but every intent is validated and executed deterministically, so a misroute yields a wrong *operation*, never a wrong *number*.
* The Qwen 3.5 9B model mentioned in the project brief was not present on this machine, so the installed `qwen3:4b` was used. No model was downloaded or fine-tuned.

## Environment notes
* The machine has an NVIDIA RTX 3050 Laptop GPU (4 GB), not the RTX 5080 mentioned in the rebuild brief, so everything was sized and measured on the 3050.
  * GPU acceleration was not useful for the graph engine at neighborhood scale: compiled CPU Dijkstra and vectorized NumPy are fast enough (sub-second for the default analyses).
  * The GPU runs local LLM inference through Ollama.
  * It also renders the 3D city in the browser: 60 fps while orbiting, measured in Chromium via ANGLE/Direct3D 11.
* The official `gis.charlottenc.gov` MapServer timed out from the development network. Data was taken from the City's ArcGIS Online feature services with the same schema.
