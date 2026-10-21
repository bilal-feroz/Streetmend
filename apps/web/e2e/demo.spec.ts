import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

// End-to-end checks against the real FastAPI engine. Wherever the UI shows a
// number, the test asks the API for the same quantity and compares.

const API = 'http://127.0.0.1:8000/api'
const GUIDED = 'guided'
const HEALTH = { healthcare: 3, transit: 1, education: 1 }

const status = (page: Page) => page.getByTestId('journey-status')
const banner = (page: Page) => page.getByTestId('banner-title')
const radio = (page: Page, group: string, name: string) => page.getByTestId(group).getByRole('radio', { name, exact: true })

/** Resolves after MapLibre (and with it the Three.js layer) has drawn a fresh frame. */
async function frame(page: Page) {
  await page.waitForFunction('window.__sm && !window.__sm.map.isMoving()')
  await page.evaluate(`new Promise((r) => { const m = window.__sm.map; m.once('render', () => requestAnimationFrame(() => r(null))); m.triggerRepaint() })`)
}

/** Pixel distance between the Three.js projection and MapLibre's own projection
 * for ground points spread over the current view. */
const ALIGNMENT = `(() => {
  const m = window.__sm.map, c = m.getCanvas(), W = c.clientWidth, H = c.clientHeight
  const pts = [[0.5, 0.5], [0.2, 0.75], [0.8, 0.6], [0.35, 0.9], [0.65, 0.35]].map(([x, y]) => { const p = m.unproject([x * W, y * H]); return [p.lng, p.lat] })
  return window.__sm.alignment(pts)
})()`

async function expectAligned(page: Page) {
  await frame(page)
  const err = (await page.evaluate(ALIGNMENT)) as (number | null)[]
  expect(err.length).toBe(5)
  for (const e of err) {
    expect(e).not.toBeNull()
    expect(e!).toBeLessThan(0.5)
  }
}

/** Screen position of a map marker, from the same projection the renderer used. */
async function markerPoint(page: Page, key: string) {
  await frame(page)
  const p = (await page.evaluate(`(() => {
    const L = window.__sm.layer, m = L.markers.after.list().find((x) => x.key === ${JSON.stringify(key)})
    return m ? L.projectLocal(m.local) : null
  })()`)) as [number, number] | null
  expect(p, `marker ${key} on screen`).not.toBeNull()
  const box = (await page.locator('.maplibregl-canvas').boundingBox())!
  return { x: box.x + p![0], y: box.y + p![1] }
}

async function open(page: Page, { panel = true } = {}) {
  await page.goto('/?intro=0&scenario=guided') // the opening and the change check have their own tests below
  await expect(page.locator('.maplibregl-canvas')).toBeVisible()
  await expect(page.getByTestId('data-status')).toContainText('Modeled scenario · Real Charlotte geography')
  if (panel) await expect(status(page)).toContainText('Disconnected')
  await page.waitForFunction('(window.__sm?.layer.index?.ids.length ?? 0) > 5000', null, { timeout: 60_000 }) // CPU-rendered CI is slow to build the city
}

