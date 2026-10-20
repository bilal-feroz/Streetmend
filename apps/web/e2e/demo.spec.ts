import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const status = (page: Page) => page.getByTestId('journey-status')
const banner = (page: Page) => page.getByTestId('banner-title')

async function open(page: Page) {
  await page.goto('/')
  await expect(page.locator('.maplibregl-canvas')).toBeVisible()
  await expect(page.getByTestId('candidate-A')).toBeVisible()
  await expect(status(page)).toContainText('Unavailable')
}

test('guided demo: two dependent repairs reconnect the journey', async ({ page, request }) => {
  // Act 1 - the city is disconnected
  await open(page)
  await expect(status(page)).toContainText('Two inaccessible connections (A, B)')

  // Act 2 - budget two, healthcare priority, analyze
  await page.getByTestId('budget').getByRole('radio', { name: '2' }).click()
  await page.getByTestId('priority').getByRole('radio', { name: 'Healthcare' }).click()
  await page.getByTestId('analyze').click()
  await expect(page.getByTestId('solver-meta')).toContainText('Exact enumeration')
  await expect(page.getByTestId('rec-A')).toBeVisible()
  await expect(page.getByTestId('rec-B')).toBeVisible()
  await expect(page.getByTestId('combined-effect')).toContainText('Synergy')

  // The UI shows what the engine computed.
  const api = await (await request.post('http://127.0.0.1:8000/api/scenarios/demo/optimize', { data: { budget: 2, priority: 'healthcare' } })).json()
  expect(api.recommendation.selected.sort()).toEqual(['A', 'B'])
  await expect(page.getByTestId('baselines')).toContainText(`+${api.objective.gain}`)

  // Act 3 - first repair: still disconnected
  await page.getByTestId('apply-A').click()
  await expect(status(page)).toContainText('Unavailable')
  await expect(status(page)).toContainText('(B)')
  await expect(banner(page)).toContainText('Repair A completed')

  // Act 4 - second repair: connected
  await page.getByTestId('apply-B').click()
  await expect(status(page)).toContainText('Connected')
  await expect(banner(page)).toHaveText('TWO REPAIRS. ONE RECONNECTED JOURNEY.')
  await expect(page.getByTestId('banner')).toContainText('Neither intervention completes this crossing alone')

  // Act 5 - evidence: route length shown equals the backend route length
  const ev = await (await request.post('http://127.0.0.1:8000/api/scenarios/demo/evaluate', { data: { applied: ['A', 'B'], origin: 'O2', destination: 'D_CLINIC', weights: { healthcare: 3, transit: 1, education: 1 } } })).json()
  await expect(status(page)).toContainText(`${Math.round(ev.journey.route.length_m)} m`)
  await expect(page.getByTestId('objective-now')).toContainText(String(ev.metrics.score))

  // Act 6 - counterfactuals: undo, before/after, reset
  await page.getByTestId('undo').click()
  await expect(status(page)).toContainText('(B)')
  await page.getByTestId('apply-B').click()
  await expect(status(page)).toContainText('Connected')
  await page.getByTestId('compare-before').click()
  await expect(status(page)).toContainText('Unavailable')
  await page.getByTestId('compare-current').click()
  await expect(status(page)).toContainText('Connected')
  await page.getByTestId('reset').click()
  await expect(status(page)).toContainText('Two inaccessible connections (A, B)')
  await expect(page.getByTestId('bottom-strip')).toContainText('none')
  // Undo restores the exact previous state, including after a reset or a removal.
  await page.getByTestId('undo').click()
  await expect(status(page)).toContainText('Connected')
  await page.getByTestId('remove-A').click()
  await expect(status(page)).toContainText('(A)')
  await page.getByTestId('undo').click()
  await expect(status(page)).toContainText('Connected')
})

test('changing parameters recomputes the recommendation', async ({ page }) => {
  await open(page)
  await page.getByTestId('analyze').click()
  await expect(page.getByTestId('rec-A')).toBeVisible()

  await page.getByTestId('priority').getByRole('radio', { name: 'Education' }).click()
  await expect(page.getByTestId('rec-E')).toBeVisible()
  await expect(page.getByTestId('rec-A')).toHaveCount(0)

  await page.getByTestId('priority').getByRole('radio', { name: 'Healthcare' }).click()
  await page.getByTestId('budget').getByRole('radio', { name: '1' }).click()
  await expect(page.getByTestId('rec-C')).toBeVisible()
  await expect(page.getByTestId('rec-A')).toHaveCount(0)

  await page.getByTestId('budget').getByRole('radio', { name: '0' }).click()
  await expect(page.getByTestId('recommendations')).toHaveCount(0)
  await expect(page.getByText('Budget is zero, so no repairs were selected.')).toBeVisible()
})

