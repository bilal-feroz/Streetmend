# Live demo script (90–120 s)

Setup: API and web running (see README). Open http://localhost:5173 at about 1440 × 900 in a WebGL2 browser. The app opens in **Change check** mode. To show the opening flight, use a fresh profile or **⋯ → Replay intro**.

The easiest path is **Present** in the header: six acts, each driven by the real engine. Use **Next** to advance. Everything also works by hand with the buttons in the panel.

| Time | Act / action | Say |
|---|---|---|
| **0–15 s** | **1 · A city that works.** Emerald route; chip *Route available in model*. | "This is Elizabeth in Charlotte: real streets, real buildings. Today, homes on Hawthorne Lane have a 648-metre step-free route to Novant Health Presbyterian. Cities change streets like this every week. StreetMend tests those changes before they're made." |
| **15–28 s** | **2 · A planner proposes a change.** The barricade appears at the East 7th Street crossing, labeled *Proposed closure · hypothetical*. | "A planner proposes a temporary construction closure of this crossing. It goes into a separate proposed network. Today's network doesn't change." |
| **28–50 s** | **3 · StreetMend finds a regression.** **ACCESS REGRESSION DETECTED.** Today's route turns into a dashed ghost; the counterexample opens. | "Five access checks run on the proposed network, and three fail. A walker still gets through at the other crossing by stepping down two curbs. Someone who needs a step-free route has lost their only one within 800 metres; the shortest step-free detour is 868. StreetMend shows exactly which edge breaks it and why the alternatives don't count." |
| **50–70 s** | **4 · StreetMend finds a fix.** Panel: *Two coordinated interventions restore the required journey.* Expand *Why not fewer?* | "Now it searches the mitigation catalog for the smallest fix, with the closure kept. Twenty candidate sets, under half a second. The answer is temporary ramps at both ends of the other crossing. Either one alone still fails. A temporary crossing at Park Drive restores a route, but it's a 19 percent detour, over the limit." |
| **70–88 s** | **5 · Apply and verify.** The ramps heal in; the route traces through; **ACCESS RESTORED — CHECK PASSED**; today / proposed / fixed table. | "The fix goes into a third network state and the original checks run again. All five pass: 648 metres step-free, all 55 journeys back. StreetMend doesn't call it fixed until the graph engine has verified it." |
| **88–105 s** | **6 · The engine is real.** Switch **B** off: fails. Switch it back on: passes. | "This isn't an animation. Take one ramp away and the check fails again; put it back and it passes. Every state is recomputed." |
| **105–120 s** | Optional: select another crossing on the map → **Propose closure** → **Run access checks**. Or switch to **Data explorer**. | "Any sidewalk or crossing can be proposed. On real CDOT records, missing data makes checks INCONCLUSIVE instead of passing them. Test the city before you change it." |

## Secondary demo: fix or build? (about 60 s)

Header → **Access gaps**. Real CDOT records and OpenStreetMap places.

| Action | Say |
|---|---|
| **Education** selected; hexagons over Elizabeth | "The same engine, on real records: every home's distance to schools along the network. Amber is not 'probably fine'. It means the route depends on sidewalks the city has no record of. 142 homes fail outright." |
| Click the top cell, **51 of 51 homes fail** | "Why? The nearest education site, a kindergarten, is 627 m away in a straight line and 902 m with every link open, but the usable step-free route is 1,763 m. The inventory records *No Sidewalk* on the direct route: a connectivity barrier." |
| **Compare: fix the network or build?** | "Two options, the same 51 homes and the same objective. Building two missing sidewalks brings 42 homes within reach, a new school 35. One of the two sidewalks is worth nothing alone; ranking repairs one at a time would miss it." |
| Budget → **1 repair** | "With one repair the answer flips: the new school wins, 35 to 32. The tool does not decide in advance." |
| **Show on map** (either) | "The option is applied and re-run on the full network. Here is the same home's new route, re-verified." |
| **Grocery** → top cell | "And when no supermarket exists in the network at all, repairs cannot help, and the tool says so." |

Optional: **Ask in plain English**, for example "Show the streets that disconnect the most modeled journeys if closed". The question maps to an allowlisted tool and the map highlights the links.

## Backup lines
* *Is the scenario rigged?* "The closure and the barriers are hypothetical settings, and the badge says so. The streets and detours are the real Charlotte graph; the exploration script shows how the detours were found, and the tests re-derive every number."
* *Is this ADA compliance?* "No. These are configurable planning checks on a modeled network. Unknown links make a check INCONCLUSIVE, never PASS."
* *Where is the AI?* "Nowhere in the decision. The fix is an exact search over typed interventions, verified by the graph engine. The optional assistant only maps questions to allowlisted operations; it never runs generated code."
* *How do I know it's right?* "More → Evidence: ten deterministic fixtures, every claim checked independently, against greedy and nearest-first baselines. Greedy fails the dependent pair, including this Charlotte case."
* *Does it scale?* "One proposal check takes about 0.15 seconds and the fix search 0.4 on this laptop, using compiled Dijkstra. Larger catalogs use the same search with a cap, and report when it isn't exhaustive."

## If something goes wrong
* **API offline**: restart it with `uv run uvicorn streetmend.api.main:app --port 8000`.
* **Slow or no internet**: the opening waits for tiles and can be skipped with **Esc**. Offline, buildings, network, routes and checks still work.
* **Wrong state**: **Start over** at the bottom of the panel, or **Exit presentation** and **Present** again.
* **The repair-planner demo** (the original StreetMend story) is under **Repair planner** in the header.