test('guided flow: 3D city, two dependent repairs, evidence, undo, explorer and back', async ({ page, request }) => {
  test.setTimeout(180_000) // twenty steps, each waiting on real engine calls and camera moves
  // 1-2. Start StreetMend on the Charlotte map: real basemap, real OSM footprints, honest badge.
  await open(page)
  await expect(status(page)).toContainText('Both curb ramps of the East 7th Street crossing at Hawthorne Lane are blocked')
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap')
  // The desktop demo never scrolls the page itself.
  expect(await page.evaluate('document.documentElement.scrollHeight <= window.innerHeight')).toBe(true)

  // 3. 2D is flat and north-up; 3D tilts the extruded city back in.
  await radio(page, 'map-mode', '2D').click()
  await expect.poll(() => page.evaluate('Math.abs(window.__sm.map.getPitch())')).toBeLessThan(0.01)
  await expect.poll(() => page.evaluate('Math.abs(window.__sm.map.getBearing())')).toBeLessThan(0.01)
  await radio(page, 'map-mode', '3D').click()
  await expect.poll(() => page.evaluate('window.__sm.map.getPitch()')).toBeGreaterThan(40)

  // 4. Rotate and zoom with MapLibre's keyboard handlers; the city stays glued to the basemap.
  await frame(page)
  const cam0 = (await page.evaluate('({ z: window.__sm.map.getZoom(), b: window.__sm.map.getBearing() })')) as { z: number; b: number }
  await page.locator('.maplibregl-canvas').focus()
  await page.keyboard.press('Shift+ArrowLeft') // rotate 15 degrees
  await expect.poll(async () => Math.abs(((await page.evaluate('window.__sm.map.getBearing()')) as number) - cam0.b)).toBeGreaterThan(10)
  await frame(page)
  await page.keyboard.press('Equal') // zoom in one level
  await expect.poll(() => page.evaluate('window.__sm.map.getZoom()')).toBeGreaterThan(cam0.z + 0.5)
  await expectAligned(page)

  // 5. Select the journey: homes on Hawthorne Lane to Novant Health Presbyterian.
  const sc = await (await request.get(`${API}/scenarios/${GUIDED}`)).json()
  const [origin, destination] = sc.default_journey as [string, string]
  const other = (sc.destinations as { id: string }[]).find((d) => d.id !== destination)!.id
  await page.getByTestId('change-journey').click()
  await page.getByTestId('destination-select').selectOption(other)
  await expect(page.getByTestId('destination-select')).toHaveValue(other)
  await page.getByTestId('origin-select').selectOption(origin)
  await page.getByTestId('destination-select').selectOption(destination)
  await expect(status(page)).toContainText('Both curb ramps')

  // 6. Inspect the blocked crossing from its map marker.
  await page.getByTestId('cam-street').click()
  const a = await markerPoint(page, 'iv:A')
  await page.mouse.click(a.x, a.y)
  const insp = page.getByTestId('inspector')
  await expect(insp).toContainText('Repair A')
  await expect(insp).toContainText('Blocked')
  await expect(insp).toContainText('scenario setting, not a survey finding')
  await expect(insp).toContainText('Illustrative crossing')
  await expect(insp.locator('canvas')).toBeVisible()
  await insp.getByRole('button', { name: 'Close details' }).click()

  // 7-8. Budget two, healthcare priority, run the analysis.
  await radio(page, 'budget', '2').click()
  await radio(page, 'priority', 'Healthcare').click()
  await page.getByTestId('analyze').click()
  await expect(page.getByTestId('solver-meta')).toContainText('Exact search over 10 combinations')
  await expect(page.getByTestId('rec-A')).toBeVisible()
  await expect(page.getByTestId('rec-B')).toBeVisible()
  await expect(page.getByTestId('headline')).toContainText('the East 7th Street crossing at Hawthorne Lane')
  const opt = await (await request.post(`${API}/scenarios/${GUIDED}/optimize`, { data: { budget: 2, priority: 'healthcare' } })).json()
  expect([...opt.recommendation.selected].sort()).toEqual(['A', 'B'])
  expect(opt.baselines.find((b: { solver: string }) => b.solver === 'greedy').selected).toEqual([])
  await expect(page.getByTestId('stat-objective')).toContainText(String(opt.objective.after))
  await expect(page.getByTestId('baselines')).toContainText(`+${opt.objective.gain}`)

  // 9-10. Repair A alone leaves the crossing incomplete.
  await page.getByTestId('apply-A').click()
  await expect(banner(page)).toHaveText('One connection repaired. The crossing remains incomplete.')
  await expect(status(page)).toContainText('Disconnected')
  await expect(status(page)).toContainText('(B)')

  // 11-12. Repair B completes it: the journey becomes reachable.
  await page.getByTestId('apply-B').click()
  await expect(banner(page)).toHaveText('TWO REPAIRS. ONE RECONNECTED JOURNEY.')
  await expect(page.getByTestId('banner')).toContainText('Neither repair completes this crossing alone')
  await expect(status(page)).toContainText('Connected')

  // 13. The calculated route: the length is the engine's, and the map draws it.
  const ev = await (await request.post(`${API}/scenarios/${GUIDED}/evaluate`, { data: { applied: ['A', 'B'], origin, destination, weights: HEALTH } })).json()
  expect(ev.journey.route.found).toBe(true)
  await expect(status(page)).toContainText(`${Math.round(ev.journey.route.length_m)} m`)
  await page.getByTestId('cam-overview').click()
  await expect.poll(() => page.evaluate('!!window.__sm.layer.networks.after.route')).toBe(true)

  // 14. Before/after split, with the engine's connected-journey counts on each side.
  await page.getByTestId('toggle-compare').click()
  const total = opt.objective.total_pairs
  await expect(page.getByTestId('compare-before')).toContainText(`${opt.objective.connected_pairs_before} of ${total} journeys connected`)
  await expect(page.getByTestId('compare-after')).toContainText(`${opt.objective.connected_pairs_after} of ${total} journeys connected`)
  const slider = page.getByRole('slider', { name: 'Before and after comparison position' })
  await slider.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(slider).toHaveAttribute('aria-valuenow', '45')
  await page.getByTestId('toggle-compare').click()
  await expect(page.getByTestId('compare')).toHaveCount(0)

  // 15-16. Undo one repair: the engine and the map both go back.
  await page.getByTestId('undo').click()
  await expect(status(page)).toContainText('(B)')
  await expect(page.getByTestId('apply-B')).toBeVisible()
  await expect(page.getByTestId('remove-A')).toBeVisible()
  await expect.poll(() => page.evaluate('!!window.__sm.layer.networks.after.route')).toBe(false)

  // 17. Reset.
  await page.getByTestId('reset').click()
  await expect(status(page)).toContainText('Both curb ramps')
  await expect(page.getByTestId('apply-A')).toBeVisible()

  // 18. Charlotte Data Explorer.
  await radio(page, 'data-mode', 'Data explorer').click()
  await expect(page.getByTestId('data-status')).toContainText('Municipal records', { timeout: 30_000 })

  // 19. One actual CDOT record, field values exactly as the city published them.
  const recs = await (await request.get(`${API}/municipal/records`)).json()
  const rec = recs.ramps[0].properties
  await page.getByTestId('tab-records').click()
  await expect(page.getByText(`${recs.ramps.length} CDOT curb-ramp records in the study area`)).toBeVisible()
  await page.getByLabel('Filter records').fill(String(rec.OBJECTID))
  await page.getByTestId('record-list').locator('button').first().click()
  const detail = page.getByTestId('record-detail')
  await expect(detail).toContainText(String(rec.OBJECTID))
  await expect(detail).toContainText(rec.RP_AssetID)
  await expect(detail).toContainText(String(rec.RP_Slope))
  await expect(detail).toContainText('Source: CDOT ADA Curb Ramps')
  await expect.poll(() => page.evaluate(`JSON.stringify(window.__sm.map.getFilter('rec-selected'))`)).toContain(String(rec.OBJECTID))

  // 20. Back to the guided simulation.
  await radio(page, 'data-mode', 'Repair planner').click()
  await expect(page.getByTestId('data-status')).toContainText('Modeled scenario')
  await expect(status(page)).toContainText('Both curb ramps')
})

