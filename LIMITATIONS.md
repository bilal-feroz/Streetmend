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

## Model and algorithm limitations
* The objective counts weighted origin–destination pairs within a threshold. It ignores route quality beyond length (slope, surface, shade, safety) and partial accessibility.
* "Optimal" means optimal for the stated candidate set, objective, weights and threshold, and only for exact-enumeration results. Beam-search results are approximate.
* Exact enumeration is combinatorial. Large budgets over many candidates fall back to beam search (for example strict policy, budget 3).
* The guided scenario's barrier states are hypothetical and were chosen so that a dependent repair pair exists (as was the synthetic Harbor District used in tests). Their numbers illustrate the method and are not evidence of typical real-world gains or of conditions at those corners.

## Map and 3D limitations
* **Estimated building heights.** 4,721 of 5,113 buildings (92%) have no height or levels tag in OpenStreetMap and are drawn at a type-based estimated height. Roofs are flat and the ground is flat (no terrain). OSM footprint coverage can be incomplete or out of date.
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
