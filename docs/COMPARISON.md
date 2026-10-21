# Related projects and what StreetMend adds

StreetMend did not invent graph routing, repair optimization, disaster simulation or accessible navigation. This page describes what comparable public projects do, based on their published code and Devpost pages as read on 21 October 2026, and where StreetMend differs. No code from these projects is used in StreetMend.

## Summary

| Project | What it does | Verifies a *proposed* change before deployment | Concrete failing evidence | Searches for a minimal mitigation | Network distance |
|---|---|---|---|---|---|
| **StreetMend** | Urban access: discover gaps, diagnose why, fix or build, verify changes | **Yes** (typed changes, three-valued checks) | **Yes** (graph counterexample per regression) | **Yes** (exact by size, re-verified) | **Yes** (step-free and walking profiles) |
| REACH (Mohammad Umar) | Facility siting for essential services in Abu Dhabi | No | No | Ranks candidate parcels | No (straight line) |
| AskStreets (Adam Munawar Rahman) | Natural-language questions over an OSM street graph | No | No | No | Yes (generated NetworkX code) |
| InfraTwin | Change planning for data and telecom networks | Yes, for network capacity | Yes (overloaded links) | Yes (cheapest modeled mitigation) | n/a (not streets) |
| ASTER | Post-flood repair prioritization for a road network | No | No | Chooses repairs after damage | Graph reachability (synthetic) |
| Barrierless NYC | Accessible route ranking for travellers | No | No | No | Yes (openrouteservice routes) |
| Ghost Route | What-if hazards on a city road graph (Devpost page not reachable; see note) | No | Reports when no route exists | No | Yes |

## Notes on each

**REACH** ([github.com/Mohammad-Umar7/reach](https://github.com/Mohammad-Umar7/reach)) scores access to six categories on H3 cells, ranks underserved districts, and ranks candidate parcels for a new facility.
* **Supply**: an E2SFCA-style measure (Luo & Qi 2009) with three distance zones and one unit of supply per amenity.
* **Distance**: haversine throughout. The repository states that its community, listing and parcel figures are illustrative synthetic data; parcel positions are deterministic offsets around district centroids.
* **What StreetMend takes**: the six categories, the thresholds, the linear score and the supply design, as ideas, re-implemented in Python.
* **What StreetMend changes**: distances along the pedestrian network, with separate step-free and walking profiles, and unknown links kept separate from failures.
* **What StreetMend does not take**: REACH's data or coordinates. Hypothetical sites are real non-residential buildings, labeled hypothetical. REACH has no license file, so no code was copied.

**AskStreets** ([github.com/msradam/askstreets](https://github.com/msradam/askstreets)) won second place in the ArangoDB and NVIDIA GraphRAG hackathon (March 2025).
* **How it works**: it extracts OSM street networks with OSMnx, stores them in ArangoDB, and answers questions with a LangGraph ReAct agent.
* **Its tools** include LLM-generated AQL run with `allow_dangerous_requests=True`, and LLM-generated Python run through `exec()`.
* **How StreetMend differs**: it keeps the idea of asking a street graph questions in plain English, but its model can only choose one of 18 allowlisted operations with typed, validated arguments. Every number comes from deterministic graph code, and any sentence the model writes is checked against the computed facts.

**InfraTwin** ([devpost.com/software/infratwin](https://devpost.com/software/infratwin)) is the closest in spirit.
* **How it works**: a shared ChangePlan for network engineers, deterministic routing and contingency analysis, and solver output treated as "a candidate, not as proof" until re-checked.
* **Its domain**: link capacity in data or telecom networks, not streets or accessibility.

**ASTER** ([devpost.com/software/aster-u8vidm](https://devpost.com/software/aster-u8vidm)) merges conflicting flood reports into link states, then enumerates repair combinations under crew, budget and time limits on a synthetic 31-node graph. It decides which repairs to make *after* damage. It does not test a proposed change for regressions.

**Barrierless NYC** ([devpost.com/software/barrierless-nyc](https://devpost.com/software/barrierless-nyc)) ranks candidate pedestrian routes against NYC open data (ramps, construction permits, 311 reports) with a deterministic score. It serves travellers choosing a route, not planners testing a change.

**Ghost Route**: the Devpost page ([devpost.com/software/ghost-route](https://devpost.com/software/ghost-route)) was behind a bot challenge and could not be read. A GitHub project of the same name (UmarAlMukhtar/GhostRoute) simulates illustrative flood, landslide, fire and roadblock hazards on a Kochi road graph and recomputes the shortest path. We could not confirm it is the same project, so this entry is unverified.

## StreetMend's specific contribution

Pre-deployment verification of proposed city changes. It combines:

* capability-aware access requirements (step-free and walking on the same graph);
* explicit failing journeys (graph counterexamples);
* minimal mitigation synthesis, re-verified on the recomputed network;
* three-valued results that never turn missing data into a pass.

The same engine also diagnoses existing access gaps. It separates connectivity barriers from facility shortages and data gaps, and compares a network repair with a new facility on one objective.

We make no claim to be the first or only tool to do any of this.