test('change check: propose, test, find the breakage, fix, verify (every state from the engine)', async ({ page, request }) => {
  test.setTimeout(120_000)
  await page.goto('/?intro=0')
  await expect(page.getByTestId('check-chip')).toContainText('Route available in model')
  await page.waitForFunction('(window.__sm?.layer.index?.ids.length ?? 0) > 5000', null, { timeout: 60_000 }) // CPU-rendered CI is slow to build the city
  const sc = await (await request.get(`${API}/scenarios/preflight`)).json()
  const prop = sc.context.verify.proposals[0].changes
  const ref = await (await request.post(`${API}/scenarios/preflight/verify`, { data: { proposal: prop } })).json()
  expect(ref.baseline.summary.FAIL).toBe(0)

  // Act 1: today's network works
  await expect(page.getByTestId('check-title')).toContainText(`${Math.round(ref.baseline.step_free_route.length_m)} m step-free route`)
  // Act 2: the planner proposes a closure (a separate proposed network)
  await page.getByTestId('propose-P1').click()
  await expect(page.getByTestId('draft')).toContainText('Temporary closure')
  await expect(page.getByTestId('check-chip')).toContainText('Route available in model')
  // Act 3: run the checks; the regression and its counterexample come from the engine
  await page.getByTestId('run-checks').click()
  await expect(banner(page)).toHaveText('ACCESS REGRESSION DETECTED')
  for (const c of ref.proposed.checks) await expect(page.getByTestId(`check-${c.id}`)).toHaveAttribute('data-status', c.status)
  const ce = ref.proposed.checks.find((c: { id: string }) => c.id === 'R1').counterexample
  await expect(page.getByTestId('counterexample')).toContainText(`${ce.walking_route.steps.length} curb steps`)
  await expect(page.getByTestId('counterexample')).toContainText(`${Math.round(ce.best_alternative.length_m)} m detour`)
  // the same change, two travel profiles: walking keeps a route, step-free does not
  await expect(page.getByTestId('profile-walking')).toContainText('Available')
  await expect(page.getByTestId('profile-step_free')).toContainText('Unavailable')
  await page.getByTestId('profile-walking').click()
  await expect(page.getByTestId('profile-walking')).toHaveAttribute('aria-pressed', 'true')
  // Act 4: the minimal fix is found by search, with why fewer fails
  const fix = await (await request.post(`${API}/scenarios/preflight/verify/fix`, { data: { proposal: prop } })).json()
  await page.getByTestId('find-fix').click()
  await expect(page.getByTestId('fix-title')).toHaveText('Two coordinated interventions restore the required journey.')
  for (const id of fix.interventions) await expect(page.getByTestId(`fix-${id}`)).toBeVisible()
  await expect(page.getByTestId('why-not')).toContainText('A alone: still no step-free route')
  await expect(page.getByTestId('why-not')).toContainText('C alone: restores a')
  // Act 5: apply and verify
  await page.getByTestId('apply-fix').click()
  await expect(banner(page)).toHaveText('ACCESS RESTORED — CHECK PASSED', { timeout: 20_000 })
  await expect(page.getByTestId('check-chip')).toContainText('Check passed')
  const fixed = await (await request.post(`${API}/scenarios/preflight/verify`, { data: { proposal: prop, mitigations: fix.interventions } })).json()
  await expect(page.getByTestId('metrics')).toContainText(`${fixed.fixed.summary.PASS}/${fixed.fixed.checks.length}`)
  await expect.poll(() => page.evaluate('!!window.__sm.layer.networks.after.route')).toBe(true)
  // Act 6: state-dependent, not pre-recorded
  await page.getByTestId('toggle-B').click()
  await expect(banner(page)).toHaveText('ACCESS REGRESSION DETECTED')
  await expect(page.getByTestId('check-R1')).toHaveAttribute('data-status', 'FAIL')
  await page.getByTestId('toggle-B').click()
  await expect(banner(page)).toHaveText('ACCESS RESTORED — CHECK PASSED')
  await expect(page.getByTestId('check-R1')).toHaveAttribute('data-status', 'PASS')
})

