// Records a real capture of the working app (no mock data): drives the running
// UI with Playwright and saves a video. Requires the API and web dev servers.
// Usage: node scripts/record-demo.mjs <outDir>
// The GPU flags let headless Chromium render the 3D city on the real GPU.
import { chromium } from '@playwright/test'

const out = process.argv[2] ?? 'demo-video'
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: out, size: { width: 1440, height: 900 } } })
const page = await ctx.newPage()
const pause = (ms) => page.waitForTimeout(ms)
const next = async () => {
  await page.getByTestId('scene-next').click()
  await page.waitForFunction(() => !document.querySelector('[data-testid=scene-next]')?.hasAttribute('disabled') || document.querySelector('[data-testid=scene-title]')?.textContent === 'Test it yourself')
}
const orbit = (deg, ms) => page.evaluate(([d, t]) => { const m = window.__sm.map; m.easeTo({ bearing: m.getBearing() + d, duration: t }) }, [deg, ms])

await page.goto('http://localhost:5173/')
await page.waitForFunction(() => (window.__sm?.layer.index?.ids.length ?? 0) > 5000)
await pause(2500)

// Guided story, narrated by presentation mode
await page.getByTestId('present').click()
await pause(2500)
await orbit(28, 4500) // scene 1: real Charlotte streets and footprints
await pause(5000)
await next() // scene 2: the blocked crossing, inspected
await pause(3500)
await page.getByTestId('inspector').getByRole('button', { name: 'Pedestrian' }).click()
await pause(3500)
await next() // scene 3: exact search over every combination
await pause(5500)
await next() // scene 4: Repair A alone, still disconnected
await pause(6000)
await next() // scene 5: Repair B reconnects the journey
await pause(8500)
await next() // scene 6: before/after split
await pause(2000)
const h = await page.getByRole('slider', { name: 'Before and after comparison position' }).boundingBox()
if (h) {
  const [x, y] = [h.x + h.width / 2, h.y + h.height / 2]
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 30; i++) await page.mouse.move(x - i * 8, y, { steps: 2 })
  for (let i = 1; i <= 50; i++) await page.mouse.move(x - 240 + i * 8, y, { steps: 2 })
  await page.mouse.up()
}
await pause(3500)
await next() // scene 7: free exploration
await pause(2500)
await page.getByTestId('present').click()
await pause(1000)

// One repair is not enough
await page.getByTestId('edit-plan').click()
await page.getByTestId('budget').getByRole('radio', { name: '1', exact: true }).click()
await page.getByTestId('analyze').click()
await pause(4500)
await page.getByTestId('edit-plan').click()
await page.getByTestId('budget').getByRole('radio', { name: '2', exact: true }).click()
await page.getByTestId('analyze').click()
await pause(2500)

// Precision 2D view and back
await page.getByTestId('map-mode').getByRole('radio', { name: '2D' }).click()
await pause(3500)
await page.getByTestId('map-mode').getByRole('radio', { name: '3D' }).click()
await pause(3000)

// Real municipal records
await page.getByTestId('data-mode').getByRole('radio', { name: 'Data explorer' }).click()
await page.getByTestId('data-status').filter({ hasText: 'Municipal records' }).waitFor()
await pause(4500)
await page.getByTestId('tab-records').click()
await pause(1500)
await page.getByLabel('Filter records').pressSequentially('225', { delay: 120 })
await page.getByTestId('record-list').locator('button').first().click()
await pause(5000)
await page.getByTestId('tab-quality').click()
await pause(4000)
await page.getByTestId('data-mode').getByRole('radio', { name: 'Guided scenario' }).click()
await pause(3500)

await ctx.close()
await browser.close()
console.log('saved to', out)
