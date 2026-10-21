# Live demo script (90–120 s)

Setup: API and web running (see README). Open http://localhost:5173 at about 1440 × 900 in a WebGL2 browser. To show the opening, use a fresh browser profile or **⋯ → Replay intro**. A recorded run is in `docs/media/streetmend-demo.mp4`; the opening alone is in `docs/media/streetmend-intro.mp4`.

The easiest path is the opening followed by **Present** in the header: six steps, each with a caption, driven by the real engine. Use **Next** to advance. Everything also works by hand.

| Time | Step / action | Say |
|---|---|---|
| **0–8 s** | **The opening.** United States → North Carolina → Charlotte → Elizabeth in 3D. | "StreetMend starts with the place: Charlotte, North Carolina, and a neighborhood called Elizabeth." |
| **8–20 s** | **Present → 01 · The city.** Point at the badge *Modeled scenario · Real Charlotte geography*. | "Real streets, real crossings, five thousand real building footprints. The barriers in this case are hypothetical, set up to show a problem planners face everywhere." |
| **20–35 s** | **02 · The disconnected journey.** The camera drops to East 7th Street; the inspector opens on repair A with the illustrative crossing. | "Residents of Hawthorne Lane need a step-free route to Novant Health Presbyterian. It breaks here: a crossing works only if the curb ramps at both ends work, and both are blocked." |
| **35–48 s** | **03 · The repair recommendation.** The panel: *Repair these two connections together.* | "With a budget of two, the engine tests every combination of candidate repairs and picks A and B, the two ends of the same crossing." |
| **48–62 s** | **04 · The first intervention.** Callout: *One end still blocked*. | "Repair A alone: the engine recomputes, and the journey is still broken. Ranking ramps one at a time would call A worthless." |
| **62–80 s** | **05 · The second intervention.** The route traces in emerald; banner **TWO REPAIRS. ONE RECONNECTED JOURNEY.** | "Repair B completes the crossing: a continuous 648-metre route, ten journeys reconnected. Neither repair does anything alone." |
| **80–95 s** | **06 · The measured result.** Drag the before/after handle. | "Same view, before and after: 45 to 55 connected journeys. A alone: zero. B alone: zero. Together: plus 123. Greedy and individual ranking recommend nothing here." |
| **95–110 s** | Exit; **Adjust** → budget **1** → **Find the best repairs** (*No single repair helps here*). Switch to **Data explorer**. | "With one repair, nothing helps, and the tool says so. On real CDOT records the same pattern appears: homes on East 5th Street can't reach the hospital because of two recorded barrier ramps." |
| **110–120 s** | **Ramp records** → open a record; then **Data & quality**. | "Every record keeps its source and survey date. Unknown links are never treated as accessible. StreetMend doesn't just show where infrastructure is broken. It finds which repairs work together to reconnect access." |

## Backup lines
* *Is the result rigged?* "The guided barriers are hypothetical and chosen to show the effect, and the badge says so. On real data the strict policy shows the same thing: exact plus 186 versus greedy plus 53. On 40 randomized districts greedy is usually optimal, and the benchmark says that too."
* *Are those buildings real?* "Footprints are OpenStreetMap. Heights come from OSM tags where they exist; most are estimates, and the building inspector shows which."
* *Is the opening just a video?* "No: it's the same map camera all the way. The national outline is drawn in the map's own projection, and the flight lands on the app's computed journey view."
* *What does the AI do?* "It maps language to one of eleven allowlisted operations. Without the model, the rule parser still works."

## If something goes wrong
* **API offline**: the app shows that the API is not reachable. Restart it with `uv run uvicorn streetmend.api.main:app --port 8000`.
* **Slow or no internet**: the opening waits for map tiles ("Preparing the city…") and can be skipped with **Esc**. Offline, the map shows *Basemap tiles unavailable*; buildings, network, routes and analysis keep working.
* **Wrong state**: **Start over** under the journey, or **Exit presentation** and **Present** again. **Reset view** (crosshair-in-circle icon) returns the camera to the journey.
* **Slow machine**: switch to **2D**, the precision view; everything else is identical.