test('access gaps: discover, diagnose, fix or build, verify (every number from the engine)', async ({ page, request }) => {
  test.setTimeout(120_000)
  await page.goto('/?intro=0')
  await expect(page.getByTestId('check-chip')).toBeVisible()
  await radio(page, 'data-mode', 'Access gaps').click()
  await expect(page.getByTestId('data-status')).toContainText('Real records')
  // Discover: the headline count is the engine's
  const edu = await (await request.get(`${API}/access/education`)).json()
  await expect(page.getByTestId('access-title')).toContainText(`${edu.summary.failing} homes cannot reach education`)
  await expect.poll(() => page.evaluate("window.__sm.map.getLayoutProperty('access-fill', 'visibility')")).toBe('visible')
  // Diagnose the worst cell
  const worst = edu.ranking[0]
  await page.getByTestId(`cell-${worst}`).click()
  const d = await (await request.get(`${API}/access/education/cells/${worst}`)).json()
  expect(d.primary_factor).toBe('barrier')
  await expect(page.getByTestId('diagnose')).toContainText('Connectivity barrier')
  await expect(page.getByTestId('distances')).toContainText(`${Math.round(d.representative.step_free_possible_m).toLocaleString('en-US')} m`)
  await expect(page.getByTestId('barriers')).toContainText(d.representative.barriers[0].reason.slice(0, 30))
  // Fix or build, budget two: fixing wins, with a repair that is worth nothing alone
  await page.getByTestId('run-compare').click()
  const two = await (await request.post(`${API}/access/compare`, { data: { category: 'education', cells: [worst], budget: 2 } })).json()
  await expect(page.getByTestId('gain-fix')).toHaveText(`+${two.fix.gain}`)
  await expect(page.getByTestId('gain-build')).toHaveText(`+${two.build.gain}`)
  await expect(page.getByTestId('option-fix')).toContainText('Wins')
  await expect(page.getByTestId('intervene')).toContainText('one is worth nothing on its own')
  // budget one: the answer flips to building
  await radio(page, 'access-budget', '1 repair').click()
  const one = await (await request.post(`${API}/access/compare`, { data: { category: 'education', cells: [worst], budget: 1 } })).json()
  expect(one.winner).toBe('build')
  await expect(page.getByTestId('gain-fix')).toHaveText(`+${one.fix.gain}`)
  await expect(page.getByTestId('option-build')).toContainText('Wins')
  // Verify: the option re-run on the full network
  await page.getByTestId('show-build').click()
  await expect(page.getByTestId('access-title')).toContainText(`Re-verified: ${one.build.after.possible} of ${one.homes} homes`)
  await expect(page.getByTestId('access-verify').locator('[data-status]').nth(2)).toHaveAttribute('data-status', one.build.after.status)
  // Grocery: no store in the modeled network, so repairs cannot help
  await page.getByTestId('cat-grocery').click()
  const gro = await (await request.get(`${API}/access/grocery`)).json()
  await expect(page.getByTestId('access-title')).toContainText(`${gro.summary.failing} homes cannot reach grocery`)
  await page.getByTestId(`cell-${gro.ranking[0]}`).click()
  await expect(page.getByTestId('diagnose')).toContainText('No facility in reach')
  await page.getByTestId('run-compare').click()
  await expect(page.getByTestId('option-fix')).toContainText('No repair within reach helps')
  await expect(page.getByTestId('option-build')).toContainText('Wins')
})

