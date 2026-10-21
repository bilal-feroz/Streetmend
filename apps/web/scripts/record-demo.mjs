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
await pause(2500)

// ---- Primary demo: the change check, act by act, on the live engine ----
const act = async () => {
  await page.getByTestId('scene-next').click()
  await page.waitForFunction(() => !document.querySelector('[data-testid=scene-next]')?.hasAttribute('disabled') || document.querySelector('[data-testid=scene-title]')?.textContent === 'The engine is real', null, { timeout: 30000 })
}
await page.getByTestId('present').click()
await pause(2000)
await orbit(18, 4000) // 1 a city that works
await pause(3500)
await act() // 2 the planner proposes a change
await pause(4500)
await act() // 3 StreetMend finds a regression
await pause(5000)
// the same change, two travel profiles
await page.getByTestId('profile-walking').click()
await pause(3800)
await page.getByTestId('profile-step_free').click()
await pause(3800)
await page.getByTestId('profile-step_free').click()
await pause(800)
await act() // 4 StreetMend finds a fix
await pause(6500)
await act() // 5 apply and verify
await pause(7000)
await act() // 6 the engine is real: B off
await pause(4000)
await page.getByTestId('toggle-B').click() // and back on
await pause(4000)
await page.getByTestId('present').click()
await pause(1200)

// ---- Secondary demo: access gaps, fix or build, on real records ----
await page.getByTestId('data-mode').getByRole('radio', { name: 'Access gaps' }).click()
await page.getByTestId('access-title').waitFor()
await pause(4500)
await page.getByTestId('cell-8944d84d32fffff').click() // diagnose the worst cell
await page.getByTestId('diagnose').waitFor()
await pause(5500)
await page.getByTestId('run-compare').click() // fix or build, budget two
await page.getByTestId('intervene').waitFor()
await pause(5000)
await page.getByTestId('show-fix').click()
await pause(4500)
await page.getByTestId('access-budget').getByRole('radio', { name: '1 repair' }).click() // the answer flips
await page.waitForFunction(() => document.querySelector('[data-testid=option-build]')?.textContent?.includes('Wins'), null, { timeout: 20000 })
await pause(3000)
await page.getByTestId('show-build').click()
await pause(4500)
await page.getByTestId('cat-grocery').click() // when no store exists, repairs cannot help
await pause(4000)

// ---- Ask in plain English: the question drives the map ----
await page.getByTestId('ask-toggle').click()
await page.getByTestId('ask-input').pressSequentially('Which neighborhood has the poorest access to groceries?', { delay: 28 })
await page.keyboard.press('Enter')
await page.getByTestId('assistant-response').waitFor({ timeout: 30000 })
await pause(5000)

// ---- Evidence: the reproducible evaluation ----
await page.getByTestId('more-menu').click()
await page.getByTestId('open-evidence').click()
await page.getByTestId('evidence-score').waitFor()
await pause(5500)
await page.keyboard.press('Escape')
await pause(800)

await ctx.close()
await browser.close()
console.log('saved to', out)
