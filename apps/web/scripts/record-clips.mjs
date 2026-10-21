// Records the real app as separate footage clips for the pitch video, logging when each
// action happens (seconds since the page opened, which is when the video starts).
// Usage: node scripts/record-clips.mjs <outDir>   (API and web dev servers running)
import { chromium } from '@playwright/test'
import { mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const out = process.argv[2] ?? 'clips'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] })
const W = 1920, H = 1080
const events = {}

const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null // ONLY=intro re-records one clip

async function clip(name, fn) {
  if (ONLY && !ONLY.includes(name)) return
  const dir = join(out, name)
  mkdirSync(dir, { recursive: true })
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, recordVideo: { dir, size: { width: W, height: H } } })
  const page = await ctx.newPage()
  const t0 = Date.now()
  const ev = {}
  const mark = (k) => { ev[k] = +((Date.now() - t0) / 1000).toFixed(2); console.log(name, k, ev[k]) }
  const pause = (ms) => page.waitForTimeout(ms)
  const orbit = (deg, ms) => page.evaluate(([d, t]) => { const m = window.__sm.map; m.easeTo({ bearing: m.getBearing() + d, duration: t, easing: (k) => k }) }, [deg, ms])
  try {
    await fn({ page, mark, pause, orbit })
  } finally {
    mark('end')
    await ctx.close()
    const f = readdirSync(dir).find((x) => x.endsWith('.webm'))
    if (f) renameSync(join(dir, f), join(out, `${name}.webm`))
    events[name] = ev
  }
}

const city = async (page) => page.waitForFunction('(window.__sm?.layer.index?.ids.length ?? 0) > 5000', null, { timeout: 60000 })

// 1. The opening: United States -> North Carolina -> Charlotte -> Elizabeth (a first visit)
await clip('intro', async ({ page, mark, pause, orbit }) => {
  await page.goto('http://localhost:5173/?intro=1')
  mark('goto')
  await page.getByTestId('intro').waitFor({ state: 'detached', timeout: 30000 })
  mark('landed')
  await orbit(14, 5000)
  await pause(5200)
})

// 2. The change check, end to end
await clip('check', async ({ page, mark, pause, orbit }) => {
  await page.goto('http://localhost:5173/?intro=0')
  await city(page)
  await page.getByTestId('check-chip').waitFor()
  await pause(2500)
  mark('today')
  await orbit(10, 3500)
  await pause(3600)
  await page.getByTestId('propose-P1').click()
  mark('propose')
  await pause(4500)
  await page.getByTestId('run-checks').click()
  mark('run')
  await page.getByTestId('banner-title').filter({ hasText: 'ACCESS REGRESSION DETECTED' }).waitFor()
  mark('regression')
  await pause(5000)
  await page.getByTestId('profile-walking').click()
  mark('walking')
  await pause(4200)
  await page.getByTestId('profile-step_free').click()
  mark('stepfree')
  await pause(4200)
  await page.getByTestId('profile-step_free').click()
  mark('profilesoff')
  await pause(1500)
  await page.getByTestId('find-fix').click()
  mark('findfix')
  await page.getByTestId('fix-title').waitFor()
  mark('fixfound')
  await pause(5500)
  await page.getByTestId('apply-fix').click()
  mark('apply')
  await page.getByTestId('banner-title').filter({ hasText: 'ACCESS RESTORED' }).waitFor({ timeout: 30000 })
  mark('restored')
  await pause(5000)
  await page.getByTestId('toggle-B').click()
  mark('boff')
  await page.getByTestId('banner-title').filter({ hasText: 'ACCESS REGRESSION DETECTED' }).waitFor({ timeout: 20000 })
  mark('bofffail')
  await pause(3200)
  await page.getByTestId('toggle-B').click()
  mark('bon')
  await page.getByTestId('banner-title').filter({ hasText: 'ACCESS RESTORED' }).waitFor({ timeout: 20000 })
  mark('bonpass')
  await pause(4000)
})

// 3. Access gaps: discover, diagnose, fix or build, verify, grocery, a question
await clip('access', async ({ page, mark, pause, orbit }) => {
  await page.goto('http://localhost:5173/?intro=0')
  await city(page)
  await pause(1500)
  await page.getByTestId('data-mode').getByRole('radio', { name: 'Access gaps' }).click()
  mark('access')
  await page.getByTestId('access-title').waitFor()
  await pause(3000)
  mark('orbit')
  await orbit(-22, 7000)
  await pause(7200)
  await page.getByTestId('cell-8944d84d32fffff').click()
  mark('cell')
  await page.getByTestId('diagnose').waitFor()
  await pause(6500)
  await page.getByTestId('run-compare').click()
  mark('compare')
  await page.getByTestId('intervene').waitFor()
  mark('compared')
  await pause(3500)
  await page.getByTestId('show-fix').click()
  mark('showfix')
  await pause(4500)
  await page.getByTestId('access-budget').getByRole('radio', { name: '1 repair' }).click()
  mark('budget1')
  await page.waitForFunction(() => document.querySelector('[data-testid=option-build]')?.textContent?.includes('Wins'), null, { timeout: 20000 })
  mark('buildwins')
  await pause(2500)
  await page.getByTestId('show-build').click()
  mark('showbuild')
  await pause(4500)
  await page.getByTestId('cat-grocery').click()
  mark('grocery')
  await pause(3500)
  await page.locator('[data-testid^=cell-]').first().click()
  mark('grocerycell')
  await page.getByTestId('diagnose').waitFor()
  await pause(3000)
  await page.getByTestId('run-compare').click()
  mark('grocerycompare')
  await page.getByTestId('intervene').waitFor()
  await pause(4000)
  await page.getByTestId('ask-toggle').click()
  mark('ask')
  await page.getByTestId('ask-input').pressSequentially('Which neighborhood has the poorest access to groceries?', { delay: 32 })
  await page.keyboard.press('Enter')
  mark('asked')
  await page.getByTestId('assistant-response').waitFor({ timeout: 30000 })
  mark('answer')
  await pause(5000)
  await page.getByTestId('more-menu').click()
  await page.getByTestId('open-evidence').click()
  mark('evidence')
  await page.getByTestId('evidence-score').waitFor()
  await pause(5000)
})

writeFileSync(join(out, ONLY ? `events.${ONLY.join('-')}.json` : 'events.json'), JSON.stringify(events, null, 1))
await browser.close()
console.log('clips in', out)