test('change check presentation walks the six acts', async ({ page }) => {
  test.setTimeout(150_000)
  await page.goto('/?intro=0')
  await expect(page.getByTestId('check-chip')).toBeVisible()
  await page.getByTestId('present').click()
  const titles = ['A city that works', 'A planner proposes a change', 'StreetMend finds a regression', 'StreetMend finds a fix', 'Apply and verify', 'The engine is real']
  for (const [i, title] of titles.entries()) {
    await expect(page.getByTestId('scene-title')).toHaveText(title)
    if (i < titles.length - 1) await expect(page.getByTestId('scene-next')).toBeEnabled({ timeout: 25_000 })
    if (i === 1) await expect(page.getByTestId('draft')).toBeVisible()
    if (i === 2) await expect(banner(page)).toHaveText('ACCESS REGRESSION DETECTED')
    if (i === 3) await expect(page.getByTestId('fix-title')).toBeVisible()
    if (i === 4) await expect(banner(page)).toHaveText('ACCESS RESTORED — CHECK PASSED')
    if (i === 5) await expect(page.getByTestId('check-R1')).toHaveAttribute('data-status', 'FAIL', { timeout: 25_000 })
    if (i < titles.length - 1) await page.getByTestId('scene-next').click()
  }
})

test('3D city layer is pixel-aligned with the basemap at any camera', async ({ page }) => {
  test.setTimeout(180_000) // several camera and 2D/3D changes, each re-rendering shadows on a CPU rasteriser in CI
  await open(page)
  for (const [pitch, bearing, zoom] of [[0, 0, 15], [45, -32, 16], [70, 120, 17.2], [60, -150, 14.6]]) {
    await page.evaluate(`window.__sm.map.jumpTo({ pitch: ${pitch}, bearing: ${bearing}, zoom: ${zoom} })`)
    await expectAligned(page)
  }
  await radio(page, 'map-mode', '2D').click()
  await expect.poll(() => page.evaluate('window.__sm.map.getPitch()')).toBeLessThan(0.5)
  await expectAligned(page)
  await radio(page, 'map-mode', '3D').click()
  await page.getByTestId('cam-street').click()
  await expect.poll(() => page.evaluate('window.__sm.map.getZoom()')).toBeGreaterThan(18)
  await expectAligned(page)
})

