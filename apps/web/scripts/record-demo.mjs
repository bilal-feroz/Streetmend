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
const orbit = (deg, ms) => page.evaluate(([d, t]) => { const m = window.__sm.map; m.easeTo({ bearing: m.getBearing() + d, duration: t }) }, [deg, ms])

// The opening: United States -> North Carolina -> Charlotte -> Elizabeth (a first visit)
await page.goto('http://localhost:5173/?intro=1')
await page.getByTestId('intro').waitFor({ state: 'detached', timeout: 20000 })
await pause(3000)

// The change check, act by act, on the live engine
const act = async () => {
  await page.getByTestId('scene-next').click()
  await page.waitForFunction(() => !document.querySelector('[data-testid=scene-next]')?.hasAttribute('disabled') || document.querySelector('[data-testid=scene-title]')?.textContent === 'The engine is real', null, { timeout: 30000 })
}
await page.getByTestId('present').click()
await pause(2500)
await orbit(20, 4500) // 1 a city that works
await pause(4000)
await act() // 2 the planner proposes a change
await pause(5000)
await act() // 3 StreetMend finds a regression
await pause(7500)
await act() // 4 StreetMend finds a fix
await pause(7500)
await act() // 5 apply and verify
await pause(8000)
await act() // 6 the engine is real: B off
await pause(4500)
await page.getByTestId('toggle-B').click() // and back on
await pause(5000)
await page.getByTestId('present').click()
await pause(1500)

// Any crossing can be proposed: the same engine, a different change
await page.getByTestId('reset-check').click()
await pause(3000)

// The original tools: repair planner and real municipal records
await page.getByTestId('data-mode').getByRole('radio', { name: 'Repair planner' }).click()
await page.getByTestId('journey-card').waitFor()
await pause(3500)
await page.getByTestId('analyze').click()
await pause(4000)
await page.getByTestId('apply-all').click()
await pause(7000)
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
await page.getByTestId('data-mode').getByRole('radio', { name: 'Change check' }).click()
await pause(3500)

await ctx.close()
await browser.close()
console.log('saved to', out)
