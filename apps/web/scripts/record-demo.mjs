// Records a real capture of the guided demo (no mock data): drives the running
// app with Playwright and saves a video. Requires API + web dev servers.
// Usage: node scripts/record-demo.mjs <outDir>
import { chromium } from '@playwright/test'

const out = process.argv[2] ?? 'demo-video'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: out, size: { width: 1440, height: 900 } } })
const page = await ctx.newPage()
const pause = (ms) => page.waitForTimeout(ms)

await page.goto('http://localhost:5173/')
await page.getByTestId('candidate-A').waitFor()
await pause(3500) // Act 1: disconnected journey

// Act 2: ask for a recommendation in plain language
await page.getByTestId('ask-input').click()
await page.getByTestId('ask-input').pressSequentially('Find the best two repairs for healthcare access', { delay: 35 })
await pause(400)
await page.getByTestId('ask-input').press('Enter')
await page.getByTestId('rec-A').waitFor()
await pause(3500)

// Act 3: first repair
await page.getByTestId('candidate-A').click()
await pause(1200)
await page.getByTestId('inspector-apply').click()
await pause(4200)

// Act 4: second repair reconnects the journey
await page.getByTestId('apply-B').click()
await pause(6500)

// Act 5: evidence
await page.getByTestId('impact').scrollIntoViewIfNeeded()
await pause(4500)

// Act 6: counterfactuals
await page.getByTestId('compare-before').click()
await pause(2500)
await page.getByTestId('compare-current').click()
await pause(2500)
await page.getByTestId('reset').click()
await pause(1500)
await page.locator('#sec-budget').scrollIntoViewIfNeeded()
await page.getByTestId('budget').getByRole('radio', { name: '1' }).click()
await pause(3000)
await page.getByTestId('priority').getByRole('radio', { name: 'Education' }).click()
await pause(3000)
await page.getByTestId('priority').getByRole('radio', { name: 'Healthcare' }).click()
await page.getByTestId('budget').getByRole('radio', { name: '2' }).click()
await pause(800)

// Real data
await page.getByTestId('mode-municipal').click()
await pause(5000)
await page.getByTestId('analyze').click()
await pause(4500)
// The same dependency in real records: two recorded barrier ramps on one journey
await page.getByTestId('toggle-candidates').scrollIntoViewIfNeeded()
await page.getByTestId('toggle-candidates').click()
await page.getByTestId('list-apply-R112391').click()
await pause(3500)
await page.getByTestId('list-apply-R20741').click()
await pause(6000)
await page.getByTestId('tab-records').click()
await pause(1500)
await page.getByTestId('record-list').locator('button').nth(3).click()
await pause(3500)
await page.getByTestId('tab-quality').click()
await pause(4000)

await ctx.close()
await browser.close()
console.log('saved to', out)