test('the story strip: before, repair A, A + B, result (engine-computed, clickable)', async ({ page, request }) => {
  await open(page)
  const sc = await (await request.get(`${API}/scenarios/${GUIDED}`)).json()
  const [origin, destination] = sc.default_journey as [string, string]
  const ev = async (applied: string[]) => (await request.post(`${API}/scenarios/${GUIDED}/evaluate`, { data: { applied, origin, destination, weights: HEALTH } })).json()
  const [e0, e1, e2] = await Promise.all([ev([]), ev(['A']), ev(['A', 'B'])])
  expect([e0.journey.route.found, e1.journey.route.found, e2.journey.route.found]).toEqual([false, false, true])
  await expect(page.getByTestId('story-0')).toContainText('Disconnected')
  await expect(page.getByTestId('story-1')).toContainText('Still disconnected')
  await expect(page.getByTestId('story-2')).toContainText('Connected')
  await expect(page.getByTestId('story-result')).toContainText(`+${e2.metrics.connected_pairs - e0.metrics.connected_pairs} journeys`)
  await page.getByTestId('story-1').click()
  await expect(status(page)).toContainText('(B)')
  await page.getByTestId('story-2').click()
  await expect(status(page)).toContainText('Connected')
  await expect(banner(page)).toHaveText('TWO REPAIRS. ONE RECONNECTED JOURNEY.')
  await page.getByTestId('story-result').click()
  await expect(page.getByTestId('compare-after')).toContainText(`${e2.metrics.connected_pairs} of ${e2.metrics.total_pairs} journeys connected`)
  await page.getByTestId('story-0').click()
  await expect(status(page)).toContainText('Both curb ramps')
  await expect(page.getByTestId('compare')).toHaveCount(0)
})

test('one repair is not enough: budget one recommends nothing', async ({ page, request }) => {
  await open(page)
  await radio(page, 'budget', '1').click()
  await page.getByTestId('analyze').click()
  await expect(page.getByTestId('headline')).toContainText('No repair within this budget improves access')
  await expect(page.getByTestId('recommendations')).toHaveCount(0)
  const opt = await (await request.post(`${API}/scenarios/${GUIDED}/optimize`, { data: { budget: 1, priority: 'healthcare' } })).json()
  expect(opt.recommendation.selected).toEqual([])
  expect(opt.objective.gain).toBe(0)
})

test('map inspector applies and removes a repair', async ({ page }) => {
  await open(page)
  await page.getByTestId('cam-street').click()
  const a = await markerPoint(page, 'iv:A')
  await page.mouse.click(a.x, a.y)
  await page.getByTestId('inspector-apply').click()
  await expect(status(page)).toContainText('(B)')
  await page.getByTestId('inspector-remove').click()
  await expect(status(page)).toContainText('Both curb ramps')
})

test('presentation mode walks through the seven scenes', async ({ page }) => {
  await open(page)
  await page.getByTestId('present').click()
  const titles = ['The city', 'The disconnected journey', 'The repair recommendation', 'The first intervention', 'The second intervention', 'The measured result']
  for (const [i, title] of titles.entries()) {
    await expect(page.getByTestId('scene-title')).toHaveText(title)
    if (i === 1) await expect(page.getByTestId('inspector')).toContainText('Repair A')
    if (i === 2) await expect(page.getByTestId('rec-B')).toBeVisible()
    if (i === 3) await expect(banner(page)).toHaveText('One connection repaired. The crossing remains incomplete.')
    if (i === 4) {
      await expect(banner(page)).toHaveText('TWO REPAIRS. ONE RECONNECTED JOURNEY.')
      await expect(status(page)).toContainText('Connected')
    }
    if (i === 5) await expect(page.getByTestId('compare')).toBeVisible()
    if (i < titles.length - 1) {
      await expect(page.getByTestId('scene-next')).toBeEnabled({ timeout: 20_000 })
      await page.getByTestId('scene-next').click()
    }
  }
  await expect(page.getByTestId('scene-next')).toBeDisabled()
  await page.getByTestId('present').click()
  await expect(page.getByTestId('presentation')).toHaveCount(0)
})

