# Live demo script (90–120 s)

Setup: API and web running (see README). Open http://localhost:5173 at about 1440 × 900 in a WebGL2 browser. If anything is applied, use **Reset** (the circular arrow in the camera toolbar). A recorded run is in `docs/media/streetmend-demo.mp4`.

The easiest path is **Present** in the header: seven scenes, each with a caption, driven by the real engine. Use **Next** to advance. The table follows those scenes; everything also works by hand.

| Time | Scene / action | Say |
|---|---|---|
| **0–15 s** | **1 · Real city context.** Drag to orbit if you like. Point at the badge *Hypothetical barriers · real Charlotte streets*. | "This is Elizabeth, in Charlotte: real streets, real crossings, and five thousand real building footprints in 3D. The barriers in this scenario are hypothetical, set up to show a problem planners face everywhere." |
| **15–30 s** | **2 · Inspect the problem.** The camera drops to East 7th Street; the inspector opens on repair A with the illustrative crossing. | "Residents of Hawthorne Lane need a step-free route to Novant Health Presbyterian. It stops here: a crossing works only if the curb ramps at both ends work, and both are blocked." |
| **30–45 s** | **3 · Find repairs.** Budget two, healthcare priority; the panel shows *exact search over 10 combinations*. | "With a budget of two, the engine evaluates every combination of candidate repairs. It picks A and B: the two ends of the same crossing." |
| **45–60 s** | **4 · Apply the first repair.** Banner: *One connection repaired. The crossing remains incomplete.* | "Repair A alone: the engine recomputes and the journey is still disconnected. Ranking ramps one at a time would call A worthless." |
| **60–80 s** | **5 · Apply the second repair.** The route traces to the hospital; banner **TWO REPAIRS. ONE RECONNECTED JOURNEY.** | "Repair B completes the crossing. A continuous 648-metre route, ten journeys reconnected. Neither repair does anything alone." |
| **80–95 s** | **6 · Prove the value.** Before/after split; drag the handle. Point at *Why this combination?* | "A alone: zero. B alone: zero. Together: plus 123. Greedy and individual ranking recommend nothing here. Every number on screen is computed live." |
| **95–110 s** | **7 · Test it yourself.** Exit the presentation; set budget **1** and run again (*No repair within this budget improves access*). Switch to **Data explorer**. | "With one repair, nothing helps, and the tool says so. On real CDOT records the same pattern appears: homes on East 5th Street can't reach the hospital because of two recorded barrier ramps." |
| **110–120 s** | **Ramp records** → open a record; then **Data & quality**. | "Every record keeps its source and survey date. Unknown links are never treated as accessible, and only 35% of crossing landings have a ramp record, so we say so. StreetMend doesn't just show where infrastructure is broken. It finds which repairs work together to reconnect access." |

## Backup lines
* *Is the result rigged?* "The guided barriers are hypothetical and chosen to show the effect, and the badge says so. On real data the strict policy shows the same thing: exact plus 186 versus greedy plus 53. On 40 randomized districts greedy is usually optimal, and the benchmark says that too."
* *Are those buildings real?* "Footprints are OpenStreetMap. Heights come from OSM tags where they exist; most are estimates, and the building inspector shows which."
* *What does the AI do?* "It maps language to one of eleven allowlisted operations. Without the model, the rule parser still works."
* *Why not just fix the worst ramps?* "Individual ranking scores each ramp in isolation, which is exactly what gives A and B zero."

## If something goes wrong
* **API offline**: the app shows that the API is not reachable. Restart it with `uv run uvicorn streetmend.api.main:app --port 8000`.
* **No internet**: the map shows *Basemap tiles unavailable*. The buildings, network, routes and analysis keep working.
* **Wrong state**: press **Reset** in the camera toolbar, or **Exit presentation** and start **Present** again.
* **Slow machine**: switch to **2D**, the precision view; everything else is identical.
