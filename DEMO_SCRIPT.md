# Live demo script (90–120 s)

Setup: API and web running (see README). Open http://localhost:5173 at about 1440 × 900. Reset if anything is applied. A recorded run is in `docs/media/streetmend-demo.mp4`.

| Time | Action | Say |
|---|---|---|
| **0–15 s** | Point at the red journey card and the dotted route across Harbor Blvd. | "For a wheelchair user, one missing curb ramp can break a whole journey. Here, Maple Row Homes cannot reach the health clinic: two inaccessible connections block the only nearby crossing." |
| **15–30 s** | Gesture across the map; point at the *Synthetic scenario* badge. | "StreetMend models the street as a graph of corners, curb ramps and crossings. A crossing works only if the ramps at both ends work. This is a synthetic district; I'll show real Charlotte data at the end." |
| **30–50 s** | Type or click **Find the best two repairs for healthcare access** and press Enter. A and B pulse; the panel shows *Exact enumeration · 45 combinations*. | "I ask a planning question. The assistant only picks an approved operation; the graph engine does the math. It evaluated every pair of the nine candidates and picked A and B." |
| **50–70 s** | Click marker **A** → **Apply repair**. The reach wave crosses the street and stops at B; banner: *Barrier B still blocks…* Then click **Apply** on B. The route traces through; banner: **TWO REPAIRS. ONE RECONNECTED JOURNEY.** | "Repair A alone: the journey is still unavailable; the route now dead-ends at B. Repair B: the clinic is reachable over a continuous 201-metre route. Neither repair does anything alone; together they unlock the crossing." |
| **70–95 s** | Scroll the panel to *Combined effect* and *Impact & evidence*. | "A alone: zero. B alone: zero. Together: plus 28. That's the network effect a ranked list of barriers misses. The greedy baseline picks C and E for plus 13; exact search scores more than twice that. Twelve new origin–destination pairs, every number computed live." |
| **95–110 s** | Click budget **1**, then **Education**. Recommendations change. Click **Charlotte Data Explorer**. | "Change the budget or the priority and it recomputes: with one repair, C is best. On real Charlotte records, homes on East 5th Street can't reach Novant Presbyterian because of two recorded barrier ramps. Same pattern, real data." |
| **110–120 s** | Open **Data & quality**. | "Every record keeps its source and survey date. Unknown links are never treated as accessible, and only 35% of crossing landings have a ramp record, so we say so. StreetMend doesn't just show where infrastructure is broken. It evaluates which repairs work together to reconnect access." |

## Backup lines
* *Is the result rigged?* "The guided scenario is designed to show the effect. On 40 randomized districts greedy is usually optimal, and the benchmark says so. The method matters when repairs depend on each other, as on Charlotte's strict policy: plus 186 versus plus 53."
* *What does the AI do?* "It maps language to one of eleven allowlisted operations. Without the model, the rule parser still works."
* *Why not just fix the worst ramps?* "Individual ranking scores each ramp in isolation, which is exactly what gives A and B zero."

## If something goes wrong
* API offline: the header shows *API offline*. Restart `uv run uvicorn streetmend.api.main:app --port 8000`.
* No internet: the guided demo needs no network. Charlotte network layers still render; only basemap tiles are missing.
* Reset the scenario: the **Reset** button in the header.