test('assistant maps questions to allowlisted operations', async ({ page }) => {
  await open(page)
  await page.getByTestId('toggle-assistant').click()
  const ask = async (text: string) => {
    await page.getByTestId('ask-input').fill(text)
    await page.getByTestId('ask-input').press('Enter')
  }
  await ask('Which two repairs improve access to healthcare the most?')
  await expect(page.getByTestId('rec-A')).toBeVisible()
  await expect(page.getByTestId('assistant-op')).toContainText('Find repairs')
  await ask('What happens if I can only repair one?')
  await expect(page.getByTestId('assistant-op')).toContainText('Compare budgets')
  await expect(page.getByTestId('assistant-response')).toContainText('With 1 repair(s): none')
  await ask('delete all files on the server')
  await expect(page.getByTestId('assistant-op')).toContainText('Not supported')
})

test('sources, help and settings; diagnostics stay out of the main UI', async ({ page }) => {
  await open(page)
  await expect(page.locator('header')).not.toContainText('qwen')
  await expect(page.locator('#planning')).not.toContainText('qwen')
  await page.getByTestId('open-methodology').click()
  const m = page.getByTestId('methodology')
  await expect(m).toBeVisible()
  await expect(m).toContainText('Score(S)')
  await expect(m).toContainText('hypothetical barriers')
  await expect(m).toContainText('estimates')
  await expect(m).toContainText('ADA compliance determination')
  await page.keyboard.press('Escape')
  await expect(m).not.toBeVisible()
  await page.getByTestId('more-menu').click()
  await page.getByTestId('open-help').click()
  await expect(page.getByTestId('help')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByTestId('more-menu').click()
  await page.getByTestId('open-settings').click()
  const s = page.getByTestId('settings')
  await expect(s).toContainText('Diagnostics')
  await expect(s).toContainText(GUIDED)
  await page.keyboard.press('Escape')
  await expect(s).not.toBeVisible()
})

test('keyboard users can run the analysis and apply repairs', async ({ page }) => {
  await open(page)
  await page.getByTestId('analyze').focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('rec-A')).toBeVisible()
  await page.getByTestId('apply-A').focus()
  await page.keyboard.press('Enter')
  await expect(status(page)).toContainText('(B)')
})

test('Charlotte data explorer plans on real records', async ({ page }) => {
  await open(page)
  await radio(page, 'data-mode', 'Data explorer').click()
  await expect(page.getByTestId('data-status')).toContainText('Municipal records', { timeout: 30_000 })
  // Real-data dependency: two recorded ramps block the default home -> hospital journey.
  await expect(status(page)).toContainText('(R112391, R20741)')
  await page.getByTestId('analyze').click()
  await expect(page.getByTestId('solver-meta')).toContainText('Exact search', { timeout: 30_000 })
  await page.getByTestId('toggle-candidates').click()
  await page.getByTestId('list-apply-R112391').click()
  await expect(status(page)).toContainText('(R20741)')
  await page.getByTestId('list-apply-R20741').click()
  await expect(status(page)).toContainText('Connected')
  await page.getByTestId('tab-quality').click()
  await expect(page.getByText('Coverage of the modeled graph')).toBeVisible()
  await page.getByTestId('tab-plan').click()
  await radio(page, 'policy', 'Strict').click()
  await expect(page.locator('#planning').getByText('Every ramp not recorded as compliant or remediated is a barrier.')).toBeVisible()
})