test('map candidate inspector applies and removes a repair', async ({ page }) => {
  await open(page)
  await page.getByTestId('candidate-A').click()
  await page.getByTestId('inspector-apply').click()
  await expect(status(page)).toContainText('(B)')
  await page.getByTestId('candidate-A').click()
  await page.getByTestId('inspector-remove').click()
  await expect(status(page)).toContainText('(A, B)')
})

test('assistant maps questions to allowlisted operations', async ({ page }) => {
  await open(page)
  const ask = async (text: string) => {
    await page.getByTestId('ask-input').fill(text)
    await page.getByTestId('ask-input').press('Enter')
  }
  await ask('Which two repairs improve access to healthcare the most?')
  await expect(page.getByTestId('assistant-op')).toContainText('Optimize repairs')
  await expect(page.getByTestId('rec-A')).toBeVisible()
  await ask('What happens if I can only repair one?')
  await expect(page.getByTestId('assistant-op')).toContainText('Compare budgets')
  await expect(page.getByTestId('assistant-response')).toContainText('With 1 repair(s): C')
  await ask('delete all files on the server')
  await expect(page.getByTestId('assistant-op')).toContainText('Unsupported request')
})

test('methodology and provenance are inspectable', async ({ page }) => {
  await open(page)
  await page.getByTestId('open-methodology').click()
  const dlg = page.getByTestId('methodology')
  await expect(dlg).toBeVisible()
  await expect(dlg).toContainText('Score(S)')
  await expect(dlg).toContainText('AskStreets')
  await expect(dlg).toContainText('not an ADA')
  await page.keyboard.press('Escape')
  await expect(dlg).not.toBeVisible()
})

test('keyboard users can run the analysis', async ({ page }) => {
  await open(page)
  await page.getByTestId('analyze').focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('rec-A')).toBeVisible()
  await page.getByTestId('apply-A').focus()
  await page.keyboard.press('Enter')
  await expect(status(page)).toContainText('(B)')
})

test('Charlotte data explorer loads real records and plans on them', async ({ page }) => {
  await open(page)
  await page.getByTestId('mode-municipal').click()
  await expect(page.getByTestId('data-status')).toContainText('Municipal records')
  await expect(status(page)).toBeVisible()
  await page.getByTestId('analyze').click()
  await expect(page.getByTestId('solver-meta')).toContainText('Exact enumeration', { timeout: 30_000 })
  // Real-data dependency: two recorded ramps block the default home -> hospital journey.
  await expect(status(page)).toContainText('Two inaccessible connections (R112391, R20741)')
  await page.getByTestId('toggle-candidates').click()
  await page.getByTestId('list-apply-R112391').click()
  await expect(status(page)).toContainText('(R20741)')
  await page.getByTestId('list-apply-R20741').click()
  await expect(status(page)).toContainText('Connected')
  await page.getByTestId('tab-records').click()
  await expect(page.getByText('320 CDOT curb-ramp records in the study area')).toBeVisible()
  await page.getByTestId('record-list').locator('button').first().click()
  await expect(page.getByTestId('record-detail')).toContainText('OBJECTID')
  await page.getByTestId('tab-quality').click()
  await expect(page.getByText('Coverage of the modeled graph')).toBeVisible()
  await page.getByTestId('tab-plan').click()
  await page.getByTestId('policy').getByRole('radio', { name: 'Strict' }).click()
  await expect(page.locator('#planning').getByText('Every ramp not recorded as compliant or remediated is a barrier.').first()).toBeVisible()
})

test('no serious automated accessibility violations', async ({ page }) => {
  await open(page)
  await page.getByTestId('analyze').click()
  await expect(page.getByTestId('rec-A')).toBeVisible()
  const results = await new AxeBuilder({ page }).exclude('.maplibregl-canvas').analyze()
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(serious.map((v) => `${v.id}: ${v.nodes.length} nodes`)).toEqual([])
})
