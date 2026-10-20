// Accessibility triage helper: prints serious/critical axe findings for a state.
// Usage: node scripts/axe-report.mjs <url> "<capture-style steps>"
import AxeBuilder from '@axe-core/playwright'
import { chromium } from '@playwright/test'
const [,, url, script = ''] = process.argv
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.goto(url)
await page.waitForTimeout(5000)
for (const a of script.split(';').filter(Boolean)) {
  const i = a.indexOf('=')
  const kind = a.slice(0, i), arg = a.slice(i + 1)
  if (kind === 'click') await page.locator(arg).first().click()
  if (kind === 'wait') await page.waitForTimeout(+arg)
}
const r = await new AxeBuilder({ page }).exclude('.maplibregl-canvas').analyze()
for (const v of r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'))
  for (const n of v.nodes) console.log(v.id, '|', n.target.join(' '), '|', n.failureSummary?.split('\n').slice(1, 2).join(' '), '|', n.html.slice(0, 140))
await browser.close()