test('no serious automated accessibility violations', async ({ page }) => {
  await open(page)
  await page.getByTestId('analyze').click()
  await expect(page.getByTestId('rec-A')).toBeVisible()
  await page.getByTestId('apply-all').click()
  await expect(status(page)).toContainText('Connected')
  const scan = async () => {
    const r = await new AxeBuilder({ page }).exclude('.maplibregl-canvas').analyze()
    return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.length} nodes`)
  }
  expect(await scan()).toEqual([])
  // the inspector with its illustrative crossing, and the before/after split
  await page.getByRole('button', { name: 'Show repair A on the map' }).click()
  await expect(page.getByTestId('inspector')).toContainText('Illustrative crossing')
  await page.getByTestId('toggle-compare').click()
  await expect(page.getByTestId('compare-after')).toBeVisible()
  expect(await scan()).toEqual([])
  await radio(page, 'data-mode', 'Data explorer').click()
  await expect(page.getByTestId('data-status')).toContainText('Municipal records', { timeout: 30_000 })
  await page.getByTestId('tab-records').click()
  await page.getByTestId('record-list').locator('button').first().click()
  expect(await scan()).toEqual([])
})

test.describe('phone layout', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('planning sheet runs the same flow without horizontal scrolling', async ({ page }) => {
    await open(page, { panel: false })
    expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
    await page.getByTestId('open-panel').click()
    await expect(page.getByTestId('data-mode-sheet')).toBeVisible()
    await page.getByTestId('analyze').click()
    await page.getByTestId('apply-all').click()
    await expect(status(page)).toContainText('Connected')
    await page.getByRole('button', { name: 'Close planning panel' }).click()
    await expect(banner(page)).toHaveText('TWO REPAIRS. ONE RECONNECTED JOURNEY.')
  })
})

test.describe('opening animation', () => {
  test('flies from the United States to the Charlotte study area and hands over cleanly', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto('/?intro=1')
    const intro = page.getByTestId('intro')
    await expect(intro).toHaveAttribute('data-stage', 'usa')
    // the highlighted state is North Carolina: it contains Charlotte and Raleigh, not Columbia SC or Richmond VA
    await expect.poll(() => page.evaluate('window.__introCheck')).toEqual({ charlotte: true, raleigh: true, columbiaSC: false, richmondVA: false })
    await expect(intro).toHaveAttribute('data-stage', 'nc', { timeout: 5_000 })
    await expect(intro).toHaveAttribute('data-stage', /charlotte|city/, { timeout: 15_000 })
    await expect(intro).toHaveCount(0, { timeout: 15_000 })
    // landed on the study area, in 3D, with the city aligned and the case on screen
    const cam = (await page.evaluate('({ z: window.__sm.map.getZoom(), p: window.__sm.map.getPitch(), lng: window.__sm.map.getCenter().lng, lat: window.__sm.map.getCenter().lat })')) as { z: number; p: number; lng: number; lat: number }
    expect(cam.z).toBeGreaterThan(14.5)
    expect(cam.p).toBeGreaterThan(40)
    expect(Math.abs(cam.lng + 80.826)).toBeLessThan(0.02)
    expect(Math.abs(cam.lat - 35.211)).toBeLessThan(0.02)
    await expectAligned(page)
    await expect(page.getByTestId('check-header')).toBeVisible()
    await expect(page.getByTestId('check-chip')).toContainText('Route available in model')
    const stats = (await page.evaluate('window.__introStats')) as { kind: string; frames: number; totalMs: number; skipped: boolean }
    expect(stats.kind).toBe('full')
    expect(stats.skipped).toBe(false)
    expect(stats.frames).toBeGreaterThan(60)
    expect(stats.totalMs).toBeLessThan(12_000)
  })

  test('can be skipped, and replayed from the menu', async ({ page }) => {
    await page.goto('/?intro=1')
    await page.getByTestId('intro-skip').click()
    await expect(page.getByTestId('intro')).toHaveCount(0, { timeout: 12_000 })
    await expect(page.getByTestId('check-header')).toBeVisible()
    await page.getByTestId('more-menu').click()
    await page.getByTestId('replay-intro').click()
    await expect(page.getByTestId('intro')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('intro')).toHaveCount(0, { timeout: 12_000 })
    await expect.poll(() => page.evaluate('window.__introStats.skipped')).toBe(true)
  })

  test('plays in full on a return visit too; ?intro=short gives the short arrival', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('streetmend.introSeen', '1'))
    await page.goto('/')
    await expect(page.getByTestId('intro')).toHaveAttribute('data-stage', 'nc', { timeout: 12_000 })
    await expect(page.getByTestId('intro')).toHaveCount(0, { timeout: 40_000 })
    expect(((await page.evaluate('window.__introStats')) as { kind: string }).kind).toBe('full')
    await page.goto('/?intro=short')
    await expect(page.getByTestId('intro')).toHaveCount(0, { timeout: 12_000 })
    expect(((await page.evaluate('window.__introStats')) as { kind: string }).kind).toBe('short')
  })

  test('respects reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    await expect(page.getByTestId('intro')).toHaveCount(0, { timeout: 12_000 })
    const stats = (await page.evaluate('window.__introStats')) as { kind: string }
    expect(stats.kind).toBe('none')
    await expect(page.getByTestId('check-chip')).toContainText('Route available in model')
  })
})
