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
  await page.goto('/')
  await expect(page.locator('.maplibregl-canvas')).toBeVisible()
  await expect(page.getByTestId('data-status')).toContainText('Hypothetical barriers · real Charlotte streets')
  if (panel) await expect(status(page)).toContainText('Disconnected')
  await page.waitForFunction('(window.__sm?.layer.index?.ids.length ?? 0) > 5000', null, { timeout: 30_000 })
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
  await expect(page.getByTestId('solver-meta')).toContainText('exact search over 10 combinations')
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
  await radio(page, 'data-mode', 'Guided scenario').click()
  await expect(page.getByTestId('data-status')).toContainText('Hypothetical barriers')
  await expect(status(page)).toContainText('Both curb ramps')
})

test('3D city layer is pixel-aligned with the basemap at any camera', async ({ page }) => {
  await open(page)
  for (const [pitch, bearing, zoom] of [[0, 0, 15], [45, -32, 16], [70, 120, 17.2], [60, -150, 14.6]]) {
    await page.evaluate(`window.__sm.map.jumpTo({ pitch: ${pitch}, bearing: ${bearing}, zoom: ${zoom} })`)
    await expectAligned(page)
  }
  await page.getByTestId('cam-top').click()
  await expect.poll(() => page.evaluate('window.__sm.map.getPitch()')).toBeLessThan(0.5)
  await page.getByTestId('cam-street').click()
  await expect.poll(() => page.evaluate('window.__sm.map.getZoom()')).toBeGreaterThan(18)
  await expectAligned(page)
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
  const titles = ['Real city context', 'Inspect the problem', 'Find repairs', 'Apply the first repair', 'Apply the second repair', 'Prove the value', 'Test it yourself']
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
  await page.getByTestId('open-help').click()
  await expect(page.getByTestId('help')).toBeVisible()
  await page.keyboard.press('Escape')
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
  await expect(page.getByTestId('solver-meta')).toContainText('exact search', { timeout: 30_000 })
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
